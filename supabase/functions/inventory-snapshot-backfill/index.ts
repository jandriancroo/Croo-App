// One-shot null-snapshot backfill for submitted inventory counts.
//
// Freezes pack_quantity_at_count + cost_at_count on every completed count row
// where either snapshot field is NULL, using the SAME resolution the UI runs
// today with forceLiveData=false. After this runs, the snapshot-wins guard in
// calculateCountItemValue makes those rows immutable to future item edits.
//
// Resolution parity (mirrors src/utils/countItemValue.ts, useLive=false path on null snapshots):
//   - cost_at_count       = item.cost_per_unit  (recipes: same — cost_per_unit IS the batch cost)
//   - pack_quantity_at_count = getEffectivePackQty({override, pack_quantity})
//        with Pipeline 1 fallback (outer_qty * canonical_qty_per_inner) when result === 1
//        and a brand_item_id conversion exists.
//
// Idempotent: only fills NULL snapshot fields; never overwrites an existing snapshot.
// Audit: every write logged to public.snapshot_backfill_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Resolver mirrors (kept inline; no project imports allowed in edge funcs) ──
function getEffectivePackQty(item: {
  pack_quantity_override?: number | null;
  count_units_per_case?: number | null;
  pack_quantity?: number | null;
}): number {
  const raw =
    item.pack_quantity_override ??
    item.count_units_per_case ??
    item.pack_quantity ??
    1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function resolvePackQty(
  item: any,
  conversion: { outer_qty: number; canonical_qty_per_inner: number | null } | null,
): number {
  const base = getEffectivePackQty({
    pack_quantity_override: item?.pack_quantity_override,
    count_units_per_case: item?.count_units_per_case,
    pack_quantity: item?.pack_quantity,
  });
  if (base !== 1) return base;
  // Pipeline 1 fallback — only when nothing else resolved AND no real overrides exist
  if (conversion && !item?.pack_quantity_override && !item?.pack_quantity) {
    const pipeline1 = Number(conversion.outer_qty) * Number(conversion.canonical_qty_per_inner ?? 1);
    if (Number.isFinite(pipeline1) && pipeline1 > 0) return pipeline1;
  }
  return base;
}

function resolveCost(item: any): number | null {
  // Mirror countItemValue.ts useLive=false fallback when no cost_at_count snapshot:
  //   costPerCase = Number(item?.cost_per_unit) || 0
  if (item?.cost_per_unit == null) return null;
  const n = Number(item.cost_per_unit);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // 1. Pull every NULL-snapshot row on a completed count, across all locations.
    //    inventory_counts.status filtering: completed/submitted = anything not 'in_progress'.
    const { data: completedCounts, error: countsErr } = await supabase
      .from("inventory_counts")
      .select("id, location_id, status")
      .neq("status", "in_progress");

    if (countsErr) throw countsErr;
    const countIds = (completedCounts || []).map((c) => c.id);
    const countLocMap = new Map<string, string>(
      (completedCounts || []).map((c) => [c.id, c.location_id]),
    );

    if (countIds.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, updated: 0, note: "no completed counts" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Paginate null-snapshot rows (count_items can be > 1000)
    const nullRows: Array<{
      id: string;
      count_id: string;
      item_id: string;
      pack_quantity_at_count: number | null;
      cost_at_count: number | null;
    }> = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("inventory_count_items")
        .select("id, count_id, item_id, pack_quantity_at_count, cost_at_count")
        .in("count_id", countIds)
        .or("pack_quantity_at_count.is.null,cost_at_count.is.null")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      nullRows.push(...data);
      if (data.length < pageSize) break;
    }

    if (nullRows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0, updated: 0, note: "no null snapshots" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Load all referenced inventory_items once.
    const uniqueItemIds = Array.from(new Set(nullRows.map((r) => r.item_id)));
    const itemMap = new Map<string, any>();
    for (let i = 0; i < uniqueItemIds.length; i += 100) {
      const slice = uniqueItemIds.slice(i, i + 100);
      const { data, error } = await supabase
        .from("inventory_items")
        .select(
          "id, location_id, brand_item_id, cost_per_unit, pack_quantity, pack_quantity_override, count_units_per_case, is_recipe",
        )
        .in("id", slice);
      if (error) throw error;
      for (const it of data || []) itemMap.set(it.id, it);
    }

    // 3. Load Pipeline 1 conversions for every brand_item_id present, scoped by brand.
    //    Easier: fetch every active conversion for all relevant brands in one shot.
    const brandIds = new Set<string>();
    const locationIds = new Set<string>();
    for (const it of itemMap.values()) {
      if (it.location_id) locationIds.add(it.location_id);
    }
    // location → org → brand resolution
    const { data: locRows } = await supabase
      .from("locations")
      .select("id, organization_id")
      .in("id", Array.from(locationIds));
    const orgByLoc = new Map<string, string>();
    const orgIds = new Set<string>();
    for (const l of locRows || []) {
      if (l.organization_id) {
        orgByLoc.set(l.id, l.organization_id);
        orgIds.add(l.organization_id);
      }
    }
    const { data: orgRows } = await supabase
      .from("organizations")
      .select("id, brand_id")
      .in("id", Array.from(orgIds));
    const brandByOrg = new Map<string, string>();
    for (const o of orgRows || []) {
      if (o.brand_id) {
        brandByOrg.set(o.id, o.brand_id);
        brandIds.add(o.brand_id);
      }
    }
    const brandByLoc = new Map<string, string>();
    for (const [locId, orgId] of orgByLoc.entries()) {
      const bid = brandByOrg.get(orgId);
      if (bid) brandByLoc.set(locId, bid);
    }

    // Fetch active conversions for these brands. Use brand_template_id (the brand item) as key.
    const conversionMap = new Map<string, { outer_qty: number; canonical_qty_per_inner: number | null }>();
    if (brandIds.size > 0) {
      const { data: convs, error: convErr } = await supabase
        .from("item_conversions")
        .select("brand_template_id, outer_qty, canonical_qty_per_inner, effective_to")
        .in("brand_id", Array.from(brandIds))
        .is("effective_to", null);
      if (convErr) throw convErr;
      for (const c of convs || []) {
        conversionMap.set(c.brand_template_id, {
          outer_qty: Number(c.outer_qty),
          canonical_qty_per_inner: c.canonical_qty_per_inner == null ? null : Number(c.canonical_qty_per_inner),
        });
      }
    }

    // 4. Walk each null-snapshot row, resolve, update, log.
    let updated = 0;
    let skippedNoItem = 0;
    let skippedNoCost = 0;
    const perLocation = new Map<string, number>();

    for (const row of nullRows) {
      const item = itemMap.get(row.item_id);
      if (!item) {
        skippedNoItem++;
        continue;
      }
      const conv = item.brand_item_id ? conversionMap.get(item.brand_item_id) ?? null : null;

      const newPack = row.pack_quantity_at_count == null
        ? resolvePackQty(item, conv)
        : null;
      const newCost = row.cost_at_count == null
        ? resolveCost(item)
        : null;

      // Build update patch — only set NULL fields
      const patch: Record<string, number> = {};
      if (newPack != null && Number.isFinite(newPack)) patch.pack_quantity_at_count = newPack;
      if (newCost != null && Number.isFinite(newCost)) patch.cost_at_count = newCost;

      if (Object.keys(patch).length === 0) {
        if (row.cost_at_count == null && newCost == null) skippedNoCost++;
        continue;
      }

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("inventory_count_items")
          .update(patch)
          .eq("id", row.id);
        if (upErr) {
          console.error("update failed", row.id, upErr.message);
          continue;
        }

        await supabase.from("snapshot_backfill_log").insert({
          count_id: row.count_id,
          item_id: row.item_id,
          location_id: countLocMap.get(row.count_id) ?? null,
          old_pack_qty: row.pack_quantity_at_count,
          new_pack_qty: patch.pack_quantity_at_count ?? null,
          old_cost: row.cost_at_count,
          new_cost: patch.cost_at_count ?? null,
        });
      }

      updated++;
      const locId = countLocMap.get(row.count_id) ?? "unknown";
      perLocation.set(locId, (perLocation.get(locId) ?? 0) + 1);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        total_null_rows: nullRows.length,
        updated,
        skipped_no_item: skippedNoItem,
        skipped_no_resolvable_cost: skippedNoCost,
        per_location: Object.fromEntries(perLocation),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("backfill error", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
