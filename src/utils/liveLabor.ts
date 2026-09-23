import { supabase } from '@/integrations/supabase/client';
import { getDateInTimezone } from '@/utils/timezoneUtils';

/**
 * Live labor for the current business day, derived from punches.
 *
 * labor_cache only holds CLOSED days (written by the nightly labor service), so
 * anything that needs today's hours/cost (dashboard week/month totals, pay
 * period cards, the punch-clock Manager Dashboard) has to compute it from
 * time_punches. Every surface calls the same server-side aggregate RPC so they
 * can never disagree — and so no per-person wage ever reaches a client.
 */
export const fetchLiveLaborForToday = async (
  locationId: string,
  timezone?: string
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

  // Server-side aggregate (real wages, totals only). This keeps pay rates off
  // the device and gives shift managers and paired punch-clock devices the same
  // Labor $ that managers see.
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
