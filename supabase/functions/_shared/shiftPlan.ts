// THEO HANDS build 3: the pure rules for adding and deleting a shift, and the day view every
// schedule preview shows. No database. Used by ai-assistant (preview + re-check at the tap) and tested
// in src/lib/shiftPlan.test.ts. Time off / availability reasons come from the cover check (hurdleFor).
import { fmtRange, fmtTime, weekdayOf } from "./coverCandidates.ts";

const mins = (t: string) => { const [h, m] = (t || "0:0").slice(0, 5).split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const span = (s: string, e: string): [number, number] => { const a = mins(s); let b = mins(e); if (b <= a) b += 1440; return [a, b]; };
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
const hoursOf = (s: { start_time: string; end_time: string }) => { const [a, b] = span(s.start_time, s.end_time); return (b - a) / 60; };
const roundH = (n: number) => Math.round(n * 2) / 2;
const first = (n: string) => n.split(" ")[0];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Days between two yyyy-MM-dd dates (b - a). */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
/** Monday of the week holding this date (the schedule's week_start_date). */
export function mondayOf(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
/** The desktop's day number: offset from the week's Monday (Monday = 0). */
export const dayOffset = (shiftDate: string, weekStart: string) => daysBetween(weekStart, shiftDate);

/** "17:30" / "5:30 pm" style input -> "HH:MM:00", or null. */
export function normTime(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2}):?(\d{2})?(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2] || 0);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

export const ADD_MAX_DAYS_AHEAD = 28;

/** Hard stops for an add: Theo says why and shows no preview. null = go on. */
export function addHardStop(o: { personMatches: number; onRoster: boolean; date: string; today: string; start: string | null; end: string | null }): string | null {
  if (o.personMatches === 0) return "not_found";
  if (o.personMatches > 1) return "which_person";
  if (!o.onRoster) return "That person isn't on this store's schedule, so I can't add them. Use the Schedule page.";
  if (o.date < o.today) return "That day has already passed. Use the Schedule page for past days.";
  if (daysBetween(o.today, o.date) > ADD_MAX_DAYS_AHEAD) return "That's more than four weeks out. Add it on the Schedule page.";
  if (!o.start || !o.end || o.start === o.end) return "Those hours don't work. What hours should the shift be?";
  return null;
}

export type DayShift = { id: string; user_id: string; name: string; template_id: string | null; position: string | null; start_time: string; end_time: string };

/** Add-a-shift warnings. They NEVER block. */
export function addShiftWarnings(o: {
  person: { id: string; name: string };
  shift: { shift_date: string; start_time: string; end_time: string; template_id: string | null; position: string | null };
  dayShifts: DayShift[];                                  // everyone's shifts at this store that day (before the add)
  weekShifts: { user_id: string | null; start_time: string; end_time: string; is_time_off?: boolean | null }[]; // the person's week
  hurdle: { kind: string; reason: string } | null;       // from hurdleFor (time off / availability)
}): { warnings: string[]; info: string[] } {
  const warnings: string[] = [];
  const pn = first(o.person.name);
  const sh = span(o.shift.start_time, o.shift.end_time);
  const mineToday = o.dayShifts.filter((d) => d.user_id === o.person.id).sort((a, b) => mins(a.start_time) - mins(b.start_time));
  for (const d of mineToday) {
    warnings.push(overlaps(sh, span(d.start_time, d.end_time))
      ? `${pn} is already working ${fmtRange(d.start_time, d.end_time)} then`
      : `${pn} already works ${fmtRange(d.start_time, d.end_time)} that day`);
  }
  if (o.hurdle && o.hurdle.kind !== "working_then") warnings.push(o.hurdle.reason);
  const named = new Set<string>();
  if (o.shift.template_id) {
    for (const d of o.dayShifts) {
      if (d.user_id === o.person.id || d.template_id !== o.shift.template_id || named.has(d.user_id)) continue;
      named.add(d.user_id);
      warnings.push(`${first(d.name)} is already on ${o.shift.position || "that template"} that day`);
    }
  }
  for (const d of o.dayShifts) {
    if (d.user_id === o.person.id || named.has(d.user_id)) continue;
    if (Math.abs(mins(d.start_time) - mins(o.shift.start_time)) <= 60 && Math.abs(span(d.start_time, d.end_time)[1] - sh[1]) <= 60) {
      named.add(d.user_id);
      warnings.push(`${first(d.name)} works ${fmtRange(d.start_time, d.end_time)}, close to these hours`);
    }
  }
  const week = roundH(o.weekShifts.filter((w) => w.user_id === o.person.id && !w.is_time_off).reduce((n, w) => n + hoursOf(w), 0) + hoursOf(o.shift));
  return { warnings, info: [`This brings ${pn} to ${week} hours this week`] };
}

