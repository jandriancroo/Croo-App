import { describe, it, expect } from 'vitest';
import {
  checklistShowsOn,
  checklistScorePeriod,
  deriveChecklistFrequency,
  isPeriodScored,
  schedulePeriodBounds,
} from './schedule';
import { scheduleFormFromRow, scheduleFormToRow, scheduleFormError, defaultScheduleForm } from '@/lib/checklistScheduleForm';

const std = (f: Record<string, unknown>) => ({ template_type: 'standard', ...f });
const days = (from: string, n: number) => {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
};
const shownIn = (c: any, from: string, n: number) => days(from, n).filter((d) => checklistShowsOn(c, d));

describe('weekly — on certain days', () => {
  const monWedFri = std({ schedule_repeats: true, schedule_period: 'week', schedule_mode: 'days', schedule_weekdays: [0, 2, 4] });
  it('shows only Mon/Wed/Fri (week of Oct 19 2026)', () =>
    expect(shownIn(monWedFri, '2026-10-19', 7)).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']));
  it('scores per day', () => expect(isPeriodScored(monWedFri)).toBe(false));
  it('every day = daily', () => expect(deriveChecklistFrequency({ schedule_period: 'week', schedule_mode: 'days', schedule_weekdays: [0, 1, 2, 3, 4, 5, 6] })).toBe('daily'));
  it('some days = weekly', () => expect(deriveChecklistFrequency(monWedFri)).toBe('weekly'));
});

describe('weekly — last N days (week = Mon–Sun)', () => {
  const last2 = std({ schedule_repeats: true, schedule_period: 'week', schedule_mode: 'last_n', schedule_last_n: 2 });
  it('shows Sat + Sun', () => expect(shownIn(last2, '2026-10-19', 7)).toEqual(['2026-10-24', '2026-10-25']));
  it('scored once for the week, Mon–Sun, across a month boundary', () => {
    expect(checklistScorePeriod(last2, '2026-11-01')).toEqual({ kind: 'week', start: '2026-10-26', end: '2026-11-01' });
  });
  it('week across a year boundary', () =>
    expect(schedulePeriodBounds('week', '2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' }));
});

describe('monthly — on a day', () => {
  const on31 = std({ schedule_repeats: true, schedule_period: 'month', schedule_mode: 'on_day', schedule_day: 31 });
  it('31st in a 30-day month falls on the 30th', () => expect(shownIn(on31, '2026-11-01', 30)).toEqual(['2026-11-30']));
  it('31st in Feb (non-leap) falls on the 28th', () => expect(shownIn(on31, '2027-02-01', 28)).toEqual(['2027-02-28']));
  it('31st in Feb (leap year) falls on the 29th', () => expect(shownIn(on31, '2028-02-01', 29)).toEqual(['2028-02-29']));
  it('15th shows only on the 15th', () =>
    expect(shownIn(std({ schedule_repeats: true, schedule_period: 'month', schedule_mode: 'on_day', schedule_day: 15 }), '2026-10-01', 31)).toEqual(['2026-10-15']));
  it('last day of month', () =>
    expect(shownIn(std({ schedule_repeats: true, schedule_period: 'month', schedule_mode: 'on_day', schedule_day: -1 }), '2026-10-01', 31)).toEqual(['2026-10-31']));
  it('scores per day', () => expect(isPeriodScored(on31)).toBe(false));
});

describe('monthly — last N days', () => {
  const last7 = std({ schedule_repeats: true, schedule_period: 'month', schedule_mode: 'last_n', schedule_last_n: 7 });
  it('Oct: 25th–31st', () => expect(shownIn(last7, '2026-10-01', 31)).toEqual(days('2026-10-25', 7)));
  it('Feb: 22nd–28th', () => expect(shownIn(last7, '2027-02-01', 28)).toEqual(days('2027-02-22', 7)));
  it('scored once for the month', () =>
    expect(checklistScorePeriod(last7, '2026-10-28')).toEqual({ kind: 'month', start: '2026-10-01', end: '2026-10-31' }));
  it('30 days in a 28-day month = whole month', () =>
    expect(shownIn(std({ schedule_repeats: true, schedule_period: 'month', schedule_mode: 'last_n', schedule_last_n: 30 }), '2027-02-01', 28)).toHaveLength(28));
});

describe('quarterly', () => {
  it('quarter bounds (calendar quarters)', () => {
    expect(schedulePeriodBounds('quarter', '2026-11-15')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(schedulePeriodBounds('quarter', '2027-03-31')).toEqual({ start: '2027-01-01', end: '2027-03-31' });
    expect(schedulePeriodBounds('quarter', '2027-04-01')).toEqual({ start: '2027-04-01', end: '2027-06-30' });
  });
  const m2d31 = std({ schedule_repeats: true, schedule_period: 'quarter', schedule_mode: 'on_day', schedule_quarter_month: 2, schedule_day: 31 });
  it('2nd month, 31st → Nov 30 in Q4 and Feb 28 in Q1', () => {
    expect(shownIn(m2d31, '2026-10-01', 92)).toEqual(['2026-11-30']);
    expect(shownIn(m2d31, '2027-01-01', 90)).toEqual(['2027-02-28']);
  });
  it('last day of the quarter', () =>
    expect(shownIn(std({ schedule_repeats: true, schedule_period: 'quarter', schedule_mode: 'on_day', schedule_quarter_month: 3, schedule_day: -1 }), '2026-10-01', 92)).toEqual(['2026-12-31']));
  const last14 = std({ schedule_repeats: true, schedule_period: 'quarter', schedule_mode: 'last_n', schedule_last_n: 14 });
  it('last 14 days of Q4 = Dec 18–31', () => expect(shownIn(last14, '2026-10-01', 92)).toEqual(days('2026-12-18', 14)));
  it('last 14 days of Q1 crosses into March only', () => expect(shownIn(last14, '2027-01-01', 90)).toEqual(days('2027-03-18', 14)));
  it('scored once for the quarter', () =>
    expect(checklistScorePeriod(last14, '2026-12-20')).toEqual({ kind: 'quarter', start: '2026-10-01', end: '2026-12-31' }));
  it('frequency = quarterly', () => expect(deriveChecklistFrequency(last14)).toBe('quarterly'));
});

describe('one date (repeating off)', () => {
  const once = std({ schedule_repeats: false, scheduled_date: '2026-10-22' });
  it('shows only that day', () => expect(shownIn(once, '2026-10-19', 7)).toEqual(['2026-10-22']));
  it('frequency = single_day, scored per day', () => {
    expect(deriveChecklistFrequency(once)).toBe('single_day');
    expect(isPeriodScored(once)).toBe(false);
  });
});

describe('migrated lists behave exactly like before', () => {
  const oldDaily = std({ frequency: 'daily' });
  const newDaily = std({ frequency: 'daily', schedule_repeats: true, schedule_period: 'week', schedule_mode: 'days', schedule_weekdays: [0, 1, 2, 3, 4, 5, 6] });
  const oldMonthly = std({ frequency: 'monthly', visible_days_before_month_end: 14 });
  const newMonthly = { ...oldMonthly, schedule_repeats: true, schedule_period: 'month', schedule_mode: 'last_n', schedule_last_n: 14 };
  const span = days('2026-01-01', 730);
  it('daily: same days for two years', () => expect(span.filter((d) => checklistShowsOn(newDaily, d))).toEqual(span.filter((d) => checklistShowsOn(oldDaily, d))));
  it('monthly last 14: same days for two years', () => expect(span.filter((d) => checklistShowsOn(newMonthly, d))).toEqual(span.filter((d) => checklistShowsOn(oldMonthly, d))));
  it('same scoring periods', () => {
    for (const d of span) {
      expect(checklistScorePeriod(newDaily, d)).toEqual(checklistScorePeriod(oldDaily, d));
      expect(checklistScorePeriod(newMonthly, d)).toEqual(checklistScorePeriod(oldMonthly, d));
    }
  });
});

describe('Dynamic and Training are not decided here', () => {
  it('dynamic always passes (its items decide), scored per day', () => {
    const dyn = { template_type: 'dynamic', frequency: 'weekly' };
    expect(checklistShowsOn(dyn, '2026-10-21')).toBe(true);
    expect(isPeriodScored(dyn)).toBe(false);
  });
});

describe('picker form', () => {
  it('round-trips each type', () => {
    const rows = [
      std({ schedule_repeats: true, schedule_period: 'week', schedule_mode: 'days', schedule_weekdays: [1, 3] }),
      std({ schedule_repeats: true, schedule_period: 'month', schedule_mode: 'last_n', schedule_last_n: 5 }),
      std({ schedule_repeats: true, schedule_period: 'quarter', schedule_mode: 'on_day', schedule_quarter_month: 3, schedule_day: -1 }),
      std({ schedule_repeats: false, scheduled_date: '2026-12-24' }),
    ];
    for (const r of rows) {
      const saved = { template_type: 'standard', ...scheduleFormToRow(scheduleFormFromRow(r), '2026-10-21') };
      for (const d of days('2026-10-01', 120)) expect(checklistShowsOn(saved, d)).toBe(checklistShowsOn(r, d));
    }
  });
  it('blank one-date = today', () =>
    expect(scheduleFormToRow({ ...defaultScheduleForm(), repeats: false, date: '' }, '2026-10-21').scheduled_date).toBe('2026-10-21'));
  it('needs at least one weekday', () => expect(scheduleFormError({ ...defaultScheduleForm(), weekdays: [] })).not.toBeNull());
  it('monthly last N keeps the month window filled', () =>
    expect(scheduleFormToRow({ ...defaultScheduleForm(), period: 'month', mode: 'last_n', lastN: 14 }, '2026-10-21').visible_days_before_month_end).toBe(14));
});
