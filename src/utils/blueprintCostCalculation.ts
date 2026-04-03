import { supabase } from "@/integrations/supabase/client";

const TO_OZ: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, tbsp: 0.5, tsp: 0.1667, ml: 0.033814, cups: 8, ea: 1, kg: 35.274, g: 0.03527,
};

const UNIT_ALIASES: Record<string, string> = {
  "oz-wt": "oz", "oz-fl": "oz", "fl-oz": "oz",
  "gram": "g", "grams": "g", "each": "ea", "count": "ea",
  "case": "cs", "cases": "cs", "can": "cn", "cans": "cn",
  "quart": "qt", "gallon": "gal", "gallons": "gal",
  "lbs": "lb", "pound": "lb", "pounds": "lb",
};

function normalizeIngUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const cleaned = unit.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
  if (UNIT_ALIASES[cleaned]) return UNIT_ALIASES[cleaned];
  if (cleaned.startsWith("case")) return "cs";
  if (cleaned.startsWith("pack")) return "cs";
  if (cleaned.includes("oz")) return "oz";
  if (cleaned.includes("gram")) return "g";
  if (cleaned.includes("gallon")) return "gal";
  if (cleaned.includes("lb") || cleaned.includes("pound")) return "lb";
  return cleaned;
}

interface BlueprintInfo {
  id: string;
  yield_qty: number | null;
  yield_unit: string | null;
  produces_item_id: string | null;
}

interface BlueprintIngredientRow {
  blueprint_id: string;
  ingredient_type: string;
  vendor_item_id: string | null;
  sub_blueprint_id: string | null;
  quantity: number;
  unit: string | null;
}

interface VendorItemInfo {
  id: string;
  cost_per_unit: number | null;
  blended_price: number | null;
  pack_size: string | null;
  count_unit: string | null;
  count_units_per_case: number | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
}

export interface BlueprintCostResult {
  batchCost: number;
  missingItems: string[];
  isPartial: boolean;
}

/**
 * Fetches all recipe blueprints and their ingredients for a location,
 * then calculates the batch cost for each blueprint by walking the tree
 * down to vendor items and using live pricing.
 *
 * Returns Map<blueprint_id, BlueprintCostResult>
 */
