type PackConfigDisplayShape = {
  outer_qty?: number | null;
  inner_qty?: number | null;
  common_unit?: string | null;
  count_units_per_case?: number | null;
};

const cleanNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");

export function formatPackConfigDisplayLabel(shape: PackConfigDisplayShape): string {
  const outerQty = cleanNumber(shape.outer_qty);
  const innerQty = cleanNumber(shape.inner_qty);
  const totalUnits = cleanNumber(shape.count_units_per_case);
  const unit = (shape.common_unit ?? "").trim().toLowerCase();
  const unitSuffix = unit ? ` ${unit}` : "";

  if (outerQty != null && outerQty > 1 && innerQty != null) {
    return `${formatNumber(outerQty)}/${formatNumber(innerQty)}${unitSuffix}`.trim();
  }

  if (innerQty != null) {
    return `${formatNumber(innerQty)}${unitSuffix}`.trim();
  }

  if (totalUnits != null) {
    return `${formatNumber(totalUnits)}${unitSuffix}`.trim();
  }

  return unit || "pack config";
}