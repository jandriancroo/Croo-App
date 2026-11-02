import { DateTime } from 'npm:luxon@3.7.2';
import { calculateDailyGoal, computeAndSavePace, getHolidayAwareComparison } from './projections.ts';
import { getLocationTimezone, todayInTimezone, weekStartFor } from './weekProjections.ts';
import { getActivePosSource } from './posSources.ts';

export interface SalesDay { sale_date: string; net_sales: number | null }
export interface GoalHistory { windowStart: string; windowEnd: string; sales: Map<string, number> }
export interface GoalRunOptions {
  T: string; tz: string; source: 'tick' | 'manual' | 'ensure'; writePlanning: boolean;
  planningWeekStart?: string; horizonEnd?: string;
  // ensure_living is deliberately narrower than a normal engine run.
  livingStart?: string; onlyNullLiving?: boolean;
}

function localDate(value: string) {
  const date = DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'America/Los_Angeles' });
  if (!date.isValid || date.toFormat('yyyy-MM-dd') !== value) throw new Error('Invalid local date');
  return date;
}
export function addGoalDays(date: string, days: number): string {
  return localDate(date).plus({ days }).toFormat('yyyy-MM-dd');
}
export function goalHistoryWindow(T: string): { windowStart: string; windowEnd: string } {
  const date = localDate(T);
  // Sunday itself is not finished: strictly-before means seven days earlier.
  const windowEnd = addGoalDays(T, -(date.weekday === 7 ? 7 : date.weekday));
  return { windowStart: addGoalDays(windowEnd, -27), windowEnd };
}
export function goalDates(start: string, end: string): string[] {
  localDate(start); localDate(end);
  const dates: string[] = [];
  for (let date = start; date <= end; date = addGoalDays(date, 1)) dates.push(date);
  return dates;
}
export function defaultGoalHorizon(T: string): string {
  const nextSunday = addGoalDays(weekStartFor(T), 13);
  const monthEnd = localDate(T).endOf('month').toFormat('yyyy-MM-dd');
  return nextSunday > monthEnd ? nextSunday : monthEnd;
}
export function goalForDate(D: string, locationId: string, history: GoalHistory): number {
  const weekday = localDate(D).weekday;
  const values = goalDates(history.windowStart, history.windowEnd)
    .filter(date => localDate(date).weekday === weekday)
    .map(date => history.sales.get(date) ?? 0).filter(sales => sales > 0);
  const dowAverage = values.length ? values.reduce((sum, sales) => sum + sales, 0) / values.length : 0;
  const lyDate = addGoalDays(D, -364);
  const holiday = getHolidayAwareComparison(D, lyDate);
  // Keep the existing same-holiday LY replacement, not just its weighting.
  const comparison = holiday.comparisonDate ?? lyDate;
  const ly = history.sales.get(comparison) ?? 0;
  return calculateDailyGoal(D, locationId, dowAverage, ly, holiday.lastYearWeight);
}
export function currentWeekAdjustment(T: string, rows: SalesDay[], goals: Map<string, number>): number {
  const weekStart = weekStartFor(T);
  const finished = rows.filter(row => row.sale_date >= weekStart && row.sale_date < T
    && Number(row.net_sales) > 0 && (goals.get(row.sale_date) ?? 0) > 0);
  if (!finished.length) return 1;
  const actual = finished.reduce((sum, row) => sum + Number(row.net_sales), 0);
  const target = finished.reduce((sum, row) => sum + (goals.get(row.sale_date) ?? 0), 0);
  return Math.max(0.8, Math.min(1.2, actual / target));
}
export function livingGoal(D: string, T: string, goal: number, adjustment: number): number {
  return Math.round(goal * (D >= T && D <= addGoalDays(weekStartFor(T), 6) ? adjustment : 1));
}
export async function loadGoalHistory(supabase: any, locationId: string, T: string, targets: string[]): Promise<GoalHistory> {
  const window = goalHistoryWindow(T);
  const dates = new Set(goalDates(window.windowStart, window.windowEnd));
  for (const target of targets) {
    const lyDate = addGoalDays(target, -364);
    dates.add(lyDate);
    const comparison = getHolidayAwareComparison(target, lyDate).comparisonDate;
    if (comparison) dates.add(comparison);
  }
  const sales = new Map<string, number>();
  // Bounded batches keep arbitrarily distant scheduler requests below API limits.
  const all = [...dates];
  for (let i = 0; i < all.length; i += 200) {
    const { data, error } = await supabase.from('sales_cache').select('sale_date, net_sales')
      .eq('location_id', locationId).in('sale_date', all.slice(i, i + 200));
    if (error) throw new Error(`Goal history: ${error.message}`);
    for (const row of data ?? []) sales.set(row.sale_date, Number(row.net_sales) || 0);
  }
  return { ...window, sales };
}

