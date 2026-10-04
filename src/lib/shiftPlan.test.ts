import { describe, it, expect } from 'vitest';
import { addShiftWarnings, addHardStop, buildDayView, shiftRefusal, deleteInfo, dayOffset, mondayOf, normTime, type DayShift } from '../../supabase/functions/_shared/shiftPlan';
import { hurdleFor, type CoverInput } from '../../supabase/functions/_shared/coverCandidates';
import { APP_ROLE_ORDER, APP_ROLE_NAMES } from '../../supabase/functions/_shared/appRoles';
import { normalizeWeeklyAvailability, conflictingBlocks } from '@/types/availability';

// Saturday Oct 17 2026 at a test store.
const DATE = '2026-10-17';
const ETHAN = { id: 'ethan', name: 'Ethan Andrian' };
const ds = (id: string, user_id: string, name: string, s: string, e: string, template_id: string | null = null, position: string | null = null): DayShift =>
  ({ id, user_id, name, template_id, position, start_time: s, end_time: e });
const NEW = (s: string, e: string, template_id: string | null = null, position: string | null = null) => ({ shift_date: DATE, start_time: s, end_time: e, template_id, position });
const warn = (shift: ReturnType<typeof NEW>, dayShifts: DayShift[], hurdle: any = null, weekShifts: any[] = []) =>
  addShiftWarnings({ person: ETHAN, shift, dayShifts, weekShifts, hurdle });

describe('add-a-shift warnings (never block)', () => {
  it('already works that day, not overlapping', () => {
    expect(warn(NEW('17:00:00', '23:00:00'), [ds('a', 'ethan', 'Ethan Andrian', '09:00:00', '15:00:00')]).warnings).toEqual(['Ethan already works 9 AM – 3 PM that day']);
  });
  it('already working then, overlapping', () => {
    expect(warn(NEW('18:00:00', '22:00:00'), [ds('a', 'ethan', 'Ethan Andrian', '17:00:00', '23:00:00')]).warnings).toEqual(['Ethan is already working 5 PM – 11 PM then']);
  });
  it('approved time off comes through from the cover check (hurdleFor)', () => {
    const input: CoverInput = {
      shift: { id: 'new', user_id: '', shift_date: DATE, start_time: '09:00:00', end_time: '16:00:00' }, coveredRole: null,
      people: [{ id: 'ethan', name: 'Ethan Andrian', role: 'team_member', weekly_availability: null }],
      timeOff: [{ user_id: 'ethan', start_date: DATE, end_date: null, start_time: null, end_time: null, time_scope: 'full_day', status: 'approved' }],
      weekShifts: [], roleOrder: APP_ROLE_ORDER, roleNames: APP_ROLE_NAMES,
      avail: { normalizeWeekly: normalizeWeeklyAvailability as any, conflictingBlocks: conflictingBlocks as any },
    };
    const h = hurdleFor(input.people[0], input);
    expect(warn(NEW('09:00:00', '16:00:00'), [], h).warnings).toEqual(['Ethan has approved time off Saturday']);
  });
  it('weekday unavailable comes through too', () => {
    expect(warn(NEW('09:00:00', '16:00:00'), [], { kind: 'unavailable', reason: "Ethan isn't available Saturdays" }).warnings).toEqual(["Ethan isn't available Saturdays"]);
  });
  it('template already filled names who', () => {
    expect(warn(NEW('17:30:00', '23:00:00', 't2', 'PM Line 2'), [ds('c', 'chey', 'Cheyenne Nauretz', '17:30:00', '23:00:00', 't2', 'PM Line 2')]).warnings)
      .toEqual(['Cheyenne is already on PM Line 2 that day']); // not repeated as "similar hours"
  });
  it('similar hours: 59 minutes apart warns', () => {
    expect(warn(NEW('17:59:00', '23:59:00'), [ds('j', 'jay', 'Jaysen Robertson', '17:00:00', '23:00:00')]).warnings).toEqual(['Jaysen works 5 PM – 11 PM, close to these hours']);
  });
  it('similar hours: 61 minutes apart does not', () => {
    expect(warn(NEW('18:01:00', '23:00:00'), [ds('j', 'jay', 'Jaysen Robertson', '17:00:00', '23:00:00')]).warnings).toEqual([]);
  });
  it('weekly hours information', () => {
    expect(warn(NEW('17:30:00', '23:00:00'), [], null, [{ user_id: 'ethan', start_time: '09:00:00', end_time: '17:00:00' }, { user_id: 'ethan', start_time: '09:00:00', end_time: '17:00:00', is_time_off: true }]).info)
      .toEqual(['This brings Ethan to 13.5 hours this week']);
  });
});

