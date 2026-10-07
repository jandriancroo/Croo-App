import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { canNudgeChecklist, renderNudgeText, DEFAULT_NUDGE_TEMPLATES, onClockIds, splitCooldown, matchChecklist, firstName, type NudgeStatusRow } from '../../supabase/functions/_shared/nudgePlan';
import { NUDGE_ROLES, actionsFor } from '../../supabase/functions/_shared/theoActions';
import { NUDGE_ROLES_CLIENT } from './checklistNudges';
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
  const f = { sender_first_name: 'Jordan', recipient_first_name: 'Maria', checklist: 'AM Line Check', done: 5, total: 12 };
  it('fills all five fields', () => expect(renderNudgeText('{sender_first_name}/{recipient_first_name}/{checklist}/{done}/{total}', f)).toBe('Jordan/Maria/AM Line Check/5/12'));
  it('leaves unknown tokens', () => expect(renderNudgeText('Hi {nope} {{name}}', f)).toBe('Hi {nope} {{name}}'));
  it('blank recipient -> there', () => expect(renderNudgeText('Hey {recipient_first_name}', { ...f, recipient_first_name: '  ' })).toBe('Hey there'));
  it('firstName prefers nickname', () => { expect(firstName({ nickname: 'Mo', full_name: 'Maria Lopez' })).toBe('Mo'); expect(firstName({ full_name: 'Maria Lopez' })).toBe('Maria'); });
});

describe('DEFAULT_NUDGE_TEMPLATES', () => {
  it('equal the migration seed text', () => {
    const dir = 'drizzle/migrations';
    const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`${dir}/${f}`, 'utf8')).find((s) => s.includes('seed_location_nudge_templates'))!;
    for (const t of DEFAULT_NUDGE_TEMPLATES) {
      expect(sql).toContain(`'${t.name}', '${t.body.replace(/'/g, "''")}', ${t.is_default}`);
    }
    expect(DEFAULT_NUDGE_TEMPLATES.filter((t) => t.is_default)).toHaveLength(1);
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

describe('matchChecklist', () => {
  const rows = [{ title: 'AM Line Check' }, { title: 'Shift Change Line Check' }, { title: 'Daily Deep Cleaning' }];
  it('one', () => expect(matchChecklist('am line check', rows)).toEqual({ one: rows[0] }));
  it('several', () => expect(matchChecklist('line check', rows)).toMatchObject({ several: [rows[0], rows[1]] }));
  it('none', () => expect(matchChecklist('closing', rows)).toEqual({ none: true }));
  it('deep cleaning checklist', () => expect(matchChecklist('deep cleaning checklist', rows)).toEqual({ one: rows[2] }));
});

describe('who can nudge', () => {
  it('server and client lists are equal', () => expect(NUDGE_ROLES_CLIENT).toEqual(NUDGE_ROLES));
  for (const r of ['shift_manager', 'shift_manager_in_training', 'team_member']) it(`${r} refused`, () => expect(actionsFor(r, true).nudge_checklist).toBe(false));
  for (const r of NUDGE_ROLES) it(`${r} allowed`, () => expect(actionsFor(r, true).nudge_checklist).toBe(true));
});

describe('push tap', () => {
  const id = '3b6a1d0e-1111-4222-8333-444455556666';
  it('checklist_nudge -> /complete/<id>', () => expect(resolvePushRoute({ type: 'checklist_nudge', checklist_id: id, url: `/complete/${id}` })).toBe(`/complete/${id}`));
  it('bad id falls back to dashboard', () => expect(resolvePushRoute({ type: 'checklist_nudge', checklist_id: 'x', url: '/complete/x' })).toBe('/dashboard'));
  it('overdue -> /dashboard', () => expect(resolvePushRoute({ type: 'overdue_checklists', checklist_id: id })).toBe('/dashboard'));
});
