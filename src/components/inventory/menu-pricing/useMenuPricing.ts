import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchBlueprintCosts, getBlueprintUnitCost } from "@/utils/blueprintCostCalculation";
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
  tpdUpchargePct: number | null;
  tpdFeePct: number | null;
  tpdPrice: number | null;
  tpdFoodCostPct: number | null;
}

interface PriceOverride {
  menu_price: number;
  tpd_upcharge_pct: number | null;
  tpd_fee_pct: number | null;
}

export function useMenuPricing(locationId: string) {
  const queryClient = useQueryClient();

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

  const { data: costMap, isLoading: costLoading } = useQuery({
    queryKey: ["menu-pricing-costs", locationId],
    queryFn: () => fetchBlueprintCosts(locationId),
    enabled: !!blueprints && blueprints.length > 0,
  });

  const { data: savedPrices } = useQuery({
    queryKey: ["menu-price-overrides", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_price_overrides" as any)
        .select("blueprint_id, menu_price, tpd_upcharge_pct, tpd_fee_pct")
        .eq("location_id", locationId);
      if (error) throw error;
      return new Map(
        ((data || []) as any[]).map((r: any) => [r.blueprint_id, {
          menu_price: Number(r.menu_price),
          tpd_upcharge_pct: r.tpd_upcharge_pct != null ? Number(r.tpd_upcharge_pct) : null,
          tpd_fee_pct: r.tpd_fee_pct != null ? Number(r.tpd_fee_pct) : null,
        } as PriceOverride])
      );
    },
  });


  const upsertPrice = useMutation({
    mutationFn: async (payload: {
      blueprintId: string;
      price?: number;
      tpdUpchargePct?: number | null;
      tpdFeePct?: number | null;
    }) => {
      const row: any = {
        location_id: locationId,
        blueprint_id: payload.blueprintId,
      };
      if (payload.price !== undefined) row.menu_price = payload.price;
      if (payload.tpdUpchargePct !== undefined) row.tpd_upcharge_pct = payload.tpdUpchargePct;
      if (payload.tpdFeePct !== undefined) row.tpd_fee_pct = payload.tpdFeePct;

      const { error } = await supabase
        .from("menu_price_overrides" as any)
        .upsert(row as any, { onConflict: "location_id,blueprint_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-price-overrides", locationId] });
    },
  });

  const bulkUpsert3pd = useMutation({
    mutationFn: async (payload: { upchargePct?: number; feePct?: number }) => {
      const bpIds = (blueprints || [])
        .filter(bp => bp.category?.toUpperCase() === "MI")
        .map(bp => bp.id);
      if (bpIds.length === 0) return;

      const rows = bpIds.map(id => {
        const existing = savedPrices?.get(id);
        const row: any = {
          location_id: locationId,
          blueprint_id: id,
          menu_price: existing?.menu_price ?? 0,
        };
        if (payload.upchargePct !== undefined) row.tpd_upcharge_pct = payload.upchargePct;
        if (payload.feePct !== undefined) row.tpd_fee_pct = payload.feePct;
        return row;
      });

      const { error } = await supabase
        .from("menu_price_overrides" as any)
        .upsert(rows as any, { onConflict: "location_id,blueprint_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu-price-overrides", locationId] });
    },
  });

  const items: MenuPricingItem[] = (blueprints || [])
    .filter(bp => bp.category?.toUpperCase() === "MI")
    .map(bp => {
      const cost = costMap?.get(bp.id);
      const batchCost = cost?.batchCost || 0;
      const recipeCost = getBlueprintUnitCost(batchCost, bp.yield_qty);
      const override = savedPrices?.get(bp.id);
      const menuPrice = override?.menu_price ?? null;

      const foodCostPct = menuPrice && menuPrice > 0
        ? (recipeCost / menuPrice) * 100
        : null;

      const tpdUpchargePct = override?.tpd_upcharge_pct ?? null;
      const tpdFeePct = override?.tpd_fee_pct ?? null;
      const tpdPrice = menuPrice && tpdUpchargePct != null
        ? menuPrice * (1 + tpdUpchargePct / 100)
        : null;
      const tpdFoodCostPct = tpdPrice && tpdPrice > 0 && tpdFeePct != null
        ? (recipeCost / (tpdPrice * (1 - tpdFeePct / 100))) * 100
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
        menuPrice,
        foodCostPct,
        tpdUpchargePct,
        tpdFeePct,
        tpdPrice,
        tpdFoodCostPct,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    items,
    isLoading: bpLoading || costLoading,
    upsertPrice: upsertPrice.mutate,
    bulkUpsert3pd: bulkUpsert3pd.mutate,
    isUpserting: upsertPrice.isPending,
  };
}
