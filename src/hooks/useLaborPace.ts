import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Labor pace ("if the rest of today goes as scheduled, where will labor
 * end up?"). Plain read of the server function get_labor_pace — no math
 * here. Polls every 60 s while the tab is visible. On null/error, screens show "—".
 */
export type LaborPaceMode = 'live' | 'schedule_only' | 'unavailable';
export type LaborPaceState =
  | 'working' | 'over_schedule' | 'unscheduled' | 'late_not_in' | 'not_started' | 'scheduled' | 'done';

export interface LaborPaceShift {
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_in: string | null;
  actual_out: string | null;
  state: LaborPaceState;
  late_minutes: number;
  early_out_minutes: number;
  remaining_hours: number;
  on_break: boolean;
  end_from_template: boolean | null;
  break_deducted_minutes: number;
}

export interface LaborPacePerson {
  user_id: string;
  name: string | null;
  state: LaborPaceState | null;
  on_break: boolean;
  worked_hours: number;
  remaining_hours: number;
  wage_missing: boolean;
  shifts: LaborPaceShift[];
}

export interface LaborPace {
  location_id: string;
  business_date: string;
  source: string | null;
  timezone: string;
  mode: LaborPaceMode;
  as_of?: string | null;
  computed_at?: string;
  worked_hours?: number | null;
  worked_labor_dollars?: number | null;
  remaining_scheduled_hours?: number;
  remaining_labor_dollars?: number;
  pace_hours?: number;
  pace_labor_dollars?: number;
  sales_pace?: number | null;
  sales_pace_source?: 'pace' | 'goal' | null;
  pace_labor_pct?: number | null;
  target_labor_pct?: number | null;
  target_labor_dollars?: number | null;
  variance_pct?: number | null;
  status?: 'ahead' | 'on_track' | 'behind' | null;
  wage_missing_count?: number;
  unscheduled_count?: number;
  late_not_in_count?: number;
  over_schedule_count?: number;
  on_break_count?: number;
  late_minutes?: number;
  early_out_minutes?: number;
  break_deducted_minutes?: number;
  on_track_band_pct?: number;
  people?: LaborPacePerson[];
}

function useTabVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

export function useLaborPace(locationId: string | null | undefined, date?: string | null, enabled = true) {
  const visible = useTabVisible();
  return useQuery({
    queryKey: ['labor-pace', locationId ?? null, date ?? null],
    enabled: !!locationId && enabled,
    retry: false,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<LaborPace | null> => {
      const { data, error } = await supabase.rpc('get_labor_pace' as any, {
        _location_id: locationId,
        ...(date ? { _date: date } : {}),
      });
      if (error) {
        console.warn('[get_labor_pace]', error.message);
        return null;
      }
      return (data as unknown as LaborPace) ?? null;
    },
  });
}

/** Display helper: "—" for null/undefined (never 0). */
export function fmtPace(v: number | null | undefined, suffix = ''): string {
  return v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toLocaleString()}${suffix}`;
}
