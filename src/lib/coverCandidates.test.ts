import { describe, it, expect } from 'vitest';
import { rankCover, hurdleFor, type CoverInput, type CoverPerson } from '../../supabase/functions/_shared/coverCandidates';
import * as mirror from '../../supabase/functions/_shared/availabilityMirror';
import { APP_ROLE_ORDER, APP_ROLE_NAMES } from '../../supabase/functions/_shared/appRoles';
import { normalizeWeeklyAvailability, conflictingBlocks } from '@/types/availability';
import { ROLE_DISPLAY_NAMES } from '@/hooks/useUserRole';

// Saturday Oct 3 2026, 5:30 PM – 9:30 PM, Ryan (shift manager)
const SHIFT = { id: 's1', user_id: 'ryan', shift_date: '2026-10-03', start_time: '17:30:00', end_time: '21:30:00' };
const avail = { normalizeWeekly: normalizeWeeklyAvailability as any, conflictingBlocks: conflictingBlocks as any };
const person = (id: string, role = 'team_member', weekly_availability: any = null): CoverPerson => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Test`, role, weekly_availability });
const base = (over: Partial<CoverInput> = {}): CoverInput => ({
  shift: SHIFT, coveredRole: 'shift_manager', people: [], timeOff: [], weekShifts: [], hours: { saturday: { open: '10:00', close: '22:00' } },
  roleOrder: APP_ROLE_ORDER, roleNames: APP_ROLE_NAMES, avail, ...over,
});
const off = (scope: string, status = 'approved', start_time: string | null = null, end_time: string | null = null, start_date = '2026-10-03', end_date: string | null = null) =>
  ({ user_id: 'deb', start_date, end_date, start_time, end_time, time_scope: scope, status });

describe('cover hurdles', () => {
  it('full-day approved time off fails', () => {
    expect(hurdleFor(person('deb'), base({ timeOff: [off('full_day')] }))?.reason).toBe('Deb has approved time off Saturday');
  });
  it('pending time off fails too', () => {
    expect(hurdleFor(person('deb'), base({ timeOff: [off('full_day', 'pending')] }))?.kind).toBe('time_off');
  });
  it('multi-day covering the date fails', () => {
    expect(hurdleFor(person('deb'), base({ timeOff: [off('multi_day', 'approved', null, null, '2026-10-01', '2026-10-05')] }))?.kind).toBe('time_off');
  });
  it('denied time off is ignored', () => {
    expect(hurdleFor(person('deb'), base({ timeOff: [off('full_day', 'denied')] }))).toBeNull();
  });
  it('partial-day overlapping the shift fails', () => {
    expect(hurdleFor(person('deb'), base({ timeOff: [off('partial_day', 'approved', '19:00', '23:00')] }))?.kind).toBe('time_off');
  });
  it('partial-day not overlapping passes', () => {
    expect(hurdleFor(person('deb'), base({ timeOff: [off('partial_day', 'approved', '09:00', '12:00')] }))).toBeNull();
  });
  it('weekday marked unavailable fails', () => {
    expect(hurdleFor(person('deb', 'team_member', { saturday: { available: false } }), base())?.reason).toBe("Deb isn't available Saturdays");
  });
  it('nothing on file counts as available', () => {
    expect(hurdleFor(person('deb', 'team_member', null), base())).toBeNull();
  });
  it("can't-work block overlapping the shift fails", () => {
    const p = person('deb', 'team_member', { saturday: { available: true, blocks: [{ start: '16:00', end: '22:00' }] } });
    expect(hurdleFor(p, base())?.reason).toBe("Deb can't work Saturdays after 4 PM");
  });
  it("can't-work block not overlapping passes", () => {
    const p = person('deb', 'team_member', { saturday: { available: true, blocks: [{ start: '10:00', end: '14:00' }] } });
    expect(hurdleFor(p, base())).toBeNull();
  });
  it('legacy "can only work" window with the shift outside it fails', () => {
    const p = person('deb', 'team_member', { saturday: { available: true, start: '10:00', end: '16:00' } });
    expect(hurdleFor(p, base())?.kind).toBe('unavailable');
  });
  it('overlap with an existing shift fails', () => {
    const r = hurdleFor(person('deb'), base({ weekShifts: [{ id: 'x', user_id: 'deb', shift_date: '2026-10-03', start_time: '16:00', end_time: '20:00' }] }));
    expect(r?.kind).toBe('working_then');
  });
});

describe('cover list', () => {
  it('same-day non-overlapping shift goes to Already working', () => {
    const r = rankCover(base({ people: [person('alle')], weekShifts: [{ id: 'x', user_id: 'alle', shift_date: '2026-10-03', start_time: '09:00', end_time: '15:00' }] }));
    expect(r.clear).toHaveLength(0);
    expect(r.working[0].line).toBe('Alle already scheduled 9 AM – 3 PM');
  });
  it('team member covering a shift manager gets "Not a shift manager"', () => {
    expect(rankCover(base({ people: [person('alle')] })).clear[0].tag).toBe('Not a shift manager');
  });
  it('shift manager in training covering a shift manager gets the trainee tag', () => {
    expect(rankCover(base({ people: [person('jo', 'shift_manager_in_training')] })).clear[0].tag).toBe('Shift manager in training');
  });
  it('same or higher role has no tag', () => {
    expect(rankCover(base({ people: [person('mo', 'manager')] })).clear[0].tag).toBeNull();
  });
  it('orders clear first, unflagged first, then fewest hours; skips the covered person; counts the rest', () => {
    const ws = [
      { id: 'a', user_id: 'amy', shift_date: '2026-09-29', start_time: '09:00', end_time: '17:00' },   // 8h
      { id: 'b', user_id: 'bo', shift_date: '2026-09-30', start_time: '09:00', end_time: '11:00' },    // 2h
      { id: 'c', user_id: 'cy', shift_date: '2026-10-03', start_time: '09:00', end_time: '12:00' },    // same day
    ];
    const r = rankCover(base({
      people: [person('ryan', 'shift_manager'), person('bo'), person('amy', 'shift_manager'), person('cy', 'shift_manager'), person('deb')],
      weekShifts: ws, timeOff: [off('full_day')],
    }));
    expect(r.clear.map((c) => c.id)).toEqual(['amy', 'bo']); // amy unflagged (8h) before bo flagged (2h)
    expect(r.working.map((c) => c.id)).toEqual(['cy']);
    expect(r.blockedSummary).toBe("1 other can't: time off");
  });
});

describe('server mirrors match the app', () => {
  it('role order and names equal the app list', () => {
    expect(APP_ROLE_ORDER).toEqual(Object.keys(ROLE_DISPLAY_NAMES));
    expect(APP_ROLE_NAMES).toEqual(ROLE_DISPLAY_NAMES);
  });
  it('availability mirror equals the locked normalizer', () => {
    const hours = { saturday: { open: '10:00', close: '22:00' }, monday: { open: '22:00', close: '02:00' } };
    const records: any[] = [
      null, {}, { saturday: { available: false } }, { saturday: { available: true, blocks: [{ start: '16:00', end: '22:00' }, { start: '09:00', end: '09:00' }] } },
      { saturday: { available: true, start: '10:00', end: '16:00' } }, { monday: { available: true, start: '23:00' } }, { sunday: { available: true, end: '15:00' } },
    ];
    for (const r of records) {
      const a = normalizeWeeklyAvailability(r, hours as any);
      expect(mirror.normalizeWeeklyAvailability(r, hours as any)).toEqual(a);
      for (const k of mirror.DAY_KEYS) {
        expect(mirror.conflictingBlocks(a?.[k] as any, '17:30', '21:30')).toEqual(conflictingBlocks(a?.[k] as any, '17:30', '21:30'));
      }
    }
  });
});
