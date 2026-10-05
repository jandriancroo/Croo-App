import { describe, it, expect } from 'vitest';
import { bucketUserPunchesByDay, businessDateForPunch, findShiftStartClockIns } from './payrollDayBucketing';
import { calculateCutoffHour } from '@/utils/timezoneUtils';

const U = 'u1';
const P = (id: string, punch_type: string, punch_time: string) => ({ id, user_id: U, punch_type, punch_time });
const cutoffs = (closeByDow: Record<number, string>) => {
  const m = new Map<number, number>();
  Object.entries(closeByDow).forEach(([d, c]) => m.set(Number(d), calculateCutoffHour(c)));
  return m;
};
const ids = (r: Record<string, any[]>) => Object.fromEntries(Object.entries(r).map(([d, ps]) => [d, ps.map((p) => p.id).sort()]));

// Georgetown: America/Chicago, close 20:00 Mon-Sat, 18:00 Sun -> cutoff 23 / 21
const GT = cutoffs({ 0: '18:00:00', 1: '20:00:00', 2: '20:00:00', 3: '20:00:00', 4: '20:00:00', 5: '20:00:00', 6: '20:00:00' });
const CT = 'America/Chicago';
// Palm Springs style: America/Los_Angeles, close 22:00 -> cutoff 1 (Fri/Sat 00:00 -> 3)
const PS = cutoffs({ 0: '22:00', 1: '22:00', 2: '22:00', 3: '22:00', 4: '23:00', 5: '00:00', 6: '00:00' });
const PT = 'America/Los_Angeles';

describe('Georgetown Reese Oct 3-4 2026 (repaired data)', () => {
  const punches = [
    P('sat_in', 'clock_in', '2026-10-03T15:00:00Z'),   // Sat 10:00 CT
    P('sat_out', 'clock_out', '2026-10-03T19:00:00Z'), // Sat 14:00 CT
    P('sun_in1', 'clock_in', '2026-10-04T14:00:00Z'),  // Sun 09:00 CT
    P('sun_out1', 'clock_out', '2026-10-04T15:30:00Z'),// Sun 10:30 CT
    P('sun_in2', 'clock_in', '2026-10-04T19:00:12Z'),  // Sun 14:00:12 CT
    P('sun_out2', 'clock_out', '2026-10-04T23:01:42Z'),// Sun 18:01:42 CT
  ];
  it('keeps Sunday morning outs on Sunday; Saturday untouched', () => {
    expect(ids(bucketUserPunchesByDay(punches, CT, GT))).toEqual({
      '2026-10-03': ['sat_in', 'sat_out'],
      '2026-10-04': ['sun_in1', 'sun_in2', 'sun_out1', 'sun_out2'],
    });
  });
  it('Sunday shows two shift starts', () => {
    const day = bucketUserPunchesByDay(punches, CT, GT)['2026-10-04'];
    expect(findShiftStartClockIns(day).map((p) => p.id)).toEqual(['sun_in1', 'sun_in2']);
  });
  it('pre-repair messy data: Sunday 10:30/10:35 outs no longer jump to Saturday', () => {
    const messy = [
      P('sat_in', 'clock_in', '2026-10-03T15:00:00Z'), P('sat_out', 'clock_out', '2026-10-03T19:00:00Z'),
      P('in1', 'clock_in', '2026-10-04T14:00:00Z'), P('o1', 'clock_out', '2026-10-04T15:30:00Z'),
      P('o2', 'clock_out', '2026-10-04T15:30:00Z'), P('o3', 'clock_out', '2026-10-04T15:35:21Z'),
      P('in2', 'clock_in', '2026-10-04T19:00:12Z'),
    ];
    const r = ids(bucketUserPunchesByDay(messy, CT, GT));
    expect(r['2026-10-03']).toEqual(['sat_in', 'sat_out']);
    expect(r['2026-10-04']).toEqual(['in1', 'in2', 'o1', 'o2', 'o3']);
  });
  it('early-close cutoff 23 never rolls a midday punch back', () => {
    expect(businessDateForPunch(new Date('2026-10-04T15:35:21Z'), CT, GT)).toBe('2026-10-04');
    expect(businessDateForPunch(new Date('2026-10-05T04:30:00Z'), CT, GT)).toBe('2026-10-04'); // Sun 23:30 CT -> own day
  });
});

