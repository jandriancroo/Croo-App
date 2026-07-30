import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const BID_LIST_WINDOW_DAYS = 30;
const UNAVAILABLE_THRESHOLD_DAYS = 60;

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────
interface SamplePatch {
  id: string;
  name: string;
  matchedVendor: "pfg" | "pa" | null;
  before: {
    last_seen_on_bid_list: string | null;
    days_not_seen: number | null;
    available_since: string | null;
  };
  after: {
    last_seen_on_bid_list: string | null;
    days_not_seen: number;
    available_since: string | null;
  };
}

interface LocationSweepResult {
  locationId: string;
  locationName: string;
  brandId: string | null;
  itemsEvaluated: number;
  itemsWithMappings: number;
  itemsUpdated: number;          // # of rows that WOULD be (or were) changed
  itemsCommitted: number;        // # of rows actually written this run
  newlyUnavailable60Plus: number;
  reappeared: number;
  pfgSkuCount: number;
  paSkuCount: number;
  itemsNeverSeen: number;        // days_not_seen IS NULL on inventory_items
  matchedFromPfg: number;        // items currently on PFG bid list
  matchedFromPa: number;         // items currently on PA bid list
  dryRun: boolean;
  samplePatches: SamplePatch[];
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
  name: string;
  before: InventoryItemRow;
  matchedVendor: "pfg" | "pa" | null;
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function vendorLabel(vendor: "pfg" | "pa"): string {
  return vendor === "pfg" ? "PFG" : "PA";
}

// ──────────────────────────────────────────────────────────────────
// 1. Per-location bid list builders
// ──────────────────────────────────────────────────────────────────
async function buildLocationPfgSkuSet(
  supabase: SupabaseClient,
  locationId: string,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - BID_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const { data, error } = await supabase
    .from("pfg_orders")
    .select("items, delivery_date")
    .eq("location_id", locationId)
    .gte("delivery_date", cutoff);

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
  // PA "bid list" equivalent = pa_catalog_items (weekly pricing catalog).
  // This mirrors the PFG bid-list logic: an item is "available" if it
  // appeared in the vendor's current catalog within BID_LIST_WINDOW_DAYS.
  // We previously read pa_orders.items, but those JSONB arrays are often
  // empty (line-items gap) and orders only reflect what was purchased,
  // not what's currently offered.
  const cutoff = new Date(
    Date.now() - BID_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("pa_catalog_items")
    .select("pa_item_id")
    .eq("location_id", locationId)
    .gte("last_seen_at", cutoff);

  if (error) throw new Error(`pa_catalog_items query failed: ${error.message}`);

  const out = new Set<string>();
  for (const row of data ?? []) {
    if (row?.pa_item_id) out.add(String(row.pa_item_id));
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// 2. Pure evaluator
// ──────────────────────────────────────────────────────────────────
function evaluateItem(
  row: InventoryItemRow,
  onList: boolean,
  vendor: "pfg" | "pa",
  matchedVendor: "pfg" | "pa" | null,
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
    if (currentDays === 0 && row.available_since !== null) {
      next_available_since = null;
    }
  }

  const isMissing = next_days_not_seen > 0;
  const isUnavailable60Plus = next_days_not_seen >= UNAVAILABLE_THRESHOLD_DAYS;

  const unchanged =
    next_last_seen === row.last_seen_on_bid_list &&
    next_days_not_seen === currentDays &&
    next_available_since === row.available_since;
  if (unchanged) return null;

  return {
    id: row.id,
    name: row.name,
    before: row,
    matchedVendor,
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
  dryRun: boolean,
): Promise<LocationSweepResult> {
  const result: LocationSweepResult = {
    locationId: location.id,
    locationName: location.name,
    brandId: location.brand_id,
    itemsEvaluated: 0,
    itemsWithMappings: 0,
    itemsUpdated: 0,
    itemsCommitted: 0,
    newlyUnavailable60Plus: 0,
    reappeared: 0,
    pfgSkuCount: 0,
    paSkuCount: 0,
    itemsNeverSeen: 0,
    matchedFromPfg: 0,
    matchedFromPa: 0,
    dryRun,
    samplePatches: [],
    errors: [],
  };

  try {
    if (!location.brand_id) {
      console.log(`[sweep] ${location.name}: no brand_id, skipping`);
      result.errors.push("location has no brand_id (organization not linked to a brand)");
      return result;
    }

    const nowIso = new Date().toISOString();
    const todayLabel = fmtDate(new Date());

    // a. Pull bid lists in parallel
    const [pfgSkus, paSkus] = await Promise.all([
      buildLocationPfgSkuSet(supabase, location.id),
      buildLocationPaSkuSet(supabase, location.id),
    ]);
    result.pfgSkuCount = pfgSkus.size;
    result.paSkuCount = paSkus.size;

    console.log(
      `[sweep] ${location.name}: PFG=${pfgSkus.size} skus, PA=${paSkus.size} skus`,
    );

    // b. Brand vendor mappings for this brand
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

    // c. Inventory items at this location (vendor-mapped only)
    const { data: items, error: itemsErr } = await supabase
      .from("inventory_items")
      .select("id, name, location_id, brand_item_id, last_seen_on_bid_list, days_not_seen, available_since")
      .eq("location_id", location.id)
      .not("brand_item_id", "is", null)
      .in("vendor_source", ["pfg", "produce_alliance"]);
    if (itemsErr) throw new Error(`inventory_items query failed: ${itemsErr.message}`);

    result.itemsEvaluated = items?.length ?? 0;
    result.itemsNeverSeen = (items ?? []).filter((r) => r.days_not_seen === null).length;

    // d. Evaluate
    const patches: ItemPatch[] = [];
    for (const row of (items ?? []) as InventoryItemRow[]) {
      if (!row.brand_item_id) continue;
      const itemMappings = mappingsByTemplate.get(row.brand_item_id);
      if (!itemMappings || itemMappings.length === 0) continue;
      result.itemsWithMappings++;

      let onList = false;
      let matchedVendor: "pfg" | "pa" | null = null;
      let primaryVendor: "pfg" | "pa" = "pfg";
      let hasPfgMapping = false;

      for (const m of itemMappings) {
        const v = m.vendor.toLowerCase();
        if (v === "pfg") hasPfgMapping = true;
      }
      primaryVendor = hasPfgMapping ? "pfg" : "pa";

      for (const m of itemMappings) {
        const v = m.vendor.toLowerCase();
        if (v === "pfg" && pfgSkus.has(String(m.vendor_item_id))) {
          onList = true;
          matchedVendor = "pfg";
          break;
        } else if ((v === "pa" || v === "produce_alliance") && paSkus.has(String(m.vendor_item_id))) {
          onList = true;
          matchedVendor = "pa";
          break;
        }
      }

      if (matchedVendor === "pfg") result.matchedFromPfg++;
      if (matchedVendor === "pa") result.matchedFromPa++;

      const labelVendor = onList && matchedVendor ? matchedVendor : primaryVendor;
      const patch = evaluateItem(row, onList, labelVendor, matchedVendor, nowIso, todayLabel);
      if (patch) patches.push(patch);
    }

    // e. Threshold tallies
    for (const p of patches) {
      if (!p._wasUnavailable60Plus && p._isUnavailable60Plus) result.newlyUnavailable60Plus++;
      if (p._wasMissing && !p._isMissing) result.reappeared++;
    }
    result.itemsUpdated = patches.length;

    // f. Sample 5 before/after
    result.samplePatches = patches.slice(0, 5).map((p) => ({
      id: p.id,
      name: p.name,
      matchedVendor: p.matchedVendor,
      before: {
        last_seen_on_bid_list: p.before.last_seen_on_bid_list,
        days_not_seen: p.before.days_not_seen,
        available_since: p.before.available_since,
      },
      after: {
        last_seen_on_bid_list: p.last_seen_on_bid_list,
        days_not_seen: p.days_not_seen,
        available_since: p.available_since,
      },
    }));

    // g. Commit (skipped on dry run)
    if (!dryRun) {
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
            result.itemsCommitted++;
          }
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[inventory-availability-sweep] Location ${location.name} failed:`, msg);
    result.errors.push(msg);
  }

  // ── A4: auto-deploy missing recipe ingredients ─────────────────
  try {
    if (location.brand_id && !dryRun) {
      const autoResult = await autoDeployMissingIngredients(supabase, location);
      (result as any).autoDeployed = autoResult.deployed;
      (result as any).autoReactivated = autoResult.reactivated;
      if (autoResult.errors.length) result.errors.push(...autoResult.errors);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[auto-deploy] ${location.name} failed:`, msg);
    result.errors.push(`auto-deploy: ${msg}`);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────
// A4: Auto-deploy missing recipe ingredients
// For each active brand-level recipe blueprint at this brand, find
// vendor_item_ids (brand_inventory_templates.id) that aren't deployed
// to this location. If the template is live + auto_deploy_enabled, create
// (or reactivate) the local inventory_items row and log it.
// ──────────────────────────────────────────────────────────────────
async function autoDeployMissingIngredients(
  supabase: SupabaseClient,
  location: { id: string; name: string; brand_id: string | null },
): Promise<{ deployed: number; reactivated: number; errors: string[] }> {
  const out = { deployed: 0, reactivated: 0, errors: [] as string[] };
  if (!location.brand_id) return out;

  // 1. Active brand blueprints + their vendor ingredient ids
  const { data: blueprints, error: bpErr } = await supabase
    .from("recipe_blueprints")
    .select("id, recipe_blueprint_ingredients(vendor_item_id)")
    .eq("brand_id", location.brand_id)
    .is("location_id", null)
    .eq("is_active", true);
  if (bpErr) {
    out.errors.push(`recipe_blueprints query: ${bpErr.message}`);
    return out;
  }

  // template_id -> blueprint_ids that reference it
  const refMap = new Map<string, Set<string>>();
  for (const bp of blueprints ?? []) {
    for (const ing of (bp as any).recipe_blueprint_ingredients ?? []) {
      const vid = ing?.vendor_item_id;
      if (!vid) continue;
      const set = refMap.get(vid) ?? new Set<string>();
      set.add((bp as any).id);
      refMap.set(vid, set);
    }
  }
  if (refMap.size === 0) return out;

  const referencedIds = Array.from(refMap.keys());

  // 2. Templates: only live + auto_deploy_enabled
  const { data: templates, error: tErr } = await supabase
    .from("brand_inventory_templates")
    .select("id, product_name, status, auto_deploy_enabled, storage_location_name")
    .in("id", referencedIds)
    .eq("brand_id", location.brand_id)
    .eq("status", "live")
    .eq("auto_deploy_enabled", true);
  if (tErr) {
    out.errors.push(`brand_inventory_templates query: ${tErr.message}`);
    return out;
  }

  // 3. Existing local rows for those templates
  const tplIds = (templates ?? []).map((t: any) => t.id);
  if (tplIds.length === 0) return out;

  const { data: existing, error: eErr } = await supabase
    .from("inventory_items")
    .select("id, brand_item_id, is_active")
    .eq("location_id", location.id)
    .in("brand_item_id", tplIds);
  if (eErr) {
    out.errors.push(`inventory_items lookup: ${eErr.message}`);
    return out;
  }
  const existingByTpl = new Map<string, { id: string; is_active: boolean }>();
  for (const r of existing ?? []) {
    existingByTpl.set((r as any).brand_item_id, { id: (r as any).id, is_active: (r as any).is_active });
  }

  // 4. Deploy / reactivate
  const logRows: any[] = [];
  for (const tpl of (templates ?? []) as any[]) {
    const existingRow = existingByTpl.get(tpl.id);
    const recipeIds = Array.from(refMap.get(tpl.id) ?? []);

    if (existingRow?.is_active) continue; // already deployed and active

    if (existingRow && !existingRow.is_active) {
      // Reactivate
      const { error: upErr } = await supabase
        .from("inventory_items")
        .update({ is_active: true })
        .eq("id", existingRow.id);
      if (upErr) {
        out.errors.push(`reactivate ${tpl.product_name}: ${upErr.message}`);
        continue;
      }
      out.reactivated++;
      logRows.push({
        location_id: location.id,
        brand_template_id: tpl.id,
        inventory_item_id: existingRow.id,
        recipe_ids: recipeIds,
        action: "reactivated",
      });
    } else {
      // Create new minimal local row — vendor SKUs intentionally NOT stamped
      // (matches existing deploy-location-inventory behavior; later vendor syncs fill them).
      const insertRow = {
        location_id: location.id,
        brand_item_id: tpl.id,
        name: tpl.product_name,
        is_active: true,
      };
      const { data: created, error: insErr } = await supabase
        .from("inventory_items")
        .insert(insertRow)
        .select("id")
        .single();
      if (insErr) {
        out.errors.push(`deploy ${tpl.product_name}: ${insErr.message}`);
        continue;
      }
      out.deployed++;
      logRows.push({
        location_id: location.id,
        brand_template_id: tpl.id,
        inventory_item_id: created?.id ?? null,
        recipe_ids: recipeIds,
        action: "created",
      });
    }
  }

  if (logRows.length > 0) {
    const { error: logErr } = await supabase
      .from("brand_auto_deployment_log")
      .insert(logRows);
    if (logErr) out.errors.push(`auto-deploy log: ${logErr.message}`);
  }

  console.log(
    `[auto-deploy] ${location.name}: deployed=${out.deployed}, reactivated=${out.reactivated}, errs=${out.errors.length}`,
  );
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Internal-only endpoint (cron / service invokes).
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let targetLocationId: string | null = null;
    let targetBrandId: string | null = null;
    let dryRun = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.location_id && typeof body.location_id === "string") {
          targetLocationId = body.location_id;
        }
        if (body?.brand_id && typeof body.brand_id === "string") {
          targetBrandId = body.brand_id;
        }
        if (body?.dry_run === true) dryRun = true;
      } catch { /* no body is fine */ }
    }

    // Locations: brand_id lives on organizations, NOT on locations.
    let locsQuery = supabase
      .from("locations")
      .select("id, name, organization_id, is_active, organizations!inner(brand_id)")
      .eq("is_active", true);
    if (targetLocationId) locsQuery = locsQuery.eq("id", targetLocationId);
    if (targetBrandId) locsQuery = locsQuery.eq("organizations.brand_id", targetBrandId);

    const { data: rawLocations, error: locErr } = await locsQuery;
    if (locErr) throw locErr;
    if (!rawLocations?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No active locations", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const locations = rawLocations.map((l: any) => ({
      id: l.id as string,
      name: l.name as string,
      brand_id: (l.organizations?.brand_id ?? null) as string | null,
    }));

    const results: LocationSweepResult[] = [];
    for (const loc of locations) {
      results.push(await sweepLocation(supabase, loc, dryRun));
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[inventory-availability-sweep] ${dryRun ? "DRY RUN" : "LIVE"} complete in ${durationMs}ms:`,
      JSON.stringify(results.map((r) => ({
        loc: r.locationName,
        eval: r.itemsEvaluated,
        wouldUpdate: r.itemsUpdated,
        committed: r.itemsCommitted,
        pfgMatched: r.matchedFromPfg,
        paMatched: r.matchedFromPa,
        errs: r.errors.length,
      }))),
    );

    return new Response(
      JSON.stringify({ success: true, dryRun, durationMs, results }),
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
