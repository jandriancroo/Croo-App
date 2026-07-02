import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    // NEW: allow client to skip pre-inserting vendor_invoices row (bypasses RLS friction on stale sessions).
    // If storagePath + locationId are supplied and no invoiceId, create the row here with service role.
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

    // Fetch the image and convert to base64 (chunked to avoid stack overflow on large files)
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) throw new Error("Failed to fetch invoice image");
    const imageBuffer = await imageResp.arrayBuffer();
    const bytes = new Uint8Array(imageBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64Image = btoa(binary);
    const contentType = imageResp.headers.get("content-type") || "image/jpeg";

    const normalizeKey = (value: unknown) => String(value ?? "").trim().toLowerCase();
    const firstNonEmpty = (...values: unknown[]) => {
      for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
      }
      return null;
    };

    // Deterministic ID for items with no vendor SKU (used by both Brand and Lite paths).
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


    // Call Lovable AI with vision to extract line items
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an invoice parser. Extract all line items from this vendor invoice image.

CRITICAL — VENDOR IDENTIFICATION:
- vendor_name MUST be the SELLER / DISTRIBUTOR / SUPPLIER — the company that issued the invoice and is being paid.
- Look for labels like "Remit To", "From", "Sold By", "Vendor", the letterhead/logo at the top, or a "Please make checks payable to" line.
- NEVER use the "Sold To", "Bill To", "Ship To", "Customer", or "Deliver To" party — that is the buyer (the restaurant/store).
- If the letterhead shows a beer/beverage distributor, produce house, or broadline supplier, that is the vendor.
- If unsure between two names, pick the one with the remit address, phone number for orders, or account/customer number formatted as "Customer #".

