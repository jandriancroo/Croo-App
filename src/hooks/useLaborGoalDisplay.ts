import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LaborGoalDisplay { day: number | null; weekly: number | null }

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Goal numbers only (punch tablet + shift managers+). Never throws; null when unavailable. */
export function useLaborGoalDisplay(locationId: string | null | undefined, date: string | null | undefined, enabled = true) {
  const { data } = useQuery({
    queryKey: ['labor-goal-display', locationId, date ?? null],
    enabled: !!locationId && enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LaborGoalDisplay | null> => {
      try {
        const { data, error } = await supabase.rpc('labor_goal_display' as any, { _location_id: locationId, _date: date ?? null });
        if (error || !data) {
          if (error) console.warn('[labor_goal_display]', error.message);
          return null;
        }
        const d = data as any;
        return { day: num(d.day), weekly: num(d.weekly) };
      } catch (e) {
        console.warn('[labor_goal_display]', e);
        return null;
      }
    },
  });
  return data ?? null;
}
