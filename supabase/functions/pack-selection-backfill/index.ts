// pack-selection-backfill — Phase 2 of the brand-inventory lifecycle.
//
// For every (active brand_template × location) pair that has no row in
// location_pack_selections, walk a 4-tier vendor resolution hierarchy and
// either propose a default selection (insert) or defer the pair with a
// reason. dry-run mode (default) returns the full bucket breakdown without
// touching the database.
//
// Resolution hierarchy (first hit wins):
//   1. pfg_bid_items      last_seen_at >= now() - 30 days
//   2. pa_catalog_items   last_seen_at >= now() - 30 days
//   3. pfg_invoices.items invoice_date >= now() - 90 days (most recent invoice)
//   4. pfg_orders.items   order_date   >= now() - 90 days (most recent order)
//   5. pa_orders.items    order_date   >= now() - 90 days (most recent line)
//   6. Deferred — no vendor presence at this location
//   7. Deferred — vendor presence found, but no matching approved brand_pack_config
//
// Multi-match (one parsed vendor pack matches >1 approved configs):
//   - If one match is already someone else's default at the same location for
//     the same template -> use that.
//   - Otherwise insert all matches with is_default=false and pick the
//     most-recent-vendor-source match as is_default=true.
//   - Every multi-match case is reported.
//
// Shared parser: imported from ../_shared/packParser.ts.
// DO NOT add a parallel parser here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parsePackString, type ParsedPack } from "../_shared/packParser.ts";
import { isInventoryEnabled, filterEnabledLocations, inventoryDisabledResponse } from "../_shared/inventoryGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Bucket =
  | "pfg_bid"
  | "pa_catalog"
  | "pfg_invoice"
  | "pfg_order"
  | "pa_order"
  | "deferred_no_vendor"
  | "deferred_no_config";

interface Pair {
  brand_template_id: string;
  location_id: string;
  template_name: string;
  location_name: string;
}

interface Resolution {
  pair: Pair;
  bucket: Bucket;
  source?: string;       // "pfg_bid" | "pfg_order" | ...
  vendor_item_id?: string;
  pack_string?: string;
  parsed?: ParsedPack;
  matched_config_ids?: string[];  // approved configs that match parsed pack
  default_config_id?: string;
  multi_match?: boolean;
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Args
  const url = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const dryRun = body?.dryRun !== false && url.searchParams.get("dryRun") !== "false";
  const onlyLocationId: string | null = body?.locationId || url.searchParams.get("locationId") || null;

  // Gate: short-circuit single-location call if disabled
  if (onlyLocationId) {
    const gate = await isInventoryEnabled(supabase, onlyLocationId);
    if (!gate.enabled) {
      console.log(`[pack-selection-backfill] SKIPPED — inventory_enabled=false for ${onlyLocationId}`);
      return inventoryDisabledResponse(gate, corsHeaders);
    }
  }

  console.log(`[pack-selection-backfill] start dryRun=${dryRun} location=${onlyLocationId || "ALL"}`);

