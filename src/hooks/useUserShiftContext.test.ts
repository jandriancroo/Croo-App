import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { pickShiftForNow } from './useUserShiftContext';

const tz = 'America/Los_Angeles';
const at = (t: string) => DateTime.fromISO(`2026-10-08T${t}`, { zone: tz });
const shifts = [
  { id: 'am', shift_date: '2026-10-08', start_time: '09:00:00', end_time: '14:00:00' },
  { id: 'pm', shift_date: '2026-10-08', start_time: '17:00:00', end_time: '01:00:00' },
];

describe('pickShiftForNow', () => {
  it('picks the shift covering now', () => expect(pickShiftForNow(shifts, tz, at('10:00'))?.id).toBe('am'));
  it('picks next upcoming between shifts', () => expect(pickShiftForNow(shifts, tz, at('15:00'))?.id).toBe('pm'));
  it('covers overnight end and evening PT', () => expect(pickShiftForNow(shifts, tz, at('23:30'))?.id).toBe('pm'));
  it('falls back to latest', () => expect(pickShiftForNow(shifts.slice(0, 1), tz, at('20:00'))?.id).toBe('am'));
  it('none', () => expect(pickShiftForNow([], tz, at('10:00'))).toBeNull());
});
