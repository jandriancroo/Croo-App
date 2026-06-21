import { startOfWeek, addDays, startOfDay, getDay } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Compute the cutoff moment for time-off requests targeting a given date.
 * The cutoff is N days before the Monday of the target week, at the
 * configured local time (location timezone).
 */
export function getTimeOffCutoffMoment(
  requestStartDate: string, // yyyy-MM-dd
  daysBefore: number,       // e.g. 7 = 1 week before target Monday
  cutoffTime: string,       // "HH:mm" or "HH:mm:ss"
  timezone: string
): Date {
  const localNoonUtc = fromZonedTime(`${requestStartDate}T12:00:00`, timezone);
  const zoned = toZonedTime(localNoonUtc, timezone);

  const mondayOfWeek = startOfWeek(zoned, { weekStartsOn: 1 });
  const cutoffLocalDate = addDays(mondayOfWeek, -Math.max(0, daysBefore));

  const dateStr = formatInTimeZone(cutoffLocalDate, timezone, "yyyy-MM-dd");
  const [hh = "17", mm = "00"] = cutoffTime.split(":");
  return fromZonedTime(
    `${dateStr}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00`,
    timezone
  );
}

export function formatCutoffLabel(
  daysBefore: number,
  cutoffTime: string
): string {
  const [hh = "17", mm = "00"] = cutoffTime.split(":");
  const h = parseInt(hh, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h % 12 || 12;
  const dayWord = daysBefore === 1 ? "day" : "days";
  return `${daysBefore} ${dayWord} before week start, ${display}:${mm} ${ampm}`;
}

function formatTime12h(cutoffTime: string): string {
  const [hh = "17", mm = "00"] = cutoffTime.split(":");
  const h = parseInt(hh, 10);
  const m = parseInt(mm, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Build a human-readable example showing what the current cutoff means
 * for the upcoming schedule week (next Monday after today in the location timezone).
 */
export function getCutoffExample(
  daysBefore: number,
  cutoffTime: string,
  timezone: string
): string {
  const nowZoned = toZonedTime(new Date(), timezone);
  const todayDay = getDay(nowZoned); // 0 = Sunday, 1 = Monday
  let daysUntilMonday = (1 - todayDay + 7) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7;

  const upcomingMonday = addDays(startOfDay(nowZoned), daysUntilMonday);
  const cutoffDate = addDays(upcomingMonday, -Math.max(0, daysBefore));

  const weekStartLabel = formatInTimeZone(upcomingMonday, timezone, "EEE, MMM d");
  const cutoffDateLabel = formatInTimeZone(cutoffDate, timezone, "EEE, MMM d");
  const timeLabel = formatTime12h(cutoffTime);
  const dayWord = daysBefore === 1 ? "day" : "days";

  return `Example: ${daysBefore} ${dayWord} before the week starting ${weekStartLabel} means the cutoff is ${cutoffDateLabel} at ${timeLabel}.`;
}

