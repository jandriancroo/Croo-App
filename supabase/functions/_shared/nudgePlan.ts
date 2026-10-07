// THE rules for Quick Nudge (checklists, tasks, events). Pure: no database, no clock of its own.
// Used by the quick-nudge function (options + send) and Theo's quick_nudge preview.
// Recipients are never chosen by a person: everyone on the clock at the store, minus the sender, minus cooldown.
import { openClockIn, type Punch } from "./punchPlan.ts";

export const NUDGE_COOLDOWN_MIN = 60;
export const MAX_MESSAGE = 300;
export const MAX_TEMPLATES = 5;

export type TargetType = "checklist" | "task" | "event";
export const TARGET_TYPES: TargetType[] = ["checklist", "task", "event"];
export type NudgeTemplate = { id: string | null; name: string; body: string; is_default: boolean };

// Must stay equal to seed_location_nudge_templates() in the database (checked by src/lib/nudgePlan.test.ts).
export const DEFAULT_NUDGE_TEMPLATES: NudgeTemplate[] = [
  { id: null, name: "Friendly follow-up", is_default: true, body: "Hey, it's {sender_first_name}. I noticed the {item} isn't done yet and wanted to follow up. Can you make sure it gets finished?" },
  { id: null, name: "Quick check-in", is_default: false, body: "Hey {recipient_first_name}, {sender_first_name} here. The {item} is at {done}/{total}. Can you jump on the rest when you get a sec?" },
  { id: null, name: "Before close", is_default: false, body: "It's {sender_first_name}. The {item} needs to be finished soon. Please wrap it up and let me know if anything's blocking you." },
  { id: null, name: "Heads-up", is_default: false, body: "Heads-up from {sender_first_name}: {item} is at {event_time} today. Please be ready for it." },
];

// Field tokens (canonical names). {checklist} is a permanent alias of {item}.
export const ALL_FIELDS = ["sender_first_name", "recipient_first_name", "item", "item_type", "event_time", "done", "total"] as const;
export type FieldName = typeof ALL_FIELDS[number];
export const FIELD_LABELS: Record<FieldName, string> = {
  sender_first_name: "Your name", recipient_first_name: "Crew member name", item: "Item", item_type: "Item type",
  event_time: "Event time", done: "Done", total: "Total",
};
const canon = (k: string): string => { const l = k.toLowerCase(); return l === "checklist" ? "item" : l; };

export function fieldsFor(type: TargetType, hasSubtasks = false): FieldName[] {
  if (type === "event") return ALL_FIELDS.filter((f) => f !== "done" && f !== "total");
  if (type === "task" && !hasSubtasks) return ALL_FIELDS.filter((f) => f !== "event_time" && f !== "done" && f !== "total");
  return ALL_FIELDS.filter((f) => f !== "event_time");
}

