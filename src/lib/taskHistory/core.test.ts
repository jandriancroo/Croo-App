import { describe, it, expect } from 'vitest';
import { loadTaskHistory, type TaskHistoryCtx } from './core';
import { getBusinessDayRangeInTimezone } from './helpers';
import { getBusinessDayRangeInTimezone as appRange } from '@/utils/timezoneUtils';

type Op = { m: string; a: any[] };
type Resolver = (table: string, ops: Op[]) => { data: any; error?: any };

/** Chainable stub: every builder method records itself; awaiting resolves via resolver. */
function fakeDb(resolver: Resolver) {
  const calls: { table: string; ops: Op[] }[] = [];
  return {
    calls,
    from(table: string) {
      const ops: Op[] = [];
      calls.push({ table, ops });
      const q: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (res: any, rej: any) => Promise.resolve(resolver(table, ops)).then(res, rej);
          }
          return (...a: any[]) => { ops.push({ m: prop, a }); return q; };
        },
      });
      return q;
    },
  };
}
const arg = (ops: Op[], m: string, col?: string) =>
  ops.find((o) => o.m === m && (col === undefined || o.a[0] === col))?.a;

const TZ = 'America/Los_Angeles';
const CLOSE = '22:00';

const checklists = [
  { id: 'A', title: 'Open', template_type: 'standard', frequency: 'daily', scheduled_date: null,
    visible_days_before_month_end: null, due_by_time: '10:00', is_active: true, family_id: null,
    replaces_checklist_id: null, superseded_at: null,
    checklist_items: [
      { id: 'a1', days_of_week: null, item_type: 'checkbox', deleted_at: null },
      { id: 'a2', days_of_week: null, item_type: 'checkbox', deleted_at: null },
      { id: 'ah', days_of_week: null, item_type: 'section_header', deleted_at: null },
    ] },
  { id: 'D', title: 'Weekly Deep Clean', template_type: 'dynamic', frequency: 'weekly', scheduled_date: null,
    visible_days_before_month_end: null, due_by_time: null, is_active: true, family_id: null,
    replaces_checklist_id: null, superseded_at: null,
    checklist_items: [
      { id: 'd1', days_of_week: [0], item_type: 'checkbox', deleted_at: null },
      { id: 'd2', days_of_week: [1], item_type: 'checkbox', deleted_at: null },
    ] },
  { id: 'M', title: 'Monthly Audit', template_type: 'standard', frequency: 'monthly', scheduled_date: null,
    visible_days_before_month_end: null, due_by_time: null, is_active: true, family_id: null,
    replaces_checklist_id: null, superseded_at: null,
    checklist_items: [{ id: 'm1', days_of_week: null, item_type: 'checkbox', deleted_at: null }] },
  { id: 'M2', title: 'Month End', template_type: 'standard', frequency: 'monthly', scheduled_date: null,
    visible_days_before_month_end: 3, due_by_time: null, is_active: true, family_id: null,
    replaces_checklist_id: null, superseded_at: null,
    checklist_items: [{ id: 'n1', days_of_week: null, item_type: 'checkbox', deleted_at: null }] },
  { id: 'DRAFT', title: 'Draft', template_type: 'standard', frequency: 'daily', scheduled_date: null,
    visible_days_before_month_end: null, due_by_time: null, is_active: false, family_id: 'A',
    replaces_checklist_id: 'A', superseded_at: null,
    checklist_items: [{ id: 'x1', days_of_week: null, item_type: 'checkbox', deleted_at: null }] },
];

const resp = (item_id: string, sub: string, cl: string, by: string, at: string) => ({
  item_id, submission_id: sub, completed_by: by, created_at: at,
  checklist_submissions: { id: sub, checklist_id: cl },
});

const resolver: Resolver = (table, ops) => {
  switch (table) {
    case 'checklists': return { data: checklists };
    case 'checklist_responses': {
      const ids: string[] = arg(ops, 'in')![1];
      if (ids.includes('M')) return { data: [resp('m1', 'sm', 'M', 'u3', '2026-10-05T18:00:00Z')] };
      return { data: [
        resp('a1', 's1', 'A', 'u1', '2026-10-12T16:00:00Z'),
        resp('d1', 's2', 'D', 'u2', '2026-10-12T17:00:00Z'),
        resp('d2', 's2', 'D', 'u2', '2026-10-12T17:05:00Z'),
      ] };
    }
    case 'temporary_tasks':
      if (arg(ops, 'eq', 'task_style')) {
        return { data: [{ id: 'al', title: 'Temp Check', description: null, accent_color: null, task_style: 'alarm',
          alarm_start_time: null, alarm_end_time: null, frequency_minutes: null, custom_times: ['09:00', '10:00'] }] };
      }
      return { data: [{ id: 't1', title: 'Restock cups', description: 'front', completed_at: '2026-10-12T20:00:00Z',
        completed_by: 'u1', accent_color: '#f00', task_style: null }], error: null };
    case 'alarm_task_completions':
      return { data: [{ id: 'ac1', task_id: 'al', completed_at: '2026-10-12T16:02:00Z', completed_by: 'u2', interval_key: '2026-10-12_0902' }] };
    case 'temporary_task_subtasks':
      return { data: [{ task_id: 't1', completed_at: 'x' }, { task_id: 't1', completed_at: null }] };
    case 'event_task_completions':
      return { data: [{ id: 'e1', completed_at: '2026-10-12T19:00:00Z', completed_by: 'u4', event: { id: 'ev', event_name: 'Truck Delivery', location_id: 'L' } }], error: null };
    case 'logbook_entries':
      return { data: [{ id: 'l1', created_at: '2026-10-12T21:00:00Z', created_by: 'u5', category: { name: 'Safe Count' },
        logbook_entry_values: [{ value_text: '{"shift":"PM"}' }] }], error: null };
  }
  return { data: [] };
};

