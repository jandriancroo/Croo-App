import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface InventoryPeriodConfig {
  periodEndDay: number; // 0=Sun, 1=Mon, ..., 6=Sat
  periodCutoff: "after_close" | "before_open";
}

const DEFAULT_CONFIG: InventoryPeriodConfig = {
  periodEndDay: 0, // Sunday
  periodCutoff: "after_close",
};

export const useInventoryPeriodSettings = (locationId: string | undefined) => {
  const { data: config = DEFAULT_CONFIG, isLoading } = useQuery({
    queryKey: ["inventory-period-settings", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("location_settings")
        .select("inventory_period_end_day, inventory_period_cutoff")
        .eq("location_id", locationId!)
        .maybeSingle();

      if (error) {
        console.error("Error fetching inventory period settings:", error);
        return DEFAULT_CONFIG;
      }

      if (!data) return DEFAULT_CONFIG;

      return {
        periodEndDay: data.inventory_period_end_day ?? 0,
        periodCutoff: (data.inventory_period_cutoff ?? "after_close") as "after_close" | "before_open",
      };
    },
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  return { config, isLoading };
};

/**
 * Given today's date and the configured end-day, compute the current period's end date.
 * Returns a yyyy-MM-dd string.
 */
export function computePeriodEndDate(
  todayStr: string,
  periodEndDay: number
): string {
  const today = new Date(todayStr + "T12:00:00");
  const currentDay = today.getDay(); // 0=Sun
  let daysUntilEnd = periodEndDay - currentDay;
  if (daysUntilEnd < 0) daysUntilEnd += 7;
  // If today IS the end day, daysUntilEnd = 0 → period ends today
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + daysUntilEnd);
  const y = endDate.getFullYear();
  const m = String(endDate.getMonth() + 1).padStart(2, "0");
  const d = String(endDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
