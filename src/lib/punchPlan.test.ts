import { describe, it, expect } from 'vitest';
import { openClockIn, parseSaidTime, zonedToUtc, checkPunch, canRemovePlaceholder, NO_SHIFT_FLAG, AFTER_FACT_FLAG, type Punch } from '../../supabase/functions/_shared/punchPlan';
import { actionsFor } from '../../supabase/functions/_shared/theoActions';

const T = (iso: string) => new Date(iso).getTime();
const P = (id: string, punch_type: string, punch_time: string): Punch => ({ id, punch_type, punch_time });
const fmt = (iso: string) => iso;
const base = { name: 'Cheyenne Ruiz', punches: [] as Punch[], shifts: [] as any[], atLocalMin: 510, meeting: null, fmt };
const NOW = T('2026-10-05T17:00:00Z'); // 10:00 AM Pacific

describe('openClockIn (same test as the database)', () => {
  it('open clock-in in last 24h', () => expect(openClockIn([P('a', 'clock_in', '2026-10-05T15:00:00Z')], NOW)?.clockIn.id).toBe('a'));
  it('closed -> null', () => expect(openClockIn([P('a', 'clock_in', '2026-10-05T15:00:00Z'), P('b', 'clock_out', '2026-10-05T16:00:00Z')], NOW)).toBeNull());
  it('older than 24h -> null', () => expect(openClockIn([P('a', 'clock_in', '2026-10-04T16:00:00Z')], NOW)).toBeNull());
  it('overnight: 6 PM in, still open at 1 AM', () => expect(openClockIn([P('a', 'clock_in', '2026-10-05T01:00:00Z')], T('2026-10-05T08:00:00Z'))?.clockIn.id).toBe('a'));
  it('last punch is break_start', () => expect(openClockIn([P('a', 'clock_in', '2026-10-05T15:00:00Z'), P('b', 'break_start', '2026-10-05T16:00:00Z')], NOW)?.last.punch_type).toBe('break_start'));
});

describe('parseSaidTime', () => {
  it('now / empty', () => { expect(parseSaidTime('', 600)).toBe('now'); expect(parseSaidTime('now', 600)).toBe('now'); });
  it('8:30 at 10 AM -> 8:30 AM', () => expect(parseSaidTime('8:30', 600)).toBe(510));
  it('4 at 5 PM -> 4 PM', () => expect(parseSaidTime('4', 1020)).toBe(960));
  it('4 pm', () => expect(parseSaidTime('4 pm', 600)).toBe(960));
  it('16:00', () => expect(parseSaidTime('16:00', 600)).toBe(960));
  it('nonsense -> null', () => expect(parseSaidTime('later', 600)).toBeNull());
});

describe('zonedToUtc', () => {
  it('Pacific daylight', () => expect(zonedToUtc('2026-10-05', 510, 'America/Los_Angeles')).toBe('2026-10-05T15:30:00.000Z'));
  it('Chicago', () => expect(zonedToUtc('2026-10-05', 510, 'America/Chicago')).toBe('2026-10-05T13:30:00.000Z'));
});

