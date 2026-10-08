import { describe, it, expect } from 'vitest';
import { paidShiftHours, shiftHasMeal, mealBreakLabel } from './shiftUtils';

const CA = { meal_rule_basis: 'shift_length', meal_break_paid: false, meal_break_hours: 5, meal_break_duration: 30, second_meal_break_hours: 10 };
const NONE = { meal_rule_basis: 'none', meal_break_hours: 5, meal_break_duration: 30 };
const NV = { meal_rule_basis: 'shift_length', meal_break_hours: 8, meal_break_duration: 30 };
const IL = { meal_rule_basis: 'shift_length', meal_break_hours: 7.5, meal_break_duration: 20 };

describe('paidShiftHours', () => {
  it('CA', () => {
    expect(paidShiftHours('09:00', '16:00', CA)).toBe(6.5);
    expect(paidShiftHours('08:00', '19:00', CA)).toBe(10);
    expect(paidShiftHours('09:00', '14:00', CA)).toBe(5);
  });
  it('none / no row', () => {
    expect(paidShiftHours('09:00', '16:00', NONE)).toBe(7);
    expect(paidShiftHours('09:00', '16:00', null)).toBe(7);
    expect(shiftHasMeal('09:00', '16:00', null)).toBe(false);
  });
  it('NV and IL', () => {
    expect(paidShiftHours('09:00', '16:00', NV)).toBe(7);
    expect(paidShiftHours('09:00', '18:00', NV)).toBe(8.5);
    expect(paidShiftHours('09:00', '17:00', IL)).toBeCloseTo(7.667, 3);
  });
  it('overnight', () => {
    expect(paidShiftHours('18:00', '00:00', CA)).toBe(5.5);
  });
  it('label', () => {
    expect(mealBreakLabel(CA)).toBe('30-min unpaid meal (shift > 5 hrs)');
    expect(mealBreakLabel(NONE)).toBeNull();
  });
});
