// Theo build 6C: clock someone in / out. Reads only; the save is the manager's Confirm tap in the browser.
// Rules live in _shared/punchPlan.ts and run here at the preview, the tap (recheck) and the Undo check.
import { checkPunch, parseSaidTime, zonedToUtc, canRemovePlaceholder, type Punch, type DayShift, type PunchKind } from "../_shared/punchPlan.ts";

type Person = { id: string; name: string };

const localParts = (iso: string, tz: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: Number(g("hour")) % 24 * 60 + Number(g("minute")) };
};
const timeLabel = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dateLabel = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
const fmt = (tz: string) => (iso: string) => `${dateLabel(iso, tz)}, ${timeLabel(iso, tz)}`;
const prevDate = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

function matchPerson(raw: string, crew: Person[]) {
  const q = raw.trim().toLowerCase();
  if (!q) return { none: true } as const;
  const exact = crew.filter((c) => c.name.toLowerCase() === q);
  const hits = exact.length ? exact : crew.filter((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || c.name.toLowerCase().startsWith(q));
  if (hits.length === 1) return { one: hits[0] } as const;
  if (hits.length > 1) return { several: hits } as const;
  return { none: true } as const;
}

async function readState(admin: any, userId: string, locationId: string, date: string, atIso: string) {
  const since = new Date(new Date(atIso).getTime() - 48 * 3600_000).toISOString();
  const [{ data: punches }, { data: shifts }, { data: meets }] = await Promise.all([
    admin.from("time_punches").select("id, punch_type, punch_time, location_id").eq("user_id", userId).gte("punch_time", since).order("punch_time"),
    admin.from("scheduled_shifts").select("id, start_time, end_time, schedules!inner(location_id)").eq("user_id", userId).eq("shift_date", date)
      .eq("schedules.location_id", locationId).eq("is_phantom", false).or("is_time_off.is.null,is_time_off.eq.false"),
    admin.from("event_attendees").select("schedule_events!inner(event_name, event_date, is_recurring, days_of_week, is_meeting, location_id)").eq("user_id", userId)
      .eq("schedule_events.is_meeting", true).eq("schedule_events.location_id", locationId),
  ]);
  const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const meeting = (meets || []).map((m: any) => m.schedule_events).find((e: any) => e && (e.event_date === date || (e.is_recurring && Array.isArray(e.days_of_week) && e.days_of_week.includes(dow))));
  return {
    punches: (punches || []) as Punch[],
    shifts: (shifts || []).map((s: any) => ({ id: s.id, start_time: s.start_time, end_time: s.end_time })) as DayShift[],
    meeting: meeting?.event_name ?? null,
  };
}

/** The preview. Returns { ok, proposal } | { ask } | { stop }. */
export async function buildPunchProposal(admin: any, managerId: string, managerFirst: string, loc: { id: string; name: string }, tz: string, args: any, crew: Person[]) {
  const kind: PunchKind | null = args?.kind === "in" || args?.kind === "out" ? args.kind : null;
  if (!kind) return { ask: "Clock them in or out?" };
  const others = crew.filter((c) => c.id !== managerId || true);
  const byId = args?.employee_id ? others.find((c) => c.id === args.employee_id) : null;
  const m = byId ? { one: byId } : matchPerson(String(args?.employee || ""), others);
  if ("several" in m && m.several) return { ask: `Which ${String(args?.employee || "").trim().split(/\s+/)[0]}: ${m.several.map((p) => p.name).join(" or ")}?` };
  if (!("one" in m) || !m.one) return { stop: args?.employee ? `I can't find ${args.employee} at this store.` : "Who should I clock in or out?" };
  const person = m.one;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const nowL = localParts(nowIso, tz);
  const said = parseSaidTime(args?.time, nowL.min);
  if (said === null) return { ask: "What time?" };
  let atIso = said === "now" ? nowIso : zonedToUtc(nowL.date, said, tz);
  // Overnight: "clock out at 11 PM" said at 1 AM means last night.
  if (said !== "now" && new Date(atIso).getTime() > now + 60_000 && kind === "out") atIso = zonedToUtc(prevDate(nowL.date), said, tz);
  return finish(admin, managerFirst, loc, tz, kind, person, atIso, now);
}

async function finish(admin: any, managerFirst: string, loc: { id: string; name: string }, tz: string, kind: PunchKind, person: Person, atIso: string, now: number) {
  const at = localParts(atIso, tz);
  const st = await readState(admin, person.id, loc.id, at.date, atIso);
  const r = checkPunch({ kind, name: person.name, at: new Date(atIso).getTime(), now, punches: st.punches, shifts: st.shifts, atLocalMin: at.min, meeting: st.meeting, fmt: fmt(tz) });
  if (!r.ok) return { stop: r.reason };
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(), action: "clock_punch", kind, employee: person, punch_time: atIso,
      time_label: timeLabel(atIso, tz), date_label: dateLabel(atIso, tz), store: loc.name, location_id: loc.id,
      shift_id: r.shift_id, open_clock_in_id: r.open_clock_in?.id ?? null,
      clock_in_label: r.open_clock_in ? fmt(tz)(r.open_clock_in.punch_time) : null,
      notes: `Entered by ${managerFirst} via Theo`, flags: r.flags,
    },
  };
}