const mkCtx = (dateStr: string): TaskHistoryCtx => {
  const { start, end } = getBusinessDayRangeInTimezone(dateStr, TZ, CLOSE);
  return { locationId: 'L', dateStr, timezone: TZ, closeTime: CLOSE, periodStart: start, periodEnd: end,
    now: new Date('2026-10-20T12:00:00Z') };
};

describe('taskHistory core', () => {
  it('helper business-day range matches the app util', () => {
    for (const d of ['2026-10-12', '2026-10-01', '2026-03-08', '2026-11-01']) {
      for (const c of [null, '22:00', '20:00', '00:00']) {
        const a = getBusinessDayRangeInTimezone(d, TZ, c);
        const b = appRange(d, TZ, c);
        expect(a.start.toISOString()).toBe(b.start.toISOString());
        expect(a.end.toISOString()).toBe(b.end.toISOString());
      }
    }
  });

  it('2026-10-12 (Monday)', async () => {
    const db = fakeDb(resolver);
    const ctx = mkCtx('2026-10-12');
    const out = await loadTaskHistory(db, ctx);

    expect(out.checklists).toEqual([
      { id: 'A', title: 'Open', completed: false, completionRate: 0.5, itemCount: 2, completedCount: 1,
        contributorIds: ['u1'], lastCompletedAt: '2026-10-12T16:00:00Z', dueByTime: '10:00' },
      { id: 'D', title: 'Weekly Deep Clean', completed: true, completionRate: 1, itemCount: 1, completedCount: 1,
        contributorIds: ['u2'], lastCompletedAt: '2026-10-12T17:05:00Z', dueByTime: null },
      { id: 'M', title: 'Monthly Audit', completed: true, completionRate: 1, itemCount: 1, completedCount: 1,
        contributorIds: ['u3'], lastCompletedAt: '2026-10-05T18:00:00Z', dueByTime: null },
    ]);

    // Daily responses use the business-day window; monthly uses the local month.
    const respCalls = db.calls.filter((c) => c.table === 'checklist_responses');
    const daily = respCalls.find((c) => !arg(c.ops, 'in')![1].includes('M'))!;
    const monthly = respCalls.find((c) => arg(c.ops, 'in')![1].includes('M'))!;
    expect(arg(daily.ops, 'gte')![1]).toBe(ctx.periodStart.toISOString());
    expect(arg(daily.ops, 'lte')![1]).toBe(ctx.periodEnd.toISOString());
    expect(arg(monthly.ops, 'gte')![1]).toBe(new Date(2026, 9, 1, 0, 0, 0, 0).toISOString());
    expect(arg(monthly.ops, 'lte')![1]).toBe(new Date(2026, 10, 0, 23, 59, 59, 999).toISOString());

    expect(out.quickTasks).toEqual([
      { id: 't1', title: 'Restock cups', description: 'front', completed_at: '2026-10-12T20:00:00Z', completed_by: 'u1',
        accent_color: '#f00', task_style: null, subtaskTotal: 2, subtaskCompleted: 1, completerName: null, completerPhoto: null },
      { id: 'ac1', title: 'Temp Check', description: null, completed_at: '2026-10-12T16:02:00Z', completed_by: 'u2',
        accent_color: null, task_style: 'alarm', subtaskTotal: 0, subtaskCompleted: 0, completerName: null, completerPhoto: null },
      { id: 'missed-al-10:00', title: 'Temp Check', description: null, completed_at: '2026-10-12T10:00:00-08:00', completed_by: null,
        accent_color: null, task_style: 'alarm-missed', subtaskTotal: 0, subtaskCompleted: 0, completerName: null, completerPhoto: null },
    ]);
    expect(out.events).toEqual([
      { id: 'e1', title: 'Truck Delivery', completed_at: '2026-10-12T19:00:00Z', completed_by: 'u4', accent_color: null, task_style: 'event' },
    ]);
    expect(out.logbook).toEqual([
      { id: 'l1', title: 'Safe Count (PM)', completed_at: '2026-10-12T21:00:00Z', completed_by: 'u5', accent_color: null, task_style: 'logbook' },
    ]);
  });

  it('2026-10-01 (Thursday): dynamic has no items for the day', async () => {
    const out = await loadTaskHistory(fakeDb(resolver), mkCtx('2026-10-01'));
    expect(out.checklists.map((c) => c.id)).toEqual(['A', 'M']);
    expect(out.checklists[0].completedCount).toBe(1);
  });

  it('hides future alarm slots when viewing today', async () => {
    const ctx = { ...mkCtx('2026-10-12'), now: new Date('2026-10-12T16:30:00Z') }; // 9:30 AM PT
    const out = await loadTaskHistory(fakeDb(resolver), ctx);
    expect(out.quickTasks.map((t) => t.id)).toEqual(['t1', 'ac1']);
  });
});