describe('late-close store (Palm Springs style)', () => {
  it('split shift stays on its day as two shifts', () => {
    const ps = [
      P('a', 'clock_in', '2026-09-15T16:00:00Z'), P('b', 'clock_out', '2026-09-15T19:00:00Z'), // 9-12 PT
      P('c', 'clock_in', '2026-09-15T23:00:00Z'), P('d', 'clock_out', '2026-09-16T03:00:00Z'), // 4-8 PM PT
    ];
    const r = bucketUserPunchesByDay(ps, PT, PS);
    expect(ids(r)).toEqual({ '2026-09-15': ['a', 'b', 'c', 'd'] });
    expect(findShiftStartClockIns(r['2026-09-15']).map((p) => p.id)).toEqual(['a', 'c']);
  });
  it('true overnight: 6 PM in, 1:30 AM out -> prior day', () => {
    const r = bucketUserPunchesByDay([
      P('in', 'clock_in', '2026-09-16T01:00:00Z'),   // Tue 9/15 18:00 PT
      P('out', 'clock_out', '2026-09-16T08:30:00Z'), // Wed 9/16 01:30 PT
    ], PT, PS);
    expect(ids(r)).toEqual({ '2026-09-15': ['in', 'out'] });
  });
  it('orphan 12:30 AM clock-out rolls to prior day when cutoff 1-11', () => {
    expect(businessDateForPunch(new Date('2026-09-16T07:30:00Z'), PT, PS)).toBe('2026-09-15'); // 00:30 PT, cutoff 1
    expect(businessDateForPunch(new Date('2026-09-16T08:30:00Z'), PT, PS)).toBe('2026-09-16'); // 01:30 PT, not < 1
  });
  it('after-midnight clock-in at a 00:00-close Friday files to Friday', () => {
    // Sat 9/19 02:00 PT, Friday close 00:00 -> cutoff 3
    expect(businessDateForPunch(new Date('2026-09-19T09:00:00Z'), PT, PS)).toBe('2026-09-18');
  });
});

describe('shift-start detection', () => {
  it('clock_in returning from break is not a new shift', () => {
    const day = [P('i', 'clock_in', '2026-09-15T16:00:00Z'), P('bs', 'break_start', '2026-09-15T19:00:00Z'),
      P('i2', 'clock_in', '2026-09-15T19:30:00Z'), P('o', 'clock_out', '2026-09-15T23:00:00Z')];
    expect(findShiftStartClockIns(day).map((p) => p.id)).toEqual(['i']);
  });
  it('double tap within 5 min is not a new shift', () => {
    const day = [P('i', 'clock_in', '2026-09-15T16:00:00Z'), P('i2', 'clock_in', '2026-09-15T16:02:00Z'), P('o', 'clock_out', '2026-09-15T20:00:00Z')];
    expect(findShiftStartClockIns(day).map((p) => p.id)).toEqual(['i']);
  });
  it('forgotten clock-out: second clock_in hours later IS a new shift', () => {
    const day = [P('i', 'clock_in', '2026-10-04T14:00:00Z'), P('i2', 'clock_in', '2026-10-04T19:00:12Z'), P('o', 'clock_out', '2026-10-04T23:01:42Z')];
    expect(findShiftStartClockIns(day).map((p) => p.id)).toEqual(['i', 'i2']);
  });
  it('no location hours -> default cutoff 5', () => {
    expect(businessDateForPunch(new Date('2026-09-16T11:00:00Z'), PT, new Map())).toBe('2026-09-15'); // 04:00 PT
    expect(businessDateForPunch(new Date('2026-09-16T12:00:00Z'), PT, new Map())).toBe('2026-09-16'); // 05:00 PT
  });
});
