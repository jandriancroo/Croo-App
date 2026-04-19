/**
 * TIMEZONE GATEWAY - SINGLE SOURCE OF TRUTH
 * ==========================================
 * All date operations MUST use these utilities to ensure proper timezone handling.
 * 
 * FORBIDDEN in business logic (use these utils instead):
 * - new Date().toISOString() → use toISOStringInTimezone() or getNowISOString()
 * - new Date('YYYY-MM-DD') → use parseDateStringInTimezone()
 * - .getTime() for grouping → use getDateInTimezone() first
 * 
 * This prevents timezone drift, overnight shift errors, and date-rollover bugs.
 */

export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Runtime guard - logs warning if timezone is missing or UTC in business logic.
 * Call this at the start of any function that requires timezone awareness.
 */
export const assertTimezone = (timezone: string | undefined, context: string): string => {
  if (!timezone) {
    console.warn(`[TIMEZONE GUARD] Missing timezone in ${context} — defaulting to ${DEFAULT_TIMEZONE}`);
    return DEFAULT_TIMEZONE;
  }
  if (timezone === 'UTC') {
    console.warn(`[TIMEZONE GUARD] UTC timezone used in ${context} — this may cause wrong-day grouping`);
  }
  return timezone;
};

/**
 * Get current timestamp as ISO string (for database writes).
 * Use this instead of new Date().toISOString() for punch_time fields.
 */
export const getNowISOString = (): string => {
  return new Date().toISOString();
};

/**
 * Get the current timezone offset string (e.g., "-08:00" or "-07:00" during DST)
 * This dynamically calculates the offset based on the actual timezone rules
 */
export const getTimezoneOffset = (
  timezone: string = DEFAULT_TIMEZONE,
  referenceDate: Date = new Date()
): string => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  });

  const parts = formatter.formatToParts(referenceDate);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName');

  if (offsetPart) {
    // Parse "GMT-08:00" or "GMT-07:00" format
    const match = offsetPart.value.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) return match[1];
  }

  // Fallback to static offsets if parsing fails
  const staticOffsets: Record<string, string> = {
    'America/Los_Angeles': '-08:00',
    'America/Denver': '-07:00',
    'America/Phoenix': '-07:00',
    'America/Chicago': '-06:00',
    'America/New_York': '-05:00',
    'America/Anchorage': '-09:00',
    'Pacific/Honolulu': '-10:00',
  };
  return staticOffsets[timezone] || '-08:00';
};

/**
 * Get the current date string in specified timezone (YYYY-MM-DD format)
 */
export const getTodayInTimezone = (timezone: string = DEFAULT_TIMEZONE): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

/**
 * Get the current day of week in specified timezone (0=Monday, 6=Sunday)
 * This matches the Monday-through-Sunday week format used in the schedule
 */
export const getDayOfWeekInTimezone = (timezone: string = DEFAULT_TIMEZONE): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  });
  const dayName = formatter.format(new Date());
  // Monday = 0, Tuesday = 1, ... Sunday = 6
  const dayMap: Record<string, number> = {
    'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6
  };
  return dayMap[dayName] ?? 0;
};

/**
 * Convert any Date object to a date string in specified timezone (YYYY-MM-DD format)
 */
export const getDateInTimezone = (date: Date, timezone: string = DEFAULT_TIMEZONE): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

/**
 * Get the current time string in specified timezone (HH:mm format)
 */
export const getTimeInTimezone = (timezone: string = DEFAULT_TIMEZONE): string => {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
};

/**
 * Generate an alarm task interval key from a timestamp.
 * Uses the location's timezone to ensure the date and time components
 * are correct for the local business day.
 * 
 * Format: YYYY-MM-DD_HHMM (e.g., "2026-01-26_1430")
 * 
 * CRITICAL: This must match the format used in the trigger-alarm-tasks edge function!
 */
