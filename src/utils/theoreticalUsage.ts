import { supabase } from "@/integrations/supabase/client";

export interface TheoreticalUsageResult {
  itemId: string;
  itemName: string;
  unit: string;
  theoreticalUsage: number;
  productGroupName: string;
  usageRate: number;
  unitsSold: number;
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
        item:inventory_items(name, unit),
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

    // 4. Calculate theoretical per item-group mapping
    const results: TheoreticalUsageResult[] = [];

    for (const rate of usageRates) {
      const item = rate.item as any;
      const group = rate.group as any;
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

    return results;
  } catch (err) {
    console.error("Theoretical usage calculation error:", err);
    return [];
  }
}
