/**
 * The ONE scheduled week-pay calculation (client). Mirrors public.labor_week_pay in SQL —
 * keep both identical (src/utils/laborCost.test.ts + laborCost.fixtures.ts check the numbers).
 *
 * Per employee, days in date order:
 *  a. H = paid hours (paidShiftHours), G = gross hours, wage = max shift wage that day.
 *  b. 7th day (seventh_day_rule, paid hours on all 7 days): 7th day regular 0, ot = min(H,8), dt = rest.
 *  c. Daily OT on when daily_overtime_threshold > 0 and not (daily_ot_max_wage > 0 and wage >= it).
 *  d. Weekly OT: only regular hours count toward weekly_overtime_threshold; regular past it -> weekly_ot.
 *  e. California only (state_code 'CA', basis 'law', unpaid meals): 1 hr meal premium
 *     at the day's wage when fewer meals fit than required. Other states keep deductions, no premium.
 *  g. cost = (regular + (ot + weekly_ot) * otm + dt * dtm) * wage + meal_premium.
 * Open shifts, time off and phantom shifts are skipped. Missing wage = $15.
 */
import { grossShiftHours, mealBreakMinutes, mealLength, paidShiftHours } from './shiftUtils';
import type { ScheduleLaborRules } from '@/hooks/useScheduleLaborRules';

export const DEFAULT_WAGE = 15;

export interface PayShift {
  user_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  wage?: number | null;
  is_time_off?: boolean | null;
  is_phantom?: boolean | null;
}

export type PayRules = Partial<ScheduleLaborRules> & Record<string, any>;

export interface PayPersonDay {
  date: string; hours: number; regular: number; ot: number; dt: number;
  weekly_ot: number; seventh_day: boolean; meal_premium: number; cost: number;
}
export interface WeekPay {
  total_hours: number;
  total_cost: number;
  days: { date: string; hours: number; cost: number }[];
  people: { user_id: string; week_hours: number; days: PayPersonDay[] }[];
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Meals that fit on one employee-day: deducted meals + same-day gaps long enough for a meal. */
function mealsThatFit(shifts: PayShift[], rules: PayRules): number {
  const len = mealLength(rules);
  let fit = 0;
  for (const s of shifts) fit += mealBreakMinutes(grossShiftHours(s.start_time, s.end_time), rules) / len;
  const deadline = num(rules.meal_deadline_hours) > 0 ? num(rules.meal_deadline_hours) : num(rules.meal_break_hours);
  const sorted = [...shifts].sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  let worked = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const start = toMin(s.start_time);
    let end = toMin(s.end_time); if (end <= start) end += 1440;
    worked += (end - start) / 60;
    const next = sorted[i + 1];
    if (!next) break;
    const gap = toMin(next.start_time) - end;
    if (gap >= len) {
      if (fit === 0) { if (worked <= deadline) fit += 1; }
      else fit += 1;
    }
  }
  return fit;
}

function mealsRequired(gross: number, rules: PayRules): number {
  const first = num(rules.meal_break_hours);
  const w1 = num(rules.meal_waiver_max_hours);
  const second = num(rules.second_meal_break_hours);
  const w2 = num(rules.second_meal_waiver_max_hours);
  if (!(gross > first) || (w1 > 0 && gross <= w1)) return 0;
  if (second > 0 && gross > second && !(w2 > 0 && gross <= w2)) return 2;
  return 1;
}

export function weekLaborCost(shifts: PayShift[], rules: PayRules | null | undefined): WeekPay {
  const r: PayRules = rules ?? {};
  const OT = num(r.daily_overtime_threshold);
  const DT = num(r.daily_double_time_threshold);
  const otm = r.overtime_multiplier ?? 1.5;
  const dtm = r.double_time_multiplier ?? 2;
  const W = num(r.weekly_overtime_threshold);
  const maxWage = num(r.daily_ot_max_wage);
  const law = !!rules && r.state_code === 'CA' && r.meal_rule_basis === 'law' && r.meal_break_paid !== true && num(r.meal_break_hours) > 0;

  const byUser = new Map<string, Map<string, PayShift[]>>();
  for (const s of shifts) {
    if (!s.user_id || s.is_time_off || s.is_phantom) continue;
    const u = byUser.get(s.user_id) ?? new Map<string, PayShift[]>();
    const d = u.get(s.shift_date) ?? [];
    d.push(s); u.set(s.shift_date, d); byUser.set(s.user_id, u);
  }

  const dayTotals = new Map<string, { hours: number; cost: number }>();
  const people: WeekPay['people'] = [];
  let total_hours = 0, total_cost = 0;

  for (const [user_id, daysMap] of [...byUser.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dates = [...daysMap.keys()].sort();
    const base = dates.map((date) => {
      const ds = daysMap.get(date)!;
      return {
        date, ds,
        H: ds.reduce((t, s) => t + paidShiftHours(s.start_time, s.end_time, rules), 0),
        G: ds.reduce((t, s) => t + grossShiftHours(s.start_time, s.end_time), 0),
        wage: Math.max(...ds.map((s) => (s.wage ?? DEFAULT_WAGE))),
      };
    });
    const workedDays = base.filter((b) => b.H > 0).length;
    const seventh = !!r.seventh_day_rule && workedDays === 7;
    let cum = 0;
    const out: PayPersonDay[] = [];
    base.forEach((b, i) => {
      let regular = b.H, ot = 0, dt = 0;
      const isSeventh = seventh && i === base.length - 1;
      if (isSeventh) { regular = 0; ot = Math.min(b.H, 8); dt = Math.max(b.H - 8, 0); }
      else if (OT > 0 && !(maxWage > 0 && b.wage >= maxWage)) {
        regular = Math.min(b.H, OT);
        dt = DT > 0 ? Math.max(b.H - DT, 0) : 0;
        ot = b.H - regular - dt;
      }
      let weekly_ot = 0;
      if (W > 0) {
        const avail = Math.max(W - cum, 0);
        cum += regular;
        weekly_ot = Math.max(regular - avail, 0);
        regular -= weekly_ot;
      }
      const meal_premium = law && mealsThatFit(b.ds, r) < mealsRequired(b.G, r) ? b.wage : 0;
      const cost = (regular + (ot + weekly_ot) * otm + dt * dtm) * b.wage + meal_premium;
      out.push({ date: b.date, hours: b.H, regular, ot, dt, weekly_ot, seventh_day: isSeventh, meal_premium, cost });
      const dt0 = dayTotals.get(b.date) ?? { hours: 0, cost: 0 };
      dt0.hours += b.H; dt0.cost += cost; dayTotals.set(b.date, dt0);
      total_hours += b.H; total_cost += cost;
    });
    people.push({ user_id, week_hours: base.reduce((t, b) => t + b.H, 0), days: out });
  }

  const days = [...dayTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
  return { total_hours, total_cost, days, people };
}

/** One day's totals from a week result (zeros when nobody works). */
export function dayPay(w: WeekPay, date: string) {
  return w.days.find((d) => d.date === date) ?? { date, hours: 0, cost: 0 };
}

/** One person's cost on one day (0 when none). */
export function personDayPay(w: WeekPay, userId: string | null | undefined, date: string): PayPersonDay | null {
  if (!userId) return null;
  return w.people.find((p) => p.user_id === userId)?.days.find((d) => d.date === date) ?? null;
}
