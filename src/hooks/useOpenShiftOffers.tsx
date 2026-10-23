import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';

export interface OpenShiftOffer {
  id: string;
  shift_id: string;
  status: string;
  created_at: string;
  shift_date: string | null;
}

/** "YYYY-MM-DD HH:MM" for now in the store's timezone. */
export function storeNowKey(timezone: string, now: Date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
/** Pure: true while the shift's start (store-local) is still ahead of nowKey. */
export function shiftNotStarted(shiftDate: string, startTime: string | null, nowKey: string): boolean {
  return `${shiftDate} ${(startTime || '00:00').slice(0, 5)}` > nowKey;
}

const KEY = (locationId: string | null) => ['open-shift-offers', locationId];

/**
 * Open/active shift offers scoped to the current location, joined through
 * scheduled_shifts → schedules to resolve location. Used to render shift
 * swap requests as pinned feed posts (rendered by src/components/feed/OpenShiftCard.tsx).
 */
export function useOpenShiftOffers() {
  const { currentLocation } = useAppLocation();
  const locationId = currentLocation?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: KEY(locationId),
    enabled: !!locationId,
    queryFn: async (): Promise<OpenShiftOffer[]> => {
      // Grab active offers first (small set), then filter by location via shift → schedule.
      const { data: offers, error } = await supabase
        .from('shift_offers')
        .select('id, shift_id, status, created_at')
        .in('status', ['available', 'claimed', 'approved', 'open', 'pending'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      if (!offers?.length) return [];

      const shiftIds = Array.from(new Set(offers.map(o => o.shift_id).filter(Boolean)));
      if (!shiftIds.length) return [];

      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('id, schedule_id, shift_date, start_time')
        .in('id', shiftIds);
      if (!shifts?.length) return [];

      const scheduleIds = Array.from(new Set(shifts.map((s: any) => s.schedule_id).filter(Boolean)));
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id, location_id')
        .in('id', scheduleIds);

      const scheduleLocMap = new Map<string, string>();
      (schedules ?? []).forEach((s: any) => scheduleLocMap.set(s.id, s.location_id));

      const shiftMap = new Map<string, { schedule_id: string; shift_date: string | null; start_time: string | null }>();
      shifts.forEach((s: any) => shiftMap.set(s.id, { schedule_id: s.schedule_id, shift_date: s.shift_date, start_time: s.start_time }));

      // Store-local "now" (YYYY-MM-DD HH:MM). Past offers stay in the table as history; the feed just hides them.
      const { data: ls } = await supabase.from('location_settings').select('timezone').eq('location_id', locationId!).maybeSingle();
      const nowLocal = storeNowKey(ls?.timezone || 'America/Los_Angeles');

      return offers
        .map(o => {
          const shift = shiftMap.get(o.shift_id);
          if (!shift) return null;
          const locId = scheduleLocMap.get(shift.schedule_id);
          if (locId !== locationId) return null;
          // Only shifts that haven't started yet (store time).
          if (shift.shift_date && !shiftNotStarted(shift.shift_date, shift.start_time, nowLocal)) return null;
          return { id: o.id, shift_id: o.shift_id, status: o.status, created_at: o.created_at, shift_date: shift.shift_date };
        })
        .filter(Boolean) as OpenShiftOffer[];
    },
  });

  useEffect(() => {
    if (!locationId) return;
    const ch = supabase
      .channel(`open-shift-offers-${locationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_offers' }, () => {
        queryClient.invalidateQueries({ queryKey: KEY(locationId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_offer_claims' }, () => {
        queryClient.invalidateQueries({ queryKey: KEY(locationId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [locationId, queryClient]);

  return {
    offers: query.data ?? [],
    isLoading: query.isLoading,
  };
}
