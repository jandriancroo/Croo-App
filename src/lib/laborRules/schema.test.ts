import { describe, it, expect } from 'vitest';
import { laborRulesSchema, DEFAULT_FORM, toForm, diffForm, EDITABLE_FIELDS, FIELD_META } from './schema';

describe('laborRulesSchema', () => {
  it('accepts defaults', () => expect(laborRulesSchema.safeParse(DEFAULT_FORM).success).toBe(true));
  it('rejects meal length out of range', () => {
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, meal_break_duration: 5 }).success).toBe(false);
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, meal_break_hours: 13 }).success).toBe(false);
  });
  it('double time must be above overtime', () => {
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, daily_overtime_threshold: 8, daily_double_time_threshold: 8 }).success).toBe(false);
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, daily_overtime_threshold: 0, daily_double_time_threshold: 0 }).success).toBe(true);
  });
  it('waiver and deadline vs meal hours', () => {
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, meal_break_hours: 5, meal_waiver_max_hours: 4 }).success).toBe(false);
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, meal_break_hours: 5, meal_deadline_hours: 6 }).success).toBe(false);
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, meal_break_hours: 5, meal_deadline_hours: 5, meal_waiver_max_hours: 6 }).success).toBe(true);
  });
  it('multipliers 1-3', () => expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, overtime_multiplier: 3.5 }).success).toBe(false));
  it('minor rules time format', () => {
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, minor_rules: { latest_end_school_night: '22:00' } }).success).toBe(true);
    expect(laborRulesSchema.safeParse({ ...DEFAULT_FORM, minor_rules: { latest_end_school_night: '10pm' } }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('every field has metadata and no engine knobs are editable', () => {
    for (const f of EDITABLE_FIELDS) expect(FIELD_META[f]).toBeTruthy();
    for (const k of ['unpaid_break_min_minutes', 'duplicate_tap_minutes', 'max_open_shift_hours', 'auto_clock_out_after_close_min', 'field_sources', 'auto_punch_out_time'])
      expect(EDITABLE_FIELDS as string[]).not.toContain(k);
  });
  it('toForm coerces numeric strings and ignores unknown keys', () => {
    const f = toForm({ meal_break_hours: '5', id: 'x', unpaid_break_min_minutes: 30 });
    expect(f.meal_break_hours).toBe(5);
    expect((f as any).id).toBeUndefined();
  });
  it('diffForm returns only changed fields', () => {
    const a = { ...DEFAULT_FORM };
    expect(diffForm(a, { ...a, meal_break_hours: 5 })).toEqual({ meal_break_hours: 5 });
    expect(diffForm(a, a)).toEqual({});
  });
});
