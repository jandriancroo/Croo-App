import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

/** Store-local today: date string and the UTC window [start, end). */
export function storeToday(timezone: string) {
  const start = DateTime.now().setZone(timezone).startOf('day');
  return { date: start.toFormat('yyyy-MM-dd'), startIso: start.toUTC().toISO()!, endIso: start.plus({ days: 1 }).toUTC().toISO()! };
}

/**
 * One cheap head-count for a page status line, run with the user's own session
 * (same row rules as the page). Null while loading or on error → title shows the date.
 */
export function useTodayCount(
  kind: 'logbook' | 'applicants',
  locationId: string | null | undefined,
  enabled = true,
) {
  const { timezone } = useLocationTimezone();
  const day = storeToday(timezone);
  const { data } = useQuery({
    queryKey: ['page-status-count', kind, locationId ?? null, day.date],
    enabled: !!locationId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<number | null> => {
      const q = kind === 'logbook'
        ? supabase.from('logbook_entries').select('id', { count: 'exact', head: true })
            .eq('location_id', locationId!).eq('entry_date', day.date)
        : supabase.from('job_applications').select('id', { count: 'exact', head: true })
            .eq('location_id', locationId!).gte('created_at', day.startIso).lt('created_at', day.endIso);
      const { count, error } = await q;
      if (error) { console.warn('[page-status]', kind, error.message); return null; }
      return count ?? 0;
    },
  });
  return data ?? null;
}

/** "3 NEW TODAY" style text with natural zero wording. */
export function countStatus(n: number | null | undefined, one: string, many: string, zero: string): string | undefined {
  if (n == null) return undefined;
  if (n === 0) return zero;
  return `${n} ${n === 1 ? one : many}`;
}