describe('add-a-shift hard stops', () => {
  const ok = { personMatches: 1, onRoster: true, date: DATE, today: '2026-10-04', start: '09:00:00', end: '16:00:00' };
  it('passes', () => expect(addHardStop(ok)).toBeNull());
  it('unknown name', () => expect(addHardStop({ ...ok, personMatches: 0 })).toBe('not_found'));
  it('two people with the name', () => expect(addHardStop({ ...ok, personMatches: 2 })).toBe('which_person'));
  it('not on the roster', () => expect(addHardStop({ ...ok, onRoster: false })).toMatch(/isn't on this store's schedule/));
  it('date in the past', () => expect(addHardStop({ ...ok, date: '2026-10-03' })).toMatch(/already passed/));
  it('28 days ahead is fine, 29 is not', () => {
    expect(addHardStop({ ...ok, date: '2026-11-01' })).toBeNull();
    expect(addHardStop({ ...ok, date: '2026-11-02' })).toMatch(/four weeks/);
  });
  it('bad hours', () => {
    expect(addHardStop({ ...ok, start: null })).toMatch(/hours/);
    expect(addHardStop({ ...ok, end: '09:00:00' })).toMatch(/hours/);
    expect(normTime('25:00')).toBeNull();
    expect(normTime('17:30')).toBe('17:30:00');
  });
});

describe('weekday number Theo writes (Monday = 0)', () => {
  it('offset from the week Monday', () => {
    expect(mondayOf('2026-10-17')).toBe('2026-10-12');
    expect(dayOffset('2026-10-12', '2026-10-12')).toBe(0);
    expect(dayOffset('2026-10-17', '2026-10-12')).toBe(5);
    expect(dayOffset('2026-10-18', mondayOf('2026-10-18'))).toBe(6);
  });
});

