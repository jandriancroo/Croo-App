/**
 * unitConversion.ts — Single source of truth for unit normalization and conversion.
 *
 * ALL costing engines (blueprintCostCalculation, recipeCostCalculation,
 * varianceReport) and UI components (RecipeRow) MUST import from here.
 * Do NOT duplicate TO_OZ or UNIT_ALIASES anywhere else.
 */

/** Conversion factors: 1 unit = X fluid ounces (weight-oz for solids) */
export const TO_OZ: Record<string, number> = {
  // ─── Imperial weight ───
  oz: 1,
  lb: 16,

  // ─── Imperial volume ───
  tsp: 0.1667,
  tbsp: 0.5,
  cup: 8,
  cups: 8,
  pt: 16,
  qt: 32,
  gal: 128,

  // ─── Metric weight ───
  g: 0.03527,
  kg: 35.274,

  // ─── Metric volume ───
  ml: 0.033814,
  cl: 0.33814,
  l: 33.814,

  // ─── Passthrough ───
  ea: 1,
};

/** Maps messy vendor / user strings → canonical keys in TO_OZ */
export const UNIT_ALIASES: Record<string, string> = {
  // oz variants
  "oz-wt": "oz", "oz-fl": "oz", "fl-oz": "oz", "floz": "oz",

  // weight
  "gram": "g", "grams": "g",
  "kilogram": "kg", "kilograms": "kg", "kgs": "kg",
  "lbs": "lb", "pound": "lb", "pounds": "lb",

  // volume — small
  "teaspoon": "tsp", "teaspoons": "tsp", "t": "tsp",
  "tablespoon": "tbsp", "tablespoons": "tbsp",

  // volume — medium
  "cup": "cups",
  "pint": "pt", "pints": "pt",
  "quart": "qt", "quarts": "qt",
  "gallon": "gal", "gallons": "gal",

  // metric volume
  "liter": "l", "liters": "l", "litre": "l", "litres": "l",
  "centiliter": "cl", "centiliters": "cl",
  "milliliter": "ml", "milliliters": "ml",

  // countable
  "each": "ea", "count": "ea",
  "case": "cs", "cases": "cs",
  "can": "cn", "cans": "cn",
};

/**
 * Normalize a raw unit string to a canonical key usable in TO_OZ lookups.
 *
 * Handles whitespace, underscores, plural forms, and substring fallbacks
 * so all engines behave identically.
 */
export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const cleaned = unit.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");

  // Exact alias match first
  if (UNIT_ALIASES[cleaned]) return UNIT_ALIASES[cleaned];

  // Direct TO_OZ key match (e.g. "oz", "lb", "tsp")
  if (TO_OZ[cleaned] !== undefined) return cleaned;

  // Prefix / substring fallbacks for messy vendor data
  if (cleaned.startsWith("case") || cleaned.startsWith("pack")) return "cs";
  if (cleaned.includes("gallon")) return "gal";
  if (cleaned.includes("liter") || cleaned.includes("litre")) return "l";
  if (cleaned.includes("oz")) return "oz";
  if (cleaned.includes("gram")) return "g";
  if (cleaned.includes("lb") || cleaned.includes("pound")) return "lb";
  if (cleaned.includes("tablespoon")) return "tbsp";
  if (cleaned.includes("teaspoon")) return "tsp";

  return cleaned;
}

/**
 * Convert a quantity from one unit to another via the oz bridge.
 * Returns null if either unit is unknown.
 */
export function convertUnits(qty: number, fromUnit: string, toUnit: string): number | null {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return qty;
  const fromFactor = TO_OZ[from];
  const toFactor = TO_OZ[to];
  if (fromFactor == null || toFactor == null) return null;
  return (qty * fromFactor) / toFactor;
}
