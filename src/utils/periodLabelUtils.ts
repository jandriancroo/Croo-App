import { format, subDays } from "date-fns";

/**
 * Monthly close safeguard: when a monthly count is completed right at the
 * start of a new month (day 1-2 before 10am), the period_end_date may point
 * to the current month instead of the prior month. This function infers the
 * correct effective end date for labeling purposes.
 */
export function getEffectivePeriodEndDate(count: {
  period_type?: string | null;
  period_end_date?: string | null;
  status?: string;
  counted_at?: string | null;
  completed_at?: string | null;
}): string | null {
  if (!count.period_end_date) return null;
  let effectiveEnd = count.period_end_date;

  if (
    count.period_type === "monthly" &&
    count.status === "completed" &&
    (count.counted_at || count.completed_at)
  ) {
    const countedAt = new Date((count.counted_at || count.completed_at)!);
    const localDay = countedAt.getDate();
    const localHour = countedAt.getHours();
    if (localDay <= 2) {
      let inferredEnd = format(countedAt, "yyyy-MM-dd");
      if (localHour < 10) {
        inferredEnd = format(subDays(new Date(inferredEnd + "T12:00:00"), 1), "yyyy-MM-dd");
      }
      if (inferredEnd < effectiveEnd) {
        effectiveEnd = inferredEnd;
      }
    }
  }

  return effectiveEnd;
}

/**
 * Format a period label for display, applying the monthly close safeguard.
 */
export function formatPeriodLabel(count: {
  period_type?: string | null;
  period_end_date?: string | null;
  count_date?: string;
  status?: string;
  counted_at?: string | null;
  completed_at?: string | null;
}): string {
  if (!count.period_type || !count.period_end_date) {
    return count.count_date
      ? format(new Date(count.count_date + "T12:00:00"), "MMM d, yyyy")
      : "";
  }

  const effectiveEnd = getEffectivePeriodEndDate(count) || count.period_end_date;
  const endDate = new Date(effectiveEnd + "T12:00:00");

  switch (count.period_type) {
    case "weekly":
      return `Week Ending ${format(endDate, "MMM d, yyyy")}`;
    case "monthly":
      return `${format(endDate, "MMMM yyyy")} Month End`;
    case "yearly":
      return `${format(endDate, "yyyy")} Year End`;
    default:
      return format(new Date((count.count_date || count.period_end_date) + "T12:00:00"), "MMM d, yyyy");
  }
}
