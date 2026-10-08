import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';

/** Same as the server's has_role_or_higher(…, 'manager'): only these see the labor goal. */
const GOAL_ROLES = ['manager', 'general_manager', 'admin', 'org_admin', 'brand_admin', 'super_admin'];

/** Weekday convention: 0 = Monday … 6 = Sunday (same as the Weekly Template). */
export type LaborGoalSource = 'weekly_template' | 'weekly_goal' | 'store_default';

interface LaborGoalsRow {
  weekly: number;
  weekly_source: 'weekly_goal' | 'store_default';
  store_default: number;
  days: Record<string, number | null>;
  template_id: string | null;
  template_name: string | null;
}

export const laborGoalsKey = (locationId: string | null | undefined) => ['labor-goals', locationId] as const;

/** Monday=0 index from a yyyy-MM-dd string (store-local business date). */
export function dowFromDate(date: string): number {
  return DateTime.fromFormat(date, 'yyyy-MM-dd').weekday - 1;
}

/**
 * The ONE client reader/writer of the store's labor goal (lives in the store-goal Weekly Template).
 * Both editors (Weekly Template page + schedule Labor % row) share this query key.
 */
export function useLaborGoals(locationIdOverride?: string | null) {
  const { currentLocation } = useLocation();
  const locationId = locationIdOverride ?? currentLocation?.id ?? null;
  const qc = useQueryClient();
  const { role } = useUserRole();
  const canSee = !!role && GOAL_ROLES.includes(role);

  const query = useQuery({
    queryKey: laborGoalsKey(locationId),
    enabled: !!locationId && canSee,
    staleTime: 60_000,
    queryFn: async (): Promise<LaborGoalsRow | null> => {
      const { data, error } = await supabase.rpc('labor_goals' as any, { _location_id: locationId });
      if (error) throw error;
      return (data as unknown as LaborGoalsRow) ?? null;
    },
  });

  // No goal for staff (server returns NULL): never fall back to a made-up number.
  const g = canSee ? query.data : null;
  const available = !!g;
  const storeDefault: number | null = g ? (g.store_default ?? null) : null;
  const weekly: number | null = g ? (g.weekly ?? storeDefault) : null;
  const weeklySource: LaborGoalSource = g?.weekly_source ?? 'store_default';

  const dayValue = useCallback((dow: number): number | null => {
    const v = g?.days?.[String(dow)];
    return v == null ? null : Number(v);
  }, [g]);

  const forDow = useCallback((dow: number): number | null => dayValue(dow) ?? weekly, [dayValue, weekly]);
  const sourceForDow = useCallback(
    (dow: number): LaborGoalSource => (dayValue(dow) != null ? 'weekly_template' : weeklySource),
    [dayValue, weeklySource],
  );
  const forDate = useCallback((date: string) => forDow(dowFromDate(date)), [forDow]);

  const mutation = useMutation({
    mutationFn: async ({ dow, pct }: { dow: number | null; pct: number | null }) => {
      const { data, error } = await supabase.rpc('set_labor_goal' as any, {
        _location_id: locationId, _day_of_week: dow, _pct: pct,
      });
      if (error) throw error;
      return data as unknown as LaborGoalsRow;
    },
    onSuccess: (data) => {
      qc.setQueryData(laborGoalsKey(locationId), data);
      qc.invalidateQueries({ queryKey: laborGoalsKey(locationId) });
    },
  });

  const makeStoreGoalTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const { data, error } = await supabase.rpc('set_store_goal_template' as any, { _template_id: templateId });
      if (error) throw error;
      return data as unknown as LaborGoalsRow;
    },
    onSuccess: (data) => qc.setQueryData(laborGoalsKey(locationId), data),
  });

  return {
    loading: query.isLoading,
    /** False for staff or when the store has no goal row: hide goal UI, use neutral colors. */
    available,
    weekly,
    weeklySource,
    storeDefault,
    dayValue,
    forDow,
    forDate,
    sourceForDow,
    source: weeklySource,
    templateId: g?.template_id ?? null,
    templateName: g?.template_name ?? null,
    setGoal: (dow: number | null, pct: number | null) => mutation.mutateAsync({ dow, pct }),
    saving: mutation.isPending,
    makeStoreGoalTemplate: (templateId: string) => makeStoreGoalTemplate.mutateAsync(templateId),
  };
}

export const LABOR_GOAL_SOURCE_LABEL: Record<LaborGoalSource, string> = {
  weekly_template: 'Weekly Template',
  weekly_goal: 'weekly goal',
  store_default: 'store default',
};

/** ≤ goal green, ≤ goal+3 yellow, above red. */
export function laborGoalTone(pct: number, goal: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (goal == null) return 'neutral';
  if (pct <= goal) return 'good';
  if (pct <= goal + 3) return 'warn';
  return 'bad';
}