/** Known fields the text uses that this target doesn't have (unique, in order). */
export function missingFields(text: string, available: FieldName[]): FieldName[] {
  const out: FieldName[] = [];
  for (const m of text.matchAll(/\{([a-z_]+)\}/gi)) {
    const k = canon(m[1]) as FieldName;
    if ((ALL_FIELDS as readonly string[]).includes(k) && !available.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function lockLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** One row of checklist_nudge_status (or null when the checklist isn't on today's list). */
export type NudgeStatusRow = {
  checklist_id: string; family_id: string; title: string; frequency?: string | null; template_type?: string | null;
  lock_until_time: string | null; is_locked: boolean; total_items: number; completed_items: number; is_complete: boolean;
};
export type NudgeRefusal = { code: string; reason: string };
type Verdict = { ok: true } | NudgeRefusal;

export function canNudgeChecklist(row: NudgeStatusRow | null | undefined): Verdict {
  if (!row) return { code: "not_today", reason: "This checklist isn't on today's list." };
  if (row.is_locked) return { code: "locked", reason: `This checklist is locked until ${lockLabel(row.lock_until_time || "00:00")}. You can nudge after it opens.` };
  if (!row.total_items) return { code: "no_items", reason: "This checklist has nothing to do today." };
  if (row.is_complete || row.completed_items >= row.total_items) return { code: "complete", reason: "This checklist is already complete." };
  return { ok: true };
}

export type TaskStatusRow = {
  task_id: string; title: string; task_style: string | null; is_active: boolean | null; show_on_dashboard: boolean | null;
  completed_at: string | null; expires_at: string | null; last_triggered_at: string | null; alarm_done_this_interval: boolean;
  write_up_id: string | null; icon_name: string | null; subtasks_total: number; subtasks_done: number;
};

export function canNudgeTask(row: TaskStatusRow | null | undefined, now: number, _tz?: string): Verdict {
  if (!row || row.is_active === false || row.show_on_dashboard === false) return { code: "not_on_dashboard", reason: "This task isn't on the dashboard." };
  if (row.completed_at) return { code: "complete", reason: "This task is already done." };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return { code: "expired", reason: "This task has expired." };
  if (row.write_up_id || row.icon_name === "opus_logo") return { code: "personal", reason: "This task is personal, so it can't be nudged." };
  if (row.task_style === "alarm" && !row.last_triggered_at) return { code: "not_due", reason: "This alarm task isn't due right now." };
  if (row.task_style === "alarm" && row.alarm_done_this_interval) return { code: "complete", reason: "This task is already done for now." };
  return { ok: true };
}

export type EventStatusRow = {
  event_id: string; title: string; event_time: string | null; event_end_time: string | null; tagged_roles?: unknown;
  is_today: boolean; completed_today: boolean;
};

const localMinutes = (now: number, tz: string) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) * 60 + Number(p.find((x) => x.type === "minute")?.value ?? 0);
};
const timeMinutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

export function canNudgeEvent(row: EventStatusRow | null | undefined, now: number, tz: string): Verdict {
  if (!row || !row.is_today) return { code: "not_today", reason: "This event isn't on today's list." };
  if (row.completed_today) return { code: "complete", reason: "This event is already checked off." };
  if (row.event_end_time && localMinutes(now, tz) > timeMinutes(row.event_end_time)) return { code: "over", reason: "This event is already over." };
  return { ok: true };
}

export type NudgeVars = {
  sender_first_name: string; recipient_first_name?: string | null; item: string; item_type: TargetType;
  event_time?: string | null; done?: number | null; total?: number | null;
};

export function renderNudgeText(text: string, v: NudgeVars): string {
  const map: Record<string, string | undefined> = {
    sender_first_name: v.sender_first_name,
    recipient_first_name: (v.recipient_first_name || "").trim() || "there",
    item: v.item, item_type: v.item_type,
    event_time: v.event_time ?? undefined,
    done: v.done == null ? undefined : String(v.done),
    total: v.total == null ? undefined : String(v.total),
  };
  return text.replace(/\{([a-z_]+)\}/gi, (whole, key: string) => { const val = map[canon(key)]; return val === undefined ? whole : val; });
}

export function firstName(p: { nickname?: string | null; full_name?: string | null } | null | undefined): string {
  const nick = (p?.nickname || "").trim();
  if (nick) return nick;
  return (p?.full_name || "").trim().split(/\s+/)[0] || "";
}

/** Who is on the clock right now: an open clock-in in the last 24 hours (punches already limited to this store). */
export function onClockIds(punchesByUser: Record<string, Punch[]>, now: number): string[] {
  return Object.entries(punchesByUser).filter(([, ps]) => openClockIn(ps, now) !== null).map(([id]) => id);
}

/** Split people by the last nudge they got for this target (ISO times). */
export function splitCooldown<T extends { id: string }>(people: T[], lastSent: Record<string, string>, now: number, cooldownMin = NUDGE_COOLDOWN_MIN) {
  const going: T[] = [];
  const recently: (T & { minutes_ago: number })[] = [];
  for (const p of people) {
    const at = lastSent[p.id];
    const ago = at ? (now - new Date(at).getTime()) / 60000 : Infinity;
    if (ago < cooldownMin) recently.push({ ...p, minutes_ago: Math.max(0, Math.floor(ago)) });
    else going.push(p);
  }
  return { going, recently };
}

const norm = (s: string) => s.toLowerCase().replace(/\b(checklist|task|event)\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Exact title first, then contains (case-insensitive), across checklists, tasks and events. */
export function matchTarget<T extends { title: string }>(said: string, rows: T[]): { one: T } | { several: T[] } | { none: true } {
  const q = norm(said || "");
  if (!q) return { none: true };
  const exact = rows.filter((r) => norm(r.title) === q);
  if (exact.length === 1) return { one: exact[0] };
  if (exact.length > 1) return { several: exact };
  const words = q.split(" ");
  const hits = rows.filter((r) => { const t = norm(r.title); return t.includes(q) || words.every((w) => t.includes(w)); });
  if (hits.length === 1) return { one: hits[0] };
  if (hits.length > 1) return { several: hits };
  return { none: true };
}
/** Back-compat name for checklist-only callers. */
export const matchChecklist = matchTarget;