For each line item extract: product_name, item_number (vendor/distributor SKU if visible), pa_product_id (ONLY the value from a column literally labeled PA Product ID or equivalent), quantity, unit (case/each/lb/etc), unit_price, total_price.
If the invoice has multiple code columns (for example Dist Item, Item, and PA Product ID), keep the PA Product ID in pa_product_id and keep the other vendor/distributor code in item_number.
For Worldwide Produce / Produce Alliance style invoices, prefer the human-readable Description column for product_name and capture the PA Product ID exactly as shown.
Also extract: invoice_number, invoice_date (YYYY-MM-DD), delivery_date (YYYY-MM-DD if shown), total_amount.
Return ONLY valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${contentType};base64,${base64Image}` },
              },
              { type: "text", text: "Parse this invoice. Extract all line items and invoice metadata." },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_invoice",
              description: "Extract structured invoice data from image",
              parameters: {
                type: "object",
                properties: {
                  vendor_name: { type: "string" },
                  invoice_number: { type: "string" },
                  invoice_date: { type: "string", description: "YYYY-MM-DD" },
                  delivery_date: { type: "string", description: "YYYY-MM-DD or null" },
                  total_amount: { type: "number" },
                  line_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        product_name: { type: "string" },
                        item_number: { type: "string" },
                        pa_product_id: { type: "string" },
                        quantity: { type: "number" },
                        unit: { type: "string" },
                        unit_price: { type: "number" },
                        total_price: { type: "number" },
                      },
                      required: ["product_name"],
                    },
                  },
                },
                required: ["vendor_name", "line_items"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_invoice" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI parsing failed: " + errText);
    }

    const aiResult = await aiResp.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI returned no structured data");

    const parsed = JSON.parse(toolCall.function.arguments);
    console.log("Parsed invoice:", JSON.stringify(parsed).slice(0, 500));

    // Update invoice metadata
    // Use delivery_date from AI, falling back to invoice_date so the order is discoverable by date
    const effectiveDeliveryDate = parsed.delivery_date || parsed.invoice_date || null;

    await admin.from("vendor_invoices").update({
      vendor_name: parsed.vendor_name || invoice.vendor_name,
      invoice_number: parsed.invoice_number || invoice.invoice_number,
      invoice_date: parsed.invoice_date || null,
      delivery_date: effectiveDeliveryDate,
      total_amount: parsed.total_amount || null,
      parsed_at: new Date().toISOString(),
      status: "parsed",
    }).eq("id", invoiceId);

    // ─────────────────────────────────────────────────────────────
    // TENANT MODE FORK — Brand path is byte-identical to prior behavior.
    // Lite path skips brand templates, vendor mappings, and gap alerts.
    // ─────────────────────────────────────────────────────────────
    const { data: locationRow } = await admin
      .from("locations")
      .select("id, organization_id, inventory_mode")
      .eq("id", invoice.location_id)
      .single();

    const inventoryMode: "brand" | "lite" =
      (locationRow as any)?.inventory_mode === "lite" ? "lite" : "brand";

    // Fetch location items — needed by both paths.
    const { data: locationItems } = await admin
      .from("inventory_items")
      .select("id, name, item_number, pa_item_id, vendor_item_id, brand_item_id, cost_per_unit, vendor_name_normalized")
      .eq("location_id", invoice.location_id)
      .eq("status", "active");

    // ═════════════════════ LITE PATH ═════════════════════
    if (inventoryMode === "lite") {
      // Fuzzy match threshold — tune after real invoice testing.
      const FUZZY_MATCH_THRESHOLD = 0.7;

      // Simple trigram-like similarity (Dice coefficient on bigrams).
      const bigrams = (s: string): Set<string> => {
        const t = ` ${s.toLowerCase().trim()} `;
        const out = new Set<string>();
        for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
        return out;
      };
      const similarity = (a: string, b: string): number => {
        if (!a || !b) return 0;
        const A = bigrams(a);
        const B = bigrams(b);
        if (A.size === 0 || B.size === 0) return 0;
        let inter = 0;
        for (const g of A) if (B.has(g)) inter++;
        return (2 * inter) / (A.size + B.size);
      };

      const normalizedVendor = normalizeKey(parsed.vendor_name);

      // Build Lite lookup indexes — only local items, no brand tables touched.
      const liteByComposite = new Map<string, any>();
      const liteByName = new Map<string, any>();
      for (const item of locationItems || []) {
        const vNorm = (item as any).vendor_name_normalized || "";
        const num = normalizeKey(item.item_number || "");
        if (vNorm && num) liteByComposite.set(`${vNorm}::${num}`, item);
        if (item.name) liteByName.set(normalizeKey(item.name), item);
      }

      const liteInsertLines: any[] = [];
      const liteNewItems: Array<{ line: any; row: any }> = [];
      const litePriceUpdates: { id: string; cost: number }[] = [];

      for (const li of parsed.line_items || []) {
        const vendorItemNumber = firstNonEmpty(
          li.item_number, li.dist_item_number, li.distributor_item_number, li.item_code
        );
        // Fall back to deterministic hash for handwritten local invoices with no vendor code.
        const stableCode = vendorItemNumber
          || (li.product_name ? generateItemId(parsed.vendor_name, li.product_name) : null);
        li.item_number = stableCode;

        let match: any = null;
        let matchStatus: "matched" | "fuzzy" | "new" = "new";
        let candidateItemId: string | null = null;

        // (a) Composite key — normalized vendor + item_number. Never item_number alone.
        if (normalizedVendor && stableCode) {
          match = liteByComposite.get(`${normalizedVendor}::${normalizeKey(stableCode)}`) || null;
          if (match) matchStatus = "matched";
        }

        // (b) Exact normalized product name.
        if (!match && li.product_name) {
          match = liteByName.get(normalizeKey(li.product_name)) || null;
          if (match) matchStatus = "matched";
        }

        // (c) Fuzzy name — do NOT auto-merge. Phase 2 UI resolves.
        if (!match && li.product_name) {
          let best: { item: any; score: number } | null = null;
          for (const [name, item] of liteByName) {
            const score = similarity(li.product_name, name);
            if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
              best = { item, score };
            }
          }
          if (best) {
            matchStatus = "fuzzy";
            candidateItemId = best.item.id;
          }
        }

        // (d) No match → auto-create item.
        let newItemRow: any = null;
        if (!match && matchStatus !== "fuzzy") {
          matchStatus = "new";
          newItemRow = {
            location_id: invoice.location_id,
            brand_item_id: null,
            name: li.product_name,
            item_number: stableCode,
            vendor_name_normalized: normalizedVendor || null,
            cost_per_unit: li.unit_price && li.unit_price > 0 ? li.unit_price : null,
            status: "active",
            match_status: "new",
          };
        }

        // Reorder path — matched (a/b) lines update cost.
        if (match && matchStatus === "matched" && li.unit_price && li.unit_price > 0) {
          litePriceUpdates.push({ id: match.id, cost: li.unit_price });
        }

        const line: any = {
          invoice_id: invoiceId,
          product_name: li.product_name,
          item_number: stableCode,
          quantity: li.quantity || null,
          unit: li.unit || null,
          unit_price: li.unit_price || null,
          total_price: li.total_price || null,
          match_status: matchStatus,
          matched_item_id: match?.id || null,
          matched_template_id: null,
          candidate_item_id: candidateItemId,
        };

        if (newItemRow) {
          liteNewItems.push({ line, row: newItemRow });
        } else {
          liteInsertLines.push(line);
        }
      }

      // Insert new inventory_items first so we can attach their ids to invoice lines.
      if (liteNewItems.length > 0) {
        const { data: inserted, error: newItemsErr } = await admin
          .from("inventory_items")
          .insert(liteNewItems.map((x) => x.row))
          .select("id, item_number, name");
        if (newItemsErr) console.error("Lite: error inserting new items:", newItemsErr);

        // Map inserted rows back to their lines (by index — insert preserves order).
        (inserted || []).forEach((row, idx) => {
          const bundle = liteNewItems[idx];
          if (bundle) {
            bundle.line.matched_item_id = row.id;
            liteInsertLines.push(bundle.line);
          }
        });
      }

      if (liteInsertLines.length > 0) {
        const { error: linesErr } = await admin
          .from("vendor_invoice_items")
          .insert(liteInsertLines);
        if (linesErr) console.error("Lite: error inserting invoice items:", linesErr);
      }

      // Reorder price updates.
      for (const upd of litePriceUpdates) {
        await admin.from("inventory_items").update({ cost_per_unit: upd.cost }).eq("id", upd.id);
      }

      const matchedCount = liteInsertLines.filter((l) => l.match_status === "matched").length;
      const fuzzyCount = liteInsertLines.filter((l) => l.match_status === "fuzzy").length;
      const newCount = liteInsertLines.filter((l) => l.match_status === "new").length;

      console.log(`[Lite] parsed ${liteInsertLines.length} lines: ${matchedCount} matched, ${fuzzyCount} fuzzy, ${newCount} new`);

      return new Response(JSON.stringify({
        success: true,
        mode: "lite",
        invoice_id: invoiceId,
        vendor_name: parsed.vendor_name,
        invoice_date: parsed.invoice_date || null,
        delivery_date: effectiveDeliveryDate,
        total_amount: parsed.total_amount || null,
        total_items: liteInsertLines.length,
        matched: matchedCount,
        fuzzy: fuzzyCount,
        unmatched: 0,
        new_gap_alerts: 0,
        new_items_created: newCount,
        price_updates: litePriceUpdates.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═════════════════════ BRAND PATH (unchanged) ═════════════════════
    // Get location's brand_id for draft creation (via organization)
    let brandId: string | null = null;
    if (locationRow?.organization_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("brand_id")
        .eq("id", locationRow.organization_id)
        .single();
      brandId = org?.brand_id || null;
    }

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
      // Vendor-agnostic fallback: invoice OCR often misreads the vendor header (e.g. picks up the buyer name)
      templateIdByAnyVendorSku.set(normalizeKey(vendorItemId), mapping.brand_template_id);
    }

    const insertItems: any[] = [];
    const newGapAlerts: any[] = [];
    const priceUpdates: { id: string; cost: number; pack_size?: string | null }[] = [];

    for (const li of parsed.line_items || []) {
      const vendorItemNumber = firstNonEmpty(li.item_number, li.dist_item_number, li.distributor_item_number, li.item_code);
      const paProductId = firstNonEmpty(li.pa_product_id, li.pa_item_id, li.paProductId);

      if (!vendorItemNumber && !paProductId && li.product_name) {
        li.item_number = generateItemId(parsed.vendor_name, li.product_name);
      } else {
        li.item_number = vendorItemNumber || paProductId || li.item_number || null;
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
      // Final fallback: if we resolved a brand template but haven't found a local item yet,
      // link to the location's inventory row for that template so we can stamp cost.
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
          pack_size: li.pack_size || li.unit || null,
        });
      }

      // For unmatched items: check if brand template already exists (dedup)
      // Cross-reference BOTH brand_inventory_templates AND brand_vendor_mappings
      if (!match && !matchedTemplateId && brandId && li.product_name) {
        const fallbackGapId = paProductId || li.item_number || generateItemId(parsed.vendor_name, li.product_name);

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
      if (update.pack_size) {
        updateData.pack_size = update.pack_size;
      }
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
