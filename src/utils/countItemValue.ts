import { convertUnits, normalizeUnit } from "./unitConversion";
import { getEffectivePackQty, isLensValid, type PackConfigLens } from "./getEffectivePackQty";


/**
 * Single source of truth for valuing a count item in inventory reports.
 *
 * Math (when entered_cases or entered_units is present):
 *   caseValue   = entered_cases × cost_per_case
 *   nonCaseUnits = max(quantity − entered_cases × pack_qty, entered_units)
 *   unitValue   = nonCaseUnits × cost_per_case / pack_qty
 *   value       = caseValue + unitValue
 *
 * `quantity` is authoritative for total units because it includes pan-counted
 * inventory (Cambro pans) folded in at save time. entered_units alone misses
 * pan units and silently under-counts pan items. The max() guard preserves the
 * legacy entered_units behaviour for rows where quantity is 0/missing.
 *
 * Pack qty resolution priority (authoritative sources only — no derivation from quantity):
 *   1. pack_quantity_at_count (snapshot from save time, post-Apr-28; skipped when forceLiveData)
 *   2. pack_quantity_override (location-level)
 *   3. pack_quantity (vendor sync)
 *   4. Pipeline 1 (item_conversions.outer_qty × canonical_qty_per_inner) — last resort only
 *   5. 1 (final fallback)
 *
 * Note: Pipeline 1 conversions are for cost-per-oz math, not for reconstructing
 * how many units the operator counted per case. They must never override an
 * explicit pack_quantity, even when pack_quantity = 1.
 *
 * pack_quantity = 1 from vendor sync is treated as unreliable — formula falls
 * through to Pipeline 1 only for ea-based conversions (canonical_unit = 'ea').
 * Weight/volume conversions (oz, lb) are never used for pack reconstruction.
 *
 * Phase 3 (Apr 30 2026): pack_quantity_at_count backfilled for all historical
 * completed counts at Palm Springs and Hemet. Future counts snapshot at save time.
 * Historical displays are now immutable to item data changes.
 *
 * IMPORTANT: This file is mirrored in supabase/functions/ai-assistant/index.ts.
 * If you change the formula here, update the mirror as well.
 */

export interface CountItemForValue {
  quantity: number | null;
  entered_cases: number | null;
  entered_units: number | null;
  entered_inner_packs?: number | null;
  cost_at_count: number | null;
  pack_quantity_at_count: number | null;
  inner_pack_quantity_at_count?: number | null;
}

export interface ItemForValue {
  brand_item_id?: string | null;
  cost_per_unit?: number | null;
  pack_quantity?: number | null;
  pack_quantity_override?: number | null;
  inner_pack_quantity?: number | null;
  is_recipe?: boolean | null;
  unit?: string | null;
  recipe_yield_qty?: number | null;
  recipe_yield_unit?: string | null;
  /**
   * Optional brand-approved pack config. When present AND valid
   * (count_units_per_case > 0 AND cost_per_common_unit > 0), the lens
   * OWNS valuation for this item: cost-per-case = cost_per_common_unit ×
   * count_units_per_case, pack qty = count_units_per_case, and local
   * cost_per_unit / pack_quantity are ignored.
   *
   * Null/zero cost on the lens fails CLOSED — falls back to local behavior
   * and logs a one-line warning so the gap is visible.
   *
   * Snapshots still win absolutely on already-saved counts.
   */
  lens?: PackConfigLens | null;
}

export interface ConversionForValue {
  outer_qty: number;
  canonical_qty_per_inner: number | null;
  canonical_unit?: string | null;
}

/**
 * Per-leg input for multi-config (Path B) valuation. One leg = one selected
 * brand_pack_config on a multi-selection item. Each leg carries its own raw
 * operator input + its own pack/inner snapshots. Per spec §3.3 cost is shared
 * across legs (sourced from parent), so leg.cost_at_count is optional and
 * falls back to ci.cost_at_count.
 */
export interface LegForValue {
  entered_cases: number | null;
  entered_units: number | null;
  entered_inner_packs?: number | null;
  quantity_common: number | null;
  pack_quantity_at_count: number | null;
  inner_pack_quantity_at_count?: number | null;
  cost_at_count?: number | null;
}

