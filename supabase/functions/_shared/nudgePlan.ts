// THE rules for Quick Nudge (checklists only). Pure: no database, no clock of its own.
// Used by the checklist-nudge function (options + send) and Theo's nudge_checklist preview.
// Recipients are never chosen by a person: everyone on the clock at the store, minus the sender, minus cooldown.
import { openClockIn, type Punch } from "./punchPlan.ts";

export const NUDGE_COOLDOWN_MIN = 60;
export const MAX_MESSAGE = 300;
export const MAX_TEMPLATES = 5;

export type NudgeTemplate = { id: string | null; name: string; body: string; is_default: boolean };

// Must stay equal to seed_location_nudge_templates() in the database (checked by src/lib/nudgePlan.test.ts).
export const DEFAULT_NUDGE_TEMPLATES: NudgeTemplate[] = [
  { id: null, name: "Friendly follow-up", is_default: true, body: "Hey, it's {sender_first_name}. I noticed the {checklist} isn't done yet and wanted to follow up. Can you make sure it gets finished?" },
  { id: null, name: "Quick check-in", is_default: false, body: "Hey {recipient_first_name}, {sender_first_name} here. The {checklist} is at {done}/{total}. Can you jump on the rest when you get a sec?" },
  { id: null, name: "Before close", is_default: false, body: "It's {sender_first_name}. The {checklist} needs to be finished soon. Please wrap it up and let me know if anything's blocking you." },
  { id: null, name: "Thanks team", is_default: false, body: "Hi team, it's {sender_first_name}. The {checklist} still has a few items left ({done}/{total} done). Thanks for taking care of it!" },
];

/** One row of checklist_nudge_status (or null when the checklist isn't on today's list). */
export type NudgeStatusRow = {
  checklist_id: string; family_id: string; title: string; frequency?: string | null; template_type?: string | null;
  lock_until_time: string | null; is_locked: boolean; total_items: number; completed_items: number; is_complete: boolean;
};

export type NudgeRefusal = { code: "not_today" | "locked" | "no_items" | "complete"; reason: string };

export function lockLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function canNudgeChecklist(row: NudgeStatusRow | null | undefined): { ok: true } | NudgeRefusal {
  if (!row) return { code: "not_today", reason: "This checklist isn't on today's list." };
  if (row.is_locked) return { code: "locked", reason: `This checklist is locked until ${lockLabel(row.lock_until_time || "00:00")}. You can nudge after it opens.` };
  if (!row.total_items) return { code: "no_items", reason: "This checklist has nothing to do today." };
  if (row.is_complete || row.completed_items >= row.total_items) return { code: "complete", reason: "This checklist is already complete." };
  return { ok: true };
}

export type NudgeFields = { sender_first_name: string; recipient_first_name?: string | null; checklist: string; done: number; total: number };

export function renderNudgeText(text: string, f: NudgeFields): string {
  const map: Record<string, string> = {
    sender_first_name: f.sender_first_name,
    recipient_first_name: (f.recipient_first_name || "").trim() || "there",
    checklist: f.checklist,
    done: String(f.done),
    total: String(f.total),
  };
  return text.replace(/\{([a-z_]+)\}/gi, (whole, key: string) => (key.toLowerCase() in map ? map[key.toLowerCase()] : whole));
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

/** Split people by the last nudge they got for this checklist family (ISO times). */
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

const norm = (s: string) => s.toLowerCase().replace(/\bchecklist\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function matchChecklist<T extends { title: string }>(said: string, rows: T[]): { one: T } | { several: T[] } | { none: true } {
  const q = norm(said || "");
  if (!q) return { none: true };
  const exact = rows.filter((r) => norm(r.title) === q);
  if (exact.length === 1) return { one: exact[0] };
  const words = q.split(" ");
  const hits = (exact.length ? exact : rows.filter((r) => { const t = norm(r.title); return t.includes(q) || words.every((w) => t.includes(w)); }));
  if (hits.length === 1) return { one: hits[0] };
  if (hits.length > 1) return { several: hits };
  return { none: true };
}
