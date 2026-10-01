import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Brand-only recipes (location_id IS NULL). Never reads store copies. */
export interface BrandRecipe {
  id: string;
  name: string;
  category: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
  is_countable: boolean | null;
  catalog_section: string | null;
}

export function useBrandRecipes(brandId: string | undefined) {
  return useQuery({
    queryKey: ["brand-recipes", brandId],
    enabled: !!brandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, category, yield_qty, yield_unit, is_countable, catalog_section")
        .eq("brand_id", brandId!)
        .is("location_id", null)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as BrandRecipe[];
    },
  });
}

export interface PriceOutlier {
  template_id: string;
  ingredient_name: string;
  unit_label: string;
  store: string;
  store_unit_price: number | null;
  median_unit_price: number | null;
  problem: string | null;
  recipes: string[];
}

/** Every ingredient + store more than 50% off the brand median, or not priceable. View only. */
export function useBrandPriceOutliers(brandId: string | undefined) {
  return useQuery({
    queryKey: ["brand-price-outliers", brandId],
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("brand_price_outliers", { _brand_id: brandId });
      if (error) throw error;
      return (data || []) as PriceOutlier[];
    },
  });
}

export interface StorePrice {
  store: string;
  cost?: number;
  unit_price?: number;
  lens?: string | null;
  problem?: string;
}

export interface IngredientPricing {
  ingredient_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string | null;
  is_sub: boolean;
  median_cost: number | null;
  min_cost: number | null;
  max_cost: number | null;
  stores_priced: number;
  unit_label: string;
  median_unit_price: number | null;
  store_prices: StorePrice[];
  outliers: StorePrice[];
}

/** Median price per ingredient across live stores, each at its own pack. View only. */
export function useBrandRecipePricing(blueprintId: string | null) {
  return useQuery({
    queryKey: ["brand-recipe-pricing", blueprintId],
    enabled: !!blueprintId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("brand_recipe_pricing", { _bp_id: blueprintId });
      if (error) throw error;
      return (data || []) as IngredientPricing[];
    },
  });
}

export const money = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : `$${Number(n).toFixed(n !== 0 && Math.abs(n) < 0.1 ? 4 : digits)}`;
