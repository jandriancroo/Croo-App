// THEO HANDS build 5: add a schedule event. READ-ONLY — loads this store's categories, the week's
// schedule and the events already there, runs the pure rules (_shared/eventPlan.ts) and returns a
// question, a stop, or a proposal. Also the re-check at the Add event tap and the Undo check. Never writes.
import { COLOR_ASK, EVENT_COLORS, EVENT_ROLE_OPTIONS, ROLE_ASK, duplicateWarning, eventChecks, eventTime, matchCategory, matchRole, parseDays, presetColor, weekdayOf, whenLabel, type ExistingEvent } from "../_shared/eventPlan.ts";
import { mondayOf } from "../_shared/shiftPlan.ts";
import { APP_ROLE_ORDER } from "../_shared/appRoles.ts";

export type EventArgs = {
  event_name?: string; date?: string; days?: unknown; start_time?: string; end_time?: string;
  category?: string; create_category?: boolean; category_color?: string; no_category?: boolean;
  notes?: string; daily_task?: boolean; meeting?: boolean; tag_roles?: unknown;
};
// Same as the database rule on event_categories: admin and up may create a category.
const canMakeCategory = (role: string | null) => !!role && APP_ROLE_ORDER.indexOf(role) !== -1 && APP_ROLE_ORDER.indexOf(role) <= APP_ROLE_ORDER.indexOf("admin");
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function existingAt(admin: any, locationId: string): Promise<ExistingEvent[]> {
  const { data } = await admin.from("schedule_events").select("id, event_name, event_time, is_recurring, event_date, day_of_week, days_of_week").eq("location_id", locationId).limit(2000);
  return (data || []) as ExistingEvent[];
}

export async function buildEventProposal(admin: any, locationId: string, args: EventArgs, today: string, role: string | null): Promise<any> {
  const name = String(args.event_name ?? "").trim().slice(0, 120);
  const date = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : null;
  const daysRaw = args.days == null || (Array.isArray(args.days) && args.days.length === 0) ? [] : parseDays(args.days);
  if (daysRaw === null) return { ask: "Which days? Say weekdays, like Monday and Thursday." };
  const mode: "one-time" | "recurring" | null = daysRaw.length ? "recurring" : date ? "one-time" : null;
  const start = args.start_time ? eventTime(args.start_time) : null;
  if (args.start_time && !start) return { ask: "What time does it start?" };
  const end = args.end_time ? eventTime(args.end_time) : null;
  if (args.end_time && !end) return { ask: "What time does it end?" };
  const chk = eventChecks({ name, mode, date, days: daysRaw, start, end }, today);
  if (chk.ask) return { ask: chk.ask };
  if (chk.stop) return { stop: chk.stop };

  // Category: one of this store's, a new one (admin and up, a preset colour), or none.
  const { data: catsData } = await admin.from("event_categories").select("id, name, color").eq("location_id", locationId).order("name");
  const cats = (catsData || []) as { id: string; name: string; color: string }[];
  let category: { id: string | null; name: string; color: string; is_new: boolean } | null = null;
  const said = String(args.category ?? "").trim().slice(0, 60);
  if (said && !args.no_category) {
    const m = matchCategory(said, cats);
    if ("match" in m) category = { id: m.match.id, name: m.match.name, color: m.match.color, is_new: false };
    else if ("several" in m) return { ask: `Which category: ${m.several.map((c) => c.name).join(" or ")}?` };
    else if (!args.create_category) return { ask: `There's no '${said}' category. Want me to create it? What color?` };
    else {
      if (!canMakeCategory(role)) return { stop: `Only an admin can create a new category. ${cats.length ? `Pick one of this store's: ${cats.map((c) => c.name).join(", ")}, or no category.` : "Say no category instead."}` };
      const hex = presetColor(args.category_color);
      if (!hex) return { ask: COLOR_ASK };
      category = { id: null, name: said, color: hex, is_new: true };
    }
  } else if (args.create_category && !args.no_category) {
    return { ask: "What should the new category be called?" };
  }

  // Roles, as the desktop window's Tag Roles list.
  const tagged: string[] = [];
  if (Array.isArray(args.tag_roles)) {
    for (const r of args.tag_roles.slice(0, 8)) {
      const m = matchRole(String(r ?? ""));
      if ("role" in m) { if (!tagged.includes(m.role)) tagged.push(m.role); }
      else if ("several" in m) return { ask: `Which one: ${m.several.join(" or ")}?` };
      else return { ask: ROLE_ASK };
    }
  }
  tagged.sort((a, b) => EVENT_ROLE_OPTIONS.findIndex((o) => o.value === a) - EVENT_ROLE_OPTIONS.findIndex((o) => o.value === b));

  // One-time: the week's schedule row (or a draft week made at the tap, like adding a shift).
  let week_start: string | null = null, schedule_id: string | null = null;
  if (mode === "one-time") {
    week_start = mondayOf(date!);
    const { data: sch } = await admin.from("schedules").select("id").eq("location_id", locationId).eq("week_start_date", week_start).maybeSingle();
    schedule_id = sch?.id ?? null;
  }
  const warnings = [...chk.warnings];
  const dup = duplicateWarning({ name, mode: mode!, date, days: daysRaw, start: start! }, await existingAt(admin, locationId));
  if (dup) warnings.push(dup);
  const notes = String(args.notes ?? "").trim().slice(0, 500) || null;
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "create_event",
      name, mode, event_date: mode === "one-time" ? date : null, day_of_week: mode === "one-time" ? weekdayOf(date!) : daysRaw[0], days: mode === "recurring" ? daysRaw : [],
      start_time: start, end_time: end, category, notes, is_daily_task: args.daily_task === true, is_meeting: args.meeting === true,
      tagged_roles: tagged, tagged_labels: tagged.map((r) => EVENT_ROLE_OPTIONS.find((o) => o.value === r)!.label),
      week_start, week_end: week_start ? addDays(week_start, 6) : null, schedule_id, needs_draft: mode === "one-time" && !schedule_id,
      when_label: whenLabel({ mode: mode!, date, days: daysRaw, start: start!, end }), warnings,
    },
  };
}

