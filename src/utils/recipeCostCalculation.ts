import { supabase } from "@/integrations/supabase/client";
import { parsePackSizeToOz } from "./legacy/conversionLegacy";
import { TO_OZ, normalizeUnit } from "./unitConversion";

interface RecipeIngredient {
  recipe_item_id: string;
  ingredient_item_id: string;
  quantity: number;
  unit: string;
}

interface ItemCostInfo {
  id: string;
  brand_item_id: string | null;
  cost_per_unit: number | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  count_units_per_case: number | null;
  count_unit: string | null;
  pack_size: string | null;
  is_recipe: boolean;
  recipe_yield_qty: number | null;
  recipe_yield_unit: string | null;
  blended_price: number | null;
}

interface ActiveConversionRow {
  brand_template_id: string;
  canonical_unit: string;
  outer_qty: number;
  canonical_qty_per_inner: number | null;
}

/**
 * Fetches all recipe ingredients and item cost info for a location,
 * then calculates the effective cost per "count unit" for each recipe item.
 * 
 * Returns a Map<item_id, cost_per_count_unit> where cost_per_count_unit
 * is the cost for 1 unit of the recipe's yield (e.g., 1 dough ball).
 */
export async function fetchRecipeCosts(locationId: string): Promise<Map<string, number>> {
  const { data: recipeItems, error: recipeError } = await supabase
    .from("inventory_items")
    .select("id, brand_item_id, cost_per_unit, pack_quantity, pack_quantity_override, count_units_per_case, count_unit, pack_size, is_recipe, recipe_yield_qty, recipe_yield_unit, blended_price")
    .eq("location_id", locationId)
    .eq("is_active", true);

  if (recipeError) throw recipeError;

  const recipeItemIds = recipeItems?.filter(i => i.is_recipe).map(i => i.id) || [];
  
  if (recipeItemIds.length === 0) return new Map();

  // Pipeline 1 — fetch brand-level conversions for raw ingredient unit normalization
  const conversionMap = new Map<string, ActiveConversionRow>();
  if (recipeItems && recipeItems.length > 0) {
    const { resolveBrandId } = await import("@/utils/resolveBrandId");
    const brandId = await resolveBrandId(locationId);
    if (brandId) {
      const { data: conversions, error: convErr } = await supabase
        .from("item_conversions")
        .select("brand_template_id, canonical_unit, outer_qty, canonical_qty_per_inner")
        .eq("brand_id", brandId)
        .is("effective_to", null);
      if (!convErr && conversions) {
        for (const c of conversions) {
          conversionMap.set(c.brand_template_id, c as ActiveConversionRow);
        }
      }
    }
  }

  // Read ingredients from recipe_blueprint_ingredients (the source of truth).
  // Resolve blueprints whose produces_item_id matches one of our local recipe items.
  // Per-store blueprints live at this location; we also accept brand-level blueprints
  // whose produces_item_id was wired to a local item.
  const { data: blueprints, error: bpErr } = await supabase
    .from("recipe_blueprints")
    .select("id, name, brand_id, location_id, produces_item_id")
    .in("produces_item_id", recipeItemIds);

  if (bpErr) throw bpErr;

  // Map blueprint_id → local recipe item_id
  const blueprintToLocalItem = new Map<string, string>();
  blueprints?.forEach(bp => {
    if (bp.produces_item_id) blueprintToLocalItem.set(bp.id, bp.produces_item_id);
  });

  const blueprintIds = blueprints?.map(b => b.id) || [];

  let blueprintIngredients: Array<{
    blueprint_id: string;
    ingredient_type: string;
    vendor_item_id: string | null;
    sub_blueprint_id: string | null;
    quantity: number;
    unit: string | null;
  }> = [];

  if (blueprintIds.length > 0) {
    const { data: bpIngs, error: bpIngErr } = await supabase
      .from("recipe_blueprint_ingredients")
      .select("blueprint_id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit")
      .in("blueprint_id", blueprintIds);
    if (bpIngErr) throw bpIngErr;
    blueprintIngredients = bpIngs || [];
  }

  // Build vendor_item_id (brand_template_id) → local inventory_items.id map (per-location)
  const brandToLocalItem = new Map<string, string>();
  recipeItems?.forEach(it => {
    if (it.brand_item_id) brandToLocalItem.set(it.brand_item_id, it.id);
  });

  // Resolve sub_blueprint_id → local recipe item_id.
  // Sub-blueprint references are typically brand-level; resolve to this location's
  // matching blueprint by (brand_id, name).
  const subBlueprintIds = Array.from(
    new Set(blueprintIngredients.map(i => i.sub_blueprint_id).filter((x): x is string => !!x))
  );
  const subBlueprintToLocalItem = new Map<string, string>();
  if (subBlueprintIds.length > 0) {
    const { data: subRefs } = await supabase
      .from("recipe_blueprints")
      .select("id, name, brand_id")
      .in("id", subBlueprintIds);

    if (subRefs && subRefs.length > 0) {
      // Pull this location's blueprints with matching names to map back to local items
      const names = subRefs.map(s => s.name);
      const { data: localMatches } = await supabase
        .from("recipe_blueprints")
        .select("name, brand_id, produces_item_id")
        .eq("location_id", locationId)
        .in("name", names);

      const localByKey = new Map<string, string>();
      localMatches?.forEach(lm => {
        if (lm.produces_item_id) localByKey.set(`${lm.brand_id}::${lm.name}`, lm.produces_item_id);
      });

      subRefs.forEach(sr => {
        // First, if the sub-blueprint itself directly produces a local item, use it
        if (blueprintToLocalItem.has(sr.id)) {
          subBlueprintToLocalItem.set(sr.id, blueprintToLocalItem.get(sr.id)!);
          return;
        }
        const localItemId = localByKey.get(`${sr.brand_id}::${sr.name}`);
        if (localItemId) subBlueprintToLocalItem.set(sr.id, localItemId);
      });
    }
  }

  // Translate blueprint ingredients into the legacy { recipe_item_id, ingredient_item_id, quantity, unit } shape
  const allIngredients: Array<{
    recipe_item_id: string;
    ingredient_item_id: string;
    quantity: number;
    unit: string;
  }> = [];

  for (const bi of blueprintIngredients) {
    const localRecipeItemId = blueprintToLocalItem.get(bi.blueprint_id);
    if (!localRecipeItemId) continue;

    let localIngredientId: string | undefined;
    if (bi.ingredient_type === "blueprint" && bi.sub_blueprint_id) {
      localIngredientId = subBlueprintToLocalItem.get(bi.sub_blueprint_id);
    } else if (bi.vendor_item_id) {
      localIngredientId = brandToLocalItem.get(bi.vendor_item_id);
    }
    if (!localIngredientId) continue;

    allIngredients.push({
      recipe_item_id: localRecipeItemId,
      ingredient_item_id: localIngredientId,
      quantity: Number(bi.quantity) || 0,
      unit: bi.unit || "",
    });
  }

  // Build lookup maps
  const itemMap = new Map<string, ItemCostInfo>();
  recipeItems?.forEach(item => itemMap.set(item.id, item as ItemCostInfo));

  const ingredientsByRecipe = new Map<string, RecipeIngredient[]>();
  allIngredients?.forEach(ing => {
    const list = ingredientsByRecipe.get(ing.recipe_item_id) || [];
    list.push(ing as RecipeIngredient);
    ingredientsByRecipe.set(ing.recipe_item_id, list);
  });

  // Recursive cost calculation with cycle detection
  const costCache = new Map<string, number>();

  function calculateBatchCost(itemId: string, visited: Set<string> = new Set()): number {
    if (costCache.has(itemId)) return costCache.get(itemId)!;
    if (visited.has(itemId)) return 0; // Cycle detection
    visited.add(itemId);

    const item = itemMap.get(itemId);
    if (!item) return 0;

    // Non-recipe items: return direct cost
    if (!item.is_recipe) {
      const cost = item.blended_price ?? item.cost_per_unit ?? 0;
      costCache.set(itemId, cost);
      return cost;
    }

    // Recipe items: if they already have a stored cost_per_unit (set by the recipe editor),
    // use it directly as the batch cost — this is the most accurate source of truth.
    if (item.cost_per_unit && item.cost_per_unit > 0) {
      costCache.set(itemId, item.cost_per_unit);
      return item.cost_per_unit;
    }

    // Recipe with no stored cost — calculate from ingredients
    const ingredients = ingredientsByRecipe.get(itemId) || [];
    if (ingredients.length === 0) {
      costCache.set(itemId, 0);
      return 0;
    }

    let totalBatchCost = 0;
    for (const ing of ingredients) {
      const ingItem = itemMap.get(ing.ingredient_item_id);
      if (!ingItem) continue;

      if (ingItem.is_recipe) {
        // Recursive: get batch cost of sub-recipe, then figure cost per unit of yield
        const subBatchCost = calculateBatchCost(ing.ingredient_item_id, new Set(visited));
        const subYield = ingItem.recipe_yield_qty || 1;
        const costPerYieldUnit = subBatchCost / subYield;
        totalBatchCost += costPerYieldUnit * ing.quantity;
      } else {
        // Raw ingredient: determine proper divisor based on unit
        const caseCost = ingItem.blended_price ?? ingItem.cost_per_unit ?? 0;
        const ingUnit = normalizeUnit(ing.unit);

        // Pipeline 1 lookup — ingItem.brand_item_id is the brand template id
        const brandConversion = ingItem.brand_item_id
          ? conversionMap.get(ingItem.brand_item_id)
          : undefined;

        const nativeUnit = normalizeUnit(
          brandConversion?.canonical_unit || ingItem.count_unit || ""
        );
        const unitsPerCase = brandConversion
          ? (brandConversion.outer_qty * (brandConversion.canonical_qty_per_inner ?? 1))
          : (ingItem.pack_quantity || 1);
        const costPerSingleUnit = caseCost / unitsPerCase;

        if (ingUnit === 'cs' || ingUnit === 'case') {
          totalBatchCost += caseCost * ing.quantity;
        } else if (ingUnit === nativeUnit || (ingUnit === 'ea' && nativeUnit === 'ea')) {
          totalBatchCost += costPerSingleUnit * ing.quantity;
        } else if (ingUnit && nativeUnit && ingUnit !== nativeUnit && TO_OZ[ingUnit] && TO_OZ[nativeUnit]) {
          const ingInNative = (ing.quantity * TO_OZ[ingUnit]) / TO_OZ[nativeUnit];
          totalBatchCost += costPerSingleUnit * ingInNative;
        } else if (!nativeUnit && TO_OZ[ingUnit] && !brandConversion) {
          const totalOz = parsePackSizeToOz(ingItem.pack_size);
          if (totalOz && totalOz > 0) {
            const cpu = caseCost / totalOz;
            totalBatchCost += ing.quantity * (TO_OZ[ingUnit] / TO_OZ["oz"]) * cpu;
          }
        } else if (!nativeUnit && ingUnit === 'ea') {
          totalBatchCost += costPerSingleUnit * ing.quantity;
        }
        // else: can't determine unit — skip
      }
    }

    costCache.set(itemId, totalBatchCost);
    return totalBatchCost;
  }

  // Calculate costs for all recipe items
  const recipeCosts = new Map<string, number>();
  for (const recipeId of recipeItemIds) {
    const batchCost = calculateBatchCost(recipeId);
    recipeCosts.set(recipeId, batchCost);
  }

  return recipeCosts;
}

/**
 * Given a recipe's batch cost and yield quantity, returns the cost per single output unit.
 * For example, if a dough recipe costs $16 and yields 667.5 oz,
 * a 17oz dough ball costs (16 / 667.5) * 17 = $0.41
 */
export function getRecipeUnitCost(
  batchCost: number,
  yieldQty: number | null
): number {
  if (!yieldQty || yieldQty === 0) return batchCost;
  return batchCost / yieldQty;
}
