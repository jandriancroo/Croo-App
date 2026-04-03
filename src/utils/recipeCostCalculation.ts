import { supabase } from "@/integrations/supabase/client";

interface RecipeIngredient {
  recipe_item_id: string;
  ingredient_item_id: string;
  quantity: number;
  unit: string;
}

interface ItemCostInfo {
  id: string;
  cost_per_unit: number | null;
  pack_quantity: number | null;
  pack_quantity_override: number | null;
  count_units_per_case: number | null;
  count_unit: string | null;
  is_recipe: boolean;
  recipe_yield_qty: number | null;
  recipe_yield_unit: string | null;
  blended_price: number | null;
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
    .select("id, cost_per_unit, pack_quantity, pack_quantity_override, count_units_per_case, count_unit, is_recipe, recipe_yield_qty, recipe_yield_unit, blended_price")
    .eq("location_id", locationId)
    .eq("is_active", true);

  if (recipeError) throw recipeError;

  const recipeItemIds = recipeItems?.filter(i => i.is_recipe).map(i => i.id) || [];
  
  if (recipeItemIds.length === 0) return new Map();

  const { data: allIngredients, error: allIngError } = await supabase
    .from("inventory_recipe_ingredients")
    .select("recipe_item_id, ingredient_item_id, quantity, unit")
    .in("recipe_item_id", recipeItemIds);

  if (allIngError) throw allIngError;

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
        const ingUnit = ing.unit?.toLowerCase() || '';
        
        // If the recipe unit is "cs" or "case", use full case cost (no division)
        if (ingUnit === 'cs' || ingUnit === 'case') {
          totalBatchCost += caseCost * ing.quantity;
        } else {
          // Use count_units_per_case for sub-unit conversion, fallback to pack_quantity
          const unitsPerCase = ingItem.count_units_per_case || ingItem.pack_quantity || 1;
          const costPerSingleUnit = caseCost / unitsPerCase;
          totalBatchCost += costPerSingleUnit * ing.quantity;
        }
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
