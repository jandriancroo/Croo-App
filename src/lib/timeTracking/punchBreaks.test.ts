import { describe, expect, it } from 'vitest';
import { buildBreaksFromPunches, hasOpenClockIn, validateShiftBreaks } from './punchBreaks';

const p = (punch_type: string, hhmm: string, day = '2026-11-12') => ({
  id: `${punch_type}-${hhmm}`,
  punch_type,
  punch_time: new Date(`${day}T${hhmm}:00-08:00`).toISOString(),
});
const t = (hhmm: string, day = '2026-11-12') => new Date(`${day}T${hhmm}:00-08:00`).getTime();

describe('buildBreaksFromPunches', () => {
  it('pairs each break with its own end', () => {
    const b = buildBreaksFromPunches([
      p('clock_in', '09:00'), p('break_start', '10:00'), p('break_end', '10:30'),
      p('break_start', '14:08'), p('break_end', '14:21'), p('clock_out', '16:00'),
    ]);
    expect(b.map((x) => x.minutes)).toEqual([30, 13]);
    expect(b[0].isLong).toBe(false);
  });

  it('does not reach past a clock-out for a stray break end (the 10:30 PM typo)', () => {
    const b = buildBreaksFromPunches([
      p('clock_in', '09:00'), p('break_start', '10:00'), p('break_start', '14:08'),
      p('break_end', '14:21'), p('clock_out', '16:00'), p('break_end', '22:30'),
    ]);
    // Same as the server: one break 10:00 -> 14:21, the second start and the 22:30 end are ignored.
    expect(b).toHaveLength(1);
    expect(b[0].minutes).toBe(261);
  });

  it('ends a break on a clock-in, and leaves an unended break open', () => {
    expect(buildBreaksFromPunches([p('clock_in', '09:00'), p('break_start', '12:00'), p('clock_in', '12:40')])[0].minutes).toBe(40);
    expect(buildBreaksFromPunches([p('clock_in', '09:00'), p('break_start', '12:00')])[0].end).toBeNull();
  });
});

describe('hasOpenClockIn', () => {
  it('is false for a closed shift', () => {
    expect(hasOpenClockIn([p('clock_in', '09:00'), p('break_start', '10:00'), p('break_end', '10:30'), p('clock_out', '16:00')])).toBe(false);
  });
  it('is true for a live shift with no clock-out yet', () => {
    expect(hasOpenClockIn([p('clock_in', '15:30'), p('break_start', '18:04'), p('break_end', '18:36')])).toBe(true);
  });
  it('is true when an earlier shift never clocked out', () => {
    expect(hasOpenClockIn([p('clock_in', '06:00'), p('clock_in', '12:00'), p('clock_out', '16:00')])).toBe(true);
  });
  it('ignores break-return clock-ins and double taps', () => {
    expect(hasOpenClockIn([p('clock_in', '09:00'), p('break_start', '12:00'), p('clock_in', '12:30'), p('clock_out', '17:00')])).toBe(false);
    expect(hasOpenClockIn([p('clock_in', '09:00'), p('clock_in', '09:02'), p('clock_out', '17:00')])).toBe(false);
  });
  it('handles two closed shifts in a day', () => {
    expect(hasOpenClockIn([p('clock_in', '06:00'), p('clock_out', '10:00'), p('clock_in', '17:00'), p('clock_out', '21:00')])).toBe(false);
  });
});

describe('validateShiftBreaks', () => {
  const base = { inMs: t('09:00'), outMs: t('16:00') };
  it('accepts breaks inside the shift', () => {
    expect(validateShiftBreaks({ ...base, breaks: [{ startMs: t('10:00'), endMs: t('10:30') }] }, 'Shift 1', 'America/Los_Angeles')).toBeNull();
  });
  it('rejects a break end typed as PM', () => {
    const msg = validateShiftBreaks({ ...base, breaks: [{ startMs: t('10:00'), endMs: t('22:30') }] }, 'Shift 1', 'America/Los_Angeles');
    expect(msg).toMatch(/outside the shift/);
    expect(msg).toMatch(/10:30 PM/);
  });
  it('rejects a break that ends before it starts', () => {
    expect(validateShiftBreaks({ ...base, breaks: [{ startMs: t('11:00'), endMs: t('10:30') }] }, 'Shift 1')).toMatch(/must be after break start/);
  });
  it('rejects a break as long as the shift', () => {
    expect(validateShiftBreaks({ ...base, breaks: [{ startMs: t('09:00'), endMs: t('16:00') }] }, 'Shift 1')).toMatch(/longer than the whole shift/);
  });
  it('allows any in-window break while the shift has no clock-out', () => {
    expect(validateShiftBreaks({ inMs: t('09:00'), outMs: null, breaks: [{ startMs: t('10:00'), endMs: t('10:30') }] }, 'Shift 1')).toBeNull();
    expect(validateShiftBreaks({ inMs: t('09:00'), outMs: null, breaks: [{ startMs: t('08:00'), endMs: null }] }, 'Shift 1')).toMatch(/outside/);
  });
});
