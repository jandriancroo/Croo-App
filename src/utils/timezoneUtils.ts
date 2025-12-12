/**
 * Timezone utilities for consistent date/time handling across the application.
 * All date operations should use these utilities to ensure proper timezone handling.
 */

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Get the current timezone offset string (e.g., "-08:00" or "-07:00" during DST)
 * This dynamically calculates the offset based on the actual timezone rules
 */
export const getTimezoneOffset = (timezone: string = DEFAULT_TIMEZONE): string => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset'
  });
  
  const parts = formatter.formatToParts(now);
  const offsetPart = parts.find(p => p.type === 'timeZoneName');
  
  if (offsetPart) {
    // Parse "GMT-08:00" or "GMT-07:00" format
    const match = offsetPart.value.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) {
      return match[1];
    }
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
 * Get the current day of week in specified timezone (0=Sunday, 6=Saturday)
 */
export const getDayOfWeekInTimezone = (timezone: string = DEFAULT_TIMEZONE): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  });
  const dayName = formatter.format(new Date());
  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
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
  const offset = getTimezoneOffset(timezone);
  return new Date(`${dateStr}T${timeStr}:00${offset}`).toISOString();
};

/**
 * Get the start of today in specified timezone as a Date object
 */
export const getStartOfTodayInTimezone = (timezone: string = DEFAULT_TIMEZONE): Date => {
  const dateStr = getTodayInTimezone(timezone);
  const offset = getTimezoneOffset(timezone);
  return new Date(`${dateStr}T00:00:00${offset}`);
};

/**
 * Get the start of a specific date in specified timezone as a Date object
 */
export const getStartOfDateInTimezone = (date: Date, timezone: string = DEFAULT_TIMEZONE): Date => {
  const dateStr = getDateInTimezone(date, timezone);
  const offset = getTimezoneOffset(timezone);
  return new Date(`${dateStr}T00:00:00${offset}`);
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
