import { describe, it, expect } from 'vitest';
import { weekLaborCost } from './laborCost';
import { FIXTURES } from './laborCost.fixtures';
import { paidShiftHours } from './shiftUtils';
import { laborCheckOverGoal, needsApprovalReason, type ScheduleLaborCheck } from '@/hooks/useScheduleApproval';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('weekLaborCost fixtures', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const w = weekLaborCost(f.shifts, f.rules);
      expect(w.total_cost).toBeCloseTo(f.total_cost, 2);
      for (const [date, cost] of Object.entries(f.day_cost ?? {})) {
        expect(w.days.find((d) => d.date === date)?.cost).toBeCloseTo(cost, 2);
      }
      const pd = w.people.flatMap((p) => p.days);
      if (f.hours) {
        expect(sum(pd.map((d) => d.regular))).toBeCloseTo(f.hours.regular, 4);
        expect(sum(pd.map((d) => d.ot))).toBeCloseTo(f.hours.ot, 4);
        expect(sum(pd.map((d) => d.weekly_ot))).toBeCloseTo(f.hours.weekly_ot, 4);
      }
      if (f.meal_premium != null) expect(sum(pd.map((d) => d.meal_premium))).toBeCloseTo(f.meal_premium, 4);
      expect(sum(w.days.map((d) => d.cost))).toBeCloseTo(w.total_cost, 6);
    });
  }

  it('7th day flag lands on the 7th day', () => {
    const w = weekLaborCost(FIXTURES[2].shifts, FIXTURES[2].rules);
    const last = w.people[0].days[6];
    expect(last.seventh_day).toBe(true);
    expect(last.ot).toBe(8);
    expect(last.regular).toBe(0);
  });

  it('skips open, time off and phantom shifts', () => {
    const base = { shift_date: '2026-10-05', start_time: '09:00', end_time: '13:00', wage: 20 };
    const w = weekLaborCost([
      { ...base, user_id: null },
      { ...base, user_id: 'a', is_time_off: true },
      { ...base, user_id: 'b', is_phantom: true },
      { ...base, user_id: 'c', wage: null },
    ], null);
    expect(w.total_hours).toBe(4);
    expect(w.total_cost).toBe(60); // missing wage = $15
  });

  it('meal waiver skips the deduction', () => {
    expect(paidShiftHours('10:00', '15:30', { meal_rule_basis: 'law', meal_break_hours: 5, meal_break_duration: 30, meal_waiver_max_hours: 6 })).toBe(5.5);
    expect(paidShiftHours('08:00', '19:00', { meal_rule_basis: 'law', meal_break_hours: 5, meal_break_duration: 30, second_meal_break_hours: 10, second_meal_waiver_max_hours: 12 })).toBe(10.5);
  });
});

describe('day over goal approval', () => {
  const lc: ScheduleLaborCheck = {
    scheduled_hours: 100, scheduled_cost: 2000, projected_sales: 10000, labor_pct: 20, target_pct: 25,
    misses_goal: true, reason: 'day_over_goal', week_over_goal: false,
    days: [{ date: '2026-10-05', projected_sales: 1000, target_pct: 25, scheduled_hours: 20, scheduled_cost: 400, labor_pct: 40, over_goal: true }],
  };
  it('reason text + over goal', () => {
    expect(needsApprovalReason(lc)).toBe('A day this week is over its labor goal, so it needs approval before it posts.');
    expect(laborCheckOverGoal(lc)).toBe(true);
  });
});
