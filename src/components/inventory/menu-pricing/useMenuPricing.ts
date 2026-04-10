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
  quPrice: number | null;
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

export function useMenuPricing(locationId: string, priceSource: "manual" | "qu" = "manual") {
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

  // Fetch QU prices from product_mix (last 7 days avg)
  const { data: quPriceMap } = useQuery({
    queryKey: ["menu-pricing-qu-prices", locationId],
    queryFn: async () => {
      // 1. Get POS mappings for this brand's blueprints
      const { data: mappings } = await supabase
        .from("inventory_product_groups")
        .select("blueprint_id, pos_items")
        .not("blueprint_id", "is", null);

      if (!mappings || mappings.length === 0) return new Map<string, number>();

      // Build blueprint -> pos item names map
      const bpToPosItems = new Map<string, string[]>();
      for (const m of mappings) {
        if (m.blueprint_id && m.pos_items && (m.pos_items as string[]).length > 0) {
          bpToPosItems.set(m.blueprint_id, m.pos_items as string[]);
        }
      }

      // 2. Get recent product_mix data (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateStr = sevenDaysAgo.toISOString().split("T")[0];

      const { data: salesRows } = await supabase
        .from("sales_cache")
        .select("product_mix")
        .eq("location_id", locationId)
        .gte("sale_date", dateStr)
        .not("product_mix", "is", null);

      if (!salesRows || salesRows.length === 0) return new Map<string, number>();

      // 3. Aggregate: itemName -> { totalSales, totalQty }
      const agg = new Map<string, { sales: number; qty: number }>();
      for (const row of salesRows) {
        const mix = row.product_mix as any[];
        if (!Array.isArray(mix)) continue;
        for (const item of mix) {
          const name = item.itemName as string;
          const sales = Number(item.netSales) || 0;
          const qty = Number(item.quantity) || 0;
          if (!name || qty <= 0 || sales <= 0) continue;
          const existing = agg.get(name) || { sales: 0, qty: 0 };
          existing.sales += sales;
          existing.qty += qty;
          agg.set(name, existing);
        }
      }

      // 4. Map blueprint_id -> avg price via POS item name matching
      const result = new Map<string, number>();
      for (const [bpId, posItems] of bpToPosItems) {
        // Find matching POS items and compute weighted avg price
        let totalSales = 0;
        let totalQty = 0;
        for (const posName of posItems) {
          const match = agg.get(posName);
          if (match) {
            totalSales += match.sales;
            totalQty += match.qty;
          }
        }
        if (totalQty > 0 && totalSales > 0) {
          result.set(bpId, totalSales / totalQty);
        }
      }

      return result;
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
      const quPrice = quPriceMap?.get(bp.id) ?? null;

      // Use the active price source for FC% calculations
      const activePrice = priceSource === "qu" && quPrice ? quPrice : menuPrice;

      const foodCostPct = activePrice && activePrice > 0
        ? (recipeCost / activePrice) * 100
        : null;

      const tpdUpchargePct = override?.tpd_upcharge_pct ?? null;
      const tpdFeePct = override?.tpd_fee_pct ?? null;
      const tpdPrice = activePrice && tpdUpchargePct != null
        ? activePrice * (1 + tpdUpchargePct / 100)
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
        quPrice,
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