export function calculateCountItemValue(
  ci: CountItemForValue,
  item: ItemForValue | undefined,
  conversion: ConversionForValue | null | undefined,
  forceLiveData: boolean, // REQUIRED — no default. Pass false to honor snapshots; true only for in-progress counts being recomputed live.
  legs?: LegForValue[] | null
): number {
  // ── Multi-config (Path B) leg-aware branch ──
  // When legs[] is provided AND non-empty AND item is not a recipe, value =
  // Σ per-leg valuation. Each leg is fed back through this same function as a
  // synthetic single-row CountItemForValue carrying that leg's own snapshots,
  // with lens/conversion forced null per spec §3.2 (per-leg pack qty comes
  // from the leg's own snapshot ladder, never from a lens or Pipeline 1).
  // Cost per spec §3.3: leg.cost_at_count ?? ci.cost_at_count (shared across legs).
  // Recipes never multi-config — guarded out so recipe yield math owns valuation.
  if (legs && legs.length > 0 && !item?.is_recipe) {
    const legItem: ItemForValue = { ...(item || {}), lens: null };
    let total = 0;
    for (const leg of legs) {
      const legCi: CountItemForValue = {
        quantity: leg.quantity_common,
        entered_cases: leg.entered_cases,
        entered_units: leg.entered_units,
        entered_inner_packs: leg.entered_inner_packs ?? null,
        cost_at_count: leg.cost_at_count ?? ci.cost_at_count,
        pack_quantity_at_count: leg.pack_quantity_at_count,
        inner_pack_quantity_at_count: leg.inner_pack_quantity_at_count ?? null,
      };
      total += calculateCountItemValue(legCi, legItem, null, forceLiveData);
    }
    return total;
  }

  // ── Snapshot-wins guard ──
  // If a snapshot exists on the row, it ALWAYS wins for both cost and pack qty,
  // regardless of forceLiveData or lens. Submitted counts are frozen forever.
  const hasSnapshot = ci.pack_quantity_at_count != null || ci.cost_at_count != null;
  const useLive = forceLiveData && !hasSnapshot;

  // ── Lens (brand_pack_configs approved) ──
  // Owns valuation when present + valid + no snapshot + not a recipe.
  // Fails CLOSED to local when invalid (null/zero cost) so an "owned" item is
  // never silently $0. Recipes have their own yield-based math path.
  const lensProvided = item?.lens != null;
  const useLens = !hasSnapshot && !item?.is_recipe && isLensValid(item?.lens);
  if (lensProvided && !useLens && !hasSnapshot && !item?.is_recipe) {
    // eslint-disable-next-line no-console
    console.warn('[calculateCountItemValue] lens present but invalid (null/zero cost) — falling back to local', {
      brand_item_id: item?.brand_item_id,
      lens: item?.lens,
    });
  }

  const costPerCase = useLens
    ? Number(item!.lens!.cost_per_common_unit) * Number(item!.lens!.count_units_per_case)
    : useLive
      ? Number(item?.cost_per_unit) || 0
      : (ci.cost_at_count != null
          ? Number(ci.cost_at_count) || 0
          : Number(item?.cost_per_unit) || 0);

  if (costPerCase === 0) return 0;

  // Recipe items: cost_per_unit is the cost to make ONE BATCH that produces
  // recipe_yield_qty of recipe_yield_unit. Convert counted qty to yield unit
  // via the oz bridge when count unit differs from yield unit.
  if (item?.is_recipe) {
    const qty = ci.quantity != null
      ? Number(ci.quantity) || 0
      : (Number(ci.entered_cases || 0) + Number(ci.entered_units || 0) + Number(ci.entered_inner_packs || 0));
    const yieldQty = Number(item?.recipe_yield_qty) || 0;
    if (yieldQty > 0) {
      const yieldUnit = item?.recipe_yield_unit || null;
      const countUnit = item?.unit || null;
      let qtyInYield: number | null = qty;
      if (countUnit && yieldUnit && normalizeUnit(countUnit) !== normalizeUnit(yieldUnit)) {
        qtyInYield = convertUnits(qty, countUnit, yieldUnit);
      }
      if (qtyInYield != null && Number.isFinite(qtyInYield)) {
        return qtyInYield * (costPerCase / yieldQty);
      }
    }
    return qty * costPerCase;
  }

  const enteredCasesNum = Number(ci.entered_cases || 0);
  const enteredUnitsNum = Number(ci.entered_units || 0);
  const enteredInnerPacksNum = Number(ci.entered_inner_packs || 0);
  const quantityNum = Number(ci.quantity || 0);

  const pipeline1PackQty = conversion
    ? Number(conversion.outer_qty) * Number(conversion.canonical_qty_per_inner ?? 1)
    : null;

  // Pack qty resolution via shared helper (snapshot-first, then lens, then local).
  // When useLive=true and no snapshot exists, strip the snapshot field so the
  // helper falls through to lens → live override → pack_quantity → Pipeline 1.
  const lensForPackHelper = useLens ? item?.lens : null;
  const packSource = useLive
    ? { lens: lensForPackHelper, pack_quantity_override: item?.pack_quantity_override, pack_quantity: item?.pack_quantity }
    : { pack_quantity_at_count: ci.pack_quantity_at_count, lens: lensForPackHelper, pack_quantity_override: item?.pack_quantity_override, pack_quantity: item?.pack_quantity };
  let safePackQty = getEffectivePackQty(packSource);
  // Pipeline 1 fallback applies only when nothing else resolved (helper returned 1 with no inputs).
  // Skip entirely when lens owns the valuation — lens count_units_per_case is authoritative.
  if (!useLens && safePackQty === 1 && pipeline1PackQty != null && Number.isFinite(pipeline1PackQty) && pipeline1PackQty > 0
      && !ci.pack_quantity_at_count && !item?.pack_quantity_override && !item?.pack_quantity) {
    safePackQty = Number(pipeline1PackQty);
  }

  const innerPackQtyRaw = useLive
    ? (item?.inner_pack_quantity ?? null)
    : (ci.inner_pack_quantity_at_count ?? item?.inner_pack_quantity ?? null);
  const innerPackQty = Number(innerPackQtyRaw);
  const safeInnerPackQty = Number.isFinite(innerPackQty) && innerPackQty > 0 ? innerPackQty : 0;
  // Lens-aware: when an approved brand_pack_config drives valuation, its
  // count_units_per_case ALREADY encodes total units per case (outer × inner
  // collapsed). Multiplying by inner_pack_quantity again here would 50x the
  // case-units denominator and silently inflate stored quantities through
  // every downstream view. Suppress the inner tier on the lens path.
  const effectiveInnerPackQty = useLens ? 0 : safeInnerPackQty;
  const caseUnits = effectiveInnerPackQty > 0 ? safePackQty * effectiveInnerPackQty : safePackQty;

  const hasEntered = ci.entered_cases != null || ci.entered_units != null || ci.entered_inner_packs != null;

  let value: number;
  if (hasEntered) {
    // Pan-inclusive formula: `quantity` is the source of truth for total units
    // (cases × pack + loose units + pan units). entered_units alone misses pans.
    // When quantity is present, derive non-case units from it so pans are valued.
    // Fall back to entered_units when quantity is missing/inconsistent.
    const caseValue = enteredCasesNum * costPerCase;
    const derivedNonCaseUnits = quantityNum - (enteredCasesNum * caseUnits);
    const fallbackNonCaseUnits = enteredUnitsNum + (enteredInnerPacksNum * safeInnerPackQty);
    const nonCaseUnits = quantityNum > 0 && derivedNonCaseUnits >= fallbackNonCaseUnits
      ? derivedNonCaseUnits
      : fallbackNonCaseUnits;
    const unitValue = (nonCaseUnits * costPerCase) / caseUnits;
    value = caseValue + unitValue;
  } else {
    value = quantityNum * (costPerCase / caseUnits);
  }

  if (!Number.isFinite(value) || value < 0) {
    // eslint-disable-next-line no-console
    console.warn('[calculateCountItemValue] Invalid result, returning 0', { ci, item, conversion, value });
    return 0;
  }

  return value;
}
