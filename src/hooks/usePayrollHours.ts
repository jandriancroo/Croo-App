import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** One row per employee from the server payroll_hours function (state-correct Reg/OT/DT). */
export interface PayrollHoursRow {
  user_id: string;
  full_name: string | null;
  wage: number | null;
  wage_missing: boolean;
  regular_hours: number;
  ot_hours: number;
  dt_hours: number;
  pto_hours: number;
  total_paid_hours: number;
  open_shift_count: number;
  weeks: unknown;
}

export function usePayrollHours(locationId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: ['payroll-hours', locationId, start, end],
    enabled: !!locationId && !!start && !!end,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    queryFn: async (): Promise<PayrollHoursRow[]> => {
      const { data, error } = await (supabase.rpc as any)('payroll_hours', {
        _location_id: locationId,
        _start: start,
        _end: end,
      });
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        wage: r.wage == null ? null : Number(r.wage),
        regular_hours: Number(r.regular_hours) || 0,
        ot_hours: Number(r.ot_hours) || 0,
        dt_hours: Number(r.dt_hours) || 0,
        pto_hours: Number(r.pto_hours) || 0,
        total_paid_hours: Number(r.total_paid_hours) || 0,
        open_shift_count: Number(r.open_shift_count) || 0,
      }));
    },
  });
}
