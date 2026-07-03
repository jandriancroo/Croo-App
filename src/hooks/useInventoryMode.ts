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
interface InventoryModeResult {
  mode: InventoryMode;
  configured: boolean;
}

export function useInventoryMode(locationId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["location-inventory-mode", locationId],
    queryFn: async (): Promise<InventoryModeResult> => {
      if (!locationId) return { mode: "brand", configured: false };
      const { data, error } = await supabase
        .from("locations")
        .select("inventory_mode, inventory_configured")
        .eq("id", locationId)
        .maybeSingle();
      if (error) throw error;
      return {
        mode: (((data as any)?.inventory_mode as InventoryMode) || "brand"),
        configured: !!(data as any)?.inventory_configured,
      };
    },
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
  });

  const mode = query.data?.mode ?? "brand";
  const configured = query.data?.configured ?? false;
  return {
    mode,
    isLite: mode === "lite",
    isBrand: mode !== "lite",
    isConfigured: configured,
    isLoading: query.isLoading,
  };
}
