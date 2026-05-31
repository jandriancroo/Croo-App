// pan-baseline-backfill — one-shot correction for under-scaled recipe counts.
//
// Targets: submitted inventory_count_items where
//   is_recipe = true AND pan_sizes_at_count.enabled = true AND pan_inputs present,
// AND the live inventory_items.pan_sizes.baseline_units differs from
// pan_sizes_at_count.baseline_units.
//
// For each match it recomputes quantity from pan_inputs × live pan units
// (same getPanUnits formula the session UI uses) and refreshes pan_sizes_at_count.
// cost_at_count is intentionally untouched. Every row is logged to
// snapshot_backfill_log with source = 'pan_baseline_correction_2026_05'.
//
// ?dry_run=true (default true) returns scan counts only; no writes.
// ?dry_run=false executes the writes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOURCE_TAG = "pan_baseline_correction_2026_05";

// ── Pan registry (mirrors src/components/inventory/PanSizesSection.tsx) ──
const ALL_CONTAINERS: { key: string; ratio: number }[] = [
  { key: "full_pan", ratio: 1 },
  { key: "two_thirds", ratio: 0.667 },
  { key: "half_pan", ratio: 0.5 },
  { key: "third_pan", ratio: 0.333 },
  { key: "quarter_pan", ratio: 0.25 },
  { key: "sixth_pan", ratio: 0.167 },
  { key: "ninth_pan", ratio: 0.111 },
  { key: "cambro_22qt", ratio: 0.8 },
  { key: "cambro_12qt", ratio: 0.6 },
  { key: "cambro_8qt", ratio: 0.4 },
  { key: "cambro_4qt", ratio: 0.2 },
  { key: "dough_tray_full", ratio: 1.0 },
  { key: "dough_tray_half", ratio: 0.5 },
  { key: "dough_box", ratio: 1.2 },
];

const roundHalf = (v: number) => Math.round(v * 100) / 100;

interface PanSizes {
  enabled: boolean;
  baseline_key: string;
  baseline_units: number;
  enabled_keys: string[];
  overrides?: Record<string, number>;
}

function getPanUnits(config: PanSizes, containerKey: string): number | null {
  if (!config?.enabled || !(config.baseline_units > 0)) return null;
  if (!config.enabled_keys?.includes(containerKey)) return null;
  if (config.overrides?.[containerKey] != null) return Number(config.overrides[containerKey]);
  const baseline = ALL_CONTAINERS.find((c) => c.key === config.baseline_key);
  const target = ALL_CONTAINERS.find((c) => c.key === containerKey);
  if (!baseline || !target) return null;
  return roundHalf((target.ratio / baseline.ratio) * config.baseline_units);
}

function computeQuantityFromPanInputs(panInputs: Record<string, number>, config: PanSizes): number {
  let total = 0;
  for (const [k, raw] of Object.entries(panInputs || {})) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n === 0) continue;
    const units = getPanUnits(config, k);
    if (units == null) continue;
    total += n * units;
  }
  return total;
}