describe('checkPunch', () => {
  const shift = { id: 's1', start_time: '08:30:00', end_time: '16:00:00' };
  it('1 clock in at 8:30 with one shift: attaches it, after-the-fact flag', () => {
    const r = checkPunch({ ...base, kind: 'in', at: T('2026-10-05T15:30:00Z'), now: NOW, shifts: [shift] });
    expect(r).toMatchObject({ ok: true, shift_id: 's1' }); if (r.ok) expect(r.flags).toEqual([AFTER_FACT_FLAG]);
  });
  it('2 clock in now, no flags beyond start window', () => {
    const r = checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, shifts: [{ ...shift, start_time: '10:00:00' }], atLocalMin: 600 });
    expect(r).toEqual({ ok: true, flags: [], shift_id: 's1', open_clock_in: null });
  });
  it('two shifts that day -> no shift sent', () => { const r = checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, atLocalMin: 600, shifts: [shift, { ...shift, id: 's2', start_time: '10:00:00' }] }); expect(r.ok && r.shift_id).toBeNull(); });
  it('3/4 clock out never attaches a shift and names the clock-in', () => {
    const r = checkPunch({ ...base, kind: 'out', at: NOW, now: NOW, punches: [P('a', 'clock_in', '2026-10-05T15:30:00Z')], shifts: [shift] });
    expect(r).toMatchObject({ ok: true, shift_id: null }); if (r.ok) expect(r.open_clock_in?.id).toBe('a');
  });
  it('6 already clocked in: blocked with the time', () => { const r = checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, punches: [P('a', 'clock_in', '2026-10-05T15:30:00Z')] }); expect(r).toEqual({ ok: false, reason: 'Cheyenne is already clocked in, since 2026-10-05T15:30:00Z.' }); });
  it('already in via break punch: blocked', () => expect(checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, punches: [P('a', 'clock_in', '2026-10-05T15:00:00Z'), P('b', 'break_end', '2026-10-05T16:00:00Z')] }).ok).toBe(false));
  it('7 clock out someone not in: blocked', () => expect(checkPunch({ ...base, kind: 'out', at: NOW, now: NOW })).toEqual({ ok: false, reason: "Cheyenne isn't clocked in." }));
  it('8 on break: blocked', () => expect(checkPunch({ ...base, kind: 'out', at: NOW, now: NOW, punches: [P('a', 'clock_in', '2026-10-05T15:00:00Z'), P('b', 'break_start', '2026-10-05T16:30:00Z')] })).toEqual({ ok: false, reason: 'Cheyenne is on a break. End it first.' }));
  it('9 no shift: flag, still confirmable', () => { const r = checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, atLocalMin: 600 }); expect(r.ok && r.flags).toEqual([NO_SHIFT_FLAG]); expect(NO_SHIFT_FLAG).toBe('No scheduled shift. Confirming also adds a placeholder shift to the schedule.'); });
  it('10 future time: blocked (in and out)', () => {
    expect(checkPunch({ ...base, kind: 'in', at: NOW + 3600_000, now: NOW }).ok).toBe(false);
    expect(checkPunch({ ...base, kind: 'out', at: NOW + 3600_000, now: NOW, punches: [P('a', 'clock_in', '2026-10-05T15:00:00Z')] }).ok).toBe(false);
  });
  it('clock out before the clock-in: blocked', () => expect(checkPunch({ ...base, kind: 'out', at: T('2026-10-05T14:00:00Z'), now: NOW, punches: [P('a', 'clock_in', '2026-10-05T15:00:00Z')] }).ok).toBe(false));
  it('overnight clock out at 1 AM works', () => expect(checkPunch({ ...base, kind: 'out', at: T('2026-10-05T08:00:00Z'), now: T('2026-10-05T08:00:00Z'), punches: [P('a', 'clock_in', '2026-10-05T01:00:00Z')] }).ok).toBe(true));
  it('more than 30 min from scheduled start: flag', () => { const r = checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, atLocalMin: 600, shifts: [shift] }); expect(r.ok && r.flags.some((f) => f.includes('30 minutes'))).toBe(true); });
  it('more than 16 hours: flag', () => { const r = checkPunch({ ...base, kind: 'out', at: NOW, now: NOW, punches: [P('a', 'clock_in', '2026-10-04T23:00:00Z')] }); expect(r.ok && r.flags.some((f) => f.includes('16 hours'))).toBe(true); });
  it('meeting noted', () => { const r = checkPunch({ ...base, kind: 'in', at: NOW, now: NOW, atLocalMin: 600, meeting: 'All-store meeting' }); expect(r.ok && r.flags.some((f) => f.startsWith('Meeting: All-store meeting'))).toBe(true); });
});

describe('placeholder shift on Undo', () => {
  const ok = { is_phantom: true, shift_created_at: '2026-10-05T17:00:00Z', punch_created_at: '2026-10-05T17:00:00.300Z', other_refs: 0 };
  it('all true -> remove', () => expect(canRemovePlaceholder(ok)).toBe(true));
  it('real shift -> never', () => expect(canRemovePlaceholder({ ...ok, is_phantom: false })).toBe(false));
  it('created more than a minute apart -> keep', () => expect(canRemovePlaceholder({ ...ok, shift_created_at: '2026-10-05T16:58:00Z' })).toBe(false));
  it('referenced elsewhere -> keep', () => expect(canRemovePlaceholder({ ...ok, other_refs: 1 })).toBe(false));
});

describe('12 roles', () => {
  for (const r of ['team_member', 'shift_manager_in_training', 'shift_manager', 'brand_admin']) it(`${r}: no punch action`, () => expect(actionsFor(r, true).clock_punch).toBe(false));
  for (const r of ['manager', 'admin', 'org_admin', 'super_admin']) it(`${r}: punch action`, () => expect(actionsFor(r, true).clock_punch).toBe(true));
  it('no store access -> none', () => expect(actionsFor('super_admin', false).clock_punch).toBe(false));
});
