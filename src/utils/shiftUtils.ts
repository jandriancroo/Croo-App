/**
 * The ONE scheduled-hours rule (client). Mirrors public.scheduled_paid_hours in SQL —
 * keep both identical. Unpaid meals come from the store's labor_rules row:
 * no row / basis 'none' / paid meals / no meal hours → nothing subtracted;
 * gross > meal_break_hours → one meal; gross > second_meal_break_hours (> 0) → a second.
 * Meal length = coalesce(meal_break_duration, unpaid_break_min_minutes, 30).
 * Waivers: no first-meal deduction when meal_waiver_max_hours > 0 and gross <= it; no second-meal
 * deduction when second_meal_waiver_max_hours > 0 and gross <= it (worked through and paid).
 */
export interface MealRules {
  meal_rule_basis?: string | null;
  meal_break_paid?: boolean | null;
  meal_break_hours?: number | null;
  meal_break_duration?: number | null;
  unpaid_break_min_minutes?: number | null;
  second_meal_break_hours?: number | null;
  meal_waiver_max_hours?: number | null;
  second_meal_waiver_max_hours?: number | null;
}

export function grossShiftHours(start: string | undefined | null, end: string | undefined | null): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

export function mealLength(rules: MealRules): number {
  return Number(rules.meal_break_duration ?? rules.unpaid_break_min_minutes ?? 30);
}

/** Unpaid meal minutes for a shift of `gross` hours under these rules. */
export function mealBreakMinutes(gross: number, rules: MealRules | null | undefined): number {
  if (!rules || rules.meal_rule_basis === 'none' || rules.meal_break_paid === true) return 0;
  const first = Number(rules.meal_break_hours ?? 0);
  if (!first) return 0;
  const len = mealLength(rules);
  let mins = 0;
  const w1 = Number(rules.meal_waiver_max_hours ?? 0);
  const w2 = Number(rules.second_meal_waiver_max_hours ?? 0);
  if (gross > first && !(w1 > 0 && gross <= w1)) mins += len;
  const second = Number(rules.second_meal_break_hours ?? 0);
  if (second > 0 && gross > second && !(w2 > 0 && gross <= w2)) mins += len;
  return mins;
}

export function paidShiftHours(start: string | undefined | null, end: string | undefined | null, rules: MealRules | null | undefined): number {
  const gross = grossShiftHours(start, end);
  return Math.max(0, gross - mealBreakMinutes(gross, rules) / 60);
}

export function shiftHasMeal(start: string | undefined | null, end: string | undefined | null, rules: MealRules | null | undefined): boolean {
  if (!start || !end) return false;
  return mealBreakMinutes(grossShiftHours(start, end), rules) > 0;
}

/** Coffee hint text, e.g. "30-min unpaid meal (shift > 5 hrs)". Null when the rules give no meal. */
export function mealBreakLabel(rules: MealRules | null | undefined, gross?: number): string | null {
  if (!rules || mealBreakMinutes(gross ?? Infinity, rules) === 0) return null;
  const len = mealLength(rules);
  const first = Number(rules.meal_break_hours);
  const second = Number(rules.second_meal_break_hours ?? 0);
  if (gross !== undefined && second > 0 && gross > second) {
    return `2 × ${len}-min unpaid meals (shift > ${second} hrs)`;
  }
  return `${len}-min unpaid meal (shift > ${first} hrs)`;
}
