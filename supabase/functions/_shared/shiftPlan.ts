// THEO HANDS build 3: the pure rules for adding and deleting a shift, and the day view every
// schedule preview shows. No database. Used by ai-assistant (preview + re-check at the tap) and tested
// in src/lib/shiftPlan.test.ts. Time off / availability reasons come from the cover check (hurdleFor).
import { fmtRange, fmtTime, weekdayOf, hurdleFor, roleTag, type CoverInput, type CoverPerson, type CoverBlocked } from "./coverCandidates.ts";

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
  today: string; nowHHMM: string; openOffer: boolean; punchLinked: boolean; purpose: "delete" | "cover" | "swap" | "change";
}): string | null {
  const verb = o.purpose === "change" ? "change" : o.purpose;
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

export type DayRow = { id: string; name: string; position: string; time: string; start: number; end: number; kind: "new" | "cover" | "removed" | "swapped" | "changed" | null; was?: string };
export type DayView = { date: string; title: string; rows: DayRow[] };
export type DayChange =
  | { kind: "new"; shift: DayShift }
  | { kind: "cover"; shift_id: string; to: { id: string; name: string } }
  | { kind: "removed"; shift_id: string }
  | { kind: "swapped"; to: Record<string, { id: string; name: string }> }
  | { kind: "changed"; shift_id: string; start_time: string; end_time: string };

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
    if (change.kind === "swapped" && change.to[s.id]) return [rowOf({ ...s, user_id: change.to[s.id].id, name: change.to[s.id].name }, "swapped")];
    if (change.kind === "changed" && s.id === change.shift_id) {
      return [{ ...rowOf({ ...s, start_time: change.start_time, end_time: change.end_time }, "changed"), was: fmtRange(s.start_time, s.end_time) }];
    }
    return [rowOf(s, change.kind === "removed" && s.id === change.shift_id ? "removed" : null)];
  });
  if (change.kind === "new") groups.push([rowOf(change.shift, "new")]);
  groups.sort((x, y) => x[0].start - y[0].start || x[0].name.localeCompare(y[0].name));
  const rows = groups.flat();
  const word = change.kind === "new" ? `the day with ${first(change.shift.name)} added` : change.kind === "removed" ? "the day with this shift removed" : "the day after the change";
  const d = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  return { date, title: `${d} · ${word}`, rows };
}

export const weekdayWord = (date: string) => cap(weekdayOf(date));

// ---------------------------------------------------------------- build 4: swap and change hours

/**
 * Swap check, one direction: can `person` take `taken` (the other person's shift)?
 * The shift they give up is left out, so it never counts as "already working then".
 * Uses the cover check (hurdleFor) as is: time off (pending or approved), weekly availability, already working.
 */
export function swapHurdle(person: CoverPerson, takenInput: CoverInput, givenUpId: string): CoverBlocked | null {
  return hurdleFor(person, { ...takenInput, weekShifts: takenInput.weekShifts.filter((w) => w.id !== givenUpId) });
}

type SwapSide = { shift: { id: string; user_id: string; start_time: string; end_time: string; schedule_id: string }; person: CoverPerson; input: CoverInput };
/**
 * The whole swap rule. a.person gives up a.shift and takes b.shift; b.person the reverse.
 * Returns a stop (one sentence, no preview) or the role warnings and hours lines.
 */
export function swapPlan(a: SwapSide, b: SwapSide): { stop: string } | { warnings: string[]; info: string[] } {
  if (a.shift.id === b.shift.id || a.person.id === b.person.id) return { stop: "That's the same person." };
  const ha = swapHurdle(a.person, b.input, a.shift.id);
  if (ha) return { stop: `${ha.reason}, so I can't swap them.` };
  const hb = swapHurdle(b.person, a.input, b.shift.id);
  if (hb) return { stop: `${hb.reason}, so I can't swap them.` };
  const warnings: string[] = [];
  // Role flag (never a block): the person giving up a shift outranks the person taking it. Same wording as cover's tag.
  const tagA = roleTag(b.input.coveredRole, a.person.role, b.input.roleOrder, b.input.roleNames);
  if (tagA) warnings.push(`${first(a.person.name)} is tagged: ${tagA}`);
  const tagB = roleTag(a.input.coveredRole, b.person.role, a.input.roleOrder, a.input.roleNames);
  if (tagB) warnings.push(`${first(b.person.name)} is tagged: ${tagB}`);
  const after = (p: CoverPerson, give: SwapSide["shift"], take: SwapSide["shift"], takeInput: CoverInput) => {
    // Hours in the week of the shift they take (the week shown on the schedule for that day).
    const mine = takeInput.weekShifts.filter((w) => w.user_id === p.id && !w.is_time_off && w.id !== give.id && w.id !== take.id);
    return roundH(mine.reduce((n, w) => n + hoursOf(w), 0) + hoursOf(take));
  };
  const info = [
    `This brings ${first(a.person.name)} to ${after(a.person, a.shift, b.shift, b.input)} hours this week`,
    `This brings ${first(b.person.name)} to ${after(b.person, b.shift, a.shift, a.input)} hours this week`,
  ];
  return { warnings, info };
}

/**
 * New hours for a change: "10 to 4", or one end only ("stay till 5" = end only, "start at 10" = start only).
 * Returns the full new start/end, or a stop.
 */
export function changeHours(o: { name: string; cur: { start_time: string; end_time: string }; start: string | null; end: string | null; startGiven: boolean; endGiven: boolean }): { stop: string } | { start: string; end: string } {
  const bad = "Those hours don't work. What hours should the shift be?";
  if (!o.startGiven && !o.endGiven) return { stop: "What hours should the shift be?" };
  if ((o.startGiven && !o.start) || (o.endGiven && !o.end)) return { stop: bad };
  const start = o.start ?? o.cur.start_time.slice(0, 5) + ":00";
  const end = o.end ?? o.cur.end_time.slice(0, 5) + ":00";
  if (start.slice(0, 5) === end.slice(0, 5)) return { stop: bad };
  if (start.slice(0, 5) === o.cur.start_time.slice(0, 5) && end.slice(0, 5) === o.cur.end_time.slice(0, 5)) return { stop: `That's already ${first(o.name)}'s shift.` };
  return { start, end };
}

/** Change-hours warnings (never block): the add-a-shift warnings with the changed shift left out. */
export function changeShiftWarnings(o: {
  shift: DayShift & { shift_date: string };
  start: string; end: string;
  dayShifts: DayShift[];
  weekShifts: { id?: string; user_id: string | null; start_time: string; end_time: string; is_time_off?: boolean | null }[];
  hurdle: { kind: string; reason: string } | null;
}): { warnings: string[]; info: string[] } {
  const r = addShiftWarnings({
    person: { id: o.shift.user_id, name: o.shift.name },
    // No template here: the shift keeps its own position, so "already on that template" is not a change.
    shift: { shift_date: o.shift.shift_date, start_time: o.start, end_time: o.end, template_id: null, position: null },
    dayShifts: o.dayShifts.filter((d) => d.id !== o.shift.id),
    weekShifts: o.weekShifts.filter((w) => w.id !== o.shift.id),
    hurdle: o.hurdle && (o.hurdle.kind === "time_off" || o.hurdle.kind === "unavailable") ? o.hurdle : null,
  });
  return { warnings: r.warnings, info: r.info.map((t) => t.replace(/^This brings/, "This takes")) };
}
