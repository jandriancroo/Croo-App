/**
 * Shared valuation for inventory transfer lines.
 *
 * inventory_transfer_items.cost_per_unit stores the item's CASE cost.
 * - unit_type "case": quantity × case_cost
 * - unit_type "unit" (each / bottle / bag / inner pack): quantity × case_cost / pack
 *
 * pack = inventory_items.pack_quantity (units per case), same divisor the
 * TransferDialog uses (costPerCase / packQty = costPerEach).
 */
export interface TransferLineLike {
  quantity: number | string | null | undefined;
  unit_type?: string | null;
  cost_per_unit: number | string | null | undefined;
  pack_quantity?: number | string | null;
}

export function transferPackDivisor(packQuantity: number | string | null | undefined): number {
  const n = Number(packQuantity);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function transferLineValue(line: TransferLineLike): number {
  const qty = Number(line.quantity) || 0;
  const caseCost = Number(line.cost_per_unit) || 0;
  if (line.unit_type === "case") return qty * caseCost;
  return (qty * caseCost) / transferPackDivisor(line.pack_quantity);
}

export function transferLinesTotal(lines: TransferLineLike[] | null | undefined): number {
  return (lines || []).reduce((sum, line) => sum + transferLineValue(line), 0);
}