/** Why a shift can't be deleted (or covered) by voice. null = allowed. Same rules at preview and at the tap. */
export function shiftRefusal(o: {
  shift: { shift_date: string; start_time: string; is_phantom?: boolean | null; is_coverage_only?: boolean | null };
  today: string; nowHHMM: string; openOffer: boolean; punchLinked: boolean; purpose: "delete" | "cover";
}): string | null {
  const verb = o.purpose === "delete" ? "delete" : "cover";
  if (o.openOffer) return "That shift is posted in the shift pool. Handle it there.";
  if (o.shift.shift_date < o.today) return `That shift is in the past, so I can't ${verb} it. Use the Schedule page.`;
  if (o.shift.shift_date === o.today && o.shift.start_time.slice(0, 5) <= o.nowHHMM) return `That shift has already started, so I can't ${verb} it. Use the Schedule page.`;
  if (o.shift.is_phantom) return `That shift was made automatically from a clock-in, so I can't ${verb} it. Use the Schedule page.`;
  if (o.shift.is_coverage_only) return `That's a coverage-only shift, so I can't ${verb} it. Use the Schedule page.`;
  if (o.punchLinked) return `That shift already has punches on it, so I can't ${verb} it. Use the Schedule page.`;
  return null;
}

/** Delete information lines. */
export function deleteInfo(o: { shift: DayShift; dayShifts: DayShift[]; weekShifts: { user_id: string | null; start_time: string; end_time: string; is_time_off?: boolean | null }[] }): string[] {
  const out: string[] = [];
  if (o.shift.template_id && o.shift.position && !o.dayShifts.some((d) => d.id !== o.shift.id && d.template_id === o.shift.template_id)) {
    out.push(`This leaves no one on ${o.shift.position} that day`);
  }
  const week = roundH(o.weekShifts.filter((w) => w.user_id === o.shift.user_id && !w.is_time_off).reduce((n, w) => n + hoursOf(w), 0) - hoursOf(o.shift));
  out.push(`This takes ${first(o.shift.name)} to ${Math.max(0, week)} hours this week`);
  return out;
}

export type DayRow = { id: string; name: string; position: string; time: string; start: number; end: number; kind: "new" | "cover" | "removed" | null };
export type DayView = { date: string; title: string; rows: DayRow[] };
export type DayChange =
  | { kind: "new"; shift: DayShift }
  | { kind: "cover"; shift_id: string; to: { id: string; name: string } }
  | { kind: "removed"; shift_id: string };

/** The day AS IT WILL BE after the change, sorted by start time then name; the changed row(s) marked.
 *  A cover shows two adjacent rows for the one shift: the original person (removed), then the replacement (cover). */
export function buildDayView(date: string, dayShifts: DayShift[], change: DayChange): DayView {
  const rowOf = (s: DayShift, kind: DayRow["kind"], id = s.id): DayRow => {
    const [a, b] = span(s.start_time, s.end_time);
    return { id, name: s.name, position: s.position || "No position", time: fmtRange(s.start_time, s.end_time), start: a, end: b, kind };
  };
  // Each entry is a group that sorts as one unit (the cover pair stays together, removed first).
  const groups: DayRow[][] = dayShifts.map((s) => {
    if (change.kind === "cover" && s.id === change.shift_id) {
      return [rowOf(s, "removed", `${s.id}:was`), rowOf({ ...s, user_id: change.to.id, name: change.to.name }, "cover", `${s.id}:now`)];
    }
    return [rowOf(s, change.kind === "removed" && s.id === change.shift_id ? "removed" : null)];
  });
  if (change.kind === "new") groups.push([rowOf(change.shift, "new")]);
  groups.sort((x, y) => x[0].start - y[0].start || x[0].name.localeCompare(y[0].name));
  const rows = groups.flat();
  const word = change.kind === "new" ? `the day with ${first(change.shift.name)} added` : change.kind === "cover" ? "the day after the change" : "the day with this shift removed";
  const d = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  return { date, title: `${d} · ${word}`, rows };
}

export const weekdayWord = (date: string) => cap(weekdayOf(date));