describe('delete / cover refusals', () => {
  const base = { shift: { shift_date: '2026-10-17', start_time: '17:00:00' }, today: '2026-10-04', nowHHMM: '12:00', openOffer: false, punchLinked: false, purpose: 'delete' as const };
  it('allowed', () => expect(shiftRefusal(base)).toBeNull());
  it('open offer -> shift pool', () => expect(shiftRefusal({ ...base, openOffer: true })).toBe('That shift is posted in the shift pool. Handle it there.'));
  it('punch linked', () => expect(shiftRefusal({ ...base, punchLinked: true })).toMatch(/punches/));
  it('phantom', () => expect(shiftRefusal({ ...base, shift: { ...base.shift, is_phantom: true } })).toMatch(/automatically/));
  it('coverage-only', () => expect(shiftRefusal({ ...base, shift: { ...base.shift, is_coverage_only: true } })).toMatch(/coverage-only/));
  it('past', () => expect(shiftRefusal({ ...base, shift: { ...base.shift, shift_date: '2026-10-03' } })).toMatch(/in the past/));
  it('today, already started', () => expect(shiftRefusal({ ...base, today: '2026-10-17', nowHHMM: '17:00' })).toMatch(/already started/));
  it('today, not started yet', () => expect(shiftRefusal({ ...base, today: '2026-10-17', nowHHMM: '16:59' })).toBeNull());
  it('cover wording', () => expect(shiftRefusal({ ...base, purpose: 'cover', punchLinked: true })).toMatch(/can't cover/));
});

describe('day view payload', () => {
  const day = [ds('b', 'jay', 'Jaysen Robertson', '17:00:00', '23:00:00'), ds('a', 'alle', 'Alle Rowe', '09:00:00', '16:00:00', 't1', 'AM Manager'), ds('c', 'aub', 'Aubrey Andrian', '09:00:00', '15:00:00')];
  it('sorted by start then name, new row marked', () => {
    const v = buildDayView(DATE, day, { kind: 'new', shift: ds('new', 'ethan', 'Ethan Andrian', '12:00:00', '19:00:00') });
    expect(v.rows.map((r) => r.name)).toEqual(['Alle Rowe', 'Aubrey Andrian', 'Ethan Andrian', 'Jaysen Robertson']);
    expect(v.rows.find((r) => r.kind === 'new')?.position).toBe('No position');
    expect(v.title).toBe('Saturday, Oct 17 · the day with Ethan added');
    expect('axis' in v).toBe(false);
  });
  it('removed row stays in the list, marked', () => {
    const v = buildDayView(DATE, day, { kind: 'removed', shift_id: 'b' });
    expect(v.rows).toHaveLength(3);
    expect(v.rows.find((r) => r.id === 'b')?.kind).toBe('removed');
    expect(v.rows.filter((r) => r.kind)).toHaveLength(1);
  });
  it('cover shows two adjacent rows: original removed, then replacement covering', () => {
    const v = buildDayView(DATE, day, { kind: 'cover', shift_id: 'a', to: { id: 'eth', name: 'Ethan Andrian' } });
    expect(v.rows).toHaveLength(4);
    const i = v.rows.findIndex((r) => r.kind === 'removed');
    const [was, now] = [v.rows[i], v.rows[i + 1]];
    expect([was.name, was.kind, was.position, was.time]).toEqual(['Alle Rowe', 'removed', 'AM Manager', now.time]);
    expect([now.name, now.kind, now.position]).toEqual(['Ethan Andrian', 'cover', 'AM Manager']);
    expect(was.id).not.toBe(now.id);
    expect(new Set(v.rows.map((r) => r.id)).size).toBe(v.rows.length);
    expect(v.rows.some((r) => 'from' in r)).toBe(false);
  });
  it('cover pair stays together, removed first, even when the replacement name sorts first', () => {
    const v = buildDayView(DATE, day, { kind: 'cover', shift_id: 'a', to: { id: 'z', name: 'Aaron Zed' } });
    const i = v.rows.findIndex((r) => r.kind === 'removed');
    expect([v.rows[i].name, v.rows[i + 1].name]).toEqual(['Alle Rowe', 'Aaron Zed']);
  });
  it('delete info lines', () => {
    const me = ds('c', 'chey', 'Cheyenne Nauretz', '17:30:00', '23:00:00', 't2', 'PM Line 2');
    expect(deleteInfo({ shift: me, dayShifts: [me], weekShifts: [{ user_id: 'chey', start_time: '17:30:00', end_time: '23:00:00' }, { user_id: 'chey', start_time: '09:00:00', end_time: '17:00:00' }] }))
      .toEqual(['This leaves no one on PM Line 2 that day', 'This takes Cheyenne to 8 hours this week']);
  });
});

// ---------------------------------------------------------------- build 4
import { swapPlan, swapHurdle, changeHours, changeShiftWarnings } from '../../supabase/functions/_shared/shiftPlan';
import type { CoverPerson, CoverTimeOff, CoverWeekShift } from '../../supabase/functions/_shared/coverCandidates';

const MON = '2026-10-12';
const RYAN: CoverPerson = { id: 'ryan', name: 'Ryan Lorenzo Cuen', role: 'team_member', weekly_availability: null };
const JOSH: CoverPerson = { id: 'josh', name: 'Joshua Haro', role: 'shift_manager', weekly_availability: null };
const sh = (id: string, user_id: string, s: string, e: string, date = MON) => ({ id, user_id, shift_date: date, start_time: s, end_time: e, schedule_id: 'w' });
const inputFor = (shift: ReturnType<typeof sh>, coveredRole: string, week: CoverWeekShift[], timeOff: CoverTimeOff[] = [], people: CoverPerson[] = [RYAN, JOSH]): CoverInput => ({
  shift, coveredRole, people, timeOff, weekShifts: week, roleOrder: APP_ROLE_ORDER, roleNames: APP_ROLE_NAMES,
  avail: { normalizeWeekly: normalizeWeeklyAvailability as any, conflictingBlocks: conflictingBlocks as any },
});
const R = sh('r', 'ryan', '09:00:00', '15:00:00');
const J = sh('j', 'josh', '12:00:00', '20:00:00'); // overlaps Ryan's own shift
const WEEK = [R, J];
const plan = (week = WEEK, timeOff: CoverTimeOff[] = [], ryan = RYAN, josh = JOSH) =>
  swapPlan({ shift: R, person: ryan, input: inputFor(R, 'team_member', week, timeOff, [ryan, josh]) }, { shift: J, person: josh, input: inputFor(J, 'shift_manager', week, timeOff, [ryan, josh]) });

describe('swap check (both ways, the shift given up left out)', () => {
  it('overlapping shifts still swap: the shift each gives up does not count as already working', () => {
    expect(swapHurdle(RYAN, inputFor(J, 'shift_manager', WEEK), 'r')).toBeNull();
    expect(swapHurdle(JOSH, inputFor(R, 'team_member', WEEK), 'j')).toBeNull();
    expect('stop' in plan()).toBe(false);
  });
  it('without leaving it out the cover check would block (proves the rule)', () => {
    expect(hurdleFor(RYAN, inputFor(J, 'shift_manager', WEEK))?.kind).toBe('working_then');
  });
  it('time off blocks (checked on the person taking the shift)', () => {
    const p = plan(WEEK, [{ user_id: 'josh', start_date: MON, end_date: null, start_time: null, end_time: null, time_scope: 'full_day', status: 'approved' }]);
    expect(p).toEqual({ stop: "Joshua has approved time off Monday, so I can't swap them." });
  });
  it('pending time off blocks too (same as cover)', () => {
    const p = plan(WEEK, [{ user_id: 'ryan', start_date: MON, end_date: null, start_time: null, end_time: null, time_scope: 'full_day', status: 'pending' }]);
    expect(p).toEqual({ stop: "Ryan has time off requested Monday, so I can't swap them." });
  });
  it('weekly availability blocks', () => {
    const ryan = { ...RYAN, weekly_availability: { monday: { available: false } } };
    expect(plan(WEEK, [], ryan)).toEqual({ stop: "Ryan isn't available Mondays, so I can't swap them." });
  });
  it('already working during the other shift (a third shift) blocks', () => {
    const week = [...WEEK, sh('r2', 'ryan', '17:00:00', '22:00:00')];
    expect(plan(week)).toEqual({ stop: "Ryan is already working 5 PM – 10 PM that day, so I can't swap them." });
  });
  it('role warning, never a block: a team member takes a shift manager shift', () => {
    const p = plan() as { warnings: string[]; info: string[] };
    expect(p.warnings).toEqual(['Ryan is tagged: Not a shift manager']);
    expect(p.info).toEqual(['This brings Ryan to 8 hours this week', 'This brings Joshua to 6 hours this week']);
  });
  it('same person -> stop', () => {
    expect(swapPlan({ shift: R, person: RYAN, input: inputFor(R, 'team_member', WEEK) }, { shift: { ...R, id: 'r3' }, person: RYAN, input: inputFor(R, 'team_member', WEEK) })).toEqual({ stop: "That's the same person." });
  });
  it('refusals apply with purpose swap', () => {
    const base = { shift: { shift_date: MON, start_time: '09:00:00' }, today: '2026-10-04', nowHHMM: '12:00', openOffer: false, punchLinked: false, purpose: 'swap' as const };
    expect(shiftRefusal({ ...base, shift: { ...base.shift, shift_date: '2026-10-03' } })).toBe("That shift is in the past, so I can't swap it. Use the Schedule page.");
    expect(shiftRefusal({ ...base, today: MON, nowHHMM: '09:00' })).toMatch(/already started, so I can't swap/);
    expect(shiftRefusal({ ...base, openOffer: true })).toMatch(/shift pool/);
    expect(shiftRefusal({ ...base, punchLinked: true, purpose: 'change' })).toMatch(/can't change it/);
  });
  it('day view: both shifts once each, new names, chip Swapped, no removed rows', () => {
    const day = [ds('r', 'ryan', 'Ryan Lorenzo Cuen', '09:00:00', '15:00:00'), ds('j', 'josh', 'Joshua Haro', '12:00:00', '20:00:00'), ds('x', 'al', 'Alle Rowe', '09:00:00', '16:00:00')];
    const v = buildDayView(MON, day, { kind: 'swapped', to: { r: { id: 'josh', name: 'Joshua Haro' }, j: { id: 'ryan', name: 'Ryan Lorenzo Cuen' } } });
    expect(v.rows.filter((r) => r.kind === 'swapped').map((r) => `${r.name} ${r.time}`)).toEqual(['Joshua Haro 9 AM – 3 PM', 'Ryan Lorenzo Cuen 12 PM – 8 PM']);
    expect(v.rows.some((r) => r.kind === 'removed')).toBe(false);
    expect(v.rows).toHaveLength(3);
  });
});

describe('change hours', () => {
  const cur = { start_time: '09:00:00', end_time: '16:00:00' };
  const ch = (start: string | null, end: string | null) => changeHours({ name: 'Alle Rowe', cur, start: start && normTime(start), end: end && normTime(end), startGiven: start !== null, endGiven: end !== null });
  it('both ends', () => expect(ch('10:00', '16:00')).toEqual({ start: '10:00:00', end: '16:00:00' }));
  it('end only ("stay till 5")', () => expect(ch(null, '17:00')).toEqual({ start: '09:00:00', end: '17:00:00' }));
  it('start only ("start at 10")', () => expect(ch('10:00', null)).toEqual({ start: '10:00:00', end: '16:00:00' }));
  it('same hours -> already', () => expect(ch('9:00', '16:00')).toEqual({ stop: "That's already Alle's shift." }));
  it('invalid -> ask again', () => expect(ch('25:00', '16:00')).toEqual({ stop: "Those hours don't work. What hours should the shift be?" }));
  it('start = end -> invalid', () => expect(ch('16:00', null)).toEqual({ stop: "Those hours don't work. What hours should the shift be?" }));
  const me = { ...ds('a', 'alle', 'Alle Rowe', '09:00:00', '16:00:00', 't1', 'AM Manager'), shift_date: MON };
  const other = ds('n', 'nic', 'Nicole Mendez', '10:30:00', '16:30:00');
  it('the changed shift is left out: no "already works" or "close to these hours" against itself', () => {
    const r = changeShiftWarnings({ shift: me, start: '10:00:00', end: '16:00:00', dayShifts: [me], weekShifts: [{ id: 'a', user_id: 'alle', start_time: '09:00:00', end_time: '16:00:00' }], hurdle: null });
    expect(r).toEqual({ warnings: [], info: ['This takes Alle to 6 hours this week'] });
  });
  it('overlap with own other shift, similar hours, time off; working_then from the cover check ignored', () => {
    const own2 = ds('a2', 'alle', 'Alle Rowe', '17:00:00', '22:00:00');
    const r = changeShiftWarnings({ shift: me, start: '10:00:00', end: '18:00:00', dayShifts: [me, own2, other], weekShifts: [], hurdle: { kind: 'time_off', reason: 'Alle has approved time off Monday' } });
    expect(r.warnings).toEqual(['Alle is already working 5 PM – 10 PM then', 'Alle has approved time off Monday']);
    const r2 = changeShiftWarnings({ shift: me, start: '10:00:00', end: '17:00:00', dayShifts: [me, other], weekShifts: [], hurdle: { kind: 'working_then', reason: 'x' } });
    expect(r2.warnings).toEqual(['Nicole works 10:30 AM – 4:30 PM, close to these hours']);
  });
  it('day view: one Changed row with the new time and the old time', () => {
    const v = buildDayView(MON, [me, other], { kind: 'changed', shift_id: 'a', start_time: '10:00:00', end_time: '16:00:00' });
    const r = v.rows.find((x) => x.kind)!;
    expect([r.kind, r.time, r.was, r.position]).toEqual(['changed', '10 AM – 4 PM', '9 AM – 4 PM', 'AM Manager']);
    expect(v.rows.filter((x) => x.kind)).toHaveLength(1);
  });
});
