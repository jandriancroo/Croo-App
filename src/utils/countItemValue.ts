/**
 * Single source of truth for valuing a count item in inventory reports.
 *
 * Math:
 *   value = (entered_cases × cost_per_case) + (entered_units × cost_per_case / pack_qty)
 *
 * Pack qty resolution priority:
 *   1. pack_quantity_at_count (snapshot from save time, post-Apr-28)
 *   2. derived from entered_cases (when quantity stored as multiplied total)
 *   3. pack_quantity_override (location-level)
 *   4. pack_quantity (vendor sync)
 *   5. Pipeline 1 (item_conversions.outer_qty × canonical_qty_per_inner)
 *   6. 1 (final fallback)
 *
 * IMPORTANT: This file is mirrored in supabase/functions/ai-assistant/index.ts.
 * If you change the formula here, update the mirror as well. See countItemValue.test.ts
 * for the canonical test cases that must continue to pass.
 */

export interface CountItemForValue {
  quantity: number | null;
  entered_cases: number | null;
  entered_units: number | null;
  cost_at_count: number | null;
  pack_quantity_at_count: number | null;
}

export interface ItemForValue {
  brand_item_id?: string | null;
  cost_per_unit?: number | null;
  pack_quantity?: number | null;
  pack_quantity_override?: number | null;
}

export interface ConversionForValue {
  outer_qty: number;
  canonical_qty_per_inner: number | null;
}

export function calculateCountItemValue(
  ci: CountItemForValue,
  item: ItemForValue | undefined,
  conversion: ConversionForValue | null | undefined,
  forceLiveData: boolean = false
): number {
  // Phase 1 — forceLiveData ignores snapshots and uses live cost / live pack chain.
  // Default behaviour (false) preserves the post-Apr-28 snapshot-first lock.
  const costPerCase = forceLiveData
    ? Number(item?.cost_per_unit) || 0
    : (ci.cost_at_count != null
        ? Number(ci.cost_at_count) || 0
        : Number(item?.cost_per_unit) || 0);

  if (costPerCase === 0) return 0;

  const enteredCasesNum = Number(ci.entered_cases || 0);
  const enteredUnitsNum = Number(ci.entered_units || 0);
  const quantityNum = Number(ci.quantity || 0);

  const derivedPackQty = enteredCasesNum > 0
    ? (quantityNum - enteredUnitsNum) / enteredCasesNum
    : null;

  const pipeline1PackQty = conversion
    ? Number(conversion.outer_qty) * Number(conversion.canonical_qty_per_inner ?? 1)
    : null;

  const packQtyRaw = forceLiveData
    ? (derivedPackQty
        ?? item?.pack_quantity_override
        ?? item?.pack_quantity
        ?? pipeline1PackQty
        ?? 1)
    : (ci.pack_quantity_at_count
        ?? derivedPackQty
        ?? item?.pack_quantity_override
        ?? item?.pack_quantity
        ?? pipeline1PackQty
        ?? 1);

  const packQty = Number(packQtyRaw);
  const safePackQty = Number.isFinite(packQty) && packQty > 0 ? packQty : 1;

  const hasEntered = ci.entered_cases != null || ci.entered_units != null;

  let value: number;
  if (hasEntered) {
    const caseValue = enteredCasesNum * costPerCase;
    const unitValue = (enteredUnitsNum * costPerCase) / safePackQty;
    value = caseValue + unitValue;
  } else {
    value = quantityNum * (costPerCase / safePackQty);
  }

  if (!Number.isFinite(value) || value < 0) {
    // eslint-disable-next-line no-console
    console.warn('[calculateCountItemValue] Invalid result, returning 0', { ci, item, conversion, value });
    return 0;
  }

  return value;
}