/** The re-check at the Add event tap: category still there (or still free), week row, no new duplicate. */
export async function recheckEvent(admin: any, locationId: string, p: any, role: string | null): Promise<{ ok: true; schedule_id: string | null } | { ok: false; changed: string }> {
  const cat = p?.category;
  if (cat && !cat.is_new) {
    const { data } = await admin.from("event_categories").select("id").eq("id", String(cat.id || "")).eq("location_id", locationId).maybeSingle();
    if (!data) return { ok: false, changed: `the '${cat.name}' category was removed.` };
  }
  if (cat?.is_new) {
    if (!canMakeCategory(role)) return { ok: false, changed: "only an admin can create a new category." };
    if (!EVENT_COLORS.some((c) => c.hex === cat.color)) return { ok: false, changed: "that color isn't one of the presets." };
    const { data } = await admin.from("event_categories").select("id, name").eq("location_id", locationId);
    if ((data || []).some((c: any) => String(c.name).trim().toLowerCase() === String(cat.name).trim().toLowerCase())) return { ok: false, changed: `a '${cat.name}' category was just created. Ask Theo again to use it.` };
  }
  let schedule_id: string | null = null;
  if (p?.mode === "one-time") {
    const { data: sch } = await admin.from("schedules").select("id").eq("location_id", locationId).eq("week_start_date", String(p.week_start || "")).maybeSingle();
    if (p.schedule_id && sch?.id !== p.schedule_id) return { ok: false, changed: "that week's schedule was removed." };
    schedule_id = sch?.id ?? null;
  }
  const dup = duplicateWarning({ name: String(p?.name || ""), mode: p?.mode, date: p?.event_date, days: p?.days || [], start: String(p?.start_time || "") }, await existingAt(admin, locationId));
  if (dup && !(p?.warnings || []).includes(dup)) return { ok: false, changed: dup };
  return { ok: true, schedule_id };
}

/** The check at the Undo tap: nobody ticked the daily task, no attendee added; and whether its new category is still unused. */
export async function undoEventCheck(admin: any, locationId: string, eventId: string, categoryId: string | null) {
  const { data: ev } = await admin.from("schedule_events").select("id").eq("id", eventId).eq("location_id", locationId).maybeSingle();
  if (!ev) return { ok: false, reason: "Not undone: the event isn't on the schedule anymore." };
  const [{ count: done }, { count: att }] = await Promise.all([
    admin.from("event_task_completions").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
    admin.from("event_attendees").select("event_id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  if ((done || 0) > 0) return { ok: false, reason: "Not undone: someone already completed it." };
  if ((att || 0) > 0) return { ok: false, reason: "Not undone: an attendee has been added." };
  let category_in_use = false;
  if (categoryId) {
    const { count } = await admin.from("schedule_events").select("id", { count: "exact", head: true }).eq("category_id", categoryId).neq("id", eventId);
    category_in_use = (count || 0) > 0;
  }
  return { ok: true, category_in_use };
}
