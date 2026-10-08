import { describe, it, expect } from 'vitest';
import { labelFor, chipsFor, flagsForDay, breaksFromDetails, indexByClockIn, type ShiftFlagRow } from './shiftFlags';

const row = (id: string, flags: string[], details: any = {}): ShiftFlagRow => ({
  user_id: 'u', business_date: '2026-09-24', clock_in_punch_id: id, clock_out_punch_id: null,
  clock_in: '2026-09-24T16:00:00Z', clock_out: null, paid_min: 300, flags, details,
});

describe('labelFor', () => {
  it('plain labels', () => {
    expect(labelFor('missing_clock_out')).toBe('Open');
    expect(labelFor('second_meal_missing')).toBe('2nd Meal');
    expect(labelFor('overtime')).toBe('OT');
  });
  it('short meal', () => expect(labelFor('no_meal_break', { short_meal_min: 18.4 })).toBe('Short Meal (18m)'));
  it('company policy', () => expect(labelFor('no_meal_break', { basis: 'company' })).toBe('No Break (policy)'));
  it('no break default', () => expect(labelFor('no_meal_break', { basis: 'law' })).toBe('No Break'));
  it('long shift hours', () => expect(labelFor('long_shift', { day_paid_min: 645 })).toBe('Long Shift 10.8h'));
});

describe('chipsFor', () => {
  it('dedupes by label', () => {
    const chips = chipsFor([row('a', ['auto_clock_out', 'long_break']), row('b', ['long_break', 'overtime'])]);
    expect(chips).toEqual([
      { label: 'Auto Out', tone: 'warning' },
      { label: 'Long Break', tone: 'warning' },
      { label: 'OT', tone: 'info' },
    ]);
  });
});

describe('flagsForDay', () => {
  it('maps only clock-in punches that have a row', () => {
    const idx = indexByClockIn([row('in1', ['open_break']), row('other', ['overtime'])]);
    const day = [
      { id: 'in1', punch_type: 'clock_in' },
      { id: 'b1', punch_type: 'break_start' },
      { id: 'in2', punch_type: 'clock_in' },
      { id: 'other', punch_type: 'clock_out' },
    ];
    const r = flagsForDay(day, idx);
    expect(r.map((x) => x.clock_in_punch_id)).toEqual(['in1']);
  });
  it('no match → nothing', () => expect(flagsForDay([{ id: 'x', punch_type: 'clock_in' }], new Map())).toEqual([]));
});

describe('breaksFromDetails', () => {
  it('maps breaks', () => {
    expect(breaksFromDetails({ breaks: [
      { start: 's1', end: 'e1', min: 41.6, long: true },
      { start: 's2', end: null, min: null, long: false },
    ] })).toEqual([
      { start: 's1', end: 'e1', minutes: 42, isLong: true },
      { start: 's2', end: null, minutes: 0, isLong: false },
    ]);
  });
  it('empty', () => expect(breaksFromDetails(null)).toEqual([]));
});
