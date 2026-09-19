import { supabase } from '@/integrations/supabase/client';
import { bucketPunchesByUserAndDay } from '@/utils/payrollDayBucketing';
import { calculateDayHours } from '@/utils/payrollCalculations';
import { calculateCutoffHour, getDateInTimezone } from '@/utils/timezoneUtils';

/**
 * Live labor for the current business day, derived from punches.
 *
 * labor_cache only holds CLOSED days (written by the nightly labor service), so
 * anything that needs today's hours/cost (dashboard week/month totals, pay
 * period cards) has to compute it from time_punches. Both surfaces call this so
 * they can never disagree.
 */
export const fetchLiveLaborForToday = async (
  locationId: string,
  timezone?: string,
  /**
   * `wageSource: 'kiosk'` resolves wages through the `kiosk-wages` edge
   * function instead of get_current_wages_batch. Required on the punch-clock
   * Manager Dashboard: a paired device session has no manager role, so the RPC
   * masks every wage to a flat default and labor dollars come out inflated.
   */
  opts?: { wageSource?: 'rpc' | 'kiosk' }
): Promise<{ date: string; hours: number; cost: number }> => {
  let zone = timezone;
  if (!zone && locationId) {
    const { data } = await supabase
      .from('location_settings')
      .select('timezone')
      .eq('location_id', locationId)
      .maybeSingle();
    zone = (data as any)?.timezone || 'America/Los_Angeles';

  }
  zone = zone || 'America/Los_Angeles';
  const today = getDateInTimezone(new Date(), zone);
  const empty = { date: today, hours: 0, cost: 0 };
  if (!locationId) return empty;
  const timezoneResolved = zone;

  // Default path: server-side aggregate (real wages, totals only). This keeps
  // pay rates off the device and gives shift managers the same Labor $ that
  // managers see. Only the punch-clock kiosk path resolves wages client-side.
  if (opts?.wageSource !== 'kiosk') {
    const { data, error } = await supabase.rpc('get_live_labor_totals', {
      _location_id: locationId,
      _date: today,
    });
    if (error) {
      console.error('[liveLabor] get_live_labor_totals failed:', error);
      return empty;
    }
    const row = (data as any[])?.[0];
    return { date: today, hours: Number(row?.hours) || 0, cost: Number(row?.cost) || 0 };
  }

  // Kiosk path (paired punch-clock device): resolve wages via kiosk-wages and
  // bucket punches locally so the overlay math works without a user role.
  const start = new Date(`${today}T00:00:00Z`);
  start.setDate(start.getDate() - 1);
  const end = new Date(`${today}T00:00:00Z`);
  end.setDate(end.getDate() + 2);

  const [punchRes, hoursRes] = await Promise.all([
    supabase
      .from('time_punches')
      .select('id, user_id, punch_type, punch_time, notes')
      .eq('location_id', locationId)
      .gte('punch_time', start.toISOString())
      .lte('punch_time', end.toISOString())
      .order('punch_time', { ascending: true }),
    supabase
      .from('location_hours')
      .select('day_of_week, close_time')
      .eq('location_id', locationId),
  ]);

  const punches = (punchRes.data as any[]) || [];
  if (punches.length === 0) return empty;

  const cutoffByDayOfWeek = new Map<number, number>();
  ((hoursRes.data as any[]) || []).forEach((h: any) => {
    cutoffByDayOfWeek.set(h.day_of_week, calculateCutoffHour(h.close_time));
  });

  const userIds = [...new Set(punches.map((p: any) => p.user_id))] as string[];
  const wageByUserId = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: res } = await supabase.functions.invoke('kiosk-wages', {
      body: { location_id: locationId, user_ids: userIds, date: today },
    });
    ((res as any)?.wages || []).forEach((w: any) => {
      if (w.hourly_wage != null) wageByUserId.set(w.user_id, Number(w.hourly_wage));
    });
  }

  let hours = 0;
  let cost = 0;
  const bucketed = bucketPunchesByUserAndDay(punches as any[], timezoneResolved, cutoffByDayOfWeek, 5);
  bucketed.forEach((daysForUser, userId) => {
    const wage = wageByUserId.get(userId) ?? 15;
    const dayPunches = (daysForUser as any)[today];
    if (!dayPunches) return;
    const dayHours = calculateDayHours(dayPunches as any[], true);
    if (!(dayHours > 0)) return;
    hours += dayHours;
    cost += dayHours * wage;
  });

  return { date: today, hours, cost };
};

/**
 * Read-only actual labor for CLOSED business days, derived straight from punches.
 *
 * labor_cache is the authoritative store (written by the nightly labor service),
 * but a missed nightly run leaves a 0-hour row behind. Week views call this to
 * fill only those gaps — it never writes to labor_cache.
 */
export const fetchActualLaborForDates = async (
  locationId: string,
  timezone: string,
  dates: string[]
): Promise<Record<string, { hours: number; cost: number }>> => {
  const result: Record<string, { hours: number; cost: number }> = {};
  if (!locationId || dates.length === 0) return result;

  // Server-side aggregate with real wages — totals only, no pay rates on the
  // device. Same math for every role, so week views agree across phones.
  const { data, error } = await supabase.rpc('get_labor_totals_for_dates', {
    _location_id: locationId,
    _dates: [...dates].sort(),
  });
  if (error) {
    console.error('[liveLabor] get_labor_totals_for_dates failed:', error);
    return result;
  }
  ((data as any[]) || []).forEach((row: any) => {
    const hours = Number(row.hours) || 0;
    const cost = Number(row.cost) || 0;
    if (hours > 0 || cost > 0) result[row.date] = { hours, cost };
  });
  return result;
};
