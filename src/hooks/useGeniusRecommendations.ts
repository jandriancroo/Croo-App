import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";

/**
 * Client wrapper for the `genius-usage-engine` edge function.
 *
 * The engine is authoritative — this hook only invokes it and reads the
 * cached rows it wrote (item_usage_rates, order_recommendations).
 */
export function useGeniusRecommendations(locationId: string, enabled = true) {
  const qc = useQueryClient();
  const { getBusinessDateInTimezone } = useLocationTimezone(locationId);
  const asOfDate = getBusinessDateInTimezone();

  const recs = useQuery({
    queryKey: ["genius-recs", locationId, asOfDate],
    enabled: !!locationId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      // Grab active items
      const { data: items, error: itemsErr } = await supabase
        .from("lite_inventory_items" as any)
        .select("id, name, vendor_name_normalized, unit, common_label, case_qty, units_per_case, usage_model")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (itemsErr) throw itemsErr;
      const ids = ((items as any[]) || []).map((i) => i.id);
      if (ids.length === 0) return { items: [], recs: {}, rates: {} };

      // Fitted rates (already computed by the engine)
      const { data: rates } = await supabase
        .from("item_usage_rates" as any)
        .select("item_id, weekly_usage_level, residual_stddev, r2_usage_vs_sales, periods_used, last_fitted_at")
        .in("item_id", ids);
      const ratesById = new Map<string, any>();
      ((rates as any[]) || []).forEach((r) => ratesById.set(r.item_id, r));

      // Ask the engine for a fresh batch of recommendations for today
      const { data: fn, error: fnErr } = await supabase.functions.invoke("genius-usage-engine", {
        body: { action: "recommendBatch", item_ids: ids, as_of_date: asOfDate },
      });
      if (fnErr) {
        console.error("[GeniusRecommendations] recommendBatch failed", fnErr);
      }
      return {
        items: (items as any[]) || [],
        recs: fnErr ? {} : (fn?.results as Record<string, any>) || {},
        rates: Object.fromEntries(ratesById),
        error: fnErr?.message || null,
      };
    },
  });

  const refit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("genius-usage-engine", {
        body: { action: "rebuildLocation", location_id: locationId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["genius-recs", locationId] });
    },
  });

  return { ...recs, refit };
}
