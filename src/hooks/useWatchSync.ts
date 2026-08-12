import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DateTime } from 'luxon';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getDisplayName } from '@/utils/displayName';
import { METRIC_CONFIGS, type MetricType, type SalesDataForWidgets } from '@/components/dashboard/DashboardWidget';
import { formatWatchValue, resolveWatchMetricValue } from '@/utils/watchMetrics';
import { isWatchBridgeAvailable, pushWatchSnapshot, type WatchCube, type WatchPayload, type WatchShift } from '@/lib/watchBridge';

interface CubeLike {
  id: string;
  title?: string;
  accentColor?: string;
  cubeType?: string;
  metrics?: MetricType[];
  faceMetrics?: MetricType[][];
  faceTitles?: string[];
  numFaces?: number;
  hiddenForSelf?: boolean;
  hiddenForLocation?: boolean;
}

function toWatchMetrics(metrics: MetricType[] | undefined, salesData: SalesDataForWidgets | null) {
  return (metrics || [])
    .filter(m => METRIC_CONFIGS[m])
    .map(m => {
      const cfg = METRIC_CONFIGS[m];
      return {
        label: cfg.shortLabel || cfg.label,
        value: formatWatchValue(resolveWatchMetricValue(m, salesData), cfg.format),
      };
    });
}

const SALES_SUMMARY_METRICS: MetricType[] = [
  'sales_today',
  'sales_pace',
  'sales_projected_today',
  'sales_last_year_day',
  'guest_count_today',
  'avg_ticket',
  'labor_percent_today',
  'labor_hours_today',
  'sales_wtd',
  'sales_mtd',
];

/**
 * Mirrors the phone dashboard (Data Cubes, today's schedule, sales summary)
 * onto the Apple Watch. Read-only: it never mutates cube config or any data.
 */
export function useWatchSync(cubes: CubeLike[], salesData: SalesDataForWidgets | null) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const timezone = useLocationTimezone();
  const lastSentRef = useRef<string>('');

  const enabled = isWatchBridgeAvailable() && !!currentLocation?.id;

  const todayStr = DateTime.now()
    .setZone(timezone || 'America/Los_Angeles')
    .toFormat('yyyy-MM-dd');

  const { data: schedule = [] } = useQuery({
    queryKey: ['watch-today-schedule', currentLocation?.id, todayStr],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    queryFn: async (): Promise<WatchShift[]> => {
      const { data, error } = await supabase
        .from('scheduled_shifts')
        .select('id, user_id, position, start_time, end_time, schedule:schedules!inner(is_published, location_id), template:shift_templates(name, start_time, end_time)')
        .eq('shift_date', todayStr)
        .eq('schedule.location_id', currentLocation!.id)
        .eq('schedule.is_published', true);

      if (error || !data) return [];

      const userIds = [...new Set(data.map((s: any) => s.user_id).filter(Boolean))];
      const profileMap = new Map<string, any>();
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', userIds);
        (profiles || []).forEach(p => profileMap.set(p.id, p));
      }

      const fmt = (t?: string | null) => {
        if (!t) return '';
        const dt = DateTime.fromFormat(t.slice(0, 5), 'HH:mm');
        return dt.isValid ? dt.toFormat('h:mma').replace(':00', '').toLowerCase() : t;
      };

      return (data as any[])
        .map(s => {
          const start = s.start_time || s.template?.start_time;
          const end = s.end_time || s.template?.end_time;
          const profile = profileMap.get(s.user_id);
          return {
            id: s.id,
            name: getDisplayName(profile?.full_name, profile?.nickname) || 'Open Shift',
            role: s.position || s.template?.name || '',
            time: [fmt(start), fmt(end)].filter(Boolean).join(' – '),
            isMe: !!user?.id && s.user_id === user.id,
            _sort: start || '',
          };
        })
        .sort((a, b) => String(a._sort).localeCompare(String(b._sort)))
        .map(({ _sort, ...rest }) => rest as WatchShift);
    },
  });

  const payload: WatchPayload | null = useMemo(() => {
    if (!enabled) return null;

    const watchCubes: WatchCube[] = cubes
      .filter(c => (c.cubeType === 'data' || c.cubeType === 'data-3d') && !c.hiddenForSelf && !c.hiddenForLocation)
      .map(c => {
        const faces: WatchCube['faces'] =
          c.cubeType === 'data-3d' && c.faceMetrics?.length
            ? c.faceMetrics
                .slice(0, c.numFaces || c.faceMetrics.length)
                .map((metrics, i) => ({
                  title: c.faceTitles?.[i] || `Face ${i + 1}`,
                  metrics: toWatchMetrics(metrics, salesData),
                }))
                .filter(f => f.metrics.length > 0)
            : [{ title: c.title || 'Cube', metrics: toWatchMetrics(c.metrics, salesData) }];

        return {
          id: c.id,
          title: c.title || 'Cube',
          accentColor: c.accentColor || '#8B5CF6',
          faces,
        };
      })
      .filter(c => c.faces.length > 0);

    return {
      updatedAt: new Date().toISOString(),
      locationName: currentLocation?.name || '',
      cubes: watchCubes,
      schedule,
      sales: toWatchMetrics(SALES_SUMMARY_METRICS, salesData),
    };
  }, [enabled, cubes, salesData, schedule, currentLocation?.name]);

  useEffect(() => {
    if (!payload) return;
    // Ignore the timestamp when deciding whether anything actually changed.
    const { updatedAt, ...comparable } = payload;
    const fingerprint = JSON.stringify(comparable);
    if (fingerprint === lastSentRef.current) return;
    lastSentRef.current = fingerprint;
    void pushWatchSnapshot(payload);
  }, [payload]);
}
