/**
 * LEGACY CONVERSION LOGIC — DO NOT EXTEND
 *
 * Contains scattered unit-conversion math that Pipeline 1
 * (item_conversions table) will replace.
 *
 * Scheduled for deletion: Step 6 of migration plan.
 * Do not add new functions here.
 * Do not import this file from any new Pipeline 1/2/3 code.
 */

// ============================================================
// Hardcoded multiplier helpers — wrapping inline * 16 / * 128 math
// (originally inlined in UnitMatrixView.tsx and UsageRateMapping.tsx)
// ============================================================

export const lbToOz = (lb: number): number => lb * 16;
export const ozToLb = (oz: number): number => oz / 16;
export const galToOz = (gal: number): number => gal * 128;

// ============================================================
// From src/utils/blueprintCostCalculation.ts
// ============================================================

// Standard can sizes in fluid oz (approximate industry standard)
const CAN_SIZE_OZ: Record<string, number> = {
  "10": 106, "5": 56, "3": 33, "2.5": 26.5, "2": 20, "1": 11, "300": 14, "303": 16,
};

/**
 * Parse pack_size string to derive total oz per case.
 * Handles patterns like:
 *   "6/#10"      → 6 cans × 106 oz = 636 oz
 *   "6/#10 CN"   → same
 *   "6/5 LB"     → 6 × 5 × 16 = 480 oz
 *   "8/4 LB"     → 8 × 4 × 16 = 512 oz
 *   "6/106 OZ"   → 6 × 106 = 636 oz
 *   "10#"        → 10 lb = 160 oz
 *   "4/2.5#"     → 4 × 2.5 lb = 160 oz
 * Returns total oz or null if unparseable.
 */
export function parsePackSizeToOz(packSize: string | null): number | null {
  if (!packSize) return null;
  const s = packSize.trim();

  // Pattern: "6/#10" or "6/#10 CN" — cans
  const canMatch = s.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]*)$/);
  if (canMatch) {
    const count = parseInt(canMatch[1]);
    const canSize = canMatch[2];
    const ozPerCan = CAN_SIZE_OZ[canSize];
    if (ozPerCan) return count * ozPerCan;
    return null;
  }

  // Pattern: "6/5 LB" or "8/2.2 LB"
  const lbMatch = s.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*LB$/i);
  if (lbMatch) {
    return parseInt(lbMatch[1]) * parseFloat(lbMatch[2]) * 16;
  }

  // Pattern: "6/106 OZ" or "4/32 OZ"
  const ozMatch = s.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*OZ$/i);
  if (ozMatch) {
    return parseInt(ozMatch[1]) * parseFloat(ozMatch[2]);
  }

  // Pattern: "10#" or "2.5#" — single weight in pounds
  const poundMatch = s.match(/^(\d+\.?\d*)\s*#$/);
  if (poundMatch) {
    return parseFloat(poundMatch[1]) * 16;
  }

  // Pattern: "4/2.5#" — count/weight in pounds
  const countPoundMatch = s.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*#$/);
  if (countPoundMatch) {
    return parseInt(countPoundMatch[1]) * parseFloat(countPoundMatch[2]) * 16;
  }

  return null;
}

// ============================================================
// From src/components/brand/BrandPanMatrixSheet.tsx
// ============================================================

/**
 * Parse pack_size strings like "2/5 LB", "6/1 LB", "4/1 GAL", "6/#10 CN"
 * → returns the inner unit code ("LB", "GAL", "CN", …) or "".
 * Falls back gracefully on weird formats.
 */
export const parsePackSizeInnerUnit = (packSize: string | null | undefined): string => {
  if (!packSize) return "";
  // grab the trailing alpha token
  const m = String(packSize).trim().match(/([A-Za-z]+)\s*$/);
  return m?.[1] ?? "";
};

