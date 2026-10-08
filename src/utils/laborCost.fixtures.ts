// Shared fixtures for weekLaborCost (TS) and public.labor_week_pay (SQL parity check).
import type { PayShift, PayRules } from './laborCost';

export const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const U = '00000000-0000-0000-0000-000000000001';

export const CA: PayRules = {
  daily_overtime_threshold: 8, daily_double_time_threshold: 12, weekly_overtime_threshold: 40,
  overtime_multiplier: 1.5, double_time_multiplier: 2, seventh_day_rule: true,
  meal_rule_basis: 'law', meal_break_paid: false, meal_break_hours: 5, meal_break_duration: 30,
  second_meal_break_hours: 10, meal_deadline_hours: 5,
};
export const WEEKLY_ONLY: PayRules = { daily_overtime_threshold: 0, weekly_overtime_threshold: 40, overtime_multiplier: 1.5, double_time_multiplier: 2 };

const sh = (date: string, start: string, end: string, wage = 20): PayShift => ({ user_id: U, shift_date: date, start_time: start, end_time: end, wage });
const days = (n: number, start: string, end: string) => WEEK.slice(0, n).map((d) => sh(d, start, end));

export interface PayFixture {
  name: string;
  shifts: PayShift[];
  rules: PayRules | null;
  total_cost: number;
  day_cost?: Record<string, number>;
  /** expected regular / daily OT / weekly OT hour totals */
  hours?: { regular: number; ot: number; weekly_ot: number; dt?: number };
  meal_premium?: number;
}

export const FIXTURES: PayFixture[] = [
  { name: 'weekly OT 5x9h, no daily OT', shifts: days(5, '09:00', '18:00'), rules: WEEKLY_ONLY, total_cost: 950, hours: { regular: 40, ot: 0, weekly_ot: 5 } },
  { name: 'CA 6x7.5h paid -> 40 reg + 5 weekly OT', shifts: days(6, '09:00', '17:00'), rules: CA, total_cost: 40 * 20 + 5 * 30, hours: { regular: 40, ot: 0, weekly_ot: 5 } },
  { name: 'CA 7th day 8h', shifts: [...days(6, '09:00', '14:00'), sh(WEEK[6], '09:00', '17:30')], rules: CA, total_cost: 30 * 20 + 240, day_cost: { [WEEK[6]]: 240 } },
  { name: 'CA 7th day 10h', shifts: [...days(6, '09:00', '14:00'), sh(WEEK[6], '08:00', '19:00')], rules: CA, total_cost: 30 * 20 + 320, day_cost: { [WEEK[6]]: 320 } },
  { name: 'CA 5x10h daily OT, no weekly double count', shifts: days(5, '08:00', '19:00'), rules: CA, total_cost: 1100, hours: { regular: 40, ot: 10, weekly_ot: 0 } },
  { name: 'CA 6x9h -> 6 daily OT + 8 weekly OT', shifts: days(6, '08:00', '17:30'), rules: CA, total_cost: 40 * 20 + 14 * 30, hours: { regular: 40, ot: 6, weekly_ot: 8 } },
  { name: 'meal premium: 15-min gap', shifts: [sh(WEEK[0], '10:00', '13:00'), sh(WEEK[0], '13:15', '16:00')], rules: CA, total_cost: 5.75 * 20 + 20, meal_premium: 20 },
  { name: 'meal fits: 1h gap', shifts: [sh(WEEK[0], '10:00', '13:00'), sh(WEEK[0], '14:00', '16:45')], rules: CA, total_cost: 5.75 * 20, meal_premium: 0 },
  { name: 'meal deducted single 10:00-16:30', shifts: [sh(WEEK[0], '10:00', '16:30')], rules: CA, total_cost: 6 * 20, meal_premium: 0 },
  { name: 'meal waiver 6h, 5.5h shift', shifts: [sh(WEEK[0], '10:00', '15:30')], rules: { ...CA, meal_waiver_max_hours: 6 }, total_cost: 5.5 * 20, meal_premium: 0 },
  { name: 'daily_ot_max_wage 18, wage 20 -> weekly OT only', shifts: days(5, '08:00', '19:00'), rules: { ...CA, daily_ot_max_wage: 18 }, total_cost: 40 * 20 + 10 * 30, hours: { regular: 40, ot: 0, weekly_ot: 10 } },
  { name: 'no rules -> straight time', shifts: days(6, '08:00', '19:00'), rules: null, total_cost: 66 * 20, hours: { regular: 66, ot: 0, weekly_ot: 0 } },
];
