/**
 * THIN RE-EXPORT LAYER
 * ====================
 * All date logic now lives in timezoneUtils.ts (the single source of truth).
 * This file re-exports for backward compatibility so existing imports keep working.
 * New code should import directly from '@/utils/timezoneUtils'.
 */
import {
  getTodayInTimezone,
  getDateInTimezone,
  getStartOfTodayInTimezone,
  getStartOfDateInTimezone,
  getDateInTimezoneOffset,
  getDayOfWeekInTimezone,
  getTimezoneOffset,
} from './timezoneUtils';

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

// ── Re-exports (timezone-aware) ──
export { getTodayInTimezone, getDateInTimezone, getStartOfTodayInTimezone, getStartOfDateInTimezone, getDateInTimezoneOffset, getDayOfWeekInTimezone, getTimezoneOffset };

/**
 * Get the day of week for a specific date in specified timezone
 * Returns Monday-based index: Monday = 0, Tuesday = 1, ... Sunday = 6
 */
export const getDateDayOfWeekInTimezone = (date: Date, timezone: string = DEFAULT_TIMEZONE): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  });
  const dayName = formatter.format(date);
  const dayMap: Record<string, number> = {
    'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6
  };
  return dayMap[dayName] ?? 0;
};

// ── Legacy PST aliases (used by older code) ──
export const getTodayInPST = (): string => getTodayInTimezone(DEFAULT_TIMEZONE);
export const getDateInPST = (date: Date): string => getDateInTimezone(date, DEFAULT_TIMEZONE);
export const getStartOfTodayPST = (): Date => getStartOfTodayInTimezone(DEFAULT_TIMEZONE);
export const getStartOfDatePST = (date: Date): Date => getStartOfDateInTimezone(date, DEFAULT_TIMEZONE);
export const getDateInPSTOffset = (daysOffset: number): string => getDateInTimezoneOffset(daysOffset, DEFAULT_TIMEZONE);
export const getDayOfWeekInPST = (): number => getDayOfWeekInTimezone(DEFAULT_TIMEZONE);
