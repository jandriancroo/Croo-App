// THEO HANDS build 2: cover a shift. READ-ONLY — loads data, runs the shared cover check
// (_shared/coverCandidates.ts) and returns screens or a proposal. Never writes.
import { rankCover, hurdleFor, candidateFor, fmtRange, weekdayOf, type CoverInput } from "../_shared/coverCandidates.ts";
import { buildDayView, shiftRefusal, type DayShift } from "../_shared/shiftPlan.ts";
import * as mirror from "../_shared/availabilityMirror.ts";
import { APP_ROLE_ORDER, APP_ROLE_NAMES } from "../_shared/appRoles.ts";

export type Crew = { id: string; full_name: string; nickname: string | null };
// Offer statuses the shift pool treats as still open (not yet handed off).
const OPEN_OFFER = ["available", "open", "pending", "claimed"];
const POSTED = "That shift is posted in the shift pool. Handle it there.";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const first = (n: string) => n.split(" ")[0];
export const dateLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const dayWord = (d: string, today: string) => (d === today ? "today" : cap(weekdayOf(d)));

export async function loadShift(admin: any, shiftId: string, locationId: string) {
  if (typeof shiftId !== "string" || !/^[0-9a-f-]{36}$/i.test(shiftId)) return null;
  const { data } = await admin.from("scheduled_shifts")
    .select("id, user_id, shift_date, start_time, end_time, day_of_week, schedule_id, is_time_off, schedule:schedules!inner(id, location_id, is_published, week_start_date)")
    .eq("id", shiftId).maybeSingle();
  if (!data || data.schedule?.location_id !== locationId || !data.user_id || data.is_time_off) return null;
  return data;
}

export async function hasOpenOffer(admin: any, shiftId: string) {
  const { data } = await admin.from("shift_offers").select("id").eq("shift_id", shiftId).in("status", OPEN_OFFER).limit(1);
  return (data || []).length > 0;
}

export async function punchLinked(admin: any, shiftId: string) {
  const { data } = await admin.from("time_punches").select("id").eq("shift_id", shiftId).limit(1);
  return (data || []).length > 0;
}

export type When = { today: string; nowHHMM: string };
/** The voice refusals shared by delete and cover (server-enforced, again at the tap). */
export async function refusalFor(admin: any, shift: any, w: When, purpose: "delete" | "cover") {
  const { data: flags } = await admin.from("scheduled_shifts").select("is_phantom, is_coverage_only").eq("id", shift.id).maybeSingle();
  const [openOffer, linked] = await Promise.all([hasOpenOffer(admin, shift.id), punchLinked(admin, shift.id)]);
  return shiftRefusal({ shift: { ...shift, ...(flags || {}) }, today: w.today, nowHHMM: w.nowHHMM, openOffer, punchLinked: linked, purpose });
}

export const posOf = (t: any) => (t ? (t.position || t.template_name || null) : null);

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

async function shiftsOn(admin: any, locationId: string, date: string) {
  const { data } = await admin.from("scheduled_shifts")
    .select("id, user_id, shift_date, start_time, end_time, is_time_off, is_phantom, is_coverage_only, schedule:schedules!inner(location_id)")
    .eq("schedule.location_id", locationId).eq("shift_date", date).not("user_id", "is", null);
  return (data || []).filter((s: any) => !s.is_time_off).sort((a: any, b: any) => String(a.start_time).localeCompare(String(b.start_time)));
}

export async function buildInput(admin: any, shift: any, locationId: string, crew: Crew[], name: (c: Crew) => string): Promise<CoverInput> {
  // Candidates are the store's schedule roster (same "show on schedule" rule the Schedule page uses).
  const { data: ros } = await admin.from("user_locations").select("user_id").eq("location_id", locationId).eq("show_on_schedule", true);
  const onRoster = new Set((ros || []).map((r: any) => r.user_id));
  crew = crew.filter((c) => onRoster.has(c.id));
  const ids = crew.map((c) => c.id);
  const [prof, roles, off, week, hrs] = await Promise.all([
    admin.from("profiles").select("id, weekly_availability").in("id", ids),
    admin.from("user_roles").select("user_id, role").in("user_id", [...ids, shift.user_id]),
    admin.from("availability_requests").select("user_id, start_date, end_date, start_time, end_time, time_scope, status")
      .in("user_id", ids).in("status", ["pending", "approved"]).lte("start_date", shift.shift_date)
      .or(`end_date.gte.${shift.shift_date},end_date.is.null`),
    admin.from("scheduled_shifts").select("id, user_id, shift_date, start_time, end_time, is_time_off").eq("schedule_id", shift.schedule_id),
    admin.from("location_hours").select("day_of_week, open_time, close_time, is_closed").eq("location_id", locationId),
  ]);
  const roleOf = new Map<string, string>();
  for (const r of roles.data || []) {
    const cur = roleOf.get(r.user_id);
    const i = APP_ROLE_ORDER.indexOf(r.role);
    if (i >= 0 && (cur === undefined || i < APP_ROLE_ORDER.indexOf(cur))) roleOf.set(r.user_id, r.role);
  }
  const wa = new Map((prof.data || []).map((p: any) => [p.id, p.weekly_availability]));
  const hours: Record<string, { open: string; close: string }> = {};
  for (const row of hrs.data || []) {
    const key = mirror.DAY_KEYS_SUNDAY_FIRST[row.day_of_week];
    if (!key || row.is_closed || !row.open_time || !row.close_time) continue;
    hours[key] = { open: String(row.open_time).substring(0, 5), close: String(row.close_time).substring(0, 5) };
  }
  return {
    shift: { id: shift.id, user_id: shift.user_id, shift_date: shift.shift_date, start_time: shift.start_time, end_time: shift.end_time },
    coveredRole: roleOf.get(shift.user_id) || "team_member",
    people: crew.map((c) => ({ id: c.id, name: name(c), role: roleOf.get(c.id) || "team_member", weekly_availability: wa.get(c.id) ?? null })),
    timeOff: off.data || [],
    weekShifts: week.data || [],
    hours,
    roleOrder: APP_ROLE_ORDER,
    roleNames: APP_ROLE_NAMES,
    avail: { normalizeWeekly: mirror.normalizeWeeklyAvailability as any, conflictingBlocks: mirror.conflictingBlocks as any },
  };
}

