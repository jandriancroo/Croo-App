import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { canNudgeChecklist, canNudgeTask, canNudgeEvent, fieldsFor, missingFields, renderNudgeText, DEFAULT_NUDGE_TEMPLATES, onClockIds, splitCooldown, matchChecklist, matchTarget, firstName, type NudgeStatusRow, type TaskStatusRow, type EventStatusRow } from '../../supabase/functions/_shared/nudgePlan';
import { NUDGE_ROLES, actionsFor } from '../../supabase/functions/_shared/theoActions';
import { NUDGE_ROLES_CLIENT } from './quickNudges';
import { resolvePushRoute } from './pushRouting';

const row = (o: Partial<NudgeStatusRow> = {}): NudgeStatusRow => ({
  checklist_id: 'c1', family_id: 'f1', title: 'AM Line Check', lock_until_time: null, is_locked: false, total_items: 12, completed_items: 5, is_complete: false, ...o,
});

describe('canNudgeChecklist', () => {
  it('open and unfinished -> ok', () => expect(canNudgeChecklist(row())).toEqual({ ok: true }));
  it('not on today', () => expect(canNudgeChecklist(null)).toMatchObject({ code: 'not_today', reason: "This checklist isn't on today's list." }));
  it('locked shows the time', () => expect(canNudgeChecklist(row({ is_locked: true, lock_until_time: '15:00:00' }))).toMatchObject({ code: 'locked', reason: 'This checklist is locked until 3:00 PM. You can nudge after it opens.' }));
  it('lock carry-over: after midnight the server says unlocked, so nudge is allowed', () => expect(canNudgeChecklist(row({ is_locked: false, lock_until_time: '15:00:00' }))).toEqual({ ok: true }));
  it('no items', () => expect(canNudgeChecklist(row({ total_items: 0, completed_items: 0 }))).toMatchObject({ code: 'no_items' }));
  it('complete', () => expect(canNudgeChecklist(row({ completed_items: 12, is_complete: true }))).toMatchObject({ code: 'complete', reason: 'This checklist is already complete.' }));
});

describe('renderNudgeText', () => {
  const f = { sender_first_name: 'Jordan', recipient_first_name: 'Maria', item: 'AM Line Check', item_type: 'checklist' as const, event_time: '6:00 PM', done: 5, total: 12 };
  it('fills all seven fields + the {checklist} alias', () => expect(renderNudgeText('{sender_first_name}/{recipient_first_name}/{item}/{item_type}/{event_time}/{done}/{total}/{checklist}', f)).toBe('Jordan/Maria/AM Line Check/checklist/6:00 PM/5/12/AM Line Check'));
  it('leaves unknown tokens', () => expect(renderNudgeText('Hi {nope} {{name}}', f)).toBe('Hi {nope} {{name}}'));
  it('blank recipient -> there', () => expect(renderNudgeText('Hey {recipient_first_name}', { ...f, recipient_first_name: '  ' })).toBe('Hey there'));
  it('firstName prefers nickname', () => { expect(firstName({ nickname: 'Mo', full_name: 'Maria Lopez' })).toBe('Mo'); expect(firstName({ full_name: 'Maria Lopez' })).toBe('Maria'); });
});

describe('DEFAULT_NUDGE_TEMPLATES', () => {
  it('equal the migration seed text', () => {
    const dir = 'drizzle/migrations';
    const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(`${dir}/${f}`, 'utf8')).filter((s) => s.includes('FUNCTION public.seed_location_nudge_templates')).pop()!;
    for (const t of DEFAULT_NUDGE_TEMPLATES) {
      expect(sql).toContain(`'${t.name}', '${t.body.replace(/'/g, "''")}', ${t.is_default}`);
    }
    expect(DEFAULT_NUDGE_TEMPLATES.filter((t) => t.is_default)).toHaveLength(1);
  });
});

