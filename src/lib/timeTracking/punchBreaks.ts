/**
 * Shift and break pairing for Time Tracking, built from a day's punches.
 * Mirrors the server pairing in public._labor_pair_shifts (and _punch_shift_segments):
 * punches walk in time order (ties: break_end, clock_out, clock_in, break_start);
 * a break_start opens a break only when none is open; a break_end closes the open break
 * (stray break_ends are ignored); a clock_in during a break ends it; a clock_out ends the shift.
 */
export interface PunchBreakLine {
  start: string;
  end: string | null;
  minutes: number;
  isLong: boolean;
}

/** Shown on the disabled Approve button and when the server refuses an approval. */
export const OPEN_SHIFT_APPROVE_REASON = 'Cannot approve a shift that has no clock-out.';

/** Minimal punch shape used for pairing. */
export interface PairingPunch {
  punch_type: string;
  punch_time: string;
}

const ms = (p: PairingPunch) => new Date(p.punch_time).getTime();
const TIE: Record<string, number> = { break_end: 0, clock_out: 1, clock_in: 2, break_start: 3 };

export function sortPunchesForPairing<T extends PairingPunch>(punches: T[]): T[] {
  return [...(punches || [])].sort(
    (a, b) => ms(a) - ms(b) || (TIE[a.punch_type] ?? 9) - (TIE[b.punch_type] ?? 9),
  );
}

export function buildBreaksFromPunches(dayPunches: PairingPunch[]): PunchBreakLine[] {
  const lines: PunchBreakLine[] = [];
  let open: PairingPunch | null = null;
  const close = (end: PairingPunch | null) => {
    if (!open) return;
    const minutes = end ? Math.round((ms(end) - ms(open)) / 60000) : 0;
    lines.push({ start: open.punch_time, end: end ? end.punch_time : null, minutes, isLong: !!end && minutes > 35 });
    open = null;
  };
  for (const p of sortPunchesForPairing(dayPunches)) {
    if (p.punch_type === 'break_start') {
      if (!open) open = p;
    } else if (p.punch_type === 'break_end' || p.punch_type === 'clock_in') {
      if (open) close(p);
    } else if (p.punch_type === 'clock_out') {
      if (open) close(null);
    }
  }
  if (open) close(null);
  return lines;
}

/**
 * True when any clock-in has no clock-out, including a live shift that is still going.
 * A clock-in during a break (break return) or a double tap within `dupMinutes` of the
 * shift's clock-in does not start a new shift, same as the server.
 */
export function hasOpenClockIn(dayPunches: PairingPunch[], dupMinutes = 5): boolean {
  let shiftStart: PairingPunch | null = null;
  let onBreak = false;
  let prev: PairingPunch | null = null;
  for (const p of sortPunchesForPairing(dayPunches)) {
    const last = prev;
    prev = p;
    if (p.punch_type === 'clock_in') {
      if (!shiftStart) {
        shiftStart = p;
        onBreak = false;
      } else if (onBreak) {
        onBreak = false;
      } else if (last === shiftStart && ms(p) - ms(shiftStart) <= dupMinutes * 60000) {
        // double tap
      } else {
        return true; // earlier shift never clocked out
      }
    } else if (p.punch_type === 'clock_out') {
      shiftStart = null;
      onBreak = false;
    } else if (p.punch_type === 'break_start') {
      if (shiftStart) onBreak = true;
    } else if (p.punch_type === 'break_end') {
      onBreak = false;
    }
  }
  return !!shiftStart;
}

export interface ShiftBreakCheck {
  /** Clock-in, epoch ms. */
  inMs: number;
  /** Clock-out, epoch ms, or null while the shift has none. */
  outMs: number | null;
  breaks: { startMs: number; endMs: number | null }[];
}

const hhmm = (t: number, timeZone?: string) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(t));

/**
 * Edit-form guard: a break must end after it starts, sit inside the clock-in/out window,
 * and be shorter than the shift. Returns a message for the first problem, or null.
 */
export function validateShiftBreaks(shift: ShiftBreakCheck, shiftLabel: string, timeZone?: string): string | null {
  const { inMs, outMs } = shift;
  for (let i = 0; i < shift.breaks.length; i++) {
    const { startMs, endMs } = shift.breaks[i];
    const label = `${shiftLabel}, break ${i + 1}`;
    if (endMs != null && endMs <= startMs) {
      return `${label}: break end (${hhmm(endMs, timeZone)}) must be after break start (${hhmm(startMs, timeZone)}).`;
    }
    const outside = (t: number) => t < inMs || (outMs != null && t > outMs);
    if (outside(startMs) || (endMs != null && outside(endMs))) {
      const window = `${hhmm(inMs, timeZone)} – ${outMs != null ? hhmm(outMs, timeZone) : 'no clock-out'}`;
      const brk = `${hhmm(startMs, timeZone)}${endMs != null ? ` – ${hhmm(endMs, timeZone)}` : ''}`;
      return `${label} (${brk}) is outside the shift (${window}). Check AM/PM.`;
    }
    if (endMs != null && outMs != null && endMs - startMs >= outMs - inMs) {
      return `${label} is as long as or longer than the whole shift.`;
    }
  }
  return null;
}
