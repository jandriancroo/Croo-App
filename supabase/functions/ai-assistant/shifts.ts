// THEO HANDS build 3: add a shift, delete a shift, and the day view all schedule previews share.
// READ-ONLY — loads data, runs the pure rules (_shared/shiftPlan.ts) and the cover check's
// time-off/availability reasons (hurdleFor), and returns screens or a proposal. Never writes.
import { hurdleFor, fmtRange, fmtTime } from "../_shared/coverCandidates.ts";
import { addHardStop, addShiftWarnings, buildDayView, dayOffset, deleteInfo, mondayOf, normTime, shiftRefusal, weekdayWord, type DayChange, type DayShift } from "../_shared/shiftPlan.ts";
import { buildInput, dateLabel, hasOpenOffer, type Crew } from "./cover.ts";

const NO_SCHEDULE = "00000000-0000-0000-0000-000000000000";
const first = (n: string) => n.split(" ")[0];
const posOf = (t: any) => (t ? (t.position || t.template_name || null) : null);

/** Every assigned, non-time-off shift at this store on that date, with names and positions. */
export async function dayShiftsAt(admin: any, locationId: string, date: string, name: (c: Crew) => string): Promise<DayShift[]> {
  const { data } = await admin.from("scheduled_shifts")
    .select("id, user_id, template_id, start_time, end_time, is_time_off, schedule:schedules!inner(location_id), template:shift_templates(template_name, position)")
    .eq("schedule.location_id", locationId).eq("shift_date", date).not("user_id", "is", null);
  const rows = (data || []).filter((s: any) => !s.is_time_off);
  const ids = [...new Set(rows.map((s: any) => s.user_id))];
  const { data: prof } = ids.length ? await admin.from("profiles").select("id, full_name, nickname").in("id", ids) : { data: [] };
  const nm = new Map((prof || []).map((p: any) => [p.id, name(p)]));
  return rows.map((s: any) => ({ id: s.id, user_id: s.user_id, name: nm.get(s.user_id) || "Someone", template_id: s.template_id, position: posOf(s.template), start_time: s.start_time, end_time: s.end_time }));
}

export async function dayViewFor(admin: any, locationId: string, date: string, name: (c: Crew) => string, change: DayChange) {
  return buildDayView(date, await dayShiftsAt(admin, locationId, date, name), change);
}

async function scheduleFor(admin: any, locationId: string, date: string) {
  const week = mondayOf(date);
  const { data } = await admin.from("schedules").select("id, is_published, week_start_date").eq("location_id", locationId).eq("week_start_date", week).maybeSingle();
  return { week, schedule: data as { id: string; is_published: boolean; week_start_date: string } | null };
}

/** This store's templates that apply to that weekday (Monday = 0 on templates), by start time. */
export async function templatesFor(admin: any, locationId: string, date: string) {
  const { data } = await admin.from("shift_templates").select("id, template_name, position, start_time, end_time, days_of_week").eq("location_id", locationId).order("start_time");
  const off = dayOffset(date, mondayOf(date));
  return (data || []).filter((t: any) => !Array.isArray(t.days_of_week) || t.days_of_week.includes(off));
}

export type AddArgs = { employee_id?: string; date?: string; start_time?: string; end_time?: string; template_id?: string };

/**
 * Build an add preview, or say what is missing / why not.
 * Returns one of: { ask } (a question for the manager), { stop } (a hard stop), { screen, for_theo } (template list), { ok, proposal }.
 */