const T0 = new Date('2026-10-07T20:00:00Z').getTime(); // 1:00 PM in Los Angeles
const task = (o: Partial<TaskStatusRow> = {}): TaskStatusRow => ({
  task_id: 't1', title: 'Catering order', task_style: 'standard', is_active: true, show_on_dashboard: true, completed_at: null,
  expires_at: null, last_triggered_at: null, alarm_done_this_interval: false, write_up_id: null, icon_name: 'ClipboardList', subtasks_total: 0, subtasks_done: 0, ...o,
});
describe('canNudgeTask', () => {
  const tz = 'America/Los_Angeles';
  it('ok', () => expect(canNudgeTask(task(), T0, tz)).toEqual({ ok: true }));
  it('not on dashboard', () => { expect(canNudgeTask(null, T0, tz)).toMatchObject({ code: 'not_on_dashboard' }); expect(canNudgeTask(task({ show_on_dashboard: false }), T0, tz)).toMatchObject({ code: 'not_on_dashboard' }); expect(canNudgeTask(task({ is_active: false }), T0, tz)).toMatchObject({ code: 'not_on_dashboard', reason: "This task isn't on the dashboard." }); });
  it('complete', () => expect(canNudgeTask(task({ completed_at: '2026-10-07T19:00:00Z' }), T0, tz)).toMatchObject({ code: 'complete', reason: 'This task is already done.' }));
  it('expired', () => expect(canNudgeTask(task({ expires_at: '2026-10-07T19:59:00Z' }), T0, tz)).toMatchObject({ code: 'expired' }));
  it('personal (write-up / opus)', () => { expect(canNudgeTask(task({ write_up_id: 'w' }), T0, tz)).toMatchObject({ code: 'personal' }); expect(canNudgeTask(task({ icon_name: 'opus_logo' }), T0, tz)).toMatchObject({ code: 'personal' }); });
  it('alarm not due', () => expect(canNudgeTask(task({ task_style: 'alarm' }), T0, tz)).toMatchObject({ code: 'not_due', reason: "This alarm task isn't due right now." }));
  it('alarm done this interval', () => expect(canNudgeTask(task({ task_style: 'alarm', last_triggered_at: '2026-10-07T19:30:00Z', alarm_done_this_interval: true }), T0, tz)).toMatchObject({ code: 'complete', reason: 'This task is already done for now.' }));
  it('alarm due and open', () => expect(canNudgeTask(task({ task_style: 'alarm', last_triggered_at: '2026-10-07T19:30:00Z' }), T0, tz)).toEqual({ ok: true }));
});

const ev = (o: Partial<EventStatusRow> = {}): EventStatusRow => ({ event_id: 'e1', title: 'Staff meeting', event_time: '18:00:00', event_end_time: null, is_today: true, completed_today: false, ...o });
describe('canNudgeEvent', () => {
  const tz = 'America/Los_Angeles';
  it('before start is allowed', () => expect(canNudgeEvent(ev(), T0, tz)).toEqual({ ok: true }));
  it('not today', () => expect(canNudgeEvent(ev({ is_today: false }), T0, tz)).toMatchObject({ code: 'not_today', reason: "This event isn't on today's list." }));
  it('done', () => expect(canNudgeEvent(ev({ completed_today: true }), T0, tz)).toMatchObject({ code: 'complete' }));
  it('over', () => expect(canNudgeEvent(ev({ event_time: '11:00:00', event_end_time: '12:30:00' }), T0, tz)).toMatchObject({ code: 'over', reason: 'This event is already over.' }));
  it('still running', () => expect(canNudgeEvent(ev({ event_time: '12:00:00', event_end_time: '14:00:00' }), T0, tz)).toEqual({ ok: true }));
});

describe('fieldsFor + missingFields', () => {
  it('checklist has everything but event time', () => expect(fieldsFor('checklist')).not.toContain('event_time'));
  it('task without subtasks has no done/total', () => { expect(fieldsFor('task', false)).not.toContain('done'); expect(fieldsFor('task', true)).toContain('total'); });
  it('event has event time, no done/total', () => { expect(fieldsFor('event')).toContain('event_time'); expect(fieldsFor('event')).not.toContain('done'); });
  it('missingFields lists unavailable known fields only', () => {
    expect(missingFields('{item} at {done}/{total} {nope}', fieldsFor('event'))).toEqual(['done', 'total']);
    expect(missingFields('{checklist} at {event_time}', fieldsFor('checklist'))).toEqual(['event_time']);
    expect(missingFields('{checklist}', fieldsFor('event'))).toEqual([]);
  });
});

describe('onClockIds', () => {
  const now = new Date('2026-10-07T20:00:00Z').getTime();
  const p = (type: string, iso: string) => ({ id: iso + type, punch_type: type, punch_time: iso });
  it('open / closed / on break / >24h', () => {
    expect(onClockIds({
      open: [p('clock_in', '2026-10-07T15:00:00Z')],
      closed: [p('clock_in', '2026-10-07T12:00:00Z'), p('clock_out', '2026-10-07T18:00:00Z')],
      break: [p('clock_in', '2026-10-07T15:00:00Z'), p('break_start', '2026-10-07T19:00:00Z')],
      old: [p('clock_in', '2026-10-06T19:00:00Z')],
    }, now).sort()).toEqual(['break', 'open']);
  });
  it('other store punches are filtered before (query is per store): none -> nobody', () => expect(onClockIds({}, now)).toEqual([]));
});

