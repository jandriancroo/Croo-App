import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type InventoryMode = "brand" | "lite";

/**
 * Resolves the `inventory_mode` for a location.
 *
 * Mirrors the `lens_enabled` per-location flag pattern: the mode is set at
 * creation, cached client-side, and used to gate nav/routes so brand-mode
 * code paths never mount for Lite locations.
 *
 * Returns 'brand' as a safe fallback while loading or on error, so existing
 * behavior stays untouched during Phase 1 rollout.
 */
export function useInventoryMode(locationId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["location-inventory-mode", locationId],
    queryFn: async (): Promise<InventoryMode> => {
      if (!locationId) return "brand";
      const { data, error } = await supabase
        .from("locations")
        .select("inventory_mode")
        .eq("id", locationId)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.inventory_mode as InventoryMode) || "brand";
    },
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000, // 5 min — mode is immutable after creation in v1
  });

  return {
    mode: query.data ?? "brand",
    isLite: query.data === "lite",
    isBrand: query.data !== "lite",
    isLoading: query.isLoading,
  };
}
