import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShiftFlagRow } from '@/lib/timeTracking/shiftFlags';

async function fetchOne(locationId: string, start: string, end: string): Promise<ShiftFlagRow[]> {
  const { data, error } = await supabase.rpc('shift_flags' as any, { _location_id: locationId, _start: start, _end: end });
  if (error) throw error;
  return ((data as any[]) || []) as ShiftFlagRow[];
}

/** Server shift flags for one store (or several, merged) over a date range. */
export function useShiftFlags(locationId: string | string[] | undefined | null, start: string | undefined | null, end: string | undefined | null) {
  const ids = (Array.isArray(locationId) ? locationId : locationId ? [locationId] : []).filter(Boolean);
  return useQuery({
    queryKey: ['shift-flags', ids.length === 1 ? ids[0] : ids.slice().sort().join(','), start, end],
    enabled: ids.length > 0 && !!start && !!end,
    queryFn: async () => {
      const parts = await Promise.all(ids.map((id) => fetchOne(id, start!, end!)));
      return parts.flat();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export const invalidateShiftFlags = (qc: QueryClient) => qc.invalidateQueries({ queryKey: ['shift-flags'] });
