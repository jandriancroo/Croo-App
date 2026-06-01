/**
 * Unified pack-shape resolver.
 *
 * Single source of truth for resolving an item's effective pack structure for
 * the count screen and everything downstream of it (lane visibility, header
 * subtitle badges, valuation math, save-time snapshots).
 *
 * Strict precedence: **snapshot > lens > local**.
 *
 * - "snapshot" = `pack_quantity_at_count` / `inner_pack_quantity_at_count` —
 *   frozen at save time. Once a snapshot is present, it ALWAYS wins. This is
 *   what keeps submitted/locked counts immutable.
 * - "lens"     = an approved `brand_pack_configs` row for this brand_item_id.
 *   When `isLensValid(lens)` is true, lens fields win over any local field —
 *   including non-null but stale local values. (The previous resolver used
 *   `??` which only fell back when local was nullish; this is what allowed a
 *   stale local `inner_pack_label` or `pack_quantity` to silently beat the
 *   approved config.)
 * - "local"    = `inventory_items` columns (the legacy default).
 *
 * Callers should resolve the shape **once** (per item) at the data-shaping
 * boundary and pass the resolved object to all downstream consumers, so the
 * three-lane grid, the header badge, the valuation math, and the save
 * snapshot all read identical numbers.
 */

import { isLensValid, type PackConfigLens as ValuationLens } from "./getEffectivePackQty";

export interface PackShapeItemInput {
  // Frozen snapshot — wins if present
  pack_quantity_at_count?: number | null;
  inner_pack_quantity_at_count?: number | null;
  // Local fields (legacy default)
  pack_quantity?: number | null;
  pack_quantity_override?: number | null;
  /** Raw uncollapsed pack qty (pre-shortcut-collapse). */
  _rawPackQuantity?: number | null;
  _rawPackQuantityOverride?: number | null;
  inner_pack_quantity?: number | null;
  inner_pack_label?: string | null;
  unit?: string | null;
  cost_per_unit?: number | null;
}

export interface PackShapeLens extends ValuationLens {
  outer_type?: string | null;
  inner_qty?: number | null;
  inner_type?: string | null;
}

export interface ResolvedPackShape {
  /** Outer packs per case (the multiplier behind the Cases lane). */
  packQty: number;
  /** Units per inner pack, or null when no inner tier exists. */
  innerPackQty: number | null;
  /** Singular noun for the inner lane (e.g. "sleeve"), or null. */
  innerLabel: string | null;
  /** Singular noun for the outer container (e.g. "bag", "case"), or null.
   *  Drives the Cases-lane label when set (e.g. "Bags" instead of "Cases"). */
  outerLabel: string | null;
  /** Atomic unit token (lb, oz, ea…). Lowercased. */
  unit: string;
  /** Vendor case cost. Local cost_per_unit is system-of-record for cost. */
  costPerCase: number | null;
  /** Provenance — useful for debugging/UX. */
  source: "snapshot" | "lens" | "local";
}

const finiteOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const localPackQty = (item: PackShapeItemInput): number => {
  const candidates = [
    item._rawPackQuantityOverride,
    item.pack_quantity_override,
    item._rawPackQuantity,
    item.pack_quantity,
  ];
  for (const c of candidates) {
    const n = finiteOrNull(c);
    if (n != null && n > 0) return n;
  }
  return 1;
};

const trimmedOrNull = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
};

