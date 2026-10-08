import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useScheduleLaborRules } from '@/hooks/useScheduleLaborRules';
import { DEFAULT_WAGE, weekLaborCost, type PayShift } from '@/utils/laborCost';

interface WageShift extends PayShift { id: string }
interface WageProfile { id: string; hourly_wage?: number | null }

/**
 * The ONE client read of scheduled pay: per-shift wage (wage on the shift date -> profile -> $15)
 * plus the store's rules, fed through weekLaborCost. Pass the WEEK's shifts.
 */
export function useWeekLaborCost(shifts: WageShift[], profiles: WageProfile[], locationId: string | null | undefined) {
  const { data: rules } = useScheduleLaborRules(locationId);
  const pairs = useMemo(() => {
    const set = new Set<string>();
    for (const s of shifts) if (s.user_id) set.add(`${s.user_id}|${s.shift_date}`);
    return [...set].sort();
  }, [shifts]);

  const { data: wageMap = {}, isLoading } = useQuery({
    queryKey: ['shift-wages', pairs.join(',')],
    enabled: pairs.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const out: Record<string, number> = {};
      await Promise.all(pairs.map(async (k) => {
        const [uid, date] = k.split('|');
        const { data, error } = await supabase.rpc('get_current_wage', { p_user_id: uid, p_date: date });
        if (!error && data != null) out[k] = Number(data);
      }));
      return out;
    },
  });

  const wageFor = (userId: string | null | undefined, date: string): number => {
    if (!userId) return DEFAULT_WAGE;
    return wageMap[`${userId}|${date}`] ?? profiles.find((p) => p.id === userId)?.hourly_wage ?? DEFAULT_WAGE;
  };

  const pay = useMemo(
    () => weekLaborCost(shifts.map((s) => ({ ...s, wage: wageFor(s.user_id, s.shift_date) })), rules ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shifts, profiles, wageMap, rules],
  );

  return { pay, rules: rules ?? null, wageFor, isLoadingWages: isLoading };
}
