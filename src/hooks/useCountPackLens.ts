import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrandId } from "@/utils/resolveBrandId";

/**
 * Mirrors the count screen's lens loading exactly (same query keys, same
 * queryFn) so read-only displays show the pack the count screen actually uses.
 * Keep in sync with InventoryCountSession.tsx (location-brand-id,
 * location-lens-enabled, pack-config-lens).
 */
export function useCountPackLens(locationId: string | null | undefined) {
  const { data: brandId } = useQuery({
    queryKey: ["location-brand-id", locationId],
    queryFn: () => resolveBrandId(locationId as string),
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
  });

  const { data: lensEnabled } = useQuery({
    queryKey: ["location-lens-enabled", locationId],
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations" as any)
        .select("lens_enabled")
        .eq("id", locationId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.lens_enabled === true;
    },
  });

  const { data: lensMap, isFetching } = useQuery({
    queryKey: ["pack-config-lens", brandId, lensEnabled],
    enabled: !!brandId && lensEnabled === true,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_pack_configs" as any)
        .select("brand_template_id, count_units_per_case, cost_per_common_unit, common_unit, outer_qty, outer_type, inner_qty, inner_type, status, show_cases, show_inner_packs, show_common_unit")
        .eq("status", "approved");
      if (error) throw error;
      const map = new Map<string, any>();
      for (const row of (data as any[]) || []) {
        if (!row?.brand_template_id) continue;
        map.set(row.brand_template_id, {
          count_units_per_case: row.count_units_per_case,
          cost_per_common_unit: row.cost_per_common_unit,
          common_unit: row.common_unit,
          outer_qty: row.outer_qty,
          outer_type: row.outer_type,
          inner_qty: row.inner_qty,
          inner_type: row.inner_type,
          show_cases: row.show_cases ?? null,
          show_inner_packs: row.show_inner_packs ?? null,
          show_common_unit: row.show_common_unit ?? null,
        });
      }
      return map;
    },
  });

  return { lensEnabled: lensEnabled === true, lensMap, loading: lensEnabled === true && (lensMap === undefined || isFetching && !lensMap) };
}
