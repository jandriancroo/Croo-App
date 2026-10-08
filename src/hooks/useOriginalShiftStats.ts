import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';

export type OriginalShiftOutcome = 'kept' | 'gave_away' | 'moved_off' | 'removed';

export interface OriginalShiftDetail {
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  outcome: OriginalShiftOutcome;
  to_user_name: string | null;
  changed_by_name: string | null;
  changed_at: string | null;
}

export interface OriginalShiftStats {
  og_shifts: number;
  kept: number;
  gave_away: number;
  moved_off: number;
  removed: number;
  details: OriginalShiftDetail[];
}

const EMPTY: OriginalShiftStats = { og_shifts: 0, kept: 0, gave_away: 0, moved_off: 0, removed: 0, details: [] };

/** The ONE caller of original_shift_changes. Range: today−90 days → today+21 days (store-local LA). */
export function useOriginalShiftStats(userId: string | null | undefined, locationId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['original-shift-stats', locationId, userId],
    enabled: enabled && !!userId && !!locationId,
    staleTime: 60_000,
    queryFn: async (): Promise<OriginalShiftStats> => {
      const today = DateTime.now().setZone('America/Los_Angeles').startOf('day');
      const { data, error } = await supabase.rpc('original_shift_changes', {
        _location_id: locationId!,
        _from: today.minus({ days: 90 }).toFormat('yyyy-MM-dd'),
        _to: today.plus({ days: 21 }).toFormat('yyyy-MM-dd'),
        _user_id: userId!,
      });
      if (error) throw error;
      const row = (data as any[] | null)?.[0];
      if (!row) return EMPTY;
      return { ...row, details: (row.details ?? []) as OriginalShiftDetail[] };
    },
  });
}
