// Server reads only; pure arithmetic lives in periodMetrics.ts.
import { DateTime } from 'npm:luxon@3';
import { computePace, resolveGoal, storeNow } from './cubeMetrics.ts';
import { periodMetrics, scaleLastYear, comparison, paceStatus } from './periodMetrics.ts';

export const SALES_PERIOD_COLUMNS = 'sale_date, net_sales, guest_count, pizza_count, avg_ticket, override_projection, initial_projection, projected_sales, living_projection, pace_adjusted_projection, pace_calculated_at, hourly_data, payments_data, product_mix';
export function periodBounds(today: string, zone: string) {
  const d = DateTime.fromFormat(today, 'yyyy-MM-dd', { zone });
  if (!d.isValid) throw new Error('Invalid business date');
  const f = (x: any) => x.toFormat('yyyy-MM-dd');
  const week = d.startOf('week'), month = d.startOf('month'), prev = d.minus({ months: 1 });
  return { weekStart: f(week), weekEnd: f(week.plus({ days: 6 })), monthStart: f(month), monthEnd: f(d.endOf('month')),
    priorMonthStart: f(prev.startOf('month')), priorMonthEnd: f(prev.endOf('month')), priorWeekStart: f(week.minus({ days: 7 })), priorWeekEnd: f(week.minus({ days: 1 })), priorDay: f(d.minus({ days: 7 })) };
}
export function periodDates(start: string, end: string, zone: string): string[] {
  const dates: string[] = [];
  for (let d = DateTime.fromFormat(start, 'yyyy-MM-dd', { zone }); d.isValid && d.toFormat('yyyy-MM-dd') <= end && dates.length < 400; d = d.plus({ days: 1 })) dates.push(d.toFormat('yyyy-MM-dd'));
  return dates;
}
const first = (v: any) => Array.isArray(v) ? v[0] : v;
export async function readSalesPeriods(client: any, locationId: string, date?: string) {
  const [tz, bd] = await Promise.all([
    client.from('location_settings').select('timezone').eq('location_id', locationId).maybeSingle(),
    client.rpc('business_date', { _location_id: locationId }),
  ]);
  if (tz.error || bd.error || typeof bd.data !== 'string') throw new Error('Store business date unavailable');
  const zone = tz.data?.timezone || 'America/Los_Angeles', today = bd.data.slice(0, 10), target = date || today;
  const b = periodBounds(target, zone);
  const start = [b.priorMonthStart, b.priorWeekStart, b.priorDay].sort()[0];
  const end = [b.monthEnd, b.weekEnd].sort().pop();
  const [sales, cmp, ly] = await Promise.all([
    client.from('sales_cache').select(SALES_PERIOD_COLUMNS).eq('location_id', locationId).gte('sale_date', start).lte('sale_date', end).order('sale_date'),
    client.rpc('get_sales_comparisons', { _location_id: locationId, _date: target }),
    client.rpc('get_sales_ly_totals', { _location_id: locationId, _date: target }),
  ]);
  if (sales.error) throw sales.error;
  const rows = sales.data || [], td = rows.find((r: any) => r.sale_date === today);
  const todayPace = td ? computePace({ ...td, nowInStoreTz: storeNow(zone) }) : null;
  const c = cmp.error ? null : first(cmp.data), totals = ly.error ? null : first(ly.data);
  const atPoint = scaleLastYear(c, storeNow(zone).hour);
  const sum = (a: string, z: string) => {
    const selected = rows.filter((r: any) => r.sale_date >= a && r.sale_date <= z);
    return selected.length ? selected.reduce((s: number, r: any) => s + (Number(r.net_sales) || 0), 0) : null;
  };
  const prev = rows.find((r: any) => r.sale_date === b.priorDay);
  let priorDay = prev?.net_sales == null ? null : Number(prev.net_sales);
  if (target === today && Array.isArray(prev?.hourly_data) && prev.hourly_data.length) {
    priorDay = prev.hourly_data.reduce((s: number, h: any) => parseInt(String(h.hour).split(':')[0], 10) <= storeNow(zone).hour ? s + (Number(h.sales) || 0) : s, 0);
  }
  const ranges = { day: [target, target], week: [b.weekStart, b.weekEnd], month: [b.monthStart, b.monthEnd] };
  const periods: any = {};
  for (const [name, [a, z]] of Object.entries(ranges)) {
    const metrics = periodMetrics(rows, periodDates(a, z, zone), today, todayPace);
    if (name === 'day') {
      const row = rows.find((r: any) => r.sale_date === target);
      metrics.goal = resolveGoal(row) ?? 0;
      metrics.pace = target === today ? todayPace ?? 0 : 0;
      metrics.delta = metrics.pace - metrics.goal;
      metrics.goal_percent = metrics.goal > 0 ? metrics.pace / metrics.goal * 100 : null;
      metrics.status = paceStatus(metrics.sales, metrics.pace, metrics.goal, target === today);
    }
    const full = totals?.[name === 'day' ? 'ly_day_total' : name === 'week' ? 'ly_week_total' : 'ly_month_total'] ?? null;
    const prior = name === 'day' ? priorDay : name === 'week' ? sum(b.priorWeekStart, b.priorWeekEnd) : sum(b.priorMonthStart, b.priorMonthEnd);
    periods[name] = { ...metrics, start: a, end: z, ly_at_point: atPoint[name], ly_scaled_to_hour: atPoint.scaled,
      ly_full_period: full == null ? null : Number(full), prior_period: prior,
      actual_vs_ly: comparison(metrics.sales, atPoint[name]), actual_vs_prior: comparison(metrics.sales, prior),
      pace_vs_last_year: metrics.pace > 0 && Number(full) > 0 ? comparison(metrics.pace, Number(full)) : null };
  }
  return { today, target, zone, bounds: b, rows, periods, todayPace };
}
export function salesPeriodLines(snapshot: Awaited<ReturnType<typeof readSalesPeriods>>) {
  return Object.entries(snapshot.periods).map(([name, values]) => `${name === 'day' ? 'Today' : name === 'week' ? 'Week (WTD sales, full-week goal/pace)' : 'Month (MTD sales, full-month goal/pace)'} dashboard metrics: ${JSON.stringify(values)}`).join('\n');
}