  // ── Step 1: find missing pairs ────────────────────────────────────────────
  // Fetch sources independently — there are multiple FKs from inventory_items
  // to brand_inventory_templates, so PostgREST embedding is ambiguous.
  // Paginate around PostgREST's 1000-row server cap.
  const itemRows: Array<{ brand_item_id: string; location_id: string }> = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    let q = supabase
      .from("inventory_items")
      .select("brand_item_id, location_id")
      .eq("is_active", true)
      .not("brand_item_id", "is", null)
      .not("location_id", "is", null)
      .range(off, off + PAGE - 1);
    if (onlyLocationId) q = q.eq("location_id", onlyLocationId);
    const { data, error } = await q;
    if (error) return ok({ error: error.message }, 500);
    if (!data || data.length === 0) break;
    itemRows.push(...(data as any));
    if (data.length < PAGE) break;
  }


  // Gate: when scanning ALL locations, drop rows for disabled ones
  if (!onlyLocationId && itemRows.length > 0) {
    const allLocs = [...new Set(itemRows.map((r: any) => r.location_id))];
    const enabledSet = await filterEnabledLocations(supabase, allLocs);
    const before = itemRows.length;
    for (let i = itemRows.length - 1; i >= 0; i--) {
      if (!enabledSet.has(itemRows[i].location_id)) itemRows.splice(i, 1);
    }
    const skipped = before - itemRows.length;
    if (skipped > 0) console.log(`[pack-selection-backfill] Skipped ${skipped} item rows — inventory_enabled=false`);
  }

  const candidateTplIds = [...new Set((itemRows || []).map((r: any) => r.brand_item_id))];
  const candidateLocIds = [...new Set((itemRows || []).map((r: any) => r.location_id))];

  const { data: tplRows } = await supabase
    .from("brand_inventory_templates")
    .select("id, product_name, status")
    .in("id", candidateTplIds);
  const liveTpl = new Map<string, string>(); // id -> name
  for (const t of tplRows || []) {
    if (t.status === "live") liveTpl.set(t.id, t.product_name);
  }

  const { data: locRows } = await supabase
    .from("locations")
    .select("id, name")
    .in("id", candidateLocIds);
  const locName = new Map<string, string>();
  for (const l of locRows || []) locName.set(l.id, l.name);

  const pairMap = new Map<string, Pair>();
  for (const r of itemRows || []) {
    if (!liveTpl.has(r.brand_item_id)) continue;
    const key = `${r.brand_item_id}::${r.location_id}`;
    if (pairMap.has(key)) continue;
    pairMap.set(key, {
      brand_template_id: r.brand_item_id,
      location_id: r.location_id,
      template_name: liveTpl.get(r.brand_item_id) || "?",
      location_name: locName.get(r.location_id) || "?",
    });
  }


  const existingSelections: Array<{ brand_template_id: string; location_id: string; is_default: boolean }> = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase
      .from("location_pack_selections")
      .select("brand_template_id, location_id, is_default")
      .range(off, off + PAGE - 1);
    if (error) return ok({ error: error.message }, 500);
    if (!data || data.length === 0) break;
    existingSelections.push(...(data as any));
    if (data.length < PAGE) break;
  }

  // pair-key -> default config_id (if any)
  const pairHasSelection = new Set<string>();
  for (const s of existingSelections) {
    if (s.is_default) pairHasSelection.add(`${s.brand_template_id}::${s.location_id}`);
  }


  const missing: Pair[] = [];
  for (const [key, p] of pairMap) {
    if (!pairHasSelection.has(key)) missing.push(p);
  }

  console.log(`[pack-selection-backfill] total pairs=${pairMap.size} missing=${missing.length}`);

  if (missing.length === 0) {
    return ok({ dryRun, totals: { total_pairs: pairMap.size, missing: 0 }, buckets: {}, samples: {} });
  }

  // ── Step 2: prefetch helpers ──────────────────────────────────────────────
  const templateIds = [...new Set(missing.map((p) => p.brand_template_id))];
  const locationIds = [...new Set(missing.map((p) => p.location_id))];

  // Vendor mappings (template -> vendor -> [vendor_item_ids])
  const { data: mappings } = await supabase
    .from("brand_vendor_mappings")
    .select("brand_template_id, vendor, vendor_item_id, pack_override_outer_qty, pack_override_outer_type, pack_override_inner_qty, pack_override_inner_type")
    .in("brand_template_id", templateIds);

  const tplVendorIds = new Map<string, { pfg: Set<string>; pa: Set<string> }>();
  // (template, vendor_key, vendor_item_id) -> override fields (mirrors seeder).
  const overrideIdx = new Map<string, { outer_qty: number | null; outer_type: string | null; inner_qty: number | null; inner_type: string | null }>();
  for (const m of mappings || []) {
    if (!tplVendorIds.has(m.brand_template_id)) {
      tplVendorIds.set(m.brand_template_id, { pfg: new Set(), pa: new Set() });
    }
    const bucket = tplVendorIds.get(m.brand_template_id)!;
    const vkey = m.vendor === "pfg" ? "pfg" : m.vendor === "produce_alliance" ? "pa" : null;
    if (vkey === "pfg") bucket.pfg.add(String(m.vendor_item_id));
    else if (vkey === "pa") bucket.pa.add(String(m.vendor_item_id));
    if (vkey) {
      overrideIdx.set(`${m.brand_template_id}::${vkey}::${m.vendor_item_id}`, {
        outer_qty: (m as any).pack_override_outer_qty ?? null,
        outer_type: (m as any).pack_override_outer_type ?? null,
        inner_qty: (m as any).pack_override_inner_qty ?? null,
        inner_type: (m as any).pack_override_inner_type ?? null,
      });
    }
  }


  // Approved brand_pack_configs grouped by template_id
  const { data: configs } = await supabase
    .from("brand_pack_configs")
    .select("id, brand_template_id, outer_qty, inner_qty, inner_type, common_unit, source, source_evidence")
    .eq("status", "approved")
    .in("brand_template_id", templateIds);

  const tplConfigs = new Map<string, any[]>();
  for (const c of configs || []) {
    const arr = tplConfigs.get(c.brand_template_id) || [];
    arr.push(c);
    tplConfigs.set(c.brand_template_id, arr);
  }

  // PFG bid items (last 30d) — keyed by `location_id::item_number`
  const cutoff30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { data: bidRows } = await supabase
    .from("pfg_bid_items")
    .select("location_id, item_number, pack_size, last_seen_at")
    .in("location_id", locationIds)
    .gte("last_seen_at", cutoff30);
  const bidIdx = new Map<string, { pack_size: string | null; last_seen_at: string }>();
  for (const r of bidRows || []) {
    bidIdx.set(`${r.location_id}::${r.item_number}`, { pack_size: r.pack_size, last_seen_at: r.last_seen_at });
  }

  // PA catalog items (last 30d)
  const { data: catRows } = await supabase
    .from("pa_catalog_items")
    .select("location_id, pa_item_id, pack_size, last_seen_at")
    .in("location_id", locationIds)
    .gte("last_seen_at", cutoff30);
  const catIdx = new Map<string, { pack_size: string | null; last_seen_at: string }>();
  for (const r of catRows || []) {
    catIdx.set(`${r.location_id}::${r.pa_item_id}`, { pack_size: r.pack_size, last_seen_at: r.last_seen_at });
  }

  // 90-day cutoff shared by pfg_invoices, pfg_orders, and pa_orders indexes.
  const cutoff90 = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

  // PFG invoices (last 90d). items jsonb → (location, itemNumber) -> most recent {packSize, invoice_date}.
  // Invoices reflect what was actually shipped/billed → more precise than orders, so we
  // consult them BEFORE pfg_orders. Bid guide still wins overall (contractual pack).
  const { data: pfgInvoiceRows } = await supabase
    .from("pfg_invoices")
    .select("location_id, invoice_date, items")
    .in("location_id", locationIds)
    .gte("invoice_date", cutoff90);
  const pfgInvoiceIdx = new Map<string, { pack_size: string | null; invoice_date: string }>();
  for (const inv of pfgInvoiceRows || []) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const it of items) {
      const num = it?.itemNumber ? String(it.itemNumber)
                : it?.productId   ? String(it.productId)
                : null;
      const pack = it?.packSize || it?.pack_size || null;
      if (!num) continue;
      const k = `${inv.location_id}::${num}`;
      const existing = pfgInvoiceIdx.get(k);
      if (!existing || existing.invoice_date < inv.invoice_date) {
        pfgInvoiceIdx.set(k, { pack_size: pack, invoice_date: inv.invoice_date });
      }
    }
  }

  // PFG orders (last 90d). items jsonb → flatten to (location, itemNumber) -> most recent {packSize, order_date}
  const { data: pfgOrderRows } = await supabase
    .from("pfg_orders")
    .select("location_id, order_date, items")
    .in("location_id", locationIds)
    .gte("order_date", cutoff90);
  const pfgOrderIdx = new Map<string, { pack_size: string | null; order_date: string }>();
  for (const o of pfgOrderRows || []) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      const num = it?.itemNumber ? String(it.itemNumber) : null;
      const pack = it?.packSize || null;
      if (!num) continue;
      const k = `${o.location_id}::${num}`;
      const existing = pfgOrderIdx.get(k);
      if (!existing || existing.order_date < o.order_date) {
        pfgOrderIdx.set(k, { pack_size: pack, order_date: o.order_date });
      }
    }
  }

  // PA orders (last 90d). items jsonb similar shape
  const { data: paOrderRows } = await supabase
    .from("pa_orders")
    .select("location_id, order_date, items")
    .in("location_id", locationIds)
    .gte("order_date", cutoff90);
  const paOrderIdx = new Map<string, { pack_size: string | null; order_date: string }>();
  for (const o of paOrderRows || []) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      const id = it?.pa_item_id || it?.paItemId || it?.itemNumber;
      const num = id ? String(id) : null;
      const pack = it?.pack_size || it?.packSize || null;
      if (!num) continue;
      const k = `${o.location_id}::${num}`;
      const existing = paOrderIdx.get(k);
      if (!existing || existing.order_date < o.order_date) {
        paOrderIdx.set(k, { pack_size: pack, order_date: o.order_date });
      }
    }
  }

  // Existing default config_id at any location for the same template
  // (used by multi-match resolver)
  const { data: anyDefaults } = await supabase
    .from("location_pack_selections")
    .select("brand_template_id, location_id, active_pack_config_id, is_default")
    .eq("is_default", true)
    .in("brand_template_id", templateIds);
  // template -> map location -> config_id
  const tplDefaultByLoc = new Map<string, Map<string, string>>();
  for (const s of anyDefaults || []) {
    if (!tplDefaultByLoc.has(s.brand_template_id)) tplDefaultByLoc.set(s.brand_template_id, new Map());
    tplDefaultByLoc.get(s.brand_template_id)!.set(s.location_id, s.active_pack_config_id);
  }

  // ── Step 3: resolve each pair ─────────────────────────────────────────────
  function matchConfigs(templateId: string, parsed: ParsedPack): any[] {
    const cfgs = tplConfigs.get(templateId) || [];
    return cfgs.filter((c) =>
      c.outer_qty === parsed.outer_qty &&
      Number(c.inner_qty || 0) === Number(parsed.inner_qty || 0) &&
      String(c.common_unit) === String(parsed.common_unit)
    );
  }

  const resolutions: Resolution[] = [];

  for (const pair of missing) {
    const tv = tplVendorIds.get(pair.brand_template_id);
    let chosen: { source: string; vendor_item_id: string; pack_size: string | null; sort: string } | null = null;

    // Hierarchy
    if (tv) {
      for (const id of tv.pfg) {
        const hit = bidIdx.get(`${pair.location_id}::${id}`);
        if (hit) { chosen = { source: "pfg_bid", vendor_item_id: id, pack_size: hit.pack_size, sort: hit.last_seen_at }; break; }
      }
      if (!chosen) for (const id of tv.pa) {
        const hit = catIdx.get(`${pair.location_id}::${id}`);
        if (hit) { chosen = { source: "pa_catalog", vendor_item_id: id, pack_size: hit.pack_size, sort: hit.last_seen_at }; break; }
      }
      if (!chosen) for (const id of tv.pfg) {
        const hit = pfgInvoiceIdx.get(`${pair.location_id}::${id}`);
        if (hit) { chosen = { source: "pfg_invoice", vendor_item_id: id, pack_size: hit.pack_size, sort: hit.invoice_date }; break; }
      }
      if (!chosen) for (const id of tv.pfg) {
        const hit = pfgOrderIdx.get(`${pair.location_id}::${id}`);
        if (hit) { chosen = { source: "pfg_order", vendor_item_id: id, pack_size: hit.pack_size, sort: hit.order_date }; break; }
      }
      if (!chosen) for (const id of tv.pa) {
        const hit = paOrderIdx.get(`${pair.location_id}::${id}`);
        if (hit) { chosen = { source: "pa_order", vendor_item_id: id, pack_size: hit.pack_size, sort: hit.order_date }; break; }
      }
    }

    if (!chosen) {
      resolutions.push({ pair, bucket: "deferred_no_vendor" });
      continue;
    }

    const parsed = parsePackString(chosen.pack_size);
    if (!parsed) {
      // Unparseable vendor pack — treat as no-config (operator must intervene)
      resolutions.push({
        pair, bucket: "deferred_no_config",
        source: chosen.source, vendor_item_id: chosen.vendor_item_id, pack_string: chosen.pack_size || undefined,
      });
      continue;
    }

    // Apply pack_override_* from brand_vendor_mappings (mirrors seeder).
    // Override inner_type also re-anchors common_unit (semantic re-anchor).
    const vkey = chosen.source.startsWith("pa_") ? "pa" : "pfg";
    const ov = overrideIdx.get(`${pair.brand_template_id}::${vkey}::${chosen.vendor_item_id}`);
    const overrideApplied = !!ov && (ov.outer_qty != null || ov.outer_type != null || ov.inner_qty != null || ov.inner_type != null);
    const lookup: ParsedPack = overrideApplied ? {
      outer_qty: ov!.outer_qty ?? parsed.outer_qty,
      inner_qty: ov!.inner_qty ?? parsed.inner_qty,
      inner_type: ov!.inner_type ?? parsed.inner_type,
      common_unit: ov!.inner_type ?? parsed.common_unit,
    } : parsed;


    const matches = matchConfigs(pair.brand_template_id, lookup);
    if (matches.length === 0) {
      resolutions.push({
        pair, bucket: "deferred_no_config",
        source: chosen.source, vendor_item_id: chosen.vendor_item_id, pack_string: chosen.pack_size || undefined, parsed: lookup,
      });
      continue;
    }


    const bucketName: Bucket =
      chosen.source === "pfg_bid" ? "pfg_bid"
      : chosen.source === "pa_catalog" ? "pa_catalog"
      : chosen.source === "pfg_invoice" ? "pfg_invoice"
      : chosen.source === "pfg_order" ? "pfg_order"
      : "pa_order";

    if (matches.length === 1) {
      resolutions.push({
        pair, bucket: bucketName,
        source: chosen.source, vendor_item_id: chosen.vendor_item_id,
        pack_string: chosen.pack_size || undefined, parsed,
        matched_config_ids: [matches[0].id], default_config_id: matches[0].id,
      });
      continue;
    }

    // Multi-match: prefer an existing default-at-some-other-location for this template
    const existingDefaults = tplDefaultByLoc.get(pair.brand_template_id);
    let preferred: string | null = null;
    if (existingDefaults) {
      for (const m of matches) {
        for (const cfgId of existingDefaults.values()) {
          if (cfgId === m.id) { preferred = m.id; break; }
        }
        if (preferred) break;
      }
    }
    // Fall back to most-recent-source signal — chosen.sort represents recency, but
    // all matches come from the SAME chosen source, so we just pick the first.
    if (!preferred) preferred = matches[0].id;

    resolutions.push({
      pair, bucket: bucketName,
      source: chosen.source, vendor_item_id: chosen.vendor_item_id,
      pack_string: chosen.pack_size || undefined, parsed,
      matched_config_ids: matches.map((m: any) => m.id),
      default_config_id: preferred ?? undefined,
      multi_match: true,
    });
  }

  // ── Step 4: aggregate ─────────────────────────────────────────────────────
  const buckets: Record<Bucket, number> = {
    pfg_bid: 0, pa_catalog: 0, pfg_invoice: 0, pfg_order: 0, pa_order: 0,
    deferred_no_vendor: 0, deferred_no_config: 0,
  };
  for (const r of resolutions) buckets[r.bucket]++;

  const sampleByBucket = (b: Bucket, n: number) =>
    resolutions.filter((r) => r.bucket === b).slice(0, n).map((r) => ({
      item: r.pair.template_name,
      location: r.pair.location_name,
      source: r.source,
      vendor_item_id: r.vendor_item_id,
      pack_string: r.pack_string,
      matched_config_id: r.default_config_id,
      all_matched_config_ids: r.matched_config_ids,
      multi_match: r.multi_match || false,
    }));

  const fullByBucket = (b: Bucket) =>
    resolutions.filter((r) => r.bucket === b).map((r) => ({
      item: r.pair.template_name,
      location: r.pair.location_name,
      source: r.source,
      vendor_item_id: r.vendor_item_id,
      pack_string: r.pack_string,
      parsed: r.parsed,
    }));

  const multiMatchCases = resolutions
    .filter((r) => r.multi_match)
    .map((r) => ({
      item: r.pair.template_name,
      location: r.pair.location_name,
      source: r.source,
      pack_string: r.pack_string,
      matched_config_ids: r.matched_config_ids,
      chosen_default: r.default_config_id,
    }));

  const report = {
    dryRun,
    totals: {
      total_pairs: pairMap.size,
      pairs_needing_backfill: missing.length,
    },
    buckets,
    samples: {
      pfg_bid: sampleByBucket("pfg_bid", 5),
      pa_catalog: sampleByBucket("pa_catalog", 5),
      pfg_invoice: sampleByBucket("pfg_invoice", 5),
      pfg_order: sampleByBucket("pfg_order", 5),
      pa_order: sampleByBucket("pa_order", 5),
      deferred_no_vendor_sample: sampleByBucket("deferred_no_vendor", 5),
    },
    deferred_no_config_full: fullByBucket("deferred_no_config"),
    multi_match_full: multiMatchCases,
  };

  if (dryRun) return ok(report);

  // ── Step 5: actual writes (dry_run=false) ─────────────────────────────────
  const toInsert: any[] = [];
  for (const r of resolutions) {
    if (!r.default_config_id || !r.matched_config_ids) continue;
    for (const cfgId of r.matched_config_ids) {
      toInsert.push({
        location_id: r.pair.location_id,
        brand_template_id: r.pair.brand_template_id,
        active_pack_config_id: cfgId,
        is_default: cfgId === r.default_config_id,
      });
    }
  }

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("location_pack_selections")
      .upsert(chunk, { onConflict: "location_id,brand_template_id,active_pack_config_id" });
    if (error) console.warn("[pack-selection-backfill] insert chunk failed:", error.message);
    else inserted += chunk.length;
  }

  return ok({ ...report, write: { inserted_rows: inserted, attempted: toInsert.length } });
});