export async function fetchBlueprintCosts(
  locationId: string
): Promise<Map<string, BlueprintCostResult>> {
  // 1. Fetch all active blueprints
  const { data: blueprints, error: bpErr } = await supabase
    .from("recipe_blueprints" as any)
    .select("id, yield_qty, yield_unit, produces_item_id")
    .eq("location_id", locationId)
    .eq("is_active", true);

  if (bpErr) throw bpErr;
  if (!blueprints?.length) return new Map();

  const bpList = blueprints as unknown as BlueprintInfo[];
  const bpMap = new Map<string, BlueprintInfo>(bpList.map(b => [b.id, b]));
  const blueprintIds = bpList.map(b => b.id);

  // 2. Fetch all ingredients for these blueprints with true pagination.
  // Supabase API row caps (often 1000) still apply even when .limit() is higher,
  // so we page by range to guarantee we collect all rows.
  const ingList: BlueprintIngredientRow[] = [];
  const ID_BATCH_SIZE = 200;
  const PAGE_SIZE = 500;

  for (let i = 0; i < blueprintIds.length; i += ID_BATCH_SIZE) {
    const idBatch = blueprintIds.slice(i, i + ID_BATCH_SIZE);
    let offset = 0;

    while (true) {
      const { data: pageData, error: ingErr } = await supabase
        .from("recipe_blueprint_ingredients" as any)
        .select("id, blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit")
        .in("blueprint_id", idBatch)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (ingErr) throw ingErr;

      const rows = (pageData || []) as unknown as BlueprintIngredientRow[];
      ingList.push(...rows);

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // 3. Fetch vendor items for pricing
  const vendorItemIds = [
    ...new Set(ingList.filter(i => i.vendor_item_id).map(i => i.vendor_item_id!)),
  ];

  let vendorMap = new Map<string, VendorItemInfo>();
  if (vendorItemIds.length > 0) {
    const { data: vendorItems, error: vErr } = await supabase
      .from("inventory_items")
      .select("id, cost_per_unit, blended_price, pack_size, count_unit, count_units_per_case, pack_quantity, pack_quantity_override")
      .in("id", vendorItemIds);
    if (vErr) throw vErr;
    vendorMap = new Map((vendorItems || []).map(v => [v.id, v as VendorItemInfo]));
  }

  // 4. Group ingredients by blueprint
  const ingredientsByBp = new Map<string, BlueprintIngredientRow[]>();
  for (const ing of ingList) {
    const list = ingredientsByBp.get(ing.blueprint_id) || [];
    list.push(ing);
    ingredientsByBp.set(ing.blueprint_id, list);
  }

  // 5. Recursive cost calculation with cycle detection
  const costCache = new Map<string, BlueprintCostResult>();

  function calculateBatchCost(
    blueprintId: string,
    visited: Set<string> = new Set()
  ): BlueprintCostResult {
    if (costCache.has(blueprintId)) return costCache.get(blueprintId)!;
    if (visited.has(blueprintId))
      return { batchCost: 0, missingItems: [], isPartial: false };
    visited.add(blueprintId);

    const ingredients = ingredientsByBp.get(blueprintId) || [];
    if (ingredients.length === 0) {
      const result: BlueprintCostResult = { batchCost: 0, missingItems: [], isPartial: false };
      costCache.set(blueprintId, result);
      return result;
    }

    let totalBatchCost = 0;
    const missingItems: string[] = [];

    for (const ing of ingredients) {
      if (ing.ingredient_type === "blueprint" && ing.sub_blueprint_id) {
        // Sub-recipe: get batch cost, divide by yield, multiply by quantity
        const subBp = bpMap.get(ing.sub_blueprint_id);
        if (!subBp) {
          missingItems.push(ing.sub_blueprint_id);
          continue;
        }
        const subResult = calculateBatchCost(ing.sub_blueprint_id, new Set(visited));
        if (subResult.missingItems.length > 0) missingItems.push(...subResult.missingItems);
        const subYield = subBp.yield_qty || 1;
        const subYieldUnit = normalizeIngUnit(subBp.yield_unit);
        const ingUnit = normalizeIngUnit(ing.unit);
        const costPerYieldUnit = subResult.batchCost / subYield;

        // Convert ingredient quantity to yield units if they differ
        if (ingUnit && subYieldUnit && ingUnit !== subYieldUnit
            && ingUnit !== "ea" && subYieldUnit !== "ea"
            && TO_OZ[ingUnit] && TO_OZ[subYieldUnit]) {
          const ingInYieldUnits = (ing.quantity * TO_OZ[ingUnit]) / TO_OZ[subYieldUnit];
          totalBatchCost += costPerYieldUnit * ingInYieldUnits;
        } else {
          totalBatchCost += costPerYieldUnit * ing.quantity;
        }
      } else if (ing.vendor_item_id) {
        // Vendor item: resolve cost from live pricing
        const vendor = vendorMap.get(ing.vendor_item_id);
        if (!vendor) {
          missingItems.push(ing.vendor_item_id);
          continue;
        }

        const caseCost = vendor.blended_price ?? vendor.cost_per_unit ?? 0;
        if (caseCost === 0) {
          // No pricing data — item exists but has no cost
          continue;
        }

        const ingUnit = normalizeIngUnit(ing.unit);
        const nativeUnit = normalizeIngUnit(vendor.count_unit);

        if (ingUnit === "cs" || ingUnit === "case") {
          totalBatchCost += caseCost * ing.quantity;
        } else if (ingUnit === "cn" || ingUnit === "can") {
          // Can-based: parse cans per case from pack_size
          const cansPerCase = parseCansPerCase(vendor.pack_size);
          if (cansPerCase && cansPerCase > 0) {
            totalBatchCost += (ing.quantity / cansPerCase) * caseCost;
          } else {
            const unitsPerCase = vendor.count_units_per_case || vendor.pack_quantity || 1;
            totalBatchCost += (caseCost / unitsPerCase) * ing.quantity;
          }
        } else {
          // Sub-unit: divide case cost by units per case, with unit conversion
          const unitsPerCase = vendor.count_units_per_case || vendor.pack_quantity || 1;
          const costPerNativeUnit = caseCost / unitsPerCase;

          // Convert ingredient quantity to native units if they differ
          if (ingUnit && nativeUnit && ingUnit !== nativeUnit && TO_OZ[ingUnit] && TO_OZ[nativeUnit]) {
            const ingInNative = (ing.quantity * TO_OZ[ingUnit]) / TO_OZ[nativeUnit];
            totalBatchCost += costPerNativeUnit * ingInNative;
          } else {
            totalBatchCost += costPerNativeUnit * ing.quantity;
          }
        }
      }
    }

    const result: BlueprintCostResult = {
      batchCost: totalBatchCost,
      missingItems,
      isPartial: missingItems.length > 0,
    };
    costCache.set(blueprintId, result);
    return result;
  }

  // 6. Calculate costs for all blueprints
  const results = new Map<string, BlueprintCostResult>();
  for (const bp of bpList) {
    results.set(bp.id, calculateBatchCost(bp.id));
  }

  return results;
}

/**
 * Given a blueprint's batch cost and yield quantity, returns the cost per single output unit.
 */
export function getBlueprintUnitCost(batchCost: number, yieldQty: number | null): number {
  if (!yieldQty || yieldQty === 0) return batchCost;
  return batchCost / yieldQty;
}

// Helper: parse cans per case from pack_size like "6/#10 CN"
function parseCansPerCase(packSize: string | null): number | null {
  if (!packSize) return null;
  const match = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (match) return parseInt(match[1]);
  return null;
}
