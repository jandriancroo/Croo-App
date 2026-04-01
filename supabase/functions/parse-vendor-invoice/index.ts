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

    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

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
For each line item extract: product_name, item_number (SKU/code if visible), quantity, unit (case/each/lb/etc), unit_price, total_price.
Also extract: vendor_name, invoice_number, invoice_date (YYYY-MM-DD), delivery_date (YYYY-MM-DD if shown), total_amount.
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

    // Now match line items against location inventory
    const { data: locationItems } = await admin
      .from("inventory_items")
      .select("id, name, item_number, vendor_item_id, brand_item_id, cost_per_unit")
      .eq("location_id", invoice.location_id)
      .eq("status", "active");

    // Get location's brand_id for draft creation
    const { data: location } = await admin
      .from("locations")
      .select("brand_id")
      .eq("id", invoice.location_id)
      .single();
    const brandId = location?.brand_id;

    // Get existing brand templates for dedup
    let existingTemplates: any[] = [];
    if (brandId) {
      const { data } = await admin
        .from("brand_inventory_templates")
        .select("id, product_name, item_number, vendor_source")
        .eq("brand_id", brandId);
      existingTemplates = data || [];
    }

    const itemMap = new Map<string, any>();
    for (const item of locationItems || []) {
      if (item.item_number) itemMap.set(item.item_number.toLowerCase(), item);
      if (item.name) itemMap.set(item.name.toLowerCase(), item);
    }

    // Generate a deterministic ID for items without a vendor SKU
    function generateItemId(vendorName: string, productName: string): string {
      const slug = (vendorName || "unknown").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
      // Simple hash from product name
      let hash = 0;
      const normalized = productName.toLowerCase().trim();
      for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
      }
      const hexHash = Math.abs(hash).toString(16).slice(0, 6);
      return `INV-${slug}-${hexHash}`;
    }

    const insertItems: any[] = [];
    const newDrafts: any[] = [];
    const priceUpdates: { id: string; cost: number }[] = [];

    for (const li of parsed.line_items || []) {
      // Auto-assign item_number if vendor didn't provide one
      if (!li.item_number && li.product_name) {
        li.item_number = generateItemId(parsed.vendor_name, li.product_name);
      }

      const matchByNumber = li.item_number ? itemMap.get(li.item_number.toLowerCase()) : null;
      const matchByName = li.product_name ? itemMap.get(li.product_name.toLowerCase()) : null;
      const match = matchByNumber || matchByName;

      const itemRow: any = {
        invoice_id: invoiceId,
        product_name: li.product_name,
        item_number: li.item_number || null,
        quantity: li.quantity || null,
        unit: li.unit || null,
        unit_price: li.unit_price || null,
        total_price: li.total_price || null,
        match_status: match ? "matched" : "unmatched",
        matched_item_id: match?.id || null,
      };

      if (match && li.unit_price && li.unit_price > 0) {
        priceUpdates.push({ id: match.id, cost: li.unit_price });
      }

      // For unmatched items: check if brand template already exists (dedup)
      if (!match && brandId && li.product_name) {
        const templateByNumber = li.item_number
          ? existingTemplates.find(t => t.item_number?.toLowerCase() === li.item_number.toLowerCase())
          : null;
        const templateByName = existingTemplates.find(
          t => t.product_name.toLowerCase() === li.product_name.toLowerCase()
        );

        if (!templateByNumber && !templateByName) {
          newDrafts.push({
            brand_id: brandId,
            product_name: li.product_name,
            item_number: li.item_number || null,
            vendor_source: `invoice:${parsed.vendor_name || "unknown"}`,
            source_location_id: invoice.location_id,
            status: "draft",
            category: null,
            is_weight_based: false,
            is_recipe: false,
            pan_baseline_key: "each",
            pan_enabled_keys: ["each"],
            match_keywords: [],
          });
        } else {
          // Already exists as template, link if we have the template ID
          const existingTemplate = templateByNumber || templateByName;
          if (existingTemplate) {
            itemRow.matched_template_id = existingTemplate.id;
            itemRow.match_status = "matched_brand";
          }
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

    // Update matched item costs
    for (const update of priceUpdates) {
      await admin
        .from("inventory_items")
        .update({ cost_per_unit: update.cost })
        .eq("id", update.id);
    }

    // Create brand draft templates for unmatched items (with dedup via upsert)
    if (newDrafts.length > 0) {
      const { error: draftErr } = await admin
        .from("brand_inventory_templates")
        .insert(newDrafts);
      if (draftErr) console.error("Error creating brand drafts:", draftErr);
    }

    return new Response(JSON.stringify({
      success: true,
      vendor_name: parsed.vendor_name,
      total_items: insertItems.length,
      matched: insertItems.filter(i => i.match_status === "matched").length,
      unmatched: insertItems.filter(i => i.match_status === "unmatched").length,
      new_drafts: newDrafts.length,
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
