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
}

export interface ConversionForValue {
  outer_qty: number;
  canonical_qty_per_inner: number | null;
  canonical_unit?: string | null;
}

export function calculateCountItemValue(
  ci: CountItemForValue,
  item: ItemForValue | undefined,
  conversion: ConversionForValue | null | undefined,
  forceLiveData: boolean // REQUIRED — no default. Pass false to honor snapshots; true only for in-progress counts being recomputed live.
): number {
  // ── Snapshot-wins guard ──
  // If a snapshot exists on the row, it ALWAYS wins for both cost and pack qty,
  // regardless of forceLiveData. Submitted counts are frozen forever.
  const hasSnapshot = ci.pack_quantity_at_count != null || ci.cost_at_count != null;
  const useLive = forceLiveData && !hasSnapshot;

  const costPerCase = useLive
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

  // Pack qty resolution via shared helper (snapshot-first by priority).
  // When useLive=true and no snapshot exists, strip the snapshot field so the
  // helper falls through to live override → pack_quantity → Pipeline 1 fallback.
  const packSource = useLive
    ? { pack_quantity_override: item?.pack_quantity_override, pack_quantity: item?.pack_quantity }
    : { pack_quantity_at_count: ci.pack_quantity_at_count, pack_quantity_override: item?.pack_quantity_override, pack_quantity: item?.pack_quantity };
  let safePackQty = getEffectivePackQty(packSource);
  // Pipeline 1 fallback applies only when nothing else resolved (helper returned 1 with no inputs).
  if (safePackQty === 1 && pipeline1PackQty != null && Number.isFinite(pipeline1PackQty) && pipeline1PackQty > 0
      && !ci.pack_quantity_at_count && !item?.pack_quantity_override && !item?.pack_quantity) {
    safePackQty = Number(pipeline1PackQty);
  }

  const innerPackQtyRaw = useLive
    ? (item?.inner_pack_quantity ?? null)
    : (ci.inner_pack_quantity_at_count ?? item?.inner_pack_quantity ?? null);
  const innerPackQty = Number(innerPackQtyRaw);
  const safeInnerPackQty = Number.isFinite(innerPackQty) && innerPackQty > 0 ? innerPackQty : 0;
  const caseUnits = safeInnerPackQty > 0 ? safePackQty * safeInnerPackQty : safePackQty;

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
