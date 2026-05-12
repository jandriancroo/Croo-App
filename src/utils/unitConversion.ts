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
  cn: 1, // can — treated as each (1 can = 1 each); embedded-size variants like "can(8.4oz-fl)" handled by expandEmbeddedUnit
};

/** Industry-standard #N can sizes in fluid ounces */
const HASH_CAN_OZ: Record<string, number> = {
  "1": 11, "2": 20, "2.5": 29, "3": 33, "5": 56, "10": 104,
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
  "each": "ea", "count": "ea", "ct": "ea",
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
  // Skip case/pack swallowing when the string carries an embedded size like "pack(9.6lb)" — expandEmbeddedUnit handles those.
  if ((cleaned.startsWith("case") || cleaned.startsWith("pack")) && !cleaned.includes("(")) return "cs";
  if (cleaned.includes("gallon")) return "gal";
  if (cleaned.includes("liter") || cleaned.includes("litre")) return "l";
  if (cleaned.includes("oz") && !cleaned.includes("(")) return "oz";
  if (cleaned.includes("gram")) return "g";
  if ((cleaned.includes("lb") || cleaned.includes("pound")) && !cleaned.includes("(")) return "lb";
  if (cleaned.includes("tablespoon")) return "tbsp";
  if (cleaned.includes("teaspoon")) return "tsp";

  return cleaned;
}

/**
 * Expand an embedded-size unit string into a base quantity + canonical unit.
 *
 * Handles strings like:
 *   "bottle(20oz-fl)" + qty=3 → { qty: 60, unit: "oz" }
 *   "pack(9.6lb)" + qty=2     → { qty: 19.2, unit: "lb" }
 *   "#10can" + qty=1          → { qty: 104, unit: "oz" }
 *
 * For plain units (no embedded size) returns { qty, unit: normalizeUnit(rawUnit) }.
 *
 * Used by costing engines so a recipe ingredient like "3 bottle(20oz-fl)" of olive oil
 * is priced as 60 oz of olive oil, not as 3 unrecognized strings.
 */
export function expandEmbeddedUnit(qty: number, rawUnit: string | null | undefined): { qty: number; unit: string } {
  if (!rawUnit) return { qty, unit: "" };
  const cleaned = rawUnit.trim().toLowerCase().replace(/\s+/g, "");

  // #10can, #5can, #2.5can, etc. — industry-standard can sizes
  const hashMatch = cleaned.match(/^#(\d+(?:\.\d+)?)can$/);
  if (hashMatch) {
    const oz = HASH_CAN_OZ[hashMatch[1]];
    if (oz) return { qty: qty * oz, unit: "oz" };
  }

  // bottle(20oz-fl), pack(9.6lb), can(8.4oz-fl), pack(158oz-wt), bottle(330ml), etc.
  const m = cleaned.match(/\(([\d.]+)([a-z-]+)\)/);
  if (m) {
    const amount = parseFloat(m[1]);
    const innerUnit = normalizeUnit(m[2]);
    if (Number.isFinite(amount) && innerUnit && TO_OZ[innerUnit] !== undefined) {
      return { qty: qty * amount, unit: innerUnit };
    }
  }

  return { qty, unit: normalizeUnit(rawUnit) };
}

/**
 * Convert a quantity from one unit to another via the oz bridge.
 * Returns null if either unit is unknown. Embedded-size units are expanded first.
 */
export function convertUnits(qty: number, fromUnit: string, toUnit: string): number | null {
  const fromExp = expandEmbeddedUnit(qty, fromUnit);
  const toExp = expandEmbeddedUnit(1, toUnit); // expand "to" for normalization only; multiplier baked into divisor
  const from = fromExp.unit;
  const to = toExp.unit;
  if (from === to) return fromExp.qty / toExp.qty;
  const fromFactor = TO_OZ[from];
  const toFactor = TO_OZ[to];
  if (fromFactor == null || toFactor == null) return null;
  return (fromExp.qty * fromFactor) / (toExp.qty * toFactor);
}
