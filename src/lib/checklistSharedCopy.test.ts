import { describe, it, expect } from 'vitest';
import { sharedCopyWindow } from './checklistSharedCopy';

const base = { checklist_type: 'standard', schedule_repeats: true } as any;
describe('shared copy window', () => {
  it('weekly last N days shares Mon–Sun', () => {
    const c = { ...base, frequency: 'weekly', schedule_mode: 'last_n', schedule_period: 'week', schedule_last_n: 2 };
    expect(sharedCopyWindow(c, '2026-10-24')).toMatchObject({ start: '2026-10-19', end: '2026-10-25' });
    expect(sharedCopyWindow(c, '2026-10-25')).toMatchObject({ start: '2026-10-19', end: '2026-10-25' });
  });
  it('quarterly last N days shares the calendar quarter', () => {
    const c = { ...base, frequency: 'quarterly', schedule_mode: 'last_n', schedule_period: 'quarter', schedule_last_n: 14 };
    expect(sharedCopyWindow(c, '2026-12-20')).toMatchObject({ start: '2026-10-01', end: '2026-12-31' });
  });
  it('monthly last N days still shares the month', () => {
    const c = { ...base, frequency: 'monthly', schedule_mode: 'last_n', schedule_period: 'month', schedule_last_n: 5 };
    expect(sharedCopyWindow(c, '2026-10-28')).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
  });
  it('quarterly on a day and weekly certain days stay one copy per day', () => {
    const q = { ...base, frequency: 'quarterly', schedule_mode: 'day', schedule_period: 'quarter', schedule_quarter_month: 2, schedule_month_day: 15 };
    const w = { ...base, frequency: 'weekly', schedule_mode: 'days', schedule_period: 'week', schedule_weekdays: [0, 2, 4] };
    expect(sharedCopyWindow(q, '2026-11-15')).toMatchObject({ start: '2026-11-15', end: '2026-11-15' });
    expect(sharedCopyWindow(w, '2026-10-21')).toMatchObject({ start: '2026-10-21', end: '2026-10-21' });
  });
});
