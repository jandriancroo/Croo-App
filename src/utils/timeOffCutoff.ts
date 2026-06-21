import { startOfWeek, addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Compute the cutoff moment for time-off requests targeting a given date.
 * The cutoff falls in the WEEK BEFORE the requested date's week (Mon–Sun),
 * on the configured day-of-week (0=Sun..6=Sat) at the configured local time.
 */
export function getTimeOffCutoffMoment(
  requestStartDate: string, // yyyy-MM-dd
  cutoffDayOfWeek: number,  // 0=Sun..6=Sat
  cutoffTime: string,       // "HH:mm" or "HH:mm:ss"
  timezone: string
): Date {
  // Anchor at noon to avoid DST edges, parsed in the location TZ
  const localNoonUtc = fromZonedTime(`${requestStartDate}T12:00:00`, timezone);
  const zoned = toZonedTime(localNoonUtc, timezone);

  // Monday of the requested week (week_starts_on: 1)
  const mondayOfWeek = startOfWeek(zoned, { weekStartsOn: 1 });
  const prevMonday = addDays(mondayOfWeek, -7);

  // Offset from previous Monday: Mon=0, Tue=1, ... Sat=5, Sun=6
  const dayOffset = cutoffDayOfWeek === 0 ? 6 : cutoffDayOfWeek - 1;
  const cutoffLocalDate = addDays(prevMonday, dayOffset);

  const dateStr = formatInTimeZone(cutoffLocalDate, timezone, "yyyy-MM-dd");
  const [hh = "17", mm = "00"] = cutoffTime.split(":");
  return fromZonedTime(`${dateStr}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00`, timezone);
}

export function formatCutoffLabel(
  cutoffDayOfWeek: number,
  cutoffTime: string
): string {
  const day = DAY_LABELS[cutoffDayOfWeek] ?? "Wed";
  const [hh = "17", mm = "00"] = cutoffTime.split(":");
  const h = parseInt(hh, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h % 12 || 12;
  return `${day} ${display}:${mm} ${ampm}`;
}
