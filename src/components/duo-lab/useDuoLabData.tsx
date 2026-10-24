import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { useLaborPace } from '@/hooks/useLaborPace';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { useChecklistCompletion } from '@/hooks/useChecklistCompletion';
import { useTrainingAssignments } from '@/hooks/useTrainingAssignments';
import { groupTrainingAssignments } from '@/components/dashboard/TrainingAssignmentsSection';
import { getDayOfWeekInTimezone, getBusinessDateInTimezone } from '@/utils/timezoneUtils';
import { checklistShowsOn } from '@/lib/taskHistory/schedule';
import type { SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';

/**
 * Read-only data for the Duo Design Lab. Uses the same query keys as the Dash
 * so it shares cached data instead of making new requests.
 */
export function useDuoLabData() {
  const { currentLocation } = useAppLocation();
  const { getTodayInTimezone, timezone } = useLocationTimezone();
  const { user } = useAuth();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const queryClient = useQueryClient();
  const locId = currentLocation?.id;

  const { data: sales = null } = useQuery<SalesDataForWidgets | null>({
    queryKey: ['dashboard-sales-enriched', locId, getBusinessDateInTimezone()],
    queryFn: () => queryClient.getQueryData(['dashboard-sales-enriched', locId, getBusinessDateInTimezone()]) ?? null,
    enabled: !!locId,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: laborPace } = useLaborPace(locId);

  const { data: locationSettings } = useQuery({
    queryKey: ['location-hours-today', locId, timezone],
    staleTime: 10 * 60 * 1000,
    enabled: !!locId,
    queryFn: async () => {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date());
      const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const { data } = await supabase
        .from('location_hours')
        .select('open_time, close_time, is_closed')
        .eq('location_id', locId!)
        .eq('day_of_week', map[weekday] ?? 0)
        .maybeSingle();
      if (!data || data.is_closed) return null;
      return { hours_open: data.open_time, hours_close: data.close_time };
    },
  });

  const { data: checklistData } = useQuery({
    queryKey: ['dashboard-checklists', locId, timezone],
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
    enabled: !!locId,
    queryFn: async () => {
      const currentDay = getDayOfWeekInTimezone(timezone);
      const res = await supabase
        .from('checklists')
        .select('*, checklist_items(id, days_of_week, deleted_at)')
        .eq('is_active', true)
        .neq('template_type', 'training')
        .eq('location_id', locId!)
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      const list = (res.data || []).filter((c: any) => {
        if (c.template_type === 'dynamic') {
          return (c.checklist_items || []).some((i: any) => !i.deleted_at && i.days_of_week?.includes(currentDay));
        }
        return checklistShowsOn(c as any, getTodayInTimezone());
      });
      return { checklists: list as any[] };
    },
  });
  const checklists = checklistData?.checklists || [];
  const { getCompletionData } = useChecklistCompletion(checklists, locId);

  const canApproveTraining = isAdmin || isManager || isShiftManager || isGeneralManager;
  const { data: trainingAssignments = [] } = useTrainingAssignments({ locationId: locId, userId: user?.id, timezone });
  const trainees = useMemo(
    () => groupTrainingAssignments(trainingAssignments, user?.id, canApproveTraining).flatMap(g => g.trainees),
    [trainingAssignments, user?.id, canApproveTraining],
  );
  const trainingTotal = trainees.filter(a => a.expected > 0).length;
  const trainingRemaining = trainees.filter(a => a.expected > 0 && a.completed < a.expected).length;

  const { data: widgets = [] } = useDashboardWidgets(locId);
  const cubes = useMemo(
    () => widgets
      .filter(w => w.cubeType === 'data-3d' && w.faceMetrics && w.numFaces)
      .map(w => ({
        id: w.id,
        title: w.title,
        accentColor: w.accentColor,
        faces: w.faceMetrics!.slice(0, w.numFaces!).map((metrics, i) => ({ metrics, title: w.faceTitles?.[i] || undefined })),
      })),
    [widgets],
  );
  const hasSalesChart = widgets.some(w => w.cubeType === 'sales-chart');

  const { data: logo } = useQuery({
    queryKey: ['duo-lab-logo', locId],
    enabled: !!locId,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const cached = queryClient.getQueryData<any>(['org-logo', locId]);
      if (cached?.logo_url) return cached.logo_url as string;
      const { data: loc } = await supabase.from('locations').select('brand_id').eq('id', locId!).single();
      if (!loc?.brand_id) return null;
      const { data: b } = await supabase.from('brands').select('logo_url').eq('id', loc.brand_id).single();
      return (b?.logo_url as string) ?? null;
    },
  });

  // Same numbers and wording rules as the Dash sentence.
  const pace = laborPace?.sales_pace ?? sales?.projections?.todayPaceAdjusted ?? null;
  const projection = sales?.projections?.todayProjected || null;
  const salesSoFar = sales?.daily ?? null;
  const laborPct = laborPace && laborPace.mode !== 'unavailable' && laborPace.pace_labor_pct != null
    ? Number(laborPace.pace_labor_pct) : null;
  const behind = laborPace?.status === 'behind';

  const sentence = useMemo(() => {
    if (!laborPace) return null;
    const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
    const salesPart = pace != null && pace > 0
      ? (projection ? `You're pacing at ${money(pace)} on a ${money(projection)} projection` : `You're pacing at ${money(pace)} today`)
      : null;
    if (!salesPart && laborPct == null) return null;
    const labor = laborPct != null
      ? <span className={behind ? 'text-warning font-semibold' : undefined}>around {laborPct.toFixed(1)}% labor tonight</span>
      : null;
    if (salesPart && labor) return <>{salesPart}, and it looks like you'll end with {labor}.</>;
    if (salesPart) return <>{salesPart}.</>;
    return <>It looks like you'll end with {labor}.</>;
  }, [laborPace, pace, projection, laborPct, behind]);

  return {
    currentLocation, timezone, locationSettings, sales, laborPace,
    pace, projection, salesSoFar, laborPct, behind, sentence,
    checklists, getCompletionData, trainingTotal, trainingRemaining, canApproveTraining, userId: user?.id,
    cubes, hasSalesChart, logo,
  };
}

export type DuoLabData = ReturnType<typeof useDuoLabData>;
