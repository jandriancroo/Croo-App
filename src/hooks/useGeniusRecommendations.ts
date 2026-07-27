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
      // Ask the engine for a fresh location batch. The edge function loads
      // active items server-side so large locations do not send huge payloads
      // or trigger per-item request waterfalls from the browser.
      const { data: fn, error: fnErr } = await supabase.functions.invoke("genius-usage-engine", {
        body: { action: "recommendLocation", location_id: locationId, as_of_date: asOfDate },
      });
      if (fnErr) {
        console.error("[GeniusRecommendations] recommendLocation failed", fnErr);
      }
      return {
        items: fnErr ? [] : (fn?.items as any[]) || [],
        recs: fnErr ? {} : (fn?.results as Record<string, any>) || {},
        rates: fnErr ? {} : (fn?.rates as Record<string, any>) || {},
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
