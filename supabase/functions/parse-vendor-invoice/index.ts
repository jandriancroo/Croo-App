import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  extractInvoiceFromImage,
  imageBufferToBase64,
  AiRateLimitedError,
  AiCreditsExhaustedError,
} from "../_shared/invoice-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Auth check
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    let { invoiceId, storagePath, locationId, countId } = body || {};

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Symmetric guard: this endpoint writes to Brand governance tables
    // (vendor_invoices, inventory_items, vendor_gap_alerts). Refuse if the
    // target location is Lite mode — those uploads must go through
    // parse-vendor-invoice-lite and stay in lite_* tables.
    if (locationId) {
      const { data: loc } = await admin
        .from("locations")
        .select("id, inventory_mode")
        .eq("id", locationId)
        .single();
      if ((loc as any)?.inventory_mode === "lite") {
        return new Response(JSON.stringify({ error: "Location is in Lite inventory mode — use parse-vendor-invoice-lite" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Allow client to skip pre-inserting vendor_invoices row (bypasses RLS friction on stale sessions).
    if (!invoiceId && storagePath && locationId) {
      const { data: created, error: createErr } = await admin
        .from("vendor_invoices")
        .insert({
          location_id: locationId,
          vendor_name: "Unknown",
          image_url: `vendor-invoices/${storagePath}`,
          uploaded_by: user.id,
          inventory_count_id: countId || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (createErr || !created) throw new Error("Failed to create invoice record: " + (createErr?.message || "unknown"));
      invoiceId = created.id;
    }

    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId or (storagePath+locationId) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get invoice record
    const { data: invoice, error: invErr } = await admin
      .from("vendor_invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) throw new Error("Invoice not found");

    // Get the image URL (signed if private bucket)
    let imageUrl = invoice.image_url;
    if (imageUrl && imageUrl.startsWith("vendor-invoices/")) {
      const { data: signedData } = await admin.storage
        .from("vendor-invoices")
        .createSignedUrl(imageUrl.replace("vendor-invoices/", ""), 600);
      if (signedData?.signedUrl) imageUrl = signedData.signedUrl;
    }
    if (!imageUrl) throw new Error("No image URL on invoice");

    // Fetch the image and convert to base64
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) throw new Error("Failed to fetch invoice image");
    const base64Image = imageBufferToBase64(await imageResp.arrayBuffer());
    const contentType = imageResp.headers.get("content-type") || "image/jpeg";

    const normalizeKey = (value: unknown) => String(value ?? "").trim().toLowerCase();
    const firstNonEmpty = (...values: unknown[]) => {
      for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
      }
      return null;
    };

    function generateItemId(vendorName: string, productName: string): string {
      const slug = (vendorName || "unknown").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
      let hash = 0;
      const normalized = productName.toLowerCase().trim();
      for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
      }
      const hexHash = Math.abs(hash).toString(16).slice(0, 6);
      return `INV-${slug}-${hexHash}`;
    }

    // Call Lovable AI via shared helper
    let parsed;
    try {
      parsed = await extractInvoiceFromImage(base64Image, contentType, lovableApiKey);
    } catch (e) {
      if (e instanceof AiRateLimitedError) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (e instanceof AiCreditsExhaustedError) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }
    console.log("Parsed invoice:", JSON.stringify(parsed).slice(0, 500));

    // Use delivery_date from AI, falling back to invoice_date so the order is discoverable by date
    const effectiveDeliveryDate = parsed.delivery_date || parsed.invoice_date || null;

    // Location + brand (fetched first so we can reject buyer-side names as "vendor")
    const { data: locationRow } = await admin
      .from("locations")
      .select("id, name, organization_id")
      .eq("id", invoice.location_id)
      .single();

    let brandId: string | null = null;
    let orgName: string | null = null;
    if (locationRow?.organization_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("brand_id, name")
        .eq("id", locationRow.organization_id)
        .single();
      brandId = org?.brand_id || null;
      orgName = org?.name || null;
    }

    // Guard: the AI sometimes grabs the "Bill To"/"Sold To" party (our own org/location)
    // as the vendor. Never let a buyer-side name become the vendor name.
    const normalize = (s: string) =>
      s.toLowerCase().replace(/\b(inc|llc|l\.l\.c|corp|co|ltd)\b\.?/g, "").replace(/[^a-z0-9]/g, "").trim();
    const buyerNames = [orgName, locationRow?.name].filter(Boolean).map((n) => normalize(n as string));
    const parsedVendor = parsed.vendor_name?.trim() || "";
    const isBuyerName =
      !!parsedVendor &&
      buyerNames.some((b) => b.length > 3 && (normalize(parsedVendor) === b || normalize(parsedVendor).includes(b) || b.includes(normalize(parsedVendor))));
    if (isBuyerName) {
      console.warn(`Rejected buyer-side vendor_name from AI: "${parsedVendor}"`);
      parsed.vendor_name = invoice.vendor_name && invoice.vendor_name !== "Unknown" ? invoice.vendor_name : undefined;
    }

    await admin.from("vendor_invoices").update({
      vendor_name: parsed.vendor_name || invoice.vendor_name,
      invoice_number: parsed.invoice_number || invoice.invoice_number,
      invoice_date: parsed.invoice_date || null,
      delivery_date: effectiveDeliveryDate,
      total_amount: parsed.total_amount || null,
      parsed_at: new Date().toISOString(),
      status: "parsed",
    }).eq("id", invoiceId);


    // Fetch location items
    const { data: locationItems } = await admin
      .from("inventory_items")
      .select("id, name, item_number, pa_item_id, vendor_item_id, brand_item_id, cost_per_unit")
      .eq("location_id", invoice.location_id)
      .eq("status", "active");

    // Get existing brand templates AND vendor mappings for dedup
    let existingTemplates: any[] = [];
    let existingVendorMappings: any[] = [];
    if (brandId) {
      const [templatesRes, mappingsRes] = await Promise.all([
        admin
          .from("brand_inventory_templates")
          .select("id, product_name, item_number, pa_item_id, vendor_source")
          .eq("brand_id", brandId),
        admin
          .from("brand_vendor_mappings")
          .select("brand_template_id, vendor, vendor_item_id")
      ]);
      existingTemplates = templatesRes.data || [];
      existingVendorMappings = mappingsRes.data || [];
    }

    const localByItemNumber = new Map<string, any>();
    const localByPaId = new Map<string, any>();
    const localByName = new Map<string, any>();
    const localByBrandItemId = new Map<string, any>();
    for (const item of locationItems || []) {
      if (item.item_number) localByItemNumber.set(normalizeKey(item.item_number), item);
      if ((item as any).pa_item_id) localByPaId.set(normalizeKey((item as any).pa_item_id), item);
      if (item.name) localByName.set(normalizeKey(item.name), item);
      if (item.brand_item_id) localByBrandItemId.set(item.brand_item_id, item);
    }

    const templateByItemNumber = new Map<string, any>();
    const templateByPaId = new Map<string, any>();
    const templateByName = new Map<string, any>();
    for (const template of existingTemplates) {
      if (template.item_number) templateByItemNumber.set(normalizeKey(template.item_number), template);
      if ((template as any).pa_item_id) templateByPaId.set(normalizeKey((template as any).pa_item_id), template);
      if (template.product_name) templateByName.set(normalizeKey(template.product_name), template);
    }

    const templateIdByVendorKey = new Map<string, string>();
    const templateIdByAnyVendorSku = new Map<string, string>();
    for (const mapping of existingVendorMappings) {
      const vendorItemId = String(mapping.vendor_item_id || "").trim();
      const vendor = String((mapping as any).vendor || "").trim().toLowerCase();
      if (!vendorItemId) continue;
      templateIdByVendorKey.set(`${vendor}:${normalizeKey(vendorItemId)}`, mapping.brand_template_id);
      templateIdByAnyVendorSku.set(normalizeKey(vendorItemId), mapping.brand_template_id);
    }

    const insertItems: any[] = [];
    const newGapAlerts: any[] = [];
    const priceUpdates: { id: string; cost: number; pack_size?: string | null }[] = [];

    for (const li of parsed.line_items || []) {
      const vendorItemNumber = firstNonEmpty(li.item_number, (li as any).dist_item_number, (li as any).distributor_item_number, (li as any).item_code);
      const paProductId = firstNonEmpty(li.pa_product_id, (li as any).pa_item_id, (li as any).paProductId);

      if (!vendorItemNumber && !paProductId && li.product_name) {
        li.item_number = generateItemId(parsed.vendor_name || "", li.product_name);
      } else {
        li.item_number = vendorItemNumber || paProductId || li.item_number || undefined;
      }

      let matchedTemplateId: string | null = null;
      let match = null;

      if (paProductId) {
        match = localByPaId.get(normalizeKey(paProductId)) || null;
        matchedTemplateId =
          templateIdByVendorKey.get(`produce_alliance:${normalizeKey(paProductId)}`) ||
          templateIdByVendorKey.get(`pa:${normalizeKey(paProductId)}`) ||
          templateByPaId.get(normalizeKey(paProductId))?.id ||
          null;
        if (!match && matchedTemplateId) {
          match = localByBrandItemId.get(matchedTemplateId) || null;
        }
      }

      if (!match && li.item_number) {
        match = localByItemNumber.get(normalizeKey(li.item_number)) || null;
      }
      if (!match && li.product_name) {
        match = localByName.get(normalizeKey(li.product_name)) || null;
      }
      if (!matchedTemplateId) {
        matchedTemplateId =
          (match?.brand_item_id as string | undefined) ||
          (paProductId ? templateByPaId.get(normalizeKey(paProductId))?.id : null) ||
          (li.item_number ? templateByItemNumber.get(normalizeKey(li.item_number))?.id : null) ||
          (li.item_number ? templateIdByAnyVendorSku.get(normalizeKey(li.item_number)) : null) ||
          (li.product_name ? templateByName.get(normalizeKey(li.product_name))?.id : null) ||
          null;
      }
      if (!match && matchedTemplateId) {
        match = localByBrandItemId.get(matchedTemplateId) || null;
      }

      const itemRow: any = {
        invoice_id: invoiceId,
        product_name: li.product_name,
        item_number: li.item_number || null,
        quantity: li.quantity || null,
        unit: li.unit || null,
        unit_price: li.unit_price || null,
        total_price: li.total_price || null,
        match_status: match ? "matched" : matchedTemplateId ? "matched_brand" : "unmatched",
        matched_item_id: match?.id || null,
        matched_template_id: matchedTemplateId,
      };

      if (match && li.unit_price && li.unit_price > 0) {
        priceUpdates.push({
          id: match.id,
          cost: li.unit_price,
          pack_size: (li as any).pack_size || li.unit || null,
        });
      }

      if (!match && !matchedTemplateId && brandId && li.product_name) {
        const fallbackGapId = paProductId || li.item_number || generateItemId(parsed.vendor_name || "", li.product_name);
        if (!templateByName.get(normalizeKey(li.product_name))) {
          newGapAlerts.push({
            brand_id: brandId,
            item_number: fallbackGapId,
            vendor_name: parsed.vendor_name || "Unknown Vendor",
            vendor_description: li.product_name,
            vendor_source: paProductId ? "produce_alliance" : `invoice`,
            category_name: null,
            pack_size: li.unit || null,
            status: "new",
          });
        }
      }

      insertItems.push(itemRow);
    }

    // Insert parsed line items
    if (insertItems.length > 0) {
      const { error: itemsErr } = await admin
        .from("vendor_invoice_items")
        .insert(insertItems);
      if (itemsErr) console.error("Error inserting invoice items:", itemsErr);
    }

    // Update matched item costs and pack metadata
    for (const update of priceUpdates) {
      const updateData: Record<string, any> = { cost_per_unit: update.cost };
      if (update.pack_size) updateData.pack_size = update.pack_size;
      await admin
        .from("inventory_items")
        .update(updateData)
        .eq("id", update.id);
    }

    // Write unmatched items to vendor_gap_alerts for unified brand review
    if (newGapAlerts.length > 0) {
      const { error: gapErr } = await admin
        .from("vendor_gap_alerts")
        .upsert(newGapAlerts, { onConflict: "brand_id,vendor_source,item_number", ignoreDuplicates: true });
      if (gapErr) console.error("Error creating gap alerts:", gapErr);
    }

    const matchedCount = insertItems.filter(i => i.match_status === "matched" || i.match_status === "matched_brand").length;
    const unmatchedCount = insertItems.filter(i => i.match_status === "unmatched").length;

    return new Response(JSON.stringify({
      success: true,
      mode: "brand",
      invoice_id: invoiceId,
      vendor_name: parsed.vendor_name,
      invoice_date: parsed.invoice_date || null,
      delivery_date: effectiveDeliveryDate,
      total_amount: parsed.total_amount || null,
      total_items: insertItems.length,
      matched: matchedCount,
      unmatched: unmatchedCount,
      new_gap_alerts: newGapAlerts.length,
      price_updates: priceUpdates.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-vendor-invoice error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
