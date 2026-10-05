import { describe, it, expect } from 'vitest';
import { eventChecks, duplicateWarning, matchCategory, matchRole, presetColor, parseDays, eventTime, whenLabel, weekdayOf, EVENT_COLORS, EVENT_ROLE_OPTIONS } from '../../supabase/functions/_shared/eventPlan';
import { ASSIGNABLE_ROLE_OPTIONS } from '@/hooks/useUserRole';
import { readFileSync } from 'fs';

const T = '2026-10-04';
const base = { name: 'Produce Order', mode: 'one-time' as const, date: '2026-10-17', days: [], start: '08:00', end: null };

describe('required fields and end vs start', () => {
  it('name missing', () => expect(eventChecks({ ...base, name: ' ' }, T).ask).toBe('What should the event be called?'));
  it('no date -> Which day? (never today)', () => expect(eventChecks({ ...base, mode: null, date: null }, T).ask).toBe('Which day?'));
  it('recurring with no days -> Which days?', () => expect(eventChecks({ ...base, mode: 'recurring', date: null }, T).ask).toBe('Which days?'));
  it('no start', () => expect(eventChecks({ ...base, start: null }, T).ask).toBe('What time does it start?'));
  it('end before start stops', () => expect(eventChecks({ ...base, start: '15:00', end: '14:00' }, T).stop).toMatch(/isn't after the start/));
  it('end equal to start stops', () => expect(eventChecks({ ...base, end: '08:00' }, T).stop).toBeTruthy());
  it('end optional', () => expect(eventChecks(base, T)).toEqual({ warnings: [] }));
  it('past date warns only', () => { const r = eventChecks({ ...base, date: '2026-10-01' }, T); expect(r.stop).toBeUndefined(); expect(r.warnings).toEqual(['That date is in the past.']); });
});

describe('duplicate warning', () => {
  const ex = [
    { id: '1', event_name: 'Produce Order', event_time: '08:00:00', is_recurring: false, event_date: '2026-10-17', day_of_week: 5, days_of_week: null },
    { id: '2', event_name: 'Ice machine check', event_time: '07:00:00', is_recurring: true, event_date: null, day_of_week: 0, days_of_week: [0, 3] },
  ];
  it('same name+time same date', () => expect(duplicateWarning({ name: 'produce order', mode: 'one-time', date: '2026-10-17', start: '08:00' }, ex)).toMatch(/already on the schedule/));
  it('different time: none', () => expect(duplicateWarning({ name: 'Produce Order', mode: 'one-time', date: '2026-10-17', start: '09:00' }, ex)).toBeNull());
  it('one-time on a recurring weekday', () => expect(duplicateWarning({ name: 'Ice Machine Check', mode: 'one-time', date: '2026-10-15', start: '07:00' }, ex)).toBeTruthy());
  it('recurring overlapping days', () => expect(duplicateWarning({ name: 'Ice machine check', mode: 'recurring', days: [3], start: '07:00' }, ex)).toBeTruthy());
  it('recurring other days: none', () => expect(duplicateWarning({ name: 'Ice machine check', mode: 'recurring', days: [1], start: '07:00' }, ex)).toBeNull());
});

describe('category match', () => {
  const cats = [{ id: 'a', name: 'Ordering' }, { id: 'b', name: 'Training' }, { id: 'c', name: 'Truck Day' }, { id: 'd', name: 'Truck Prep' }];
  it('exact, any case', () => expect(matchCategory('ordering', cats)).toEqual({ match: cats[0] }));
  it('"the ordering category"', () => expect(matchCategory('the Ordering category', cats)).toEqual({ match: cats[0] }));
  it('plural', () => expect(matchCategory('Trainings', cats)).toEqual({ match: cats[1] }));
  it('two close fits -> several', () => expect('several' in matchCategory('truck', cats)).toBe(true));
  it('no match', () => expect(matchCategory('Payroll', cats)).toEqual({ none: true }));
});

describe('color mapping', () => {
  it('10 presets, same as both manual screens', () => {
    expect(EVENT_COLORS).toHaveLength(10);
    for (const f of ['src/components/schedule/EventRow.tsx', 'src/components/schedule/MobileEventDialog.tsx']) {
      const hexes = [...readFileSync(f, 'utf8').split('const PRESET_COLORS')[1].split(']')[0].matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase());
      expect(hexes).toEqual(EVENT_COLORS.map((c) => c.hex));
    }
  });
  it('green -> preset', () => expect(presetColor('Green')).toBe('#22c55e'));
  it('purple-ish -> ask', () => expect(presetColor('purple-ish')).toBeNull());
  it('purple -> ask (violet is the preset)', () => expect(presetColor('purple')).toBeNull());
});

describe('roles (desktop Tag Roles list)', () => {
  it('server list equals the app list', () => expect(EVENT_ROLE_OPTIONS).toEqual(ASSIGNABLE_ROLE_OPTIONS));
  it('the managers', () => expect(matchRole('the managers')).toEqual({ role: 'manager' }));
  it('shift managers', () => expect(matchRole('shift managers')).toEqual({ role: 'shift_manager' }));
  it('cooks -> none', () => expect(matchRole('cooks')).toEqual({ none: true }));
});

describe('days, times, labels', () => {
  it('weekday words', () => expect(parseDays(['Thursday', 'monday'])).toEqual([0, 3]));
  it('bad weekday', () => expect(parseDays(['someday'])).toBeNull());
  it('times', () => { expect(eventTime('7')).toBe('07:00'); expect(eventTime('14:30:00')).toBe('14:30'); expect(eventTime('25')).toBeNull(); });
  it('Oct 17 2026 is Saturday', () => expect(weekdayOf('2026-10-17')).toBe(5));
  it('one-time label', () => expect(whenLabel({ mode: 'one-time', date: '2026-10-17', start: '08:00', end: '09:00' })).toBe('Saturday, Oct 17 · 8:00 AM to 9:00 AM'));
  it('recurring label', () => expect(whenLabel({ mode: 'recurring', days: [0, 3], start: '08:00' })).toBe('Every Monday and Thursday · 8:00 AM'));
});