export const getAlarmIntervalKey = (
  timestamp: Date | string,
  timezone: string = DEFAULT_TIMEZONE
): string => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  
  // Get the local date in YYYY-MM-DD format
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  
  // Get the local time parts
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });
  
  const parts = formatter.formatToParts(date);
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  
  return `${localDate}_${hour}${minute}`;
};

/**
 * Format a date for display in specified timezone
 */
export const formatDateTimeInTimezone = (
  date: Date | string, 
  timezone: string = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = {}
): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    ...options
  }).format(dateObj);
};

/**
 * Convert a local date string (YYYY-MM-DD) and time (HH:mm) to an ISO string
 * in the specified timezone. This is critical for saving times to the database.
 */
export const toISOStringInTimezone = (
  dateStr: string,
  timeStr: string,
  timezone: string = DEFAULT_TIMEZONE
): string => {
  // Use a reference date that falls within the intended local calendar date
  // (noon UTC is safely within the same date for US timezones)
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  return new Date(`${dateStr}T${timeStr}:00${offset}`).toISOString();
};

/**
 * Get the start of today in specified timezone as a Date object
 */
export const getStartOfTodayInTimezone = (timezone: string = DEFAULT_TIMEZONE): Date => {
  const dateStr = getTodayInTimezone(timezone);
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  return new Date(`${dateStr}T00:00:00${offset}`);
};

/**
 * Get the start of a specific date in specified timezone as a Date object
 */
export const getStartOfDateInTimezone = (date: Date, timezone: string = DEFAULT_TIMEZONE): Date => {
  const dateStr = getDateInTimezone(date, timezone);
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  return new Date(`${dateStr}T00:00:00${offset}`);
};

/**
 * Parse a date-only string (YYYY-MM-DD) as midnight in the specified timezone.
 * This avoids the JS Date("YYYY-MM-DD") UTC parsing that can shift the calendar day.
 *
 * DST-safe: verifies the result maps back to the correct calendar date and
 * retries with the corrected offset if DST boundaries cause a mismatch
 * (e.g., spring-forward day where midnight's offset differs from noon's).
 */
export const parseDateStringInTimezone = (
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE
): Date => {
  // First attempt: use offset from noon UTC (works for ~99% of days)
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  const result = new Date(`${dateStr}T00:00:00${offset}`);

  // Verify the result actually represents the correct calendar date in-timezone
  const actualDate = getDateInTimezone(result, timezone);
  if (actualDate === dateStr) return result;

  // DST mismatch detected (e.g., spring-forward day) — recalculate
  // Use the result itself as reference to get the correct offset for midnight
  const correctedOffset = getTimezoneOffset(timezone, result);
  return new Date(`${dateStr}T00:00:00${correctedOffset}`);
};

/**
 * Get the end-of-day Date for a date-only string (YYYY-MM-DD) in the specified timezone.
 * DST-safe: uses the same self-correcting approach as parseDateStringInTimezone.
 */
export const getEndOfDateStringInTimezone = (
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE
): Date => {
  // First attempt
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  const result = new Date(`${dateStr}T23:59:59.999${offset}`);

  // Verify
  const actualDate = getDateInTimezone(result, timezone);
  if (actualDate === dateStr) return result;

  // Correct for DST mismatch
  const correctedOffset = getTimezoneOffset(timezone, result);
  return new Date(`${dateStr}T23:59:59.999${correctedOffset}`);
};

/**
 * Get a date N days from now in specified timezone (YYYY-MM-DD format)
 */
export const getDateInTimezoneOffset = (daysOffset: number, timezone: string = DEFAULT_TIMEZONE): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return getDateInTimezone(date, timezone);
};

/**
 * Format a timestamp for display in the location's timezone
 */
export const formatTimeDisplay = (
  timestamp: string | Date,
  timezone: string = DEFAULT_TIMEZONE
): string => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
};

/**
 * Format a full datetime for display in the location's timezone
 */
export const formatDateTimeDisplay = (
  timestamp: string | Date,
  timezone: string = DEFAULT_TIMEZONE
): string => {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
};

/**
 * Default business day cutoff hour (5 AM) - used as fallback when close time is not provided.
 */
