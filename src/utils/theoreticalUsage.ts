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
  totalCost: number;
  resolutionPath: string;
}

/**
 * Calculate theoretical usage for all mapped inventory items
 * using the recipe-driven engine.
 * 
 * Flow: POS Sales × Recipe Resolution = Theoretical Ingredient Usage
 */
export async function calculateTheoreticalUsage(
  locationId: string,
  startDate: string,
  endDate: string
): Promise<TheoreticalUsageResult[]> {
  try {
    const { data, error } = await supabase.rpc("calculate_theoretical_usage", {
      p_location_id: locationId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) {
      console.error("Theoretical usage RPC error:", error);
      return [];
    }

    if (!data || data.length === 0) return [];

    // Aggregate by vendor_item_id (same item may appear from multiple mappings/paths)
    const aggregated = new Map<string, TheoreticalUsageResult>();

    for (const row of data) {
      const key = row.vendor_item_id || row.ingredient_name;
      const existing = aggregated.get(key);
      
      if (existing) {
        existing.theoreticalUsage += Number(row.total_quantity) || 0;
        existing.totalCost += Number(row.total_cost) || 0;
        existing.unitsSold += Number(row.units_sold) || 0;
      } else {
        aggregated.set(key, {
          itemId: row.vendor_item_id || "",
          itemName: row.vendor_item_name || row.ingredient_name || "Unknown",
          unit: row.unit_of_measure || "",
          theoreticalUsage: Math.round((Number(row.total_quantity) || 0) * 100) / 100,
          productGroupName: row.pos_mapping_name || "",
          usageRate: 0, // Not applicable in recipe-driven model
          unitsSold: Number(row.units_sold) || 0,
          packQuantity: 1,
          totalCost: Math.round((Number(row.total_cost) || 0) * 100) / 100,
          resolutionPath: row.resolution_path || "",
        });
      }
    }

    return Array.from(aggregated.values());
  } catch (err) {
    console.error("Theoretical usage calculation error:", err);
    return [];
  }
}