const approxEq = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") !== "false"; // default TRUE

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const summary = {
    dry_run: dryRun,
    source: SOURCE_TAG,
    scanned: 0,
    candidates: 0,           // is_recipe + pan enabled + pan_inputs present
    would_heal: 0,           // baseline differs and recomputed qty differs
    skipped_baseline_match: 0,
    skipped_no_pan_inputs: 0,
    skipped_no_live_item: 0,
    skipped_live_pan_disabled: 0,
    skipped_qty_unchanged: 0,
    skipped_recompute_failed: 0,
    updated: 0,
    errors: [] as { row_id: string; error: string }[],
    sample: [] as Array<{
      row_id: string;
      count_id: string;
      item_id: string;
      old_baseline: number;
      new_baseline: number;
      old_quantity: number;
      new_quantity: number;
    }>,
  };

  try {
    // 1) Pull submitted counts
    const { data: completedCounts, error: countsErr } = await supabase
      .from("inventory_counts")
      .select("id, location_id, status")
      .neq("status", "in_progress");
    if (countsErr) throw countsErr;
    const countLocMap = new Map<string, string>(
      (completedCounts || []).map((c: any) => [c.id, c.location_id]),
    );
    const countIds = Array.from(countLocMap.keys());
    if (countIds.length === 0) {
      return new Response(JSON.stringify({ ...summary, note: "no completed counts" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Pull candidate rows (paged, chunked by count_id to avoid IN-list limits)
    const candidateRows: Array<{
      id: string;
      count_id: string;
      item_id: string;
      quantity: number | null;
      pan_inputs: Record<string, number> | null;
      pan_sizes_at_count: PanSizes | null;
    }> = [];
    const chunkSize = 200;
    for (let i = 0; i < countIds.length; i += chunkSize) {
      const slice = countIds.slice(i, i + chunkSize);
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("inventory_count_items")
          .select("id, count_id, item_id, quantity, pan_inputs, pan_sizes_at_count")
          .in("count_id", slice)
          .not("pan_sizes_at_count", "is", null)
          .not("pan_inputs", "is", null)
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        candidateRows.push(...(data as any[]));
        if (data.length < pageSize) break;
      }
    }
    summary.scanned = candidateRows.length;

    // Filter to is_recipe items + pan enabled
    const itemIds = Array.from(new Set(candidateRows.map((r) => r.item_id)));
    const itemMap = new Map<string, { is_recipe: boolean; pan_sizes: PanSizes | null }>();
    for (let i = 0; i < itemIds.length; i += 200) {
      const slice = itemIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, is_recipe, pan_sizes")
        .in("id", slice);
      if (error) throw error;
      for (const it of data || []) itemMap.set(it.id, { is_recipe: !!it.is_recipe, pan_sizes: (it as any).pan_sizes });
    }

    // 3) Evaluate each candidate
    for (const row of candidateRows) {
      const live = itemMap.get(row.item_id);
      if (!live) {
        summary.skipped_no_live_item++;
        continue;
      }
      if (!live.is_recipe) continue;
      const snap = row.pan_sizes_at_count;
      if (!snap?.enabled) continue;
      const panInputs = row.pan_inputs;
      if (!panInputs || Object.keys(panInputs).length === 0) {
        summary.skipped_no_pan_inputs++;
        continue;
      }
      summary.candidates++;

      const livePan = live.pan_sizes;
      if (!livePan?.enabled || !(livePan.baseline_units > 0)) {
        summary.skipped_live_pan_disabled++;
        continue;
      }

      const snapBaseline = Number(snap.baseline_units) || 0;
      const liveBaseline = Number(livePan.baseline_units) || 0;
      if (approxEq(snapBaseline, liveBaseline)) {
        summary.skipped_baseline_match++;
        continue;
      }

      // Recompute new quantity from pan_inputs × live pan units, preserving the
      // snapshot's enabled_keys/baseline_key shape but with live baseline + overrides
      // so the resulting pan_sizes_at_count is self-consistent with the new qty.
      const correctedSnap: PanSizes = {
        ...snap,
        baseline_key: livePan.baseline_key ?? snap.baseline_key,
        baseline_units: liveBaseline,
        enabled_keys: snap.enabled_keys, // preserve count shape
        overrides: livePan.overrides ?? snap.overrides ?? undefined,
      };
      const newQty = computeQuantityFromPanInputs(panInputs, correctedSnap);
      const oldQty = Number(row.quantity) || 0;

      if (!Number.isFinite(newQty)) {
        summary.skipped_recompute_failed++;
        continue;
      }
      if (approxEq(newQty, oldQty)) {
        summary.skipped_qty_unchanged++;
        continue;
      }

      summary.would_heal++;
      if (summary.sample.length < 20) {
        summary.sample.push({
          row_id: row.id,
          count_id: row.count_id,
          item_id: row.item_id,
          old_baseline: snapBaseline,
          new_baseline: liveBaseline,
          old_quantity: oldQty,
          new_quantity: roundHalf(newQty),
        });
      }

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("inventory_count_items")
          .update({
            quantity: newQty,
            pan_sizes_at_count: correctedSnap,
          })
          .eq("id", row.id);
        if (upErr) {
          summary.errors.push({ row_id: row.id, error: upErr.message });
          continue;
        }
        await supabase.from("snapshot_backfill_log").insert({
          count_id: row.count_id,
          item_id: row.item_id,
          location_id: countLocMap.get(row.count_id) ?? null,
          source: SOURCE_TAG,
          old_quantity: oldQty,
          new_quantity: newQty,
          old_baseline: snapBaseline,
          new_baseline: liveBaseline,
        });
        summary.updated++;
      }
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message, partial: summary }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
