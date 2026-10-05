/**
 * Day-bucketing + shift detection for punch records (Time Tracking, pay-period
 * summary cards, personal pay). ONE shared helper — do not re-implement inline.
 *
 * Mirrors the server engine (public._labor_pair_shifts + public.business_date):
 *   1. Punches are paired in chronological order (state machine): a clock_in
 *      opens a shift, breaks / clock_out attach to the OPEN shift, and the whole
 *      shift is filed under its CLOCK-IN's business date. An overnight clock-out
 *      therefore lands on the day the shift started, no hour cutoff needed.
 *   2. A punch's own business date only rolls back to the previous calendar day
 *      when the prior day's cutoff (close + 3h, wrapped) is between 1 and 11
 *      (inclusive) AND the punch hour is strictly before it. Early-close stores
 *      (e.g. close 20:00 -> cutoff 23) never roll midday punches back.
 *   3. A clock_in while a shift is open: ends an open break (legacy "clock in
 *      from break"), is ignored as a double tap if within 5 min of the open
 *      clock_in, otherwise starts a NEW shift (the earlier one is left open /
 *      missing clock-out) — same as the server.
 *
 * ⚠️  READ-ONLY display helper. Server payroll_hours stays the source of truth
 * for paid hours. No wage / OT formulas live here.
 */
import { formatInTimeZone } from 'date-fns-tz';
import { getDateInTimezone } from '@/utils/timezoneUtils';

export interface BucketablePunch {
  user_id: string;
  punch_type: string;
  punch_time: string;
  notes?: string | null;
  id?: string;
}

type PunchLike = { punch_type: string; punch_time: string; id?: string };

export const DOUBLE_TAP_MS = 5 * 60 * 1000;

// Same tie-break order as the server pairing (_labor_pair_shifts).
const SERVER_TIE_ORDER: Record<string, number> = {
  break_end: 0,
  clock_out: 1,
  clock_in: 2,
  break_start: 3,
};

const ms = (p: PunchLike) => new Date(p.punch_time).getTime();

export function sortPunchesForPairing<T extends PunchLike>(punches: T[]): T[] {
  return [...punches].sort((a, b) => {
    const t = ms(a) - ms(b);
    if (t !== 0) return t;
    const pa = SERVER_TIE_ORDER[a.punch_type] ?? 99;
    const pb = SERVER_TIE_ORDER[b.punch_type] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

const addDays = (localDateStr: string, days: number): string => {
  const d = new Date(`${localDateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Business date of a single instant — same rule as SQL public.business_date().
 * cutoffByDayOfWeek: day_of_week (0=Sun) -> calculateCutoffHour(close_time).
 */
export function businessDateForPunch(
  punchTime: Date,
  timezone: string,
  cutoffByDayOfWeek: Map<number, number>,
  defaultCutoff = 5
): string {
  const localDate = getDateInTimezone(punchTime, timezone);
  const prevDate = addDays(localDate, -1);
  const prevDow = new Date(`${prevDate}T12:00:00Z`).getUTCDay();
  const cutoff = cutoffByDayOfWeek.get(prevDow) ?? defaultCutoff;
  const hour = parseInt(formatInTimeZone(punchTime, timezone, 'H'), 10);
  if (cutoff >= 1 && cutoff <= 11 && hour < cutoff) return prevDate;
  return localDate;
}

/**
 * Groups ONE user's punches into `{ 'yyyy-MM-dd': punches[] }` by pairing
 * in -> out chronologically and filing each shift under its clock-in's
 * business date. Unpaired punches fall back to their own business date so
 * managers can still see (and fix) them.
 */
export function bucketUserPunchesByDay<T extends BucketablePunch>(
  punches: T[],
  timezone: string,
  cutoffByDayOfWeek: Map<number, number>,
  defaultCutoff = 5
): Record<string, T[]> {
  const byDay: Record<string, T[]> = {};
  const push = (day: string, p: T) => {
    (byDay[day] ||= []).push(p);
  };

  let openDay: string | null = null;
  let openClockIn: T | null = null;
  let breakOpen = false;
  let prev: T | null = null;

  for (const p of sortPunchesForPairing(punches)) {
    const ownDay = businessDateForPunch(new Date(p.punch_time), timezone, cutoffByDayOfWeek, defaultCutoff);

    switch (p.punch_type) {
      case 'clock_in': {
        if (openDay !== null && breakOpen) {
          // Legacy: clock_in used to end a break — stays in the open shift.
          push(openDay, p);
          breakOpen = false;
        } else if (
          openDay !== null &&
          openClockIn &&
          prev === openClockIn &&
          ms(p) - ms(openClockIn) <= DOUBLE_TAP_MS
        ) {
          // Double tap — keep with the open shift.
          push(openDay, p);
        } else {
          // New shift (also covers a forgotten clock-out on the previous one).
          openDay = ownDay;
          openClockIn = p;
          breakOpen = false;
          push(ownDay, p);
        }
        break;
      }
      case 'clock_out': {
        if (openDay !== null) {
          push(openDay, p);
        } else {
          push(ownDay, p); // orphan clock-out
        }
        openDay = null;
        openClockIn = null;
        breakOpen = false;
        break;
      }
      case 'break_start': {
        if (openDay !== null) {
          push(openDay, p);
          breakOpen = true;
        } else push(ownDay, p);
        break;
      }
      case 'break_end': {
        if (openDay !== null) {
          push(openDay, p);
          breakOpen = false;
        } else push(ownDay, p);
        break;
      }
      default:
        push(openDay ?? ownDay, p);
    }
    prev = p;
  }

  return byDay;
}

/**
 * Groups punches for many users into `{ userId: { day: punches[] } }`.
 */
export function bucketPunchesByUserAndDay<T extends BucketablePunch>(
  punches: T[],
  timezone: string,
  cutoffByDayOfWeek: Map<number, number>,
  defaultCutoff = 5
): Map<string, Record<string, T[]>> {
  const byUser = new Map<string, T[]>();
  punches.forEach((p) => {
    const arr = byUser.get(p.user_id) || [];
    arr.push(p);
    byUser.set(p.user_id, arr);
  });

  const result = new Map<string, Record<string, T[]>>();
  byUser.forEach((userPunches, userId) => {
    result.set(userId, bucketUserPunchesByDay(userPunches, timezone, cutoffByDayOfWeek, defaultCutoff));
  });
  return result;
}

/**
 * Shift-starting clock_ins within ONE day's punches (already bucketed).
 * Same state machine as bucketing: a clock_in starts a new shift unless it
 * ends an open break or is a double tap (<= 5 min after the open clock_in).
 * A clock_in after another clock_in (forgotten clock-out) IS a new shift, so
 * a second shift is never hidden behind the first one's Out.
 */
export function findShiftStartClockIns<T extends PunchLike>(dayPunches: T[]): T[] {
  const starts: T[] = [];
  let open: T | null = null;
  let breakOpen = false;
  let prev: T | null = null;

  for (const p of sortPunchesForPairing(dayPunches)) {
    if (p.punch_type === 'clock_in') {
      if (open && breakOpen) {
        breakOpen = false;
      } else if (open && prev === open && ms(p) - ms(open) <= DOUBLE_TAP_MS) {
        // double tap
      } else {
        starts.push(p);
        open = p;
        breakOpen = false;
      }
    } else if (p.punch_type === 'clock_out') {
      open = null;
      breakOpen = false;
    } else if (p.punch_type === 'break_start') {
      if (open) breakOpen = true;
    } else if (p.punch_type === 'break_end') {
      breakOpen = false;
    }
    prev = p;
  }
  return starts;
}
