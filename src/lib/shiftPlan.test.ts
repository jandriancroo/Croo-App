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
    expect(v.axis.labels).toEqual(['9 AM', '1 PM', '7 PM', '11 PM']);
  });
  it('removed row stays in the list, marked', () => {
    const v = buildDayView(DATE, day, { kind: 'removed', shift_id: 'b' });
    expect(v.rows).toHaveLength(3);
    expect(v.rows.find((r) => r.id === 'b')?.kind).toBe('removed');
  });
  it('cover row shows the replacement and who it is from', () => {
    const v = buildDayView(DATE, day, { kind: 'cover', shift_id: 'a', to: { id: 'eth', name: 'Ethan Andrian' } });
    const r = v.rows.find((x) => x.id === 'a')!;
    expect([r.name, r.kind, r.from, r.position]).toEqual(['Ethan Andrian', 'cover', 'Alle Rowe', 'AM Manager']);
  });
  it('delete info lines', () => {
    const me = ds('c', 'chey', 'Cheyenne Nauretz', '17:30:00', '23:00:00', 't2', 'PM Line 2');
    expect(deleteInfo({ shift: me, dayShifts: [me], weekShifts: [{ user_id: 'chey', start_time: '17:30:00', end_time: '23:00:00' }, { user_id: 'chey', start_time: '09:00:00', end_time: '17:00:00' }] }))
      .toEqual(['This leaves no one on PM Line 2 that day', 'This takes Cheyenne to 8 hours this week']);
  });
});
