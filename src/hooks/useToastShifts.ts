import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Read-only Toast punch/shift rows (written by the toast-sync robot from
// Toast's GetShiftsV2 feed). Toast owns the punches — these are for display
// and pairing only; nothing here is editable in CrooHQ.
export interface ToastShiftRow {
  id: string;
  location_id: string;
  toast_shift_id: string;
  shift_date: string;
  employee_name: string;
  toast_user_id: string | null;
  restaurant_user_id: string | null;
  external_employee_id: string | null;
  status: string;
  in_time: string;
  out_time: string | null;
  breaks: unknown; // jsonb; shape { start, end }[] at runtime
  missed_breaks: unknown;
  job_title: string | null;
  is_tipped: boolean;
  tips: number;
  payable_seconds: number;
  overtime_seconds: number;
  unpaid_break_seconds: number;
  anomaly_count: number;
  croo_user_id: string | null;
  croo_scheduled_shift_id: string | null;
}

export function useToastShifts(
  locationId: string | null | undefined,
  dateStr: string | null | undefined,
  opts: { refetchMs?: number } = {},
) {
  return useQuery<ToastShiftRow[]>({
    queryKey: ['toast-shifts', locationId, dateStr],
    queryFn: async () => {
      if (!locationId || !dateStr) return [];
      const { data, error } = await supabase
        .from('toast_shifts')
        .select('*')
        .eq('location_id', locationId)
        .eq('shift_date', dateStr)
        .order('in_time', { ascending: true });
      if (error) throw error;
      return (data || []) as ToastShiftRow[];
    },
    enabled: !!locationId && !!dateStr,
    staleTime: 30 * 1000,
    refetchInterval: opts.refetchMs ?? false,
  });
}
