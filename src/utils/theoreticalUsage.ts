import { supabase } from "@/integrations/supabase/client";

export interface TheoreticalUsageResult {
  itemId: string;
  itemName: string;
  unit: string;
  theoreticalUsage: number;
  productGroupName: string;
  usageRate: number;
  unitsSold: number;
  packQuantity: number;
}

/**
 * Calculate theoretical usage for all mapped inventory items
 * based on sales data over a date range.
 * 
 * Formula: Units Sold (from mapped POS categories) × Usage Rate = Theoretical Usage
 */
export async function calculateTheoreticalUsage(
  locationId: string,
  startDate: string,
  endDate: string
): Promise<TheoreticalUsageResult[]> {
  try {
    // 1. Get all usage rates with item and group info
    const { data: usageRates, error: ratesErr } = await supabase
      .from("inventory_usage_rates")
      .select(`
        id,
        inventory_item_id,
        product_group_id,
        usage_rate,
        item:inventory_items(name, unit, pack_quantity),
        group:inventory_product_groups(name, pos_categories, pos_items)
      `)
      .eq("location_id", locationId)
      .not("usage_rate", "is", null);

    if (ratesErr || !usageRates || usageRates.length === 0) {
      return [];
    }

    // 2. Get sales data for the period
    const { data: salesData, error: salesErr } = await supabase
      .from("sales_cache")
      .select("product_mix")
      .eq("location_id", locationId)
      .gte("sale_date", startDate)
      .lte("sale_date", endDate)
      .not("product_mix", "is", null);

    if (salesErr) {
      console.error("Failed to fetch sales for theoretical:", salesErr);
      return [];
    }

    // 3. Sum quantities by POS category AND by individual item name
    const categorySales = new Map<string, number>();
    const itemSales = new Map<string, number>();
    for (const day of salesData || []) {
      const mix = day.product_mix as any[];
      if (!Array.isArray(mix)) continue;
      for (const item of mix) {
        if (item.category && item.quantity) {
          const cat = item.category as string;
          categorySales.set(cat, (categorySales.get(cat) || 0) + Number(item.quantity));
        }
        if (item.itemName && item.quantity) {
          const name = item.itemName as string;
          itemSales.set(name, (itemSales.get(name) || 0) + Number(item.quantity));
        }
      }
    }

    // 4. Fetch recipe ingredients for cascade
    const { data: recipeIngredients } = await supabase
      .from("inventory_recipe_ingredients")
      .select("recipe_item_id, ingredient_item_id, quantity, unit");

    // Build recipe map: recipe_item_id -> ingredients[]
    const recipeMap = new Map<string, { ingredient_item_id: string; quantity: number; unit: string }[]>();
    for (const ri of recipeIngredients || []) {
      const existing = recipeMap.get(ri.recipe_item_id) || [];
      existing.push({ ingredient_item_id: ri.ingredient_item_id, quantity: Number(ri.quantity), unit: ri.unit });
      recipeMap.set(ri.recipe_item_id, existing);
    }

    // Fetch recipe items for yield info
    const { data: recipeItems } = await supabase
      .from("inventory_items")
      .select("id, name, recipe_yield_qty, recipe_yield_unit")
      .eq("is_recipe", true);

    const recipeYieldMap = new Map<string, { yieldQty: number; yieldUnit: string }>();
    for (const ri of recipeItems || []) {
      if (ri.recipe_yield_qty) {
        recipeYieldMap.set(ri.id, { yieldQty: Number(ri.recipe_yield_qty), yieldUnit: ri.recipe_yield_unit || "ea" });
      }
    }

    // 5. Calculate theoretical per item-group mapping
    const results: TheoreticalUsageResult[] = [];

    for (const rate of usageRates) {
      const item = rate.item as any;
      const group = rate.group as any;
      const packQty = Number(item?.pack_quantity) || 1;
      if (!item || !group || !rate.usage_rate) continue;

      const posCategories = (group.pos_categories as string[]) || [];
      const posItemNames = (group.pos_items as string[]) || [];
      let unitsSold = 0;
      for (const cat of posCategories) {
        unitsSold += categorySales.get(cat) || 0;
      }
      for (const itemName of posItemNames) {
        unitsSold += itemSales.get(itemName) || 0;
      }

      if (unitsSold === 0) continue;

      const theoretical = unitsSold * Number(rate.usage_rate);

      // If this is a recipe item, cascade to raw ingredients
      const recipeIngs = recipeMap.get(rate.inventory_item_id);
      const recipeYield = recipeYieldMap.get(rate.inventory_item_id);

      if (recipeIngs && recipeYield && recipeYield.yieldQty > 0) {
        // Add the recipe itself
        results.push({
          itemId: rate.inventory_item_id,
          itemName: item.name + " (recipe)",
          unit: item.unit,
          theoreticalUsage: Math.round(theoretical * 100) / 100,
          productGroupName: group.name,
          usageRate: Number(rate.usage_rate),
          unitsSold,
          packQuantity: packQty,
        });

        // Cascade: theoretical oz of recipe needed → ratio of batches → raw ingredient qty
        const batchesNeeded = theoretical / recipeYield.yieldQty;
        for (const ing of recipeIngs) {
          const rawQty = batchesNeeded * ing.quantity;
          results.push({
            itemId: ing.ingredient_item_id,
            itemName: `↳ (via ${item.name})`,
            unit: ing.unit,
            theoreticalUsage: Math.round(rawQty * 100) / 100,
            productGroupName: group.name,
            usageRate: 0, // derived, not direct
            unitsSold,
          });
        }
      } else {
        results.push({
          itemId: rate.inventory_item_id,
          itemName: item.name,
          unit: item.unit,
          theoreticalUsage: Math.round(theoretical * 100) / 100,
          productGroupName: group.name,
          usageRate: Number(rate.usage_rate),
          unitsSold,
        });
      }
    }

    return results;
  } catch (err) {
    console.error("Theoretical usage calculation error:", err);
    return [];
  }
}
