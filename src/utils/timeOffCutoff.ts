import { startOfWeek, addDays } from "date-fns";
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
