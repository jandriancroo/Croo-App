// One-time (idempotent) backfill: stamp item_number (PFG) and pa_item_id (PA)
// onto existing active inventory_items where they're NULL, using brand_vendor_mappings
// joined on brand_item_id. Never overwrites existing values. Safe to re-run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional scoping: { locationId?: string, brandId?: string, dryRun?: boolean }
    let body: any = {};
    try { body = await req.json(); } catch { /* GET/empty allowed */ }
    const { locationId, brandId, dryRun } = body;

    // 1. Pull active items missing at least one vendor ID, with a brand link.
    let q = supabase
      .from("inventory_items")
      .select("id, location_id, brand_item_id, item_number, pa_item_id")
      .eq("is_active", true)
      .not("brand_item_id", "is", null)
      .or("item_number.is.null,pa_item_id.is.null");
    if (locationId) q = q.eq("location_id", locationId);

    // Page through results — there may be more than the default 1000 row cap.
    const allItems: any[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allItems.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Optional brand filter — done after fetch since brand lives on the template.
    let candidates = allItems;
    if (brandId) {
      const tmplIds = Array.from(new Set(candidates.map((i) => i.brand_item_id)));
      const brandTmpls: string[] = [];
      const CHUNK = 500;
      for (let i = 0; i < tmplIds.length; i += CHUNK) {
        const slice = tmplIds.slice(i, i + CHUNK);
        const { data: t } = await supabase
          .from("brand_inventory_templates")
          .select("id")
          .eq("brand_id", brandId)
          .in("id", slice);
        for (const r of t || []) brandTmpls.push(r.id);
      }
      const brandSet = new Set(brandTmpls);
      candidates = candidates.filter((i) => brandSet.has(i.brand_item_id));
    }

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({ scanned: 0, stamped_pfg: 0, stamped_pa: 0, message: "Nothing to backfill" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // 2. Fetch all vendor mappings for the templates these items reference.
    const templateIds = Array.from(new Set(candidates.map((i) => i.brand_item_id))) as string[];
    const pfgMap = new Map<string, string>();
    const paMap = new Map<string, string>();
    const CHUNK = 500;
    for (let i = 0; i < templateIds.length; i += CHUNK) {
      const slice = templateIds.slice(i, i + CHUNK);
      const { data: maps, error: mErr } = await supabase
        .from("brand_vendor_mappings")
        .select("brand_template_id, vendor, vendor_item_id")
        .in("brand_template_id", slice)
        .in("vendor", ["pfg", "produce_alliance", "pa"]);
      if (mErr) throw mErr;
      for (const m of maps || []) {
        if (!m.vendor_item_id) continue;
        if (m.vendor === "pfg" && !pfgMap.has(m.brand_template_id)) {
          pfgMap.set(m.brand_template_id, m.vendor_item_id);
        } else if ((m.vendor === "produce_alliance" || m.vendor === "pa") && !paMap.has(m.brand_template_id)) {
          paMap.set(m.brand_template_id, m.vendor_item_id);
        }
      }
    }

    // 3. Compute per-item updates — only fill nulls, never overwrite.
    type Update = { id: string; item_number?: string; pa_item_id?: string };
    const updates: Update[] = [];
    let stampedPfg = 0;
    let stampedPa = 0;
    for (const it of candidates) {
      const u: Update = { id: it.id };
      if (!it.item_number) {
        const v = pfgMap.get(it.brand_item_id);
        if (v) { u.item_number = v; stampedPfg++; }
      }
      if (!it.pa_item_id) {
        const v = paMap.get(it.brand_item_id);
        if (v) { u.pa_item_id = v; stampedPa++; }
      }
      if (u.item_number || u.pa_item_id) updates.push(u);
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          scanned: candidates.length,
          would_stamp_pfg: stampedPfg,
          would_stamp_pa: stampedPa,
          would_update_rows: updates.length,
        }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // 4. Apply updates one row at a time (per-row payload differs).
    let applied = 0;
    let failed = 0;
    for (const u of updates) {
      const payload: any = {};
      if (u.item_number) payload.item_number = u.item_number;
      if (u.pa_item_id) payload.pa_item_id = u.pa_item_id;
      const { error: upErr } = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", u.id);
      if (upErr) { failed++; console.warn("[backfill] update failed", u.id, upErr.message); }
      else applied++;
    }

    return new Response(
      JSON.stringify({
        scanned: candidates.length,
        rows_updated: applied,
        rows_failed: failed,
        stamped_pfg: stampedPfg,
        stamped_pa: stampedPa,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("backfill-vendor-ids error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});
