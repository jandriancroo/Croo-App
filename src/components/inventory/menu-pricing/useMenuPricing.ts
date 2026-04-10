import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchBlueprintCosts, getBlueprintUnitCost, type BlueprintCostResult } from "@/utils/blueprintCostCalculation";
import { fetchBlueprintsForLocation } from "@/utils/resolveBrandId";

export interface MenuPricingItem {
  id: string;
  name: string;
  category: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
  catalog_section: string | null;
  recipeCost: number;
  isPartial: boolean;
  menuPrice: number | null;
  foodCostPct: number | null;
}

export function useMenuPricing(locationId: string) {
  const queryClient = useQueryClient();

  // Fetch all blueprints (brand + local merge)
  const { data: blueprints, isLoading: bpLoading } = useQuery({
    queryKey: ["menu-pricing-blueprints", locationId],
    queryFn: async () => {
      const data = await fetchBlueprintsForLocation(
        locationId,
        "id, name, category, yield_qty, yield_unit, catalog_section"
      );
      return (data || []) as Array<{
        id: string; name: string; category: string | null;
        yield_qty: number | null; yield_unit: string | null;
        catalog_section: string | null;
      }>;
    },
  });

  // Fetch all costs
  const { data: costMap, isLoading: costLoading } = useQuery({
    queryKey: ["menu-pricing-costs", locationId],
    queryFn: () => fetchBlueprintCosts(locationId),
    enabled: !!blueprints && blueprints.length > 0,
  });

  // Fetch saved menu prices
  const { data: savedPrices } = useQuery({
    queryKey: ["menu-price-overrides", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_price_overrides" as any)
        .select("blueprint_id, menu_price")
        .eq("location_id", locationId);
      if (error) throw error;
      return new Map(
        ((data || []) as any[]).map((r: any) => [r.blueprint_id, Number(r.menu_price)])
      );
    },
  });

  // Upsert mutation
  const upsertPrice = useMutation({
    mutationFn: async ({ blueprintId, price }: { blueprintId: string; price: number }) => {
      const { error } = await supabase
        .from("menu_price_overrides" as any)
        .upsert(
          { location_id: locationId, blueprint_id: blueprintId, menu_price: price } as any,
          { onConflict: "location_id,blueprint_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-price-overrides", locationId] });
    },
  });

  // Build enriched items — only MI category (menu items customers order)
  const items: MenuPricingItem[] = (blueprints || [])
    .filter(bp => bp.category?.toUpperCase() === "MI")
    .map(bp => {
      const cost = costMap?.get(bp.id);
      const batchCost = cost?.batchCost || 0;
      const recipeCost = getBlueprintUnitCost(batchCost, bp.yield_qty);
      const menuPrice = savedPrices?.get(bp.id) ?? null;
      const foodCostPct = menuPrice && menuPrice > 0
        ? (recipeCost / menuPrice) * 100
        : null;

      return {
        id: bp.id,
        name: bp.name,
        category: bp.category,
        yield_qty: bp.yield_qty,
        yield_unit: bp.yield_unit,
        catalog_section: bp.catalog_section,
        recipeCost,
        isPartial: cost?.isPartial || false,
        menuPrice,
        foodCostPct,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    items,
    isLoading: bpLoading || costLoading,
    upsertPrice: upsertPrice.mutate,
    isUpserting: upsertPrice.isPending,
  };
}
