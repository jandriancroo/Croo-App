import { resolveGoal, laborPct, type GoalRow } from './cubeMetrics.ts';

export interface PeriodDay { date: string; sales: number; projected?: number; guestCount?: number }
export interface SalesRow extends GoalRow {
  sale_date: string; net_sales?: number | string | null; guest_count?: number | null;
  pizza_count?: number | null; avg_ticket?: number | string | null;
  payments_data?: unknown; hourly_data?: unknown; product_mix?: unknown;
}
export type PaceStatus = 'ahead' | 'onTrack' | 'behind';
const num = (v: unknown): number => Number(v) || 0;

/** Dashboard breakdown fallback: a day without a saved goal uses its actual sales. */
export function dailyGoal(row: SalesRow | null | undefined): number {
  return resolveGoal(row) ?? num(row?.net_sales);
}
export function periodDays(rows: SalesRow[], dates: string[]): PeriodDay[] {
  const map = new Map(rows.map(r => [r.sale_date, r]));
  return dates.map(date => {
    const row = map.get(date);
    return { date, sales: num(row?.net_sales), projected: dailyGoal(row), guestCount: num(row?.guest_count) };
  });
}
export function periodGoal(days: PeriodDay[] | undefined, fallback = 0): number {
  const total = (days || []).reduce((s, d) => s + (d.projected || 0), 0);
  return total > 0 ? total : fallback;
}
/** Exact calculatedWeekPace/calculatedMonthPace rules, including historical selection. */
export function periodPace(days: PeriodDay[] | undefined, today: string, todayPace?: number | null, isToday = true, fallback = 0): number {
  const total = (days || []).reduce((s, d) => {
    const actualOrGoal = d.sales > 0 ? d.sales : (d.projected || 0);
    if (d.date < today) return s + actualOrGoal;
    if (d.date === today && isToday) return s + (todayPace ?? actualOrGoal);
    return s + (d.projected || 0);
  }, 0);
  return total > 0 ? total : fallback;
}
export function paceStatus(actual: number, pace: number | null, goal: number, enabled = true): PaceStatus | null {
  if (!enabled || actual < 100 || pace == null || pace <= 0 || goal <= 0) return null;
  return pace / goal * 100 >= 102 ? 'ahead' : pace / goal * 100 >= 95 ? 'onTrack' : 'behind';
}
export function comparison(current: number, previous: number | null | undefined) {
  return previous == null ? null : { dollars: current - previous, percent: previous === 0 ? null : (current - previous) / previous * 100 };
}
/** Dashboard hourly chart filtering, filling, and override scaling (before label formatting). */
export function dashboardHourly(raw: any[], goal: number, override: boolean, open?: string | null, close?: string | null) {
  const hourOf = (v: unknown) => {
    const s = String(v ?? '');
    return /AM|PM/.test(s) ? parseInt(s, 10) + (s.includes('PM') && !s.startsWith('12') ? 12 : 0) : parseInt(s.split(':')[0], 10);
  };
  let hourly = raw;
  if (open && close) {
    const end = parseInt(close.split(':')[0], 10) || 24;
    hourly = [];
    for (let hour = parseInt(open.split(':')[0], 10); hour < end; hour++) {
      const row = raw.find(h => hourOf(h.hour) === hour);
      hourly.push({ hour: `${String(hour).padStart(2, '0')}:00`, sales: row?.sales || 0, projected: row?.projected || 0 });
    }
  } else {
    const filtered = raw.filter(h => h.sales > 0 || h.projected > 0);
    if (filtered.length) hourly = filtered;
  }
  const total = hourly.reduce((s, h) => s + (h.projected || 0), 0);
  if (!override || goal <= 0 || total <= 0 || Math.abs(goal / total - 1) < 0.01) return hourly;
  return hourly.map(h => ({ ...h, projected: h.projected ? Math.round(h.projected * goal / total) : 0 }));
}
/** Include the current local hour in full, just like the Sales Summary LY chip. */
export function scaleLastYear(c: any, hour: number) {
  const base = { day: c?.ly_net_sales == null ? null : num(c.ly_net_sales), week: c?.ly_wtd_net == null ? null : num(c.ly_wtd_net), month: c?.ly_mtd_net == null ? null : num(c.ly_mtd_net) };
  if (!Array.isArray(c?.ly_hourly_data) || !c.ly_hourly_data.length) return { ...base, scaled: false };
  let through = 0;
  for (const h of c.ly_hourly_data) {
    const hn = parseInt(String(h?.hour ?? '').split(':')[0], 10);
    if (Number.isFinite(hn) && hn <= hour) through += num(h?.sales);
  }
  if (through <= 0) return { ...base, scaled: false };
  return { day: through, week: base.week != null && base.day != null ? Math.max(0, base.week - base.day + through) : null,
    month: base.month != null && base.day != null ? Math.max(0, base.month - base.day + through) : null, scaled: true };
}
export function laborTotals(rows: any[] | null, sales: number) {
  if (rows == null) return null;
  const cost = rows.reduce((s, r) => s + num(r.cost), 0);
  const hours = rows.reduce((s, r) => s + num(r.hours), 0);
  return cost > 0 || hours > 0 ? { cost, hours, percent: laborPct(cost, sales) } : null;
}
export function periodMetrics(rows: SalesRow[], dates: string[], today: string, todayPace?: number | null) {
  const days = periodDays(rows, dates);
  const toDate = rows.filter(r => dates.includes(r.sale_date) && r.sale_date <= today);
  const sales = toDate.reduce((s, r) => s + num(r.net_sales), 0);
  const guests = toDate.reduce((s, r) => s + num(r.guest_count), 0);
  const pizzas = toDate.some(r => r.pizza_count != null) ? toDate.reduce((s, r) => s + num(r.pizza_count), 0) : null;
  const payments = new Map<string, number>();
  for (const r of toDate) if (Array.isArray(r.payments_data)) for (const p of r.payments_data) payments.set(p.paymentType, (payments.get(p.paymentType) || 0) + num(p.amount));
  const goal = periodGoal(days), pace = periodPace(days, today, todayPace);
  return { sales, goal, pace, status: paceStatus(sales, pace, goal), delta: pace - goal,
    goal_percent: goal > 0 ? pace / goal * 100 : null, guests, ticket: dates.length === 1 ? (toDate[0]?.avg_ticket == null ? null : num(toDate[0].avg_ticket)) : (guests > 0 && sales > 0 ? sales / guests : null), pizzas,
    payments: [...payments].map(([paymentType, amount]) => ({ paymentType, amount })), days };
}