describe('splitCooldown', () => {
  const now = new Date('2026-10-07T20:00:00Z').getTime();
  it('59 min -> recently, 61 min -> going', () => {
    const r = splitCooldown([{ id: 'a' }, { id: 'b' }], { a: new Date(now - 59 * 60000).toISOString(), b: new Date(now - 61 * 60000).toISOString() }, now);
    expect(r.recently.map((x) => x.id)).toEqual(['a']);
    expect(r.recently[0].minutes_ago).toBe(59);
    expect(r.going.map((x) => x.id)).toEqual(['b']);
  });
});

describe('matchTarget across types', () => {
  const rows = [{ type: 'checklist', title: 'Closing Checklist' }, { type: 'task', title: 'Catering order' }, { type: 'event', title: 'Staff meeting' }, { type: 'task', title: 'Staff lunch' }];
  it('one task', () => expect(matchTarget('catering order', rows)).toEqual({ one: rows[1] }));
  it('one event', () => expect(matchTarget('the staff meeting', rows)).toEqual({ none: true }));
  it('exact event', () => expect(matchTarget('Staff Meeting', rows)).toEqual({ one: rows[2] }));
  it('several across types', () => expect(matchTarget('staff', rows)).toMatchObject({ several: [rows[2], rows[3]] }));
  it('closing checklist', () => expect(matchTarget('closing', rows)).toEqual({ one: rows[0] }));
});

describe('matchChecklist', () => {
  const rows = [{ title: 'AM Line Check' }, { title: 'Shift Change Line Check' }, { title: 'Daily Deep Cleaning' }];
  it('one', () => expect(matchChecklist('am line check', rows)).toEqual({ one: rows[0] }));
  it('several', () => expect(matchChecklist('line check', rows)).toMatchObject({ several: [rows[0], rows[1]] }));
  it('none', () => expect(matchChecklist('closing', rows)).toEqual({ none: true }));
  it('deep cleaning checklist', () => expect(matchChecklist('deep cleaning checklist', rows)).toEqual({ one: rows[2] }));
});

describe('who can nudge', () => {
  it('server and client lists are equal', () => expect(NUDGE_ROLES_CLIENT).toEqual(NUDGE_ROLES));
  for (const r of ['shift_manager', 'shift_manager_in_training', 'team_member']) it(`${r} refused`, () => expect(actionsFor(r, true).quick_nudge).toBe(false));
  for (const r of NUDGE_ROLES) it(`${r} allowed`, () => expect(actionsFor(r, true).quick_nudge).toBe(true));
});

describe('push tap', () => {
  const id = '3b6a1d0e-1111-4222-8333-444455556666';
  it('quick_nudge checklist -> /complete/<id>', () => expect(resolvePushRoute({ type: 'quick_nudge', target_type: 'checklist', target_id: id, url: `/complete/${id}` })).toBe(`/complete/${id}`));
  it('quick_nudge task -> /?alert=<notification_id>', () => expect(resolvePushRoute({ type: 'quick_nudge', target_type: 'task', target_id: id, notification_id: `nudge:task:${id}` })).toBe(`/?alert=${encodeURIComponent(`nudge:task:${id}`)}`));
  it('quick_nudge event -> /?alert=<notification_id>', () => expect(resolvePushRoute({ type: 'quick_nudge', target_type: 'event', target_id: id, notification_id: 'nudge:event:x' })).toBe('/?alert=nudge%3Aevent%3Ax'));
  it('checklist_nudge -> /complete/<id>', () => expect(resolvePushRoute({ type: 'checklist_nudge', checklist_id: id, url: `/complete/${id}` })).toBe(`/complete/${id}`));
  it('bad id falls back to dashboard', () => expect(resolvePushRoute({ type: 'checklist_nudge', checklist_id: 'x', url: '/complete/x' })).toBe('/dashboard'));
  it('overdue -> /dashboard', () => expect(resolvePushRoute({ type: 'overdue_checklists', checklist_id: id })).toBe('/dashboard'));
});