export async function buildAddProposal(admin: any, locationId: string, args: AddArgs, crew: Crew[], name: (c: Crew) => string, today: string): Promise<any> {
  const person = crew.find((c) => c.id === args.employee_id);
  if (!args.employee_id) return { ask: "Who should I add?" };
  if (!person) return { stop: "I can't find that person at this store." };
  const pn = first(name(person));
  const date = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : null;
  if (!date) return { ask: "Which day?" };
  const templates = await templatesFor(admin, locationId, date);
  const tId = args.template_id && args.template_id !== "none" ? args.template_id : null;
  const tmpl = tId ? templates.find((t: any) => t.id === tId) : null;
  if (tId && !tmpl) return { stop: "That template isn't set up for that day at this store. Pick another, or say from scratch." };
  let start = normTime(args.start_time); let end = normTime(args.end_time);
  if ((!start || !end) && tmpl) { start = tmpl.start_time; end = tmpl.end_time; }
  const { data: ros } = await admin.from("user_locations").select("user_id").eq("location_id", locationId).eq("show_on_schedule", true).eq("user_id", person.id);
  const stopPre = addHardStop({ personMatches: 1, onRoster: (ros || []).length > 0, date, today, start: "09:00:00", end: "10:00:00" });
  if (stopPre) return { stop: stopPre };
  if (!start || !end) {
    if (args.start_time || args.end_time) return { stop: "Those hours don't work. What hours should the shift be?" };
    return { ask: "What hours?", templates: templates.map((t: any) => ({ template_id: t.id, name: posOf(t), usual: fmtRange(t.start_time, t.end_time) })) };
  }
  const stop = addHardStop({ personMatches: 1, onRoster: true, date, today, start, end });
  if (stop) return { stop };
  if (args.template_id === undefined || args.template_id === "") {
    const rows = [
      { template_id: "none", name: "No template", line: `From scratch: just ${pn} and these hours` },
      ...templates.map((t: any) => ({ template_id: t.id, name: posOf(t), line: `usually ${fmtRange(t.start_time, t.end_time)}` })),
    ];
    return {
      screen: { kind: "templates", title: "Which shift template, or from scratch?", subtitle: `${pn} · ${dateLabel(date)} · ${fmtRange(start, end)}`, draft: { employee_id: person.id, date, start_time: start, end_time: end }, rows },
      for_theo: { templates: rows.map((r) => ({ template_id: r.template_id, name: r.name })) },
    };
  }
  const { week, schedule } = await scheduleFor(admin, locationId, date);
  const position = posOf(tmpl);
  const fake = { id: "new", user_id: "", shift_date: date, start_time: start, end_time: end, day_of_week: 0, schedule_id: schedule?.id || NO_SCHEDULE };
  const input = await buildInput(admin, fake, locationId, crew, name);
  const me = input.people.find((p) => p.id === person.id);
  const hurdle = me ? hurdleFor(me, input) : null;
  const dayShifts = await dayShiftsAt(admin, locationId, date, name);
  const { warnings, info } = addShiftWarnings({
    person: { id: person.id, name: name(person) },
    shift: { shift_date: date, start_time: start, end_time: end, template_id: tmpl?.id || null, position },
    dayShifts, weekShifts: input.weekShifts, hurdle,
  });
  const newRow: DayShift = { id: "new", user_id: person.id, name: name(person), template_id: tmpl?.id || null, position, start_time: start, end_time: end };
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "add_shift",
      employee: { id: person.id, name: name(person) },
      shift_date: date, start_time: start, end_time: end, template_id: tmpl?.id || null, position,
      week_start: week, schedule_id: schedule?.id || null, day_of_week: dayOffset(date, week),
      published: !!schedule?.is_published,
      date_label: dateLabel(date), time_label: fmtRange(start, end),
      warnings, info,
      day: buildDayView(date, dayShifts, { kind: "new", shift: newRow }),
    },
  };
}

/** Load a shift for delete with everything the refusals need. */
async function loadForDelete(admin: any, shiftId: string, locationId: string) {
  if (typeof shiftId !== "string" || !/^[0-9a-f-]{36}$/i.test(shiftId)) return null;
  const { data } = await admin.from("scheduled_shifts")
    .select("id, user_id, shift_date, start_time, end_time, day_of_week, schedule_id, template_id, is_time_off, is_phantom, is_coverage_only, schedule:schedules!inner(id, location_id, is_published, week_start_date)")
    .eq("id", shiftId).maybeSingle();
  if (!data || data.schedule?.location_id !== locationId || !data.user_id || data.is_time_off) return null;
  return data;
}

export async function punchLinked(admin: any, shiftId: string) {
  const { data } = await admin.from("time_punches").select("id").eq("shift_id", shiftId).limit(1);
  return (data || []).length > 0;
}

/** The refusal check shared by delete and cover (server-enforced). */
export async function refusalFor(admin: any, shift: any, today: string, nowHHMM: string, purpose: "delete" | "cover") {
  const [openOffer, linked] = await Promise.all([hasOpenOffer(admin, shift.id), punchLinked(admin, shift.id)]);
  return shiftRefusal({ shift, today, nowHHMM, openOffer, punchLinked: linked, purpose });
}

/** Delete preview, or why not. Also the re-check at the Confirm tap. */
export async function buildDeleteProposal(admin: any, locationId: string, shiftId: string, crew: Crew[], name: (c: Crew) => string, today: string, nowHHMM: string): Promise<any> {
  const s = await loadForDelete(admin, shiftId, locationId);
  if (!s) return { ok: false, error: "That shift isn't on this store's schedule. Use find_shifts." };
  const why = await refusalFor(admin, s, today, nowHHMM, "delete");
  if (why) return { ok: false, error: why, refused: true };
  const dayShifts = await dayShiftsAt(admin, locationId, s.shift_date, name);
  const me = dayShifts.find((d) => d.id === s.id);
  if (!me) return { ok: false, error: "That shift isn't on this store's schedule. Use find_shifts." };
  const { data: week } = await admin.from("scheduled_shifts").select("user_id, start_time, end_time, is_time_off").eq("schedule_id", s.schedule_id).eq("user_id", s.user_id);
  const covered = crew.find((c) => c.id === s.user_id);
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "delete_shift",
      shift_id: s.id, schedule_id: s.schedule_id, day_of_week: s.day_of_week, shift_date: s.shift_date,
      start_time: s.start_time, end_time: s.end_time, template_id: s.template_id, position: me.position,
      employee: { id: s.user_id, name: covered ? name(covered) : me.name },
      published: !!s.schedule?.is_published,
      date_label: dateLabel(s.shift_date), time_label: fmtRange(s.start_time, s.end_time),
      warnings: [], info: deleteInfo({ shift: me, dayShifts, weekShifts: week || [] }),
      day: buildDayView(s.shift_date, dayShifts, { kind: "removed", shift_id: s.id }),
    },
  };
}

export const timeWord = (t: string) => fmtTime(t);
export const dayWord = weekdayWord;
