import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { MealRules } from '@/utils/shiftUtils';

export interface ScheduleLaborRules extends MealRules {
  daily_overtime_threshold: number | null;
  daily_double_time_threshold: number | null;
  overtime_multiplier: number | null;
  double_time_multiplier: number | null;
  weekly_overtime_threshold: number | null;
}

/** The ONE schedule read of a store's labor_rules (meal + OT/DT fields). Null = no row. */
export function useScheduleLaborRules(locationId: string | null | undefined) {
  return useQuery({
    queryKey: ['labor-rules-schedule', locationId],
    enabled: !!locationId,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<ScheduleLaborRules | null> => {
      const { data, error } = await supabase
        .from('labor_rules')
        .select('daily_overtime_threshold, daily_double_time_threshold, overtime_multiplier, double_time_multiplier, weekly_overtime_threshold, meal_rule_basis, meal_break_paid, meal_break_hours, meal_break_duration, unpaid_break_min_minutes, second_meal_break_hours')
        .eq('location_id', locationId!)
        .maybeSingle();
      if (error) { console.warn('labor-rules-schedule', error.code, error.message); return null; }
      return (data as ScheduleLaborRules | null) ?? null;
    },
  });
}
