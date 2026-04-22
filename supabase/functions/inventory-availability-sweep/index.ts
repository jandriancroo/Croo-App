import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BID_LIST_WINDOW_DAYS = 30;
const UNAVAILABLE_THRESHOLD_DAYS = 60;

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────
interface LocationSweepResult {
  locationId: string;
  locationName: string;
  itemsEvaluated: number;
  itemsUpdated: number;
  newlyUnavailable60Plus: number;
  reappeared: number;
  pfgSkuCount: number;
  paSkuCount: number;
  errors: string[];
}

interface InventoryItemRow {
  id: string;
  name: string;
  location_id: string;
  brand_item_id: string | null;
  last_seen_on_bid_list: string | null;
  days_not_seen: number | null;
  available_since: string | null;
}

interface VendorMappingRow {
  brand_template_id: string;
  vendor: string;
  vendor_item_id: string;
}

interface ItemPatch {
  id: string;
  last_seen_on_bid_list: string | null;
  days_not_seen: number;
  available_since: string | null;
  _wasUnavailable60Plus: boolean;
  _isUnavailable60Plus: boolean;
  _wasMissing: boolean;
  _isMissing: boolean;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  // "Apr 21, 2026" — matches existing manager-facing tag style
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function vendorLabel(vendor: "pfg" | "pa"): string {
  return vendor === "pfg" ? "PFG" : "PA";
}

// ──────────────────────────────────────────────────────────────────
// 1. Per-location bid list builders
//    Each returns the set of vendor SKUs ordered by THIS location
//    in the last BID_LIST_WINDOW_DAYS. Pure pull from local order
//    history — no shared territory state.
// ──────────────────────────────────────────────────────────────────
async function buildLocationPfgSkuSet(
  supabase: SupabaseClient,
  locationId: string,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - BID_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pfg_orders")
    .select("items")
    .eq("location_id", locationId)
    .gte("created_at", cutoff);

  if (error) throw new Error(`pfg_orders query failed: ${error.message}`);

  const out = new Set<string>();
  for (const row of data ?? []) {
    const items = Array.isArray(row.items) ? row.items : [];
    for (const it of items) {
      const sku = it?.itemNumber ?? it?.item_number ?? it?.productId;
      if (sku) out.add(String(sku));
    }
  }
  return out;
}

async function buildLocationPaSkuSet(
  supabase: SupabaseClient,
  locationId: string,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - BID_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("pa_orders")
    .select("items")
    .eq("location_id", locationId)
    .gte("created_at", cutoff);

  if (error) throw new Error(`pa_orders query failed: ${error.message}`);

  const out = new Set<string>();
  for (const row of data ?? []) {
    const items = Array.isArray(row.items) ? row.items : [];
    for (const it of items) {
      const sku = it?.item_number ?? it?.pa_item_id ?? it?.productId;
      if (sku) out.add(String(sku));
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// 2. Pure evaluator — one inventory_item row vs. its vendor SKU set
// ──────────────────────────────────────────────────────────────────
function evaluateItem(
  row: InventoryItemRow,
  onList: boolean,
  vendor: "pfg" | "pa",
  nowIso: string,
  todayLabel: string,
): ItemPatch | null {
  const currentDays = row.days_not_seen ?? 0;
  const wasMissing = currentDays > 0;
  const wasUnavailable60Plus = currentDays >= UNAVAILABLE_THRESHOLD_DAYS;

  let next_last_seen = row.last_seen_on_bid_list;
  let next_days_not_seen = currentDays;
  let next_available_since = row.available_since;

  if (onList) {
    next_last_seen = nowIso;
    next_days_not_seen = 0;
    if (wasMissing) {
      next_available_since = `Back on ${vendorLabel(vendor)} bid list — ${todayLabel}`;
    }
  } else {
    next_days_not_seen = currentDays + 1;
    // 0 → 1 transition: clear stale "Back on..." tag
    if (currentDays === 0 && row.available_since !== null) {
      next_available_since = null;
    }
  }

  const isMissing = next_days_not_seen > 0;
  const isUnavailable60Plus = next_days_not_seen >= UNAVAILABLE_THRESHOLD_DAYS;

  // No-op detection
  const unchanged =
    next_last_seen === row.last_seen_on_bid_list &&
    next_days_not_seen === currentDays &&
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
  };
}

// ──────────────────────────────────────────────────────────────────
// 3. Per-location sweep
// ──────────────────────────────────────────────────────────────────
async function sweepLocation(
  supabase: SupabaseClient,
  location: { id: string; name: string; brand_id: string | null },
): Promise<LocationSweepResult> {
  const result: LocationSweepResult = {
    locationId: location.id,
    locationName: location.name,
    itemsEvaluated: 0,
    itemsUpdated: 0,
    newlyUnavailable60Plus: 0,
    reappeared: 0,
    pfgSkuCount: 0,
    paSkuCount: 0,
    errors: [],
  };

  try {
    if (!location.brand_id) {
      console.log(`[sweep] ${location.name}: no brand_id, skipping`);
      return result;
    }

    const nowIso = new Date().toISOString();
    const todayLabel = fmtDate(new Date());

    // a. Pull this location's bid lists (parallel)
    const [pfgSkus, paSkus] = await Promise.all([
      buildLocationPfgSkuSet(supabase, location.id),
      buildLocationPaSkuSet(supabase, location.id),
    ]);
    result.pfgSkuCount = pfgSkus.size;
    result.paSkuCount = paSkus.size;

    console.log(
      `[sweep] ${location.name}: PFG=${pfgSkus.size} skus, PA=${paSkus.size} skus`,
    );

    // b. Load brand vendor mappings → (brand_template_id) → (vendor, vendor_item_id)[]
    //    A single template can have multiple mappings (different vendors / aliases).
    const { data: mappings, error: mapErr } = await supabase
      .from("brand_vendor_mappings")
      .select("brand_template_id, vendor, vendor_item_id, brand_inventory_templates!inner(brand_id)")
      .eq("brand_inventory_templates.brand_id", location.brand_id);
    if (mapErr) throw new Error(`brand_vendor_mappings query failed: ${mapErr.message}`);

    const mappingsByTemplate = new Map<string, VendorMappingRow[]>();
    for (const m of (mappings ?? []) as VendorMappingRow[]) {
      const arr = mappingsByTemplate.get(m.brand_template_id) ?? [];
      arr.push(m);
      mappingsByTemplate.set(m.brand_template_id, arr);
    }

    // c. Load this location's inventory_items
    const { data: items, error: itemsErr } = await supabase
      .from("inventory_items")
      .select("id, name, location_id, brand_item_id, last_seen_on_bid_list, days_not_seen, available_since")
      .eq("location_id", location.id)
      .not("brand_item_id", "is", null);
    if (itemsErr) throw new Error(`inventory_items query failed: ${itemsErr.message}`);

    result.itemsEvaluated = items?.length ?? 0;

    // d. Evaluate each item against the union of its vendor mappings
    const patches: ItemPatch[] = [];
    for (const row of (items ?? []) as InventoryItemRow[]) {
      if (!row.brand_item_id) continue;
      const itemMappings = mappingsByTemplate.get(row.brand_item_id);
      if (!itemMappings || itemMappings.length === 0) continue;

      // Determine which vendor "owns" the visibility check.
      // If ANY mapping's vendor sku appears in its respective bid list → onList = true.
      // Track which vendor matched for the available_since label.
      let onList = false;
      let matchedVendor: "pfg" | "pa" = "pfg";
      let primaryVendor: "pfg" | "pa" = "pfg";

      for (const m of itemMappings) {
        const v = m.vendor.toLowerCase();
        if (v === "pfg") {
          primaryVendor = "pfg";
          if (pfgSkus.has(String(m.vendor_item_id))) {
            onList = true;
            matchedVendor = "pfg";
            break;
          }
        } else if (v === "pa" || v === "produce_alliance") {
          primaryVendor = primaryVendor === "pfg" && itemMappings.some((x) => x.vendor.toLowerCase() === "pfg") ? "pfg" : "pa";
          if (paSkus.has(String(m.vendor_item_id))) {
            onList = true;
            matchedVendor = "pa";
            break;
          }
        }
      }

      const labelVendor = onList ? matchedVendor : primaryVendor;
      const patch = evaluateItem(row, onList, labelVendor, nowIso, todayLabel);
      if (patch) patches.push(patch);
    }

    // e. Tally threshold-crossing events
    for (const p of patches) {
      if (!p._wasUnavailable60Plus && p._isUnavailable60Plus) result.newlyUnavailable60Plus++;
      if (p._wasMissing && !p._isMissing) result.reappeared++;
    }

    // f. Batch update inventory_items in chunks of parallel calls
    const CHUNK = 25;
    for (let i = 0; i < patches.length; i += CHUNK) {
      const slice = patches.slice(i, i + CHUNK);
      const updates = await Promise.all(slice.map((p) =>
        supabase
          .from("inventory_items")
          .update({
            last_seen_on_bid_list: p.last_seen_on_bid_list,
            days_not_seen: p.days_not_seen,
            available_since: p.available_since,
          })
          .eq("id", p.id)
      ));
      for (const u of updates) {
        if (u.error) {
          result.errors.push(`inventory_items update failed: ${u.error.message}`);
        } else {
          result.itemsUpdated++;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[inventory-availability-sweep] Location ${location.name} failed:`, msg);
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

    // Optional scoping: { location_id?: string, brand_id?: string }
    let targetLocationId: string | null = null;
    let targetBrandId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.location_id && typeof body.location_id === "string") {
          targetLocationId = body.location_id;
        }
        if (body?.brand_id && typeof body.brand_id === "string") {
          targetBrandId = body.brand_id;
        }
      } catch { /* no body is fine */ }
    }

    let locsQuery = supabase
      .from("locations")
      .select("id, name, brand_id, is_active")
      .eq("is_active", true);
    if (targetLocationId) locsQuery = locsQuery.eq("id", targetLocationId);
    if (targetBrandId) locsQuery = locsQuery.eq("brand_id", targetBrandId);

    const { data: locations, error: locErr } = await locsQuery;
    if (locErr) throw locErr;
    if (!locations?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No active locations", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: LocationSweepResult[] = [];
    for (const loc of locations) {
      results.push(await sweepLocation(supabase, loc));
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