export const parsePackSizeOuterCount = (packSize: string | null | undefined): number | null => {
  if (!packSize) return null;
  const m = String(packSize).trim().match(/^(\d+(?:\.\d+)?)\s*\//);
  return m ? Number(m[1]) : null;
};

// ============================================================
// From src/components/inventory/UnitMatrixView.tsx
// ============================================================

/** Parse pack_size string to extract weight in oz */
export function parsePackSizeOz(packSize: string | null, packQuantity: number | null): { ozPerUnit: number | null; ozPerCase: number | null } {
  if (!packSize) return { ozPerUnit: null, ozPerCase: null };

  const match = packSize.match(/(?:(\d+)\/)?([\d.]+)\s*(LB|OZ|GA|#|KG)/i);
  if (!match) return { ozPerUnit: null, ozPerCase: null };

  const countInPack = match[1] ? parseFloat(match[1]) : 1;
  const amount = parseFloat(match[2]);
  const unit = match[3].toUpperCase();

  let ozPerSubUnit = 0;
  switch (unit) {
    case "LB": case "#": ozPerSubUnit = lbToOz(amount); break;
    case "OZ": ozPerSubUnit = amount; break;
    case "GA": ozPerSubUnit = galToOz(amount); break;
    case "KG": ozPerSubUnit = amount * 35.274; break;
    default: return { ozPerUnit: null, ozPerCase: null };
  }

  const ozPerUnit = ozPerSubUnit;
  const effectivePackQty = packQuantity || countInPack;
  const ozPerCase = ozPerUnit * effectivePackQty;

  return { ozPerUnit, ozPerCase };
}

// ============================================================
// From src/components/inventory/RecipeBuilderDialog.tsx
// (renamed from parsePackSize to avoid collision)
// ============================================================

export const TO_OZ: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, tbsp: 0.5, tsp: 0.1667, ml: 0.033814, cups: 8, ea: 1, bags: 1, ct: 1, kg: 35.274, g: 0.03527,
};

const PACK_UNIT_MAP_RB: Record<string, string> = {
  OZ: "oz", LB: "lb", GA: "gal", GAL: "gal", ML: "ml", CT: "ct", EA: "ea", CN: "ea", KG: "kg", G: "g",
};

const CAN_SIZES_RB: Record<string, number> = { "10": 106, "5": 56, "2.5": 26 };

export const parsePackSizeRecipeBuilder = (packSize: string | null): { count: number; unit: string } | null => {
  if (!packSize) return null;
  const canMatch = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (canMatch) {
    const packs = parseInt(canMatch[1]);
    const canSize = canMatch[2];
    const rawUnit = canMatch[3].toUpperCase();
    const unit = PACK_UNIT_MAP_RB[rawUnit];
    if (!unit) return null;
    const ozPerCan = CAN_SIZES_RB[canSize];
    if (ozPerCan) return { count: packs * ozPerCan, unit: "oz" };
    return { count: packs, unit };
  }
  const poundSlash = packSize.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*#$/);
  if (poundSlash) return { count: parseInt(poundSlash[1]) * parseFloat(poundSlash[2]), unit: "lb" };
  const poundStandalone = packSize.match(/^(\d+\.?\d*)\s*#$/);
  if (poundStandalone) return { count: parseFloat(poundStandalone[1]), unit: "lb" };
  const match = packSize.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (!match) return null;
  const rawUnit = match[3].toUpperCase();
  const unit = PACK_UNIT_MAP_RB[rawUnit];
  if (!unit) return null;
  return { count: parseInt(match[1]) * parseFloat(match[2]), unit };
};

// ============================================================
// From src/components/inventory/UsageRateMapping.tsx
// (renamed from parsePackSize to avoid collision; TO_OZ_MAP kept distinct
// from TO_OZ above to preserve original shape)
// ============================================================

export const TO_OZ_MAP: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, ml: 0.033814, cups: 8, ea: 1, tbsp: 0.5, tsp: 0.1667,
};

interface UsageRateItemLike {
  id: string;
  name: string;
  unit: string;
  pack_size: string | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  count_unit: string | null;
  count_units_per_case: number | null;
  cost_per_unit: number | null;
  is_recipe: boolean | null;
  storage_location: { name: string } | null;
}

/** Parse pack_size like "2/5 LB", "6/5#", "25#" → { count, size, unit } */
export const parsePackSizeUsageRate = (packSize: string | null): { count: number; size: number; unit: string } | null => {
  if (!packSize) return null;
  // Handle # as LB: "6/5#" → count=6, size=5, unit=LB
  const poundSlash = packSize.match(/^(\d+)\/([\d.]+)\s*#$/);
  if (poundSlash) return { count: parseInt(poundSlash[1]), size: parseFloat(poundSlash[2]), unit: "LB" };
  // Standalone pound: "25#" → count=1, size=25, unit=LB
  const poundStandalone = packSize.match(/^([\d.]+)\s*#$/);
  if (poundStandalone) return { count: 1, size: parseFloat(poundStandalone[1]), unit: "LB" };
  // Standard: "2/5 LB", "1/5 GA"
  const match = packSize.match(/^(\d+)\/([\d.]+)\s*(.+)$/i);
  if (!match) return null;
  return { count: parseInt(match[1]), size: parseFloat(match[2]), unit: match[3].trim().toUpperCase() };
};

/** Get smart unit options based on pack_size unit type, with auto-calculated units per case */
export const getSmartUnitOptions = (item: UsageRateItemLike): { unit: string; unitsPerCase: number; label: string }[] => {
  // For recipe items, use the saved count_unit/count_units_per_case (set from yield)
  if (item.is_recipe && item.count_unit && item.count_units_per_case) {
    const yieldUnit = item.count_unit;
    const yieldQty = item.count_units_per_case;
    const options = [
      { unit: yieldUnit, unitsPerCase: yieldQty, label: `${yieldUnit} (${yieldQty}/batch)` },
    ];
    // Add oz conversion if yield isn't already oz
    if (yieldUnit !== "oz" && TO_OZ_MAP[yieldUnit]) {
      const totalOz = yieldQty * TO_OZ_MAP[yieldUnit];
      options.push({ unit: "oz", unitsPerCase: Math.round(totalOz * 100) / 100, label: `oz (${Math.round(totalOz)}/batch)` });
    }
    return options;
  }

  const parsed = parsePackSizeUsageRate(item.pack_size);
  if (!parsed) return [{ unit: "ea", unitsPerCase: item.pack_quantity || 1, label: `ea (${item.pack_quantity || 1}/cs)` }];

  const totalRaw = parsed.count * parsed.size;
  const options: { unit: string; unitsPerCase: number; label: string }[] = [];

  switch (parsed.unit) {
    case "LB":
      options.push({ unit: "oz", unitsPerCase: Math.round(lbToOz(totalRaw) * 100) / 100, label: `oz (${Math.round(lbToOz(totalRaw))}/cs)` });
      options.push({ unit: "lb", unitsPerCase: totalRaw, label: `lb (${totalRaw}/cs)` });
      break;
    case "OZ":
      options.push({ unit: "oz", unitsPerCase: Math.round(totalRaw * 100) / 100, label: `oz (${Math.round(totalRaw)}/cs)` });
      if (totalRaw >= 16) {
        options.push({ unit: "lb", unitsPerCase: Math.round(ozToLb(totalRaw) * 100) / 100, label: `lb (${Math.round(ozToLb(totalRaw) * 100) / 100}/cs)` });
      }
      break;
    case "GA":
      options.push({ unit: "oz", unitsPerCase: Math.round(galToOz(totalRaw)), label: `oz (${Math.round(galToOz(totalRaw))}/cs)` });
      options.push({ unit: "gal", unitsPerCase: totalRaw, label: `gal (${totalRaw}/cs)` });
      break;
    case "CT":
      options.push({ unit: "ea", unitsPerCase: totalRaw, label: `ea (${totalRaw}/cs)` });
      options.push({ unit: "cs", unitsPerCase: 1, label: `cs (1/cs)` });
      break;
    case "KG":
      options.push({ unit: "oz", unitsPerCase: Math.round(totalRaw * 35.274 * 100) / 100, label: `oz (${Math.round(totalRaw * 35.274)}/cs)` });
      options.push({ unit: "lb", unitsPerCase: Math.round(totalRaw * 2.205 * 100) / 100, label: `lb (${Math.round(totalRaw * 2.205 * 100) / 100}/cs)` });
      break;
    default:
      options.push({ unit: "ea", unitsPerCase: parsed.count * parsed.size, label: `ea (${parsed.count * parsed.size}/cs)` });
      break;
  }

  return options;
};
