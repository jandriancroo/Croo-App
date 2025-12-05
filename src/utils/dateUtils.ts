const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Get the current date string in specified timezone (YYYY-MM-DD format)
 * Defaults to PST if no timezone provided
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
 * Get timezone offset string for common US timezones
 */
const getTimezoneOffset = (timezone: string): string => {
  const offsets: Record<string, string> = {
    'America/Los_Angeles': '-08:00',
    'America/Denver': '-07:00',
    'America/Phoenix': '-07:00',
    'America/Chicago': '-06:00',
    'America/New_York': '-05:00',
    'America/Anchorage': '-09:00',
    'Pacific/Honolulu': '-10:00',
  };
  return offsets[timezone] || '-08:00';
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

// Legacy aliases for backward compatibility (default to PST)
export const getTodayInPST = (): string => getTodayInTimezone(DEFAULT_TIMEZONE);
export const getDateInPST = (date: Date): string => getDateInTimezone(date, DEFAULT_TIMEZONE);
export const getStartOfTodayPST = (): Date => getStartOfTodayInTimezone(DEFAULT_TIMEZONE);
export const getStartOfDatePST = (date: Date): Date => getStartOfDateInTimezone(date, DEFAULT_TIMEZONE);
export const getDateInPSTOffset = (daysOffset: number): string => getDateInTimezoneOffset(daysOffset, DEFAULT_TIMEZONE);