/** The re-check at the Confirm tap: same person, time and store as previewed; status unchanged. */
export async function recheckPunch(admin: any, managerId: string, managerFirst: string, loc: { id: string; name: string }, tz: string, p: any, crew: Person[]) {
  if (!p?.id || !p?.employee?.id || typeof p.punch_time !== "string") return { ok: false, changed: "the preview is incomplete." };
  const { data: logged } = await admin.from("theo_action_log").select("proposal").eq("user_id", managerId).eq("action", "clock_punch").eq("proposal->>id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const lp = logged?.proposal;
  if (!lp || lp.employee?.id !== p.employee.id || lp.kind !== p.kind || lp.punch_time !== p.punch_time || lp.location_id !== loc.id || (lp.shift_id ?? null) !== (p.shift_id ?? null) || lp.notes !== p.notes) return { ok: false, changed: "this isn't the punch Theo previewed." };
  const person = crew.find((c) => c.id === p.employee.id);
  if (!person) return { ok: false, changed: `${p.employee.name} isn't active at this store anymore.` };
  const v: any = await finish(admin, managerFirst, loc, tz, p.kind, person, p.punch_time, Date.now());
  if (!v.ok) return { ok: false, changed: v.stop };
  if ((v.proposal.open_clock_in_id ?? null) !== (lp.open_clock_in_id ?? null) || (v.proposal.shift_id ?? null) !== (lp.shift_id ?? null)) return { ok: false, changed: `${p.employee.name.split(" ")[0]}'s punches changed since the preview.` };
  return { ok: true };
}

/** The check at the Undo tap. Only Theo's confirmed punch, never approved, nothing after it. */
export async function checkPunchUndo(admin: any, managerId: string, locationId: string, punchId: unknown) {
  if (typeof punchId !== "string" || !/^[0-9a-f-]{36}$/i.test(punchId)) return { ok: false, reason: "Couldn't find that punch." };
  const { data: log } = await admin.from("theo_action_log").select("id").eq("user_id", managerId).eq("action", "clock_punch").eq("record_id", punchId).limit(1).maybeSingle();
  if (!log) return { ok: false, reason: "Theo can only undo a punch Theo entered." };
  const { data: pu } = await admin.from("time_punches").select("id, user_id, punch_time, location_id, approved_by, shift_id, created_at, created_by").eq("id", punchId).maybeSingle();
  if (!pu) return { ok: false, reason: "That punch is already gone." };
  if (pu.location_id !== locationId || pu.created_by !== managerId) return { ok: false, reason: "Theo can only undo a punch Theo entered." };
  if (pu.approved_by) return { ok: false, reason: "Can't undo: that punch has been approved. Change it on the Time Clock page." };
  const { count: later } = await admin.from("time_punches").select("id", { count: "exact", head: true }).eq("user_id", pu.user_id).gt("punch_time", pu.punch_time);
  if ((later ?? 0) > 0) return { ok: false, reason: "Can't undo: there's a newer punch for this person. Change it on the Time Clock page." };
  let remove_shift_id: string | null = null;
  if (pu.shift_id) {
    try {
      const { data: sh } = await admin.from("scheduled_shifts").select("id, is_phantom, created_at").eq("id", pu.shift_id).maybeSingle();
      if (sh?.is_phantom === true) {
        const [a, b, c] = await Promise.all([
          admin.from("time_punches").select("id", { count: "exact", head: true }).eq("shift_id", sh.id).neq("id", pu.id),
          admin.from("shift_offers").select("id", { count: "exact", head: true }).eq("shift_id", sh.id),
          admin.from("shift_reminder_log").select("id", { count: "exact", head: true }).eq("shift_id", sh.id),
        ]);
        const verified = !a.error && !b.error && !c.error;
        if (verified && canRemovePlaceholder({ is_phantom: true, shift_created_at: sh.created_at, punch_created_at: pu.created_at, other_refs: (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0) })) remove_shift_id = sh.id;
        else return { ok: true, remove_shift_id: null, placeholder_left: true };
      }
    } catch { return { ok: true, remove_shift_id: null, placeholder_left: true }; }
  }
  return { ok: true, remove_shift_id, placeholder_left: false };
}

export const PROPOSE_PUNCH_TOOL = {
  type: "function",
  function: {
    name: "propose_punch",
    description: "Show the manager a PREVIEW of clocking one person in or out at this store. Saves nothing: only the manager's Confirm tap saves it. The app checks everything (already in, not in, on break, future time, flags). Send the time as the manager said it ('8:30', '4', '4 pm'); leave it out for now.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["in", "out"] },
        employee_id: { type: "string", description: "employee_id from find_crew" },
        employee: { type: "string", description: "The name as said, when you have no employee_id" },
        time: { type: "string", description: "The time as said; omit for now" },
      },
      required: ["kind"],
    },
  },
};
