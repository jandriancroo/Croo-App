/**
 * Single source of truth for resolving "which pack qty wins" across the app.
 *
 * Priority (snapshot-first, fail-closed):
 *   1. pack_quantity_at_count  — frozen snapshot from save time (post-Apr-28 lock)
 *   2. pack_quantity_override  — location-level override
 *   3. count_units_per_case    — legacy count config
 *   4. pack_quantity           — vendor sync
 *   5. 1                       — final fallback
 *
 * If pack_quantity_at_count is present, it ALWAYS wins — even if a caller
 * elsewhere has opted into live data. Submitted counts are frozen forever.
 *
 * Callers that intentionally want to ignore the snapshot (e.g. an in-progress
 * count being recomputed) should pass an object WITHOUT pack_quantity_at_count.
 */
export interface PackQtySource {
  pack_quantity_at_count?: number | null;
  pack_quantity_override?: number | null;
  count_units_per_case?: number | null;
  pack_quantity?: number | null;
}

export function getEffectivePackQty(item: PackQtySource): number {
  const raw =
    item.pack_quantity_at_count ??
    item.pack_quantity_override ??
    item.count_units_per_case ??
    item.pack_quantity ??
    1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
