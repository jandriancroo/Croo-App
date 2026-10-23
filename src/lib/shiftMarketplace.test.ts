import { describe, it, expect } from 'vitest';
import { buildOfferDayView, wouldHitSixthDay, isManagerPlus } from './shiftMarketplace';

const SHIFT = { id: 's1', user_id: 'ann', schedule_id: 'w', shift_date: '2026-10-03', start_time: '17:00:00', end_time: '21:00:00', location_id: 'L', position: 'Cashier' };

describe('shift marketplace preview', () => {
  it('owner row Removed, new person Covering, others plain', () => {
    const v = buildOfferDayView({ shift: SHIFT, ownerName: 'Ann', newPerson: { id: 'bob', name: 'Bob' }, title: 'Sat',
      dayShifts: [{ id: 's1', user_id: 'ann', start_time: '17:00', end_time: '21:00', name: 'Ann', position: 'Cashier' },
        { id: 's2', user_id: 'cy', start_time: '10:00', end_time: '14:00', name: 'Cy', position: 'Cook' }] });
    expect(v.rows.map((r) => [r.name, r.kind])).toEqual([['Cy', null], ['Ann', 'removed'], ['Bob', 'cover']]);
  });
  it('new person already on that day is tagged New', () => {
    const v = buildOfferDayView({ shift: SHIFT, ownerName: 'Ann', newPerson: { id: 'cy', name: 'Cy' }, title: 'Sat',
      dayShifts: [{ id: 's2', user_id: 'cy', start_time: '10:00', end_time: '14:00', name: 'Cy', position: 'Cook' }] });
    expect(v.rows.find((r) => r.kind && r.kind !== 'removed')?.kind).toBe('new');
  });
});

describe('sixth day', () => {
  const wk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, user_id: 'bob', shift_date: `2026-09-2${8 + i > 9 ? 9 : 8 + i}`, is_time_off: false }))
    .map((w, i) => ({ ...w, shift_date: ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'][i] }));
  it('5 other days + this one = sixth day', () => expect(wouldHitSixthDay('bob', SHIFT, wk(5))).toBe(true));
  it('4 other days is fine', () => expect(wouldHitSixthDay('bob', SHIFT, wk(4))).toBe(false));
  it('time off rows do not count', () => expect(wouldHitSixthDay('bob', SHIFT, wk(5).map((w, i) => (i === 0 ? { ...w, is_time_off: true } : w)))).toBe(false));
});

describe('roles', () => {
  it('general manager is manager+', () => {
    expect(isManagerPlus('general_manager')).toBe(true);
    expect(isManagerPlus('shift_manager')).toBe(false);
  });
});

import { storeNowKey, shiftNotStarted } from '@/hooks/useOpenShiftOffers';
describe('feed hides started shifts', () => {
  it('store-local now key', () => expect(storeNowKey('America/Los_Angeles', new Date('2026-10-23T03:30:00Z'))).toBe('2026-10-22 20:30'));
  it('later today shows, earlier today hides', () => {
    expect(shiftNotStarted('2026-10-22', '21:00:00', '2026-10-22 20:30')).toBe(true);
    expect(shiftNotStarted('2026-10-22', '20:30:00', '2026-10-22 20:30')).toBe(false);
    expect(shiftNotStarted('2026-10-21', '23:00:00', '2026-10-22 20:30')).toBe(false);
  });
});