const roleWords = (r: string | null) => (r ? APP_ROLE_NAMES[r]?.toLowerCase() : "team member") || "team member";
const article = (w: string) => (/^[aeiou]/.test(w) ? "an" : "a");

/** Ranked list for one shift. */
export async function candidatesScreen(admin: any, locationId: string, shiftId: string, crew: Crew[], name: (c: Crew) => string, w: When) {
  const shift = await loadShift(admin, shiftId, locationId);
  if (!shift) return { error: "That shift isn't on this store's schedule. Use find_shifts." };
  const why = await refusalFor(admin, shift, w, "cover");
  if (why) return { declined: why };
  const covered = crew.find((c) => c.id === shift.user_id);
  const coveredName = covered ? name(covered) : "this person";
  const input = await buildInput(admin, shift, locationId, crew, name);
  const r = rankCover(input);
  const rw = roleWords(input.coveredRole);
  const row = (c: any) => ({ employee_id: c.id, name: c.name, line: c.line, tag: c.tag });
  return {
    screen: {
      kind: "candidates", shift_id: shift.id,
      title: `Who should cover ${first(coveredName)}?`,
      subtitle: `${dateLabel(shift.shift_date)} · ${fmtRange(shift.start_time, shift.end_time)} · ${first(coveredName)} is ${article(rw)} ${rw}`,
      clear: r.clear.map(row), working: r.working.map(row), blocked_summary: r.blockedSummary,
    },
    for_theo: {
      covered: coveredName, shift_id: shift.id, date: shift.shift_date, time: fmtRange(shift.start_time, shift.end_time),
      clear_to_cover: r.clear.map((c) => `${c.name}${c.tag ? ` (${c.tag})` : ""}`),
      already_working_that_day: r.working.map((c) => `${c.name} — ${c.line}`),
      cannot: r.blockedSummary,
    },
  };
}

