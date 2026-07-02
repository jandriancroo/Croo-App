import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  extractInvoiceFromImage,
  imageBufferToBase64,
  AiRateLimitedError,
  AiCreditsExhaustedError,
} from "../_shared/invoice-ai.ts";

// Lite invoice parser — writes EXCLUSIVELY to lite_* tables.
// Zero reads/writes to inventory_items, vendor_invoices, vendor_invoice_items,
// brand_* tables, or vendor_gap_alerts.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FUZZY_MATCH_THRESHOLD = 0.7;

// Dice-coefficient bigram similarity — no pg_trgm required client-side.
function bigrams(s: string): Set<string> {
  const t = ` ${s.toLowerCase().trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const normalizeKey = (v: unknown) => String(v ?? "").trim().toLowerCase();
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
    let { invoiceId, storagePath, locationId } = body || {};

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the target location is Lite mode. Refuse otherwise — this endpoint
    // must never write to Brand governance tables.
    if (locationId) {
      const { data: loc } = await admin
        .from("locations")
        .select("id, inventory_mode")
        .eq("id", locationId)
        .single();
      if ((loc as any)?.inventory_mode !== "lite") {
        return new Response(JSON.stringify({ error: "Location is not in Lite inventory mode" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Allow client to skip pre-inserting the invoice row.
    if (!invoiceId && storagePath && locationId) {
      const { data: created, error: createErr } = await admin
        .from("lite_vendor_invoices")
        .insert({
          location_id: locationId,
          vendor_name: "Unknown",
          storage_path: storagePath,
          uploaded_by: user.id,
          status: "pending",
        })
        .select("id")
        .single();
      if (createErr || !created) {
        throw new Error("Failed to create lite invoice record: " + (createErr?.message || "unknown"));
      }
      invoiceId = created.id;
    }

    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId or (storagePath+locationId) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invoice, error: invErr } = await admin
      .from("lite_vendor_invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) throw new Error("Lite invoice not found");

    // Sign the storage path (reuses shared vendor-invoices bucket, Lite paths are prefixed).
    let imageUrl: string | null = null;
    if (invoice.storage_path) {
      const { data: signed } = await admin.storage
        .from("vendor-invoices")
        .createSignedUrl(invoice.storage_path, 600);
      imageUrl = signed?.signedUrl || null;
    }
    if (!imageUrl) throw new Error("No image URL on lite invoice");

    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) throw new Error("Failed to fetch invoice image");
    const base64Image = imageBufferToBase64(await imageResp.arrayBuffer());
    const contentType = imageResp.headers.get("content-type") || "image/jpeg";

    // AI extraction via shared helper
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
    console.log("[Lite] parsed invoice:", JSON.stringify(parsed).slice(0, 500));

    const effectiveDeliveryDate = parsed.delivery_date || parsed.invoice_date || null;

    // Vendor name: prefer the longer / more complete value already on record.
    // Prevents a shorter re-parse (e.g. "MCLANE") from clobbering "McLane Foodservice, Inc.".
    const incomingVendor = (parsed.vendor_name || "").trim();
    const existingVendor = (invoice.vendor_name || "").trim();
    const keepVendor =
      !incomingVendor ||
      existingVendor.toLowerCase() === incomingVendor.toLowerCase() ||
      (existingVendor && existingVendor.length >= incomingVendor.length && existingVendor !== "Unknown");
    const finalVendorName = keepVendor && existingVendor && existingVendor !== "Unknown"
      ? existingVendor
      : incomingVendor || existingVendor;

    await admin.from("lite_vendor_invoices").update({
      vendor_name: finalVendorName,
      invoice_number: parsed.invoice_number || invoice.invoice_number,
      invoice_date: parsed.invoice_date || null,
      delivery_date: effectiveDeliveryDate,
      total_amount: parsed.total_amount || null,
      parsed_at: new Date().toISOString(),
      status: "parsed",
    }).eq("id", invoiceId);

    // Idempotent re-parse: wipe any previously-inserted line items for this invoice
    // before writing the new set. Without this, re-runs duplicate lines.
    await admin
      .from("lite_vendor_invoice_items")
      .delete()
      .eq("invoice_id", invoiceId);

    // Load existing Lite items for this location.
    const { data: liteItems } = await admin
      .from("lite_inventory_items")
      .select("id, name, item_number, vendor_name_normalized, cost_per_unit, pack_size")
      .eq("location_id", invoice.location_id)
      .eq("is_active", true);


    const normalizedVendor = normalizeKey(parsed.vendor_name);

    const byComposite = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const item of liteItems || []) {
      const vNorm = (item as any).vendor_name_normalized || "";
      const num = normalizeKey(item.item_number || "");
      if (vNorm && num) byComposite.set(`${vNorm}::${num}`, item);
      if (item.name) byName.set(normalizeKey(item.name), item);
    }

    interface Pending {
      lineDraft: any;
      newItemRow: any | null;
      priceUpdate: { id: string; cost: number; pack_size: string | null; existingPackSize: string | null } | null;
    }
    const pending: Pending[] = [];

    for (const li of parsed.line_items || []) {
      const vendorItemNumber = firstNonEmpty(
        li.item_number, (li as any).dist_item_number, (li as any).distributor_item_number, (li as any).item_code
      );
      const stableCode = vendorItemNumber
        || (li.product_name ? generateItemId(parsed.vendor_name || "", li.product_name) : null);

      const packSize = firstNonEmpty((li as any).pack_size, (li as any).packSize, (li as any).pack);

      let match: any = null;
      let matchStatus: "matched" | "fuzzy" | "new" = "new";
      let candidateItemId: string | null = null;
      let fuzzyScore: number | null = null;

      // (a) composite: vendor + SKU
      if (normalizedVendor && stableCode) {
        match = byComposite.get(`${normalizedVendor}::${normalizeKey(stableCode)}`) || null;
        if (match) matchStatus = "matched";
      }

      // (b) exact normalized name
      if (!match && li.product_name) {
        match = byName.get(normalizeKey(li.product_name)) || null;
        if (match) matchStatus = "matched";
      }

      // (c) fuzzy ≥ threshold — held as candidate, not merged
      if (!match && li.product_name) {
        let best: { item: any; score: number } | null = null;
        for (const [name, item] of byName) {
          const score = similarity(li.product_name, name);
          if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
            best = { item, score };
          }
        }
        if (best) {
          matchStatus = "fuzzy";
          candidateItemId = best.item.id;
          fuzzyScore = Math.round(best.score * 1000) / 1000;
        }
      }

      // (d) auto-create
      let newItemRow: any = null;
      if (!match && matchStatus !== "fuzzy") {
        matchStatus = "new";
        newItemRow = {
          location_id: invoice.location_id,
          name: li.product_name,
          item_number: stableCode,
          vendor_name_normalized: normalizedVendor || null,
          unit: li.unit || null,
          pack_size: packSize,
          cost_per_unit: li.unit_price && li.unit_price > 0 ? li.unit_price : 0,
          is_active: true,
          match_status: "new",
        };
      }

      // Reorder price update — also backfills pack_size when the item is missing one.
      const priceUpdate =
        match && matchStatus === "matched" && li.unit_price && li.unit_price > 0
          ? {
              id: match.id,
              cost: li.unit_price,
              pack_size: packSize,
              existingPackSize: match.pack_size || null,
            }
          : null;

      const lineDraft = {
        invoice_id: invoiceId,
        product_name: li.product_name,
        item_number: stableCode,
        pack_size: packSize,
        quantity: li.quantity || null,
        unit: li.unit || null,
        unit_price: li.unit_price || null,
        total_price: li.total_price || null,
        match_status: matchStatus,
        matched_item_id: match?.id || null,
        candidate_item_id: candidateItemId,
        fuzzy_score: fuzzyScore,
      };

      pending.push({ lineDraft, newItemRow, priceUpdate });
    }


    // Insert auto-created items first, then attach their ids to the draft lines.
    const newItemBundles = pending.filter((p) => p.newItemRow);
    if (newItemBundles.length > 0) {
      const { data: inserted, error: newItemsErr } = await admin
        .from("lite_inventory_items")
        .insert(newItemBundles.map((b) => b.newItemRow))
        .select("id");
      if (newItemsErr) console.error("[Lite] insert new items failed:", newItemsErr);
      (inserted || []).forEach((row, idx) => {
        const b = newItemBundles[idx];
        if (b) b.lineDraft.matched_item_id = row.id;
      });
    }

    const insertLines = pending.map((p) => p.lineDraft);
    if (insertLines.length > 0) {
      const { error: linesErr } = await admin
        .from("lite_vendor_invoice_items")
        .insert(insertLines);
      if (linesErr) console.error("[Lite] insert invoice items failed:", linesErr);
    }

    // Apply price updates (and backfill pack_size on matched items missing one)
    let priceUpdateCount = 0;
    for (const p of pending) {
      if (p.priceUpdate) {
        const patch: Record<string, unknown> = { cost_per_unit: p.priceUpdate.cost };
        if (!p.priceUpdate.existingPackSize && p.priceUpdate.pack_size) {
          patch.pack_size = p.priceUpdate.pack_size;
        }
        await admin
          .from("lite_inventory_items")
          .update(patch)
          .eq("id", p.priceUpdate.id);
        priceUpdateCount++;
      }
    }


    const matchedCount = insertLines.filter((l) => l.match_status === "matched").length;
    const fuzzyCount = insertLines.filter((l) => l.match_status === "fuzzy").length;
    const newCount = insertLines.filter((l) => l.match_status === "new").length;

    console.log(`[Lite] ${insertLines.length} lines: ${matchedCount} matched, ${fuzzyCount} fuzzy, ${newCount} new`);

    return new Response(JSON.stringify({
      success: true,
      mode: "lite",
      invoice_id: invoiceId,
      vendor_name: parsed.vendor_name,
      invoice_date: parsed.invoice_date || null,
      delivery_date: effectiveDeliveryDate,
      total_amount: parsed.total_amount || null,
      total_items: insertLines.length,
      matched: matchedCount,
      fuzzy: fuzzyCount,
      new_items_created: newCount,
      price_updates: priceUpdateCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-vendor-invoice-lite error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
