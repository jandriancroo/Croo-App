import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DAY_KEYS_SUNDAY_FIRST, type WeeklyHours } from "@/types/availability";

/**
 * Store open/close per weekday for a location, used as the edges when migrating
 * legacy "can only work" availability into can't-work blocks.
 */
export function useLocationWeeklyHours(locationId?: string | null) {
  return useQuery({
    queryKey: ["location-weekly-hours", locationId],
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<WeeklyHours> => {
      const { data, error } = await supabase
        .from("location_hours")
        .select("day_of_week, open_time, close_time, is_closed")
        .eq("location_id", locationId as string);

      if (error) throw error;

      const hours: WeeklyHours = {};
      for (const row of data || []) {
        const key = DAY_KEYS_SUNDAY_FIRST[row.day_of_week];
        if (!key || row.is_closed || !row.open_time || !row.close_time) continue;
        hours[key] = {
          open: String(row.open_time).substring(0, 5),
          close: String(row.close_time).substring(0, 5),
        };
      }
      return hours;
    },
  });
}