export function resolveItemPackShape(
  item: PackShapeItemInput,
  lens: PackShapeLens | null | undefined,
): ResolvedPackShape {
  const costPerCase = finiteOrNull(item.cost_per_unit);

  // 1) Snapshot — strict null/undefined check so 0 doesn't masquerade as "no snapshot".
  const snapPack = finiteOrNull(item.pack_quantity_at_count);
  if (snapPack != null && snapPack > 0) {
    const snapInner = finiteOrNull(item.inner_pack_quantity_at_count);
    return {
      packQty: snapPack,
      innerPackQty: snapInner != null && snapInner > 0 ? snapInner : null,
      innerLabel: trimmedOrNull(item.inner_pack_label),
      outerLabel: null,
      unit: (trimmedOrNull(item.unit) ?? "ea").toLowerCase(),
      costPerCase,
      source: "snapshot",
    };
  }

  // 2) Lens — wins over local even if local is non-null but stale.
  //
  // Schema reminder (brand_pack_configs):
  //   outer_qty / outer_type  → number + noun of middle-tier containers per case
  //                              (e.g. 6 sleeves, 4 bags). NULL/1 means the case
  //                              IS the container (no middle tier).
  //   inner_qty / inner_type  → atomic units per middle container + the count
  //                              unit (e.g. 50 ea, 5 lb). inner_type is the
  //                              measurement unit, NOT a packaging noun.
  //   count_units_per_case    → outer_qty × inner_qty (units per case total).
  //
  // Lane mapping:
  //   outer_qty > 1  → 3-tier: Cases · <outer_type>s · <common_unit>s
  //                    packQty=outer_qty, innerPackQty=inner_qty,
  //                    innerLabel=outer_type, outerLabel=null
  //   outer_qty ≤ 1  → 2-tier: <outer_type>s · <common_unit>s
  //                    packQty=inner_qty (or total), innerPackQty=null,
  //                    outerLabel=outer_type (renames Cases → "Bags" etc.)
  if (isLensValid(lens)) {
    const total = finiteOrNull(lens!.count_units_per_case) ?? 1;
    const lensInner = finiteOrNull(lens!.inner_qty);
    const lensOuter = finiteOrNull((lens as any).outer_qty);
    const outerType = trimmedOrNull((lens as any).outer_type);
    const hasMiddleTier =
      lensOuter != null && lensOuter > 1 && lensInner != null && lensInner > 0;
    let packQty: number;
    let innerPackQty: number | null;
    let innerLabel: string | null;
    let outerLabel: string | null;
    if (hasMiddleTier) {
      // True 3-tier: case → N containers → M units.
      packQty = lensOuter!;
      innerPackQty = lensInner!;
      innerLabel = outerType ?? trimmedOrNull(item.inner_pack_label);
      outerLabel = null;
    } else if (lensInner != null && lensInner > 0) {
      // Flat case = single container of M units. No middle lane.
      packQty = lensInner;
      innerPackQty = null;
      innerLabel = null;
      // Only rename Cases lane when the container isn't the generic "case".
      outerLabel = outerType && outerType.toLowerCase() !== "case" ? outerType : null;
    } else {
      // No usable inner info — fall back to total units per case.
      packQty = total;
      innerPackQty = null;
      innerLabel = null;
      outerLabel = outerType && outerType.toLowerCase() !== "case" ? outerType : null;
    }
    const unit =
      (trimmedOrNull(lens!.common_unit) ??
        trimmedOrNull(item.unit) ??
        "ea").toLowerCase();
    return { packQty, innerPackQty, innerLabel, outerLabel, unit, costPerCase, source: "lens" };
  }

  // 3) Local default.
  const localInner = finiteOrNull(item.inner_pack_quantity);
  return {
    packQty: localPackQty(item),
    innerPackQty: localInner != null && localInner > 0 ? localInner : null,
    innerLabel: trimmedOrNull(item.inner_pack_label),
    outerLabel: null,
    unit: (trimmedOrNull(item.unit) ?? "ea").toLowerCase(),
    costPerCase,
    source: "local",
  };
}

/**
 * Returns a lowercased atomic-unit token suitable for human-readable subtitles
 * (e.g. "lb", "oz") or null when the unit is a generic case/each token.
 */
export function atomicUnitToken(unit: string | null | undefined): string | null {
  const u = (unit ?? "").trim().toLowerCase();
  if (!u) return null;
  if (
    u === "ea" || u === "each" || u === "unit" || u === "units" ||
    u === "cs" || u === "case" || u === "cases" ||
    u === "ct" || u === "count"
  ) return null;
  return u;
}
