// Reads for Quick Nudge, shared by quick-nudge and Theo's preview (service-role client).
// Rules stay in nudgePlan.ts; this only gathers the facts they need.
import {
  splitCooldown, firstName, lockLabel, canNudgeChecklist, canNudgeTask, canNudgeEvent, NUDGE_COOLDOWN_MIN,
  type NudgeStatusRow, type TaskStatusRow, type EventStatusRow, type TargetType,
} from "./nudgePlan.ts";
import { clockedInUserIds } from "./onClock.ts";

export type CrewPerson = { id: string; name: string; first_name: string };
export type NudgeTarget = {
  type: TargetType; id: string; family_id: string; title: string; location_id: string;
  done: number | null; total: number | null; event_time: string | null; has_subtasks: boolean;
  verdict: { ok: true } | { code: string; reason: string };
};

export async function storeTimezone(admin: any, locationId: string): Promise<string> {
  const { data } = await admin.from("location_settings").select("timezone").eq("location_id", locationId).limit(1).maybeSingle();
  return data?.timezone || "America/Los_Angeles";
}

const rpc = async (admin: any, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data || []) as any[];
};

export const nudgeStatus = (admin: any, locationId: string, checklistId?: string | null) =>
  rpc(admin, "checklist_nudge_status", { _location_id: locationId, _checklist_id: checklistId ?? null }) as Promise<NudgeStatusRow[]>;

const fromChecklist = (r: NudgeStatusRow, loc: string): NudgeTarget => ({
  type: "checklist", id: r.checklist_id, family_id: r.family_id, title: r.title, location_id: loc,
  done: r.completed_items, total: r.total_items, event_time: null, has_subtasks: false, verdict: canNudgeChecklist(r),
});
const fromTask = (r: TaskStatusRow, loc: string, now: number, tz: string): NudgeTarget => ({
  type: "task", id: r.task_id, family_id: r.task_id, title: r.title, location_id: loc,
  done: r.subtasks_total > 0 ? r.subtasks_done : null, total: r.subtasks_total > 0 ? r.subtasks_total : null,
  event_time: null, has_subtasks: r.subtasks_total > 0, verdict: canNudgeTask(r, now, tz),
});
const fromEvent = (r: EventStatusRow, loc: string, now: number, tz: string): NudgeTarget => ({
  type: "event", id: r.event_id, family_id: r.event_id, title: r.title, location_id: loc,
  done: null, total: null, event_time: r.event_time ? lockLabel(r.event_time) : null, has_subtasks: false, verdict: canNudgeEvent(r, now, tz),
});

/** One target at its store (store comes from the row, never the client). null = not found / not a nudge target. */
export async function loadTarget(admin: any, type: TargetType, id: string): Promise<NudgeTarget | null | { bad: string }> {
  const now = Date.now();
  if (type === "checklist") {
    const { data: cl } = await admin.from("checklists").select("id, title, location_id, is_active, superseded_at, template_type, frequency").eq("id", id).maybeSingle();
    if (!cl || !cl.location_id) return null;
    if (!cl.is_active || cl.superseded_at || cl.template_type === "training" || cl.frequency === "training") return { bad: "This checklist can't be nudged." };
    const [r] = await nudgeStatus(admin, cl.location_id, id);
    if (!r) return { type, id, family_id: id, title: cl.title, location_id: cl.location_id, done: null, total: null, event_time: null, has_subtasks: false, verdict: canNudgeChecklist(null) };
    return fromChecklist(r, cl.location_id);
  }
  if (type === "task") {
    const { data: t } = await admin.from("temporary_tasks").select("id, location_id").eq("id", id).maybeSingle();
    if (!t?.location_id) return null;
    const tz = await storeTimezone(admin, t.location_id);
    const [r] = await rpc(admin, "task_nudge_status", { _location_id: t.location_id, _task_id: id });
    return r ? fromTask(r, t.location_id, now, tz) : null;
  }
  const { data: e } = await admin.from("schedule_events").select("id, location_id").eq("id", id).maybeSingle();
  if (!e?.location_id) return null;
  const tz = await storeTimezone(admin, e.location_id);
  const [r] = await rpc(admin, "event_nudge_status", { _location_id: e.location_id, _event_id: id });
  return r ? fromEvent(r, e.location_id, now, tz) : null;
}

/** Every nudgeable target at the store today (for Theo's matching). */
export async function nudgeableTargets(admin: any, locationId: string): Promise<NudgeTarget[]> {
  const now = Date.now();
  const tz = await storeTimezone(admin, locationId);
  const [cls, tasks, events] = await Promise.all([
    nudgeStatus(admin, locationId),
    rpc(admin, "task_nudge_status", { _location_id: locationId }),
    rpc(admin, "event_nudge_status", { _location_id: locationId }),
  ]);
  return [
    ...cls.map((r) => fromChecklist(r, locationId)),
    ...tasks.map((r: TaskStatusRow) => fromTask(r, locationId, now, tz)),
    ...events.filter((r: EventStatusRow) => r.is_today).map((r: EventStatusRow) => fromEvent(r, locationId, now, tz)),
  ];
}

/** Everyone on the clock at the store right now (active crew), minus the sender, split by cooldown for this target. */
export async function nudgeAudience(admin: any, locationId: string, targetType: TargetType, familyId: string, senderId: string) {
  const now = Date.now();
  const [clockedIn, { data: links }] = await Promise.all([
    clockedInUserIds(admin, locationId, now),
    admin.from("user_locations").select("user_id").eq("location_id", locationId),
  ]);
  const crewIds = new Set((links || []).map((l: any) => l.user_id));
  const onIds = clockedIn.filter((id) => id !== senderId && crewIds.has(id));
  let people: CrewPerson[] = [];
  if (onIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, nickname, is_active").in("id", onIds);
    people = (profs || []).filter((p: any) => p.is_active !== false)
      .map((p: any) => ({ id: p.id, name: (p.full_name || "").trim() || firstName(p) || "Crew member", first_name: firstName(p) }))
      .sort((a: CrewPerson, b: CrewPerson) => a.name.localeCompare(b.name));
  }
  const lastSent: Record<string, string> = {};
  if (people.length) {
    const { data: logs } = await admin.from("nudge_log").select("recipient_id, created_at").eq("target_type", targetType).eq("target_family_id", familyId)
      .in("recipient_id", people.map((p) => p.id)).gte("created_at", new Date(now - NUDGE_COOLDOWN_MIN * 60000).toISOString());
    for (const l of logs || []) if (!lastSent[l.recipient_id] || l.created_at > lastSent[l.recipient_id]) lastSent[l.recipient_id] = l.created_at;
  }
  return { onClock: people, ...splitCooldown(people, lastSent, now) };
}

export async function senderFirstName(admin: any, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name, nickname").eq("id", userId).maybeSingle();
  return firstName(data) || "Your manager";
}
