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
  timezone?: string
): Promise<{ date: string; hours: number; cost: number }> => {
  let zone = timezone;
  if (!zone && locationId) {
    const { data } = await supabase
      .from('locations')
      .select('timezone')
      .eq('id', locationId)
      .maybeSingle();
    zone = (data as any)?.timezone || 'America/Los_Angeles';
  }
  zone = zone || 'America/Los_Angeles';
  const today = getDateInTimezone(new Date(), zone);
  const empty = { date: today, hours: 0, cost: 0 };
  if (!locationId) return empty;
  const timezoneResolved = zone;

  // Widen a day on each side so overnight shifts bucket correctly.
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
    const { data: wageRows } = await supabase.rpc('get_current_wages_batch', {
      p_user_ids: userIds,
    });
    ((wageRows as any[]) || []).forEach((row: any) => {
      if (row.hourly_wage != null) wageByUserId.set(row.user_id, Number(row.hourly_wage));
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
