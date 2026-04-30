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
 *   2. pack_quantity_override (location-level) — only if > 1
 *   3. pack_quantity (vendor sync) — only if > 1
 *   4. Pipeline 1 (item_conversions.outer_qty × canonical_qty_per_inner)
 *   5. 1 (final fallback)
 *
 * pack_quantity = 1 is treated as a sentinel for "vendor sync didn't give us a real pack".
 *
 * IMPORTANT: This file is mirrored in supabase/functions/ai-assistant/index.ts.
 * If you change the formula here, update the mirror as well.
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

  const pipeline1PackQty = conversion
    ? Number(conversion.outer_qty) * Number(conversion.canonical_qty_per_inner ?? 1)
    : null;

  // Treat pack_quantity = 1 as a sentinel for "vendor sync didn't give us a real pack"
  // and fall through to Pipeline 1 (item_conversions), which is authoritative.
  // A genuine pack of 1 will still resolve to 1 via the final fallback.
  const liveLegacyPackQty = (() => {
    if (item?.pack_quantity_override != null && Number(item.pack_quantity_override) > 1) {
      return Number(item.pack_quantity_override);
    }
    if (item?.pack_quantity != null && Number(item.pack_quantity) > 1) {
      return Number(item.pack_quantity);
    }
    return null;
  })();

  const packQtyRaw = forceLiveData
    ? (liveLegacyPackQty ?? pipeline1PackQty ?? 1)
    : (ci.pack_quantity_at_count ?? liveLegacyPackQty ?? pipeline1PackQty ?? 1);

  const packQty = Number(packQtyRaw);
  const safePackQty = Number.isFinite(packQty) && packQty > 0 ? packQty : 1;

  const hasEntered = ci.entered_cases != null || ci.entered_units != null;

  let value: number;
  if (hasEntered) {
    // Pan-inclusive formula: `quantity` is the source of truth for total units
    // (cases × pack + loose units + pan units). entered_units alone misses pans.
    // When quantity is present, derive non-case units from it so pans are valued.
    // Fall back to entered_units when quantity is missing/inconsistent.
    const caseValue = enteredCasesNum * costPerCase;
    const derivedNonCaseUnits = quantityNum - (enteredCasesNum * safePackQty);
    const nonCaseUnits = quantityNum > 0 && derivedNonCaseUnits >= enteredUnitsNum
      ? derivedNonCaseUnits
      : enteredUnitsNum;
    const unitValue = (nonCaseUnits * costPerCase) / safePackQty;
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
