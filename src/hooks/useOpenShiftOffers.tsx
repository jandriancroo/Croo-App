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

const KEY = (locationId: string | null) => ['open-shift-offers', locationId];

/**
 * Open/active shift offers scoped to the current location, joined through
 * scheduled_shifts → schedules to resolve location. Used to render shift
 * swap requests as pinned feed posts (Phase 1 wraps ShiftOfferMessage verbatim).
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
        .in('status', ['open', 'pending'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      if (!offers?.length) return [];

      const shiftIds = Array.from(new Set(offers.map(o => o.shift_id).filter(Boolean)));
      if (!shiftIds.length) return [];

      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('id, schedule_id, shift_date')
        .in('id', shiftIds);
      if (!shifts?.length) return [];

      const scheduleIds = Array.from(new Set(shifts.map((s: any) => s.schedule_id).filter(Boolean)));
      const { data: schedules } = await supabase
        .from('schedules')
        .select('id, location_id')
        .in('id', scheduleIds);

      const scheduleLocMap = new Map<string, string>();
      (schedules ?? []).forEach((s: any) => scheduleLocMap.set(s.id, s.location_id));

      const shiftMap = new Map<string, { schedule_id: string; shift_date: string | null }>();
      shifts.forEach((s: any) => shiftMap.set(s.id, { schedule_id: s.schedule_id, shift_date: s.shift_date }));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return offers
        .map(o => {
          const shift = shiftMap.get(o.shift_id);
          if (!shift) return null;
          const locId = scheduleLocMap.get(shift.schedule_id);
          if (locId !== locationId) return null;
          // Drop offers whose shift date has passed
          if (shift.shift_date) {
            const d = new Date(shift.shift_date + 'T00:00:00');
            if (d < today) return null;
          }
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