export async function runGoalEngine(supabase: any, locationId: string, options: GoalRunOptions) {
  const { T, source } = options;
  const tz = options.tz || await getLocationTimezone(supabase, locationId);
  const window = goalHistoryWindow(T);
  let adjustment = 1;
  let daysWritten = 0;
  let wrotePlanning = false;
  const log = async (error: string | null) => {
    const { error: logError } = await supabase.from('goal_engine_runs').upsert({
      location_id: locationId, local_run_date: T, source, ran_at: DateTime.utc().toISO(),
      wrote_planning: wrotePlanning, window_start: window.windowStart, window_end: window.windowEnd,
      week_adj: adjustment, days_written: daysWritten, error,
    }, { onConflict: 'location_id,local_run_date,source' });
    if (logError) throw new Error(`Goal run log: ${logError.message}`);
  };
  try {
    const posSource = await getActivePosSource(supabase, locationId);
    if (!posSource) throw new Error('No active POS for location');
    const start = options.livingStart && options.livingStart > T ? options.livingStart : T;
    const livingDates = goalDates(start, options.horizonEnd ?? defaultGoalHorizon(T));
    const shouldPlan = !options.onlyNullLiving && (options.writePlanning || localDate(T).weekday === 1);
    const planningStart = options.planningWeekStart ?? addGoalDays(weekStartFor(T), 7);
    const planningDates = shouldPlan ? goalDates(planningStart, addGoalDays(planningStart, 6)).filter(date => date >= T) : [];
    const finishedDates = goalDates(weekStartFor(T), addGoalDays(T, -1));
    const targets = [...new Set([...livingDates, ...planningDates, ...finishedDates])];
    const history = await loadGoalHistory(supabase, locationId, T, targets);
    const goals = new Map(targets.map(date => [date, goalForDate(date, locationId, history)]));
    const { data: finished, error: readError } = await supabase.from('sales_cache').select('sale_date, net_sales')
      .eq('location_id', locationId).gte('sale_date', weekStartFor(T)).lt('sale_date', T);
    if (readError) throw new Error(`Finished sales: ${readError.message}`);
    adjustment = currentWeekAdjustment(T, finished ?? [], goals);
    for (const date of livingDates) {
      const value = livingGoal(date, T, goals.get(date) ?? 0, adjustment);
      const row = { location_id: locationId, sale_date: date, pos_source: posSource, living_projection: value };
      if (options.onlyNullLiving) {
        // Atomic insert-ignore + conditional update protects a concurrent writer.
        const { data: inserted, error } = await supabase.from('sales_cache')
          .upsert(row, { onConflict: 'location_id,sale_date', ignoreDuplicates: true }).select('sale_date');
        if (error) throw new Error(`Living insert: ${error.message}`);
        const { data: updated, error: updateError } = await supabase.from('sales_cache')
          .update({ living_projection: value }).eq('location_id', locationId).eq('sale_date', date)
          .is('living_projection', null).select('sale_date');
        if (updateError) throw new Error(`Living fill: ${updateError.message}`);
        daysWritten += (inserted?.length ?? 0) + (updated?.length ?? 0);
      } else {
        const { error } = await supabase.from('sales_cache').upsert(row, { onConflict: 'location_id,sale_date' });
        if (error) throw new Error(`Living write: ${error.message}`);
        daysWritten++;
      }
    }
    for (const date of planningDates) {
      const value = goals.get(date) ?? 0;
      const { data: inserted, error } = await supabase.from('sales_cache').upsert({
        location_id: locationId, sale_date: date, pos_source: posSource, initial_projection: value,
      }, { onConflict: 'location_id,sale_date', ignoreDuplicates: true }).select('sale_date');
      if (error) throw new Error(`Planning insert: ${error.message}`);
      const { data: updated, error: updateError } = await supabase.from('sales_cache')
        .update({ initial_projection: value }).eq('location_id', locationId).eq('sale_date', date)
        .is('initial_projection', null).select('sale_date');
      if (updateError) throw new Error(`Planning fill: ${updateError.message}`);
      if ((inserted?.length ?? 0) + (updated?.length ?? 0) > 0) wrotePlanning = true;
    }
    // ensure must only fill future Living: don't rewrite today's curve/pace.
    if (!options.onlyNullLiving) {
      const { data: hours, error } = await supabase.from('location_settings').select('hours_open, hours_close')
        .eq('location_id', locationId).maybeSingle();
      if (error) throw new Error(`Store hours: ${error.message}`);
      const hour = (value: unknown, fallback: number) => {
        const n = parseInt(String(value ?? '').split(':')[0], 10);
        return Number.isFinite(n) ? n : fallback;
      };
      await computeAndSavePace(supabase, { locationId, date: T, timezone: tz,
        openHour: hour(hours?.hours_open, 10), closeHour: hour(hours?.hours_close, 22) });
    }
    await log(null);
    return { locationId, T, windowStart: window.windowStart, windowEnd: window.windowEnd,
      adjustment, daysWritten, wrotePlanning };
  } catch (error) {
    await log(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function dailyGoalFromCache(supabase: any, locationId: string, targetDate: string): Promise<number> {
  const tz = await getLocationTimezone(supabase, locationId);
  const T = todayInTimezone(tz);
  const history = await loadGoalHistory(supabase, locationId, T, [targetDate]);
  return goalForDate(targetDate, locationId, history);
}

export async function ensureLivingWeek(supabase: any, locationId: string, weekStart: string) {
  localDate(weekStart);
  const tz = await getLocationTimezone(supabase, locationId);
  const T = todayInTimezone(tz);
  if (weekStartFor(weekStart) !== weekStart || weekStart <= weekStartFor(T)) {
    throw new Error('weekStart must be a future Monday');
  }
  return runGoalEngine(supabase, locationId, {
    T, tz, source: 'ensure', writePlanning: false, onlyNullLiving: true,
    livingStart: weekStart, horizonEnd: addGoalDays(weekStart, 6),
  });
}