const DEFAULT_CUTOFF_HOUR = 5;

/**
 * Hours after close time when the business day resets.
 * e.g., if close is midnight (24) and this is 3, business day resets at 3 AM.
 */
const HOURS_AFTER_CLOSE = 3;

/**
 * Calculate the business day cutoff hour based on location close time.
 * The cutoff is 3 hours after the location's close time.
 * If close time crosses midnight (e.g., close at 11pm = 23:00, cutoff at 2am = 02:00),
 * this is handled correctly.
 * 
 * @param closeTime - Close time in HH:MM format (e.g., "22:00" or "00:00")
 * @returns Cutoff hour (0-23)
 */
export const calculateCutoffHour = (closeTime?: string | null): number => {
  if (!closeTime || typeof closeTime !== 'string') return DEFAULT_CUTOFF_HOUR;
  
  const [hours] = closeTime.split(':').map(Number);
  if (isNaN(hours)) return DEFAULT_CUTOFF_HOUR;
  
  // Add 3 hours after close, wrap around midnight
  return (hours + HOURS_AFTER_CLOSE) % 24;
};

/**
 * Get the current "business date" in specified timezone.
 * If it's before the cutoff hour, returns yesterday's date.
 * This is useful for closing checklists and late-night operations.
 * 
 * @param timezone - The location's timezone
 * @param closeTime - Optional close time in HH:MM format to calculate dynamic cutoff
 */
export const getBusinessDateInTimezone = (
  timezone: string = DEFAULT_TIMEZONE,
  closeTime?: string | null
): string => {
  const cutoffHour = calculateCutoffHour(closeTime);
  const now = new Date();
  
  // Get current hour in the timezone
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false
  }).format(now);
  const currentHour = parseInt(hourStr, 10);
  
  // If before cutoff, use yesterday's date
  if (currentHour < cutoffHour) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return getDateInTimezone(yesterday, timezone);
  }
  
  return getTodayInTimezone(timezone);
};

/**
 * Map any timestamp to its business date string (YYYY-MM-DD) in the given timezone.
 *
 * Mirrors getBusinessDateInTimezone but works on a historical timestamp instead of "now".
 * If the timestamp's local hour is before the cutoff (close + 3h), it rolls back to the
 * previous calendar day — ensuring overnight shifts/punches are attributed to a single
 * business day across all UI surfaces.
 *
 * Use this for grouping/filtering punches, shifts, completions on the schedule UI.
 */
export const getBusinessDateForTimestamp = (
  timestamp: string | Date,
  timezone: string = DEFAULT_TIMEZONE,
  closeTime?: string | null
): string => {
  const cutoffHour = calculateCutoffHour(closeTime);
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  const hour = parseInt(hourStr, 10);

  if (hour < cutoffHour) {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return getDateInTimezone(prev, timezone);
  }
  return getDateInTimezone(date, timezone);
};

/**
 * Get the business day start and end for checklist completion tracking.
 * The business day runs from cutoff hour today to cutoff hour tomorrow.
 * This allows late-night submissions (after midnight) to count for the previous business day.
 * 
 * @param dateStr - The date in YYYY-MM-DD format
 * @param timezone - The location's timezone
 * @param closeTime - Optional close time in HH:MM format to calculate dynamic cutoff
 */
export const getBusinessDayRangeInTimezone = (
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE,
  closeTime?: string | null
): { start: Date; end: Date } => {
  const cutoffHour = calculateCutoffHour(closeTime);
  const cutoffStr = cutoffHour.toString().padStart(2, '0');
  
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  
  // Business day starts at cutoff hour on the given date
  const start = new Date(`${dateStr}T${cutoffStr}:00:00${offset}`);
  
  // Business day ends at cutoff hour the next day
  const nextDay = new Date(referenceDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDateStr = getDateInTimezone(nextDay, timezone);
  const nextOffset = getTimezoneOffset(timezone, nextDay);
  const end = new Date(`${nextDateStr}T${cutoffStr}:00:00${nextOffset}`);
  
  return { start, end };
};
