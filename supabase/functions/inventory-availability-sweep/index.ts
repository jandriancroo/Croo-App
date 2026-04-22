import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BID_LIST_WINDOW_DAYS = 30;
const UNAVAILABLE_THRESHOLD_DAYS = 60;

interface SweepResult {
  brandId: string;
  brandName: string;
  healthRowsEvaluated: number;
  healthRowsUpdated: number;
  inventoryItemsUpdated: number;
  newlyUnavailable60Plus: number;
  reappeared: number;
  errors: string[];
}

interface HealthRow {
  id: string;
  brand_id: string;
  vendor_source: string;
  vendor_sku: string;
  vendor_territory: string;
  last_seen_on_bid_list: string | null;
  days_not_seen: number;
  available_since: string | null;
}

interface HealthPatch {
  id: string;
  last_seen_on_bid_list: string | null;
  days_not_seen: number;
  available_since: string | null;
  // bookkeeping for tallies + downstream sync (not written)
  _wasUnavailable60Plus: boolean;
  _isUnavailable60Plus: boolean;
  _wasMissing: boolean;
  _isMissing: boolean;
  _key: string; // "vendor|sku|territory"
}

function fmtDate(d: Date): string {
  // "Apr 21, 2026" — matches existing manager-facing tag style
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function vendorLabel(vendor_source: string): string {
  const v = vendor_source.toLowerCase();
  if (v === "pfg") return "PFG";
  if (v === "pa" || v === "produce_alliance") return "PA";
  return vendor_source.toUpperCase();
}

// ──────────────────────────────────────────────────────────────────
// 1. Bid list builders
//    Returns: Map<territory, Set<vendor_sku>>
// ──────────────────────────────────────────────────────────────────
async function buildPfgBidList(
  supabase: SupabaseClient,
  territoryByLocation: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  const cutoff = new Date(Date.now() - BID_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const locationIds = Array.from(territoryByLocation.keys());
  if (!locationIds.length) return new Map();

  const { data, error } = await supabase
    .from("pfg_orders")
    .select("location_id, items")
    .in("location_id", locationIds)
    .gte("created_at", cutoff);

  if (error) throw new Error(`pfg_orders query failed: ${error.message}`);

  const out = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const territory = territoryByLocation.get(row.location_id);
    if (!territory) continue;
    const items = Array.isArray(row.items) ? row.items : [];
    for (const it of items) {
      const sku = it?.itemNumber ?? it?.item_number ?? it?.productId;
      if (!sku) continue;
      const set = out.get(territory) ?? new Set<string>();
      set.add(String(sku));
      out.set(territory, set);
    }
  }
  return out;
}

async function buildPaBidList(
  supabase: SupabaseClient,
  territoryByLocation: Map<string, string>,
): Promise<Map<string, Set<string>>> {
  const cutoff = new Date(Date.now() - BID_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const locationIds = Array.from(territoryByLocation.keys());
  if (!locationIds.length) return new Map();

  const { data, error } = await supabase
    .from("pa_orders")
    .select("location_id, items")
    .in("location_id", locationIds)
    .gte("created_at", cutoff);

  if (error) throw new Error(`pa_orders query failed: ${error.message}`);

  const out = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const territory = territoryByLocation.get(row.location_id);
    if (!territory) continue;
    const items = Array.isArray(row.items) ? row.items : [];
    for (const it of items) {
      const sku = it?.item_number ?? it?.pa_item_id ?? it?.productId;
      if (!sku) continue;
      const set = out.get(territory) ?? new Set<string>();
      set.add(String(sku));
      out.set(territory, set);
    }
  }

  // Debug: surface the PA SKU shape so we can verify field-name match
  // against vendor_sku_health.vendor_sku after the first real sweep.
  console.log(
    "[sweep] PA bid list sample:",
    Array.from(out.entries()).slice(0, 3).map(([t, s]) => ({
      territory: t,
      skuCount: s.size,
      sample: Array.from(s).slice(0, 3),
    })),
  );

  return out;
}

// ──────────────────────────────────────────────────────────────────
// 2. Health row evaluator — pure function
// ──────────────────────────────────────────────────────────────────
function evaluateHealthRow(
  row: HealthRow,
  bidList: Map<string, Set<string>>,
  nowIso: string,
  todayLabel: string,
): HealthPatch | null {
  const onList = bidList.get(row.vendor_territory)?.has(row.vendor_sku) ?? false;
  const wasMissing = row.days_not_seen > 0;
  const wasUnavailable60Plus = row.days_not_seen >= UNAVAILABLE_THRESHOLD_DAYS;

  let next_last_seen = row.last_seen_on_bid_list;
  let next_days_not_seen = row.days_not_seen;
  let next_available_since = row.available_since;

  if (onList) {
    next_last_seen = nowIso;
    next_days_not_seen = 0;
    if (wasMissing) {
      next_available_since = `Back on ${vendorLabel(row.vendor_source)} bid list — ${todayLabel}`;
    }
    // if not wasMissing, leave available_since untouched
  } else {
    next_days_not_seen = row.days_not_seen + 1;
    // 0 → 1 transition: clear stale "Back on..." tag
    if (row.days_not_seen === 0 && row.available_since !== null) {
      next_available_since = null;
    }
    // last_seen_on_bid_list unchanged
  }

  const isMissing = next_days_not_seen > 0;
  const isUnavailable60Plus = next_days_not_seen >= UNAVAILABLE_THRESHOLD_DAYS;

  // No-op detection
  const unchanged =
    next_last_seen === row.last_seen_on_bid_list &&
    next_days_not_seen === row.days_not_seen &&
    next_available_since === row.available_since;
  if (unchanged) return null;

  return {
    id: row.id,
    last_seen_on_bid_list: next_last_seen,
    days_not_seen: next_days_not_seen,
    available_since: next_available_since,
    _wasUnavailable60Plus: wasUnavailable60Plus,
    _isUnavailable60Plus: isUnavailable60Plus,
    _wasMissing: wasMissing,
    _isMissing: isMissing,
    _key: `${row.vendor_source}|${row.vendor_sku}|${row.vendor_territory}`,
  };
}

// ──────────────────────────────────────────────────────────────────
// 3. Inventory items writer
//    Path: vendor_sku_health → brand_vendor_mappings → templates → inventory_items
// ──────────────────────────────────────────────────────────────────
async function syncToInventoryItems(
  supabase: SupabaseClient,
  brandId: string,
  patches: HealthPatch[],
  territoryByLocation: Map<string, string>,
): Promise<number> {
  if (!patches.length) return 0;

  // Build lookup: (vendor, vendor_sku) → patch
  const patchByVendorSku = new Map<string, HealthPatch>();
  for (const p of patches) {
    const [vendor, sku] = p._key.split("|");
    patchByVendorSku.set(`${vendor}|${sku}`, p);
  }

  // Fetch mappings for all patched (vendor, vendor_item_id) pairs in this brand
  const { data: mappings, error: mapErr } = await supabase
    .from("brand_vendor_mappings")
    .select("brand_template_id, vendor, vendor_item_id, territory, brand_inventory_templates!inner(brand_id)")
    .eq("brand_inventory_templates.brand_id", brandId);

  if (mapErr) throw new Error(`brand_vendor_mappings query failed: ${mapErr.message}`);

  // For each mapping that matches a patch, find inventory_items by (brand_item_id, location_id-in-territory)
  // and update.
  let updatedCount = 0;
  const locationsByTerritory = new Map<string, string[]>();
  for (const [locId, terr] of territoryByLocation.entries()) {
    const arr = locationsByTerritory.get(terr) ?? [];
    arr.push(locId);
    locationsByTerritory.set(terr, arr);
  }

  for (const m of mappings ?? []) {
    const key = `${m.vendor}|${m.vendor_item_id}`;
    const patch = patchByVendorSku.get(key);
    if (!patch) continue;

    // Determine which locations should receive this update.
    // If mapping has an explicit territory, scope to that territory's locations;
    // otherwise scope to all locations sharing the patch's territory.
    const [, , patchTerritory] = patch._key.split("|");
    const targetTerritory = m.territory ?? patchTerritory;
    const targetLocations = locationsByTerritory.get(targetTerritory) ?? [];
    if (!targetLocations.length) continue;

    const { error: updErr, count } = await supabase
      .from("inventory_items")
      .update({
        last_seen_on_bid_list: patch.last_seen_on_bid_list,
        available_since: patch.available_since,
      }, { count: "exact" })
      .eq("brand_item_id", m.brand_template_id)
      .in("location_id", targetLocations);

    if (updErr) {
      console.error(`[sync] inventory_items update failed for template ${m.brand_template_id}:`, updErr.message);
      continue;
    }
    updatedCount += count ?? 0;
  }

  return updatedCount;
}

// ──────────────────────────────────────────────────────────────────
// 4. Per-brand sweep
// ──────────────────────────────────────────────────────────────────
async function sweepBrand(
  supabase: SupabaseClient,
  brand: { id: string; name: string },
): Promise<SweepResult> {
  const result: SweepResult = {
    brandId: brand.id,
    brandName: brand.name,
    healthRowsEvaluated: 0,
    healthRowsUpdated: 0,
    inventoryItemsUpdated: 0,
    newlyUnavailable60Plus: 0,
    reappeared: 0,
    errors: [],
  };

  try {
    const nowIso = new Date().toISOString();
    const todayLabel = fmtDate(new Date());

    // a. Load locations for this brand → territoryByLocation
    const { data: locations, error: locErr } = await supabase
      .from("locations")
      .select("id, vendor_territory, brand_id")
      .eq("brand_id", brand.id);
    if (locErr) throw new Error(`locations query failed: ${locErr.message}`);

    const territoryByLocation = new Map<string, string>();
    for (const loc of locations ?? []) {
      if (loc.vendor_territory) territoryByLocation.set(loc.id, loc.vendor_territory);
    }

    if (!territoryByLocation.size) {
      console.log(`[sweep] Brand ${brand.name}: no locations with vendor_territory set`);
      return result;
    }

    // b. Build PFG + PA bid lists in parallel
    const [pfgBidList, paBidList] = await Promise.all([
      buildPfgBidList(supabase, territoryByLocation),
      buildPaBidList(supabase, territoryByLocation),
    ]);

    // c. Load vendor_sku_health rows for this brand (skip manager-overridden)
    const { data: healthRows, error: healthErr } = await supabase
      .from("vendor_sku_health")
      .select("id, brand_id, vendor_source, vendor_sku, vendor_territory, last_seen_on_bid_list, days_not_seen, available_since")
      .eq("brand_id", brand.id)
      .eq("manager_deactivated_override", false);
    if (healthErr) throw new Error(`vendor_sku_health query failed: ${healthErr.message}`);

    result.healthRowsEvaluated = healthRows?.length ?? 0;

    // d. Evaluate each row
    const patches: HealthPatch[] = [];
    for (const row of (healthRows ?? []) as HealthRow[]) {
      const bidList = row.vendor_source.toLowerCase() === "pfg" ? pfgBidList : paBidList;
      const patch = evaluateHealthRow(row, bidList, nowIso, todayLabel);
      if (patch) patches.push(patch);
    }

    // e. Tally threshold-crossing events
    for (const p of patches) {
      if (!p._wasUnavailable60Plus && p._isUnavailable60Plus) result.newlyUnavailable60Plus++;
      if (p._wasMissing && !p._isMissing) result.reappeared++;
    }

    // f. Batch update vendor_sku_health (one row per patch — Supabase doesn't support
    //    bulk UPDATE ... WHERE id IN, so we fire updates in chunks of parallel calls)
    const CHUNK = 25;
    for (let i = 0; i < patches.length; i += CHUNK) {
      const slice = patches.slice(i, i + CHUNK);
      const updates = await Promise.all(slice.map((p) =>
        supabase
          .from("vendor_sku_health")
          .update({
            last_seen_on_bid_list: p.last_seen_on_bid_list,
            days_not_seen: p.days_not_seen,
            available_since: p.available_since,
          })
          .eq("id", p.id)
      ));
      for (const u of updates) {
        if (u.error) {
          result.errors.push(`vendor_sku_health update failed: ${u.error.message}`);
        } else {
          result.healthRowsUpdated++;
        }
      }
    }

    // g. Mirror to inventory_items via mapping → template join
    if (patches.length) {
      result.inventoryItemsUpdated = await syncToInventoryItems(
        supabase,
        brand.id,
        patches,
        territoryByLocation,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[inventory-availability-sweep] Brand ${brand.name} failed:`, msg);
    result.errors.push(msg);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let targetBrandId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.brand_id && typeof body.brand_id === "string") {
          targetBrandId = body.brand_id;
        }
      } catch { /* no body is fine */ }
    }

    let brandsQuery = supabase.from("brands").select("id, name").eq("is_active", true);
    if (targetBrandId) brandsQuery = brandsQuery.eq("id", targetBrandId);

    const { data: brands, error: brandsErr } = await brandsQuery;
    if (brandsErr) throw brandsErr;
    if (!brands?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No active brands", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: SweepResult[] = [];
    for (const brand of brands) {
      results.push(await sweepBrand(supabase, brand));
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[inventory-availability-sweep] Complete in ${durationMs}ms:`,
      JSON.stringify(results),
    );

    return new Response(
      JSON.stringify({ success: true, durationMs, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[inventory-availability-sweep] Fatal:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
