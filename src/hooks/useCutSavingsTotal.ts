import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Exact, aggregate-only cut savings from the server.
 *
 * Both the phone dashboard and the punch-clock manager overlay call this, so the
 * two surfaces can never disagree. The server validates the plan, prices each
 * eligible cut at that person's real wage, and returns a single row of
 * { total_minutes, est_savings } — never per-person dollars or wages.
 */
export interface CutInput {
  userId: string;
  minutesCut: number;
}

export const useCutSavingsTotal = (locationId: string | undefined, cuts: CutInput[]) => {
  const payload = useMemo(
    () =>
      cuts
        .filter(c => c.minutesCut > 0)
        .map(c => ({ user_id: c.userId, minutes: Math.min(720, Math.round(c.minutesCut)) }))
        .sort((a, b) => a.user_id.localeCompare(b.user_id)),
    [cuts]
  );

  const clientMinutes = useMemo(
    () => payload.reduce((sum, c) => sum + c.minutes, 0),
    [payload]
  );

  const { data } = useQuery({
    queryKey: ['cut-savings-total', locationId, payload],
    enabled: !!locationId && payload.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cut_savings_total', {
        _location_id: locationId!,
        _cuts: payload as any,
      });
      if (error) {
        console.error('[useCutSavingsTotal] get_cut_savings_total failed:', error);
        return null;
      }
      const row = (data as any[])?.[0];
      if (!row) return null;
      return {
        totalMinutes: Number(row.total_minutes) || 0,
        estSavings: Number(row.est_savings) || 0,
      };
    },
  });

  if (payload.length === 0) return { totalMinutes: 0, estSavings: 0 as number | null };
  if (!data) return { totalMinutes: clientMinutes, estSavings: null as number | null };
  return { totalMinutes: data.totalMinutes, estSavings: data.estSavings as number | null };
};
