/**
 * Day-bucketing for punch records, mirroring the grouping used by
 * usePayrollData.fetchTimeCards (overnight clock-outs and breaks that land at
 * or before the store's close-time cutoff roll back to the previous business
 * day, but only when that previous day actually has a clock-in).
 *
 * ⚠️  This is a READ-ONLY helper used by the pay-period summary cards. It does
 * NOT replace the payroll engine — payroll still owns the authoritative
 * calculation. This exists so the summary card buckets days the SAME way
 * payroll does instead of using its own naive UTC-date grouping.
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

const previousDayString = (localDateStr: string): string => {
  const dateAtNoon = new Date(`${localDateStr}T12:00:00Z`);
  dateAtNoon.setUTCDate(dateAtNoon.getUTCDate() - 1);
  return dateAtNoon.toISOString().slice(0, 10);
};

/**
 * Groups one user's punches into `{ 'yyyy-MM-dd': punches[] }` buckets.
 */
export function bucketUserPunchesByDay<T extends BucketablePunch>(
  punches: T[],
  timezone: string,
  cutoffByDayOfWeek: Map<number, number>,
  defaultCutoff = 5
): Record<string, T[]> {
  const byDay: Record<string, T[]> = {};

  const getCutoffForPreviousDay = (dateStr: string): number => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const prevDayOfWeek = (d.getUTCDay() + 6) % 7;
    return cutoffByDayOfWeek.get(prevDayOfWeek) ?? defaultCutoff;
  };

  // First pass — which local days have a clock-in?
  const clockInsByDay = new Map<string, T>();
  punches.forEach((punch) => {
    if (punch.punch_type === 'clock_in') {
      clockInsByDay.set(getDateInTimezone(new Date(punch.punch_time), timezone), punch);
    }
  });

  punches.forEach((punch) => {
    const punchTime = new Date(punch.punch_time);
    let day = getDateInTimezone(punchTime, timezone);
    const punchHour = parseInt(formatInTimeZone(punchTime, timezone, 'H'), 10);
    const cutoffHour = getCutoffForPreviousDay(day);

    const isRollbackCandidate =
      punch.punch_type === 'clock_out' ||
      punch.punch_type === 'break_start' ||
      punch.punch_type === 'break_end';

    if (isRollbackCandidate && punchHour <= cutoffHour) {
      const sameDayClockIn = clockInsByDay.get(day);
      const shouldMoveToPrevDay =
        !sameDayClockIn ||
        new Date(sameDayClockIn.punch_time).getTime() > punchTime.getTime();

      if (shouldMoveToPrevDay) {
        const prevDay = previousDayString(formatInTimeZone(punchTime, timezone, 'yyyy-MM-dd'));
        if (clockInsByDay.has(prevDay)) day = prevDay;
      }
    }

    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(punch);
  });

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
    result.set(
      userId,
      bucketUserPunchesByDay(userPunches, timezone, cutoffByDayOfWeek, defaultCutoff)
    );
  });
  return result;
}
