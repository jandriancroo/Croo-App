/**
 * Archive-aware checklist item filtering (Jordan + Ryan rule, Aug 27 2026).
 *
 * Archiving a checklist item (checklist_items.deleted_at) pulls it off the floor
 * immediately, but the CURRENT period's score still expects it — the hole is the
 * GM's miss, not the closer's. Next period it is not expected at all.
 *
 * Three different filters — never reuse one of them for another job:
 *  1. Crew-facing lists  → isItemLive()          (hide archived instantly)
 *  2. Score / expected   → isItemExpectedInPeriod() (archived AFTER period start still counts)
 *  3. Overdue / remaining pings → isItemLive()   (never ping for a pulled task)
 */
import {
  DEFAULT_TIMEZONE,
  getBusinessDayRangeInTimezone,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';

export interface ArchivableItem {
  deleted_at?: string | null;
}

/** Filter 1 & 3: only items that are still live work. */
export const isItemLive = (item: ArchivableItem): boolean => !item.deleted_at;

/**
 * Filter 2: an item counts toward "expected" if it is live, or if it was archived
 * after the current scoring period started.
 */
export const isItemExpectedInPeriod = (
  item: ArchivableItem,
  periodStart: Date | null | undefined
): boolean => {
  if (!item.deleted_at) return true;
  if (!periodStart) return true;
  return new Date(item.deleted_at).getTime() >= periodStart.getTime();
};

/** Monday=0 week-start date string for a business date string + its Mon=0 weekday. */
export const getWeekStartDateStr = (dateStr: string, dayOfWeekMon0: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const anchor = new Date(y, m - 1, d, 12, 0, 0);
  anchor.setDate(anchor.getDate() - ((dayOfWeekMon0 + 7) % 7));
  const mm = String(anchor.getMonth() + 1).padStart(2, '0');
  const dd = String(anchor.getDate()).padStart(2, '0');
  return `${anchor.getFullYear()}-${mm}-${dd}`;
};

interface ScorePeriodArgs {
  /** 'dynamic' weekly templates score by week; everything else by frequency. */
  templateType?: string | null;
  frequency?: string | null;
  /** Business date string being scored (yyyy-MM-dd). */
  businessDateStr: string;
  /** Weekday of businessDateStr in location tz, Mon=0..Sun=6. */
  dayOfWeekMon0: number;
  timezone?: string;
  closeTime?: string | null;
}

/**
 * Start of the scoring period for a checklist:
 *  - dynamic weekly templates → that week's Monday business open
 *  - monthly                  → first of the month, midnight in location tz
 *  - daily / everything else  → that business day's open
 */
export const getScorePeriodStart = ({
  templateType,
  frequency,
  businessDateStr,
  dayOfWeekMon0,
  timezone = DEFAULT_TIMEZONE,
  closeTime,
}: ScorePeriodArgs): Date => {
  if (frequency === 'monthly') {
    const [y, m] = businessDateStr.split('-');
    return parseDateStringInTimezone(`${y}-${m}-01`, timezone);
  }
  if (templateType === 'dynamic') {
    const weekStartStr = getWeekStartDateStr(businessDateStr, dayOfWeekMon0);
    return getBusinessDayRangeInTimezone(weekStartStr, timezone, closeTime).start;
  }
  return getBusinessDayRangeInTimezone(businessDateStr, timezone, closeTime).start;
};
