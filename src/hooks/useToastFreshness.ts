import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';

const STALE_MIN = 10;

/**
 * For Toast stores: is live Toast data late right now?
 * Only flags "delayed" during the robot's working window (30 min before open →
 * 2 h after close, in the store's own time zone). Non-Toast stores → never stale.
 */
export function useToastFreshness(locationId?: string | null) {
  const { data } = useQuery({
    queryKey: ['toast-freshness', locationId],
    enabled: !!locationId,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data: last } = await supabase
        .from('toast_sales_cache')
        .select('fetched_at')
        .eq('location_id', locationId!)
        .eq('data_source', 'live')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last?.fetched_at) return null; // not a Toast store (or no access)
      const [{ data: settings }, { data: hours }] = await Promise.all([
        supabase.from('location_settings').select('timezone').eq('location_id', locationId!).maybeSingle(),
        supabase.from('location_hours').select('day_of_week, open_time, close_time, is_closed').eq('location_id', locationId!),
      ]);
      return { lastAt: last.fetched_at as string, tz: (settings as any)?.timezone || 'America/Los_Angeles', hours: (hours || []) as any[] };
    },
  });

  if (!data) return { isDelayed: false, lastLabel: null as string | null };
  const now = DateTime.now().setZone(data.tz);
  const dow = now.weekday % 7; // luxon Mon=1..Sun=7 → Sun=0
  const day = data.hours.find((h) => h.day_of_week === dow);
  const toMin = (t: string) => parseInt(String(t).slice(0, 2), 10) * 60 + parseInt(String(t).slice(3, 5), 10);
  const nowMin = now.hour * 60 + now.minute;
  const inWindow = !!day && !day.is_closed && nowMin >= toMin(day.open_time) - 30 + STALE_MIN && nowMin <= toMin(day.close_time) + 120;
  const last = DateTime.fromISO(data.lastAt).setZone(data.tz);
  const ageMin = now.diff(last, 'minutes').minutes;
  const isDelayed = inWindow && ageMin >= STALE_MIN;
  const lastLabel = last.hasSame(now, 'day') ? last.toFormat('h:mm a') : last.toFormat('LLL d, h:mm a');
  return { isDelayed, lastLabel };
}