/** Today's remaining shifts (nobody named) or one person's shifts on a date. */
export async function findShifts(admin: any, locationId: string, crew: Crew[], name: (c: Crew) => string, args: { name?: string; employee_id?: string; date?: string; purpose?: string }, today: string, nowHHMM: string, match: (q: string) => Crew[]) {
  const purpose: "cover" | "delete" = args.purpose === "delete" ? "delete" : "cover";
  const verbQ = purpose === "delete" ? "should come off the schedule" : "needs to be covered";
  const date = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : today;
  const byId = new Map(crew.map((c) => [c.id, c]));
  let person: Crew | undefined = args.employee_id ? byId.get(args.employee_id) : undefined;
  if (!person && args.name) {
    const m = match(String(args.name));
    if (m.length === 0) return { status: "not_found", next: `Say you can't find ${args.name} at this store. Propose nothing.` };
    if (m.length > 1) {
      const people = m.slice(0, 6).map((c) => ({ employee_id: c.id, name: name(c) }));
      return {
        status: "which_person", matches: people,
        next: `Ask "Which ${cap(String(args.name).split(" ")[0])} did you mean?" and name them. Show no list of candidates yet.`,
        screen: { kind: "people", purpose, date, title: `Which ${cap(String(args.name).split(" ")[0])} did you mean?`, people },
      };
    }
    person = m[0];
  }
  const all = await shiftsOn(admin, locationId, date);
  const label = (s: any) => ({ shift_id: s.id, employee_id: s.user_id, name: byId.get(s.user_id) ? name(byId.get(s.user_id)!) : "Someone", time: fmtRange(s.start_time, s.end_time) });
  if (!person) {
    // Only shifts Theo may act on: not started yet, not auto-made, not coverage-only.
    const remaining = all.filter((s: any) => !s.is_phantom && !s.is_coverage_only && (date > today || (date === today && String(s.start_time).slice(0, 5) > nowHHMM)));
    return {
      status: "pick_shift", shifts: remaining.map(label),
      next: `Reply exactly "Which shift ${verbQ} ${date === today ? "today" : cap(weekdayOf(date))}?"`,
      screen: { kind: "shifts", purpose, date, title: `Which shift ${verbQ} ${date === today ? "today" : cap(weekdayOf(date))}?`, shifts: remaining.map(label) },
    };
  }
  const mine = all.filter((s: any) => s.user_id === person!.id);
  const pn = first(name(person));
  if (mine.length === 0) return { status: "no_shift", employee_id: person.id, next: `Say "${pn} isn't scheduled ${dayWord(date, today)}. Did you mean another day?" Propose nothing.` };
  if (mine.length > 1) {
    const words = ["two", "three", "four"][mine.length - 2] || String(mine.length);
    const times = mine.map((s: any) => fmtRange(s.start_time, s.end_time).replace(/ (AM|PM)/g, "")).join(" and ");
    return {
      status: "which_shift", employee_id: person.id, shifts: mine.map(label),
      next: `Ask "${pn} has ${words} shifts ${dayWord(date, today)}, ${times}. Which one?"`,
      screen: { kind: "shifts", purpose, date, title: `${pn} has ${words} shifts ${dayWord(date, today)}. Which one?`, shifts: mine.map(label) },
    };
  }
  const s = mine[0];
  const why = await refusalFor(admin, s, { today, nowHHMM }, purpose);
  if (why) return { status: why === POSTED ? "posted" : "refused", refusal: why, next: `Say exactly "${why}" Propose nothing and show no list.` };
  return {
    status: "one_shift", shift_id: s.id, employee_id: person.id, name: name(person), date, time: fmtRange(s.start_time, s.end_time),
    next: purpose === "delete"
      ? "Call propose_action with action delete_shift and this shift_id."
      : "If the manager named who should take it, resolve them with find_crew and call propose_action (cover_shift). Otherwise call cover_candidates with this shift_id.",
  };
}

/** Preview for one replacement, or why not. Also the re-check at the Confirm tap. */
export async function buildCoverProposal(admin: any, locationId: string, shiftId: string, replacementId: string, crew: Crew[], name: (c: Crew) => string, w: When) {
  const shift = await loadShift(admin, shiftId, locationId);
  if (!shift) return { ok: false as const, error: "That shift_id isn't a shift at this store. Call find_shifts for the person being covered and use the shift_id it returns, then try again." };
  const why = await refusalFor(admin, shift, w, "cover");
  if (why) return { ok: false as const, error: why, posted: why === POSTED, refused: true };
  const rep = crew.find((c) => c.id === replacementId);
  if (!rep) return { ok: false as const, error: "That person isn't active crew at this store. Use find_crew." };
  if (rep.id === shift.user_id) return { ok: false as const, error: `${first(name(rep))} already has this shift.` };
  const covered = crew.find((c) => c.id === shift.user_id);
  const input = await buildInput(admin, shift, locationId, crew, name);
  const me = input.people.find((p) => p.id === rep.id);
  if (!me) return { ok: false as const, error: `${first(name(rep))} isn't on this store's schedule roster.` };
  const fail = hurdleFor(me, input);
  if (fail) return { ok: false as const, error: fail.reason, hurdle: fail.kind };
  const c = candidateFor(me, input);
  const [a, b] = (() => { const m = (t: string) => { const [h, mm] = t.slice(0, 5).split(":").map(Number); return h * 60 + mm; }; const s = m(shift.start_time); let e = m(shift.end_time); if (e <= s) e += 1440; return [s, e]; })();
  const after = Math.round((c.weekHours + (b - a) / 60) * 2) / 2;
  const rn = first(c.name);
  const checks = [
    c.sameDay.length ? `${rn} already scheduled ${c.sameDay.join(", ")}` : "Not scheduled then",
    "No time off that day",
    `This brings ${rn} to ${after} hours this week`,
  ];
  return {
    ok: true as const,
    proposal: {
      id: crypto.randomUUID(), action: "cover_shift",
      shift_id: shift.id, schedule_id: shift.schedule_id, day_of_week: shift.day_of_week, shift_date: shift.shift_date,
      start_time: shift.start_time, end_time: shift.end_time,
      date_label: dateLabel(shift.shift_date), time_label: fmtRange(shift.start_time, shift.end_time),
      covered: { id: shift.user_id, name: covered ? name(covered) : "Unknown" },
      replacement: { id: rep.id, name: c.name },
      checks, tag: c.tag, published: !!shift.schedule?.is_published,
      day: buildDayView(shift.shift_date, await dayShiftsAt(admin, locationId, shift.shift_date, name), { kind: "cover", shift_id: shift.id, to: { id: rep.id, name: c.name } }),
    },
  };
}
