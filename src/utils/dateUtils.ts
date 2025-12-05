/**
 * Get the current date string in PST timezone (YYYY-MM-DD format)
 * This should be used for all "today" date comparisons to ensure consistency
 */
export const getTodayInPST = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

/**
 * Convert any Date object to a date string in PST timezone (YYYY-MM-DD format)
 */
export const getDateInPST = (date: Date): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

/**
 * Get the start of today in PST as a Date object (for timestamp comparisons)
 */
export const getStartOfTodayPST = (): Date => {
  const pstDateStr = getTodayInPST();
  // Create date at midnight PST, then convert to UTC for database queries
  const [year, month, day] = pstDateStr.split('-').map(Number);
  // Create a date string with PST timezone offset
  const pstMidnight = new Date(`${pstDateStr}T00:00:00-08:00`);
  return pstMidnight;
};

/**
 * Get the start of a specific date in PST as a Date object
 */
export const getStartOfDatePST = (date: Date): Date => {
  const pstDateStr = getDateInPST(date);
  return new Date(`${pstDateStr}T00:00:00-08:00`);
};

/**
 * Get a date N days from now in PST (YYYY-MM-DD format)
 */
export const getDateInPSTOffset = (daysOffset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return getDateInPST(date);
};
