import { describe, it, expect } from 'vitest';
import { buildNudgeList, lateText } from '../../supabase/functions/_shared/nudgeList';

const tz = 'America/Los_Angeles';
const NOW = Date.parse('2026-10-20T22:00:00Z'); // 3:00 PM PT
const base = { now: NOW, tz, businessDate: '2026-10-20', checklists: [], tasks: [], events: [], logs: [] };

describe('buildNudgeList', () => {
  it('checklist past its due time is overdue with minutes late', () => {
    const [i] = buildNudgeList({ ...base, targets: [{ type: 'checklist', id: 'c', title: 'Open', done: 1, total: 4 }], checklists: [{ id: 'c', due_by_time: '14:35:00' }] });
    expect(i.group).toBe('overdue');
    expect(i.status).toBe('25 min late · 1 of 4');
  });
  it('checklist before its due time is coming up', () => {
    const [i] = buildNudgeList({ ...base, targets: [{ type: 'checklist', id: 'c', title: 'Mid', done: 2, total: 5 }], checklists: [{ id: 'c', due_by_time: '15:30:00' }] });
    expect(i.group).toBe('coming_up');
    expect(i.status).toBe('Due 3:30 PM · 2 of 5');
  });
  it('after midnight carry-over adds a day, so last night\'s 11 PM close is late', () => {
    const late = Date.parse('2026-10-21T07:30:00Z'); // 12:30 AM PT, business day still the 20th
    const [i] = buildNudgeList({ ...base, now: late, targets: [{ type: 'checklist', id: 'c', title: 'Close', done: 0, total: 3 }], checklists: [{ id: 'c', due_by_time: '23:00:00' }] });
    expect(i.group).toBe('overdue');
  });
  it('triggered alarm task is overdue; other tasks are coming up', () => {
    const out = buildNudgeList({ ...base,
      targets: [{ type: 'task', id: 'a', title: 'Alarm', done: null, total: null }, { type: 'task', id: 'b', title: 'Plain', done: null, total: null }],
      tasks: [{ id: 'a', task_style: 'alarm', last_triggered_at: '2026-10-20T21:50:00Z', expires_at: null }, { id: 'b', task_style: 'standard', last_triggered_at: null, expires_at: null }] });
    expect(out.find((x) => x.id === 'a')!.group).toBe('overdue');
    expect(out.find((x) => x.id === 'b')!.group).toBe('coming_up');
  });
  it('events are always coming up', () => {
    const [i] = buildNudgeList({ ...base, targets: [{ type: 'event', id: 'e', title: 'Truck', done: null, total: null }], events: [{ id: 'e', event_time: '15:25:00', event_end_time: null }] });
    expect(i.group).toBe('coming_up');
    expect(i.status).toBe('Event · 3:25 PM · in 25 min');
  });
  it('overdue sorts most late first and comes before coming up', () => {
    const out = buildNudgeList({ ...base,
      targets: [{ type: 'checklist', id: 'x', title: 'X', done: 0, total: 1 }, { type: 'checklist', id: 'y', title: 'Y', done: 0, total: 1 }, { type: 'checklist', id: 'z', title: 'Z', done: 0, total: 1 }],
      checklists: [{ id: 'x', due_by_time: '14:50:00' }, { id: 'y', due_by_time: '13:00:00' }, { id: 'z', due_by_time: '16:00:00' }] });
    expect(out.map((o) => o.id)).toEqual(['y', 'x', 'z']);
  });
  it('minutes since last nudge only within the hour', () => {
    const [i] = buildNudgeList({ ...base, targets: [{ type: 'checklist', id: 'c', title: 'C', done: 0, total: 1 }], logs: [{ target_type: 'checklist', target_id: 'c', created_at: '2026-10-20T21:48:00Z' }] });
    expect(i.minutes_since_last_nudge).toBe(12);
  });
  it('late text over an hour', () => expect(lateText(65)).toBe('1 hr 5 min late'));
});
