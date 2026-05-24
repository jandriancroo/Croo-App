/**
 * Single source of truth for resolving "which pack qty wins" across the app.
 *
 * Priority (snapshot-first, fail-closed):
 *   1. pack_quantity_at_count  — frozen snapshot from save time (post-Apr-28 lock)
 *   2. lens.count_units_per_case  — approved brand_pack_configs entry (must also have cost > 0)
 *   3. pack_quantity_override  — location-level override
 *   4. count_units_per_case    — legacy count config
 *   5. pack_quantity           — vendor sync
 *   6. 1                       — final fallback
 *
 * If pack_quantity_at_count is present, it ALWAYS wins — even if a caller
 * elsewhere has opted into live data. Submitted counts are frozen forever.
 *
 * The `lens` slot is the brand-approved pack config (see brand_pack_configs).
 * It is consulted ONLY when present AND fully valid: both count_units_per_case
 * and cost_per_common_unit must be > 0. Null/zero cost fails closed back to
 * local — never silently values an "owned" item at $0.
 *
 * Callers that intentionally want to ignore the snapshot (e.g. an in-progress
 * count being recomputed) should pass an object WITHOUT pack_quantity_at_count.
 * Callers that don't attach `lens` get byte-for-byte today's behavior.
 */
export interface PackConfigLens {
  count_units_per_case: number | null;
  cost_per_common_unit: number | null;
  common_unit?: string | null;
}

export interface PackQtySource {
  pack_quantity_at_count?: number | null;
  pack_quantity_override?: number | null;
  count_units_per_case?: number | null;
  pack_quantity?: number | null;
  lens?: PackConfigLens | null;
}

export function isLensValid(lens: PackConfigLens | null | undefined): boolean {
  if (!lens) return false;
  const units = Number(lens.count_units_per_case);
  const cost = Number(lens.cost_per_common_unit);
  return Number.isFinite(units) && units > 0 && Number.isFinite(cost) && cost > 0;
}

export function getEffectivePackQty(item: PackQtySource): number {
  // Snapshot wins absolutely.
  if (item.pack_quantity_at_count != null) {
    const n = Number(item.pack_quantity_at_count);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // Lens wins over local only when valid (cost > 0). Null/zero cost fails closed.
  if (isLensValid(item.lens)) {
    const n = Number(item.lens!.count_units_per_case);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const raw =
    item.pack_quantity_override ??
    item.count_units_per_case ??
    item.pack_quantity ??
    1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
