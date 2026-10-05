// THEO HANDS build 5: the pure rules for "add a schedule event" (tested in src/lib/eventPlan.test.ts).
// Checked at the preview and again at the tap. Never writes.

/** The 10 preset category colours, same order and values as the manual event screens. */
export const EVENT_COLORS: { name: string; hex: string }[] = [
  { name: "blue", hex: "#3b82f6" }, { name: "red", hex: "#ef4444" }, { name: "green", hex: "#22c55e" },
  { name: "amber", hex: "#f59e0b" }, { name: "violet", hex: "#8b5cf6" }, { name: "pink", hex: "#ec4899" },
  { name: "cyan", hex: "#06b6d4" }, { name: "orange", hex: "#f97316" }, { name: "lime", hex: "#84cc16" },
  { name: "indigo", hex: "#6366f1" },
];
export const COLOR_ASK = `Which color? I can use ${EVENT_COLORS.map((c) => c.name).join(", ")}.`;

/** A colour word to a preset, or null (anything not exactly a preset name: ask). */
export function presetColor(raw: unknown): string | null {
  const q = String(raw ?? "").trim().toLowerCase();
  if (!q) return null;
  const hit = EVENT_COLORS.find((c) => c.name === q || c.hex === q);
  return hit ? hit.hex : null;
}

/** SERVER MIRROR of the desktop event window's "Tag Roles" list (ASSIGNABLE_ROLE_OPTIONS in useUserRole). */
export const EVENT_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "team_member", label: "Team Member" },
  { value: "shift_manager_in_training", label: "Shift Manager in Training" },
  { value: "shift_manager", label: "Shift Manager" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];
export const ROLE_ASK = `Which roles? I can tag ${EVENT_ROLE_OPTIONS.map((r) => r.label).join(", ")}.`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const singular = (s: string) => s.split(" ").map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");

/** A role as said ("the managers", "shift managers") to one role on the list. */
export function matchRole(raw: string): { role: string } | { several: string[] } | { none: true } {
  const q = singular(norm(raw).replace(/^(the|all|our|just|only) /, ""));
  if (!q) return { none: true };
  const exact = EVENT_ROLE_OPTIONS.filter((r) => singular(norm(r.label)) === q || r.value.replace(/_/g, " ") === q);
  if (exact.length === 1) return { role: exact[0].value };
  if (q === "smit" || q === "sm in training" || q === "trainee shift manager") return { role: "shift_manager_in_training" };
  if (q === "sm") return { role: "shift_manager" };
  if (q === "crew" || q === "team" || q === "crew member") return { role: "team_member" };
  const close = EVENT_ROLE_OPTIONS.filter((r) => singular(norm(r.label)).includes(q));
  if (close.length === 1) return { role: close[0].value };
  if (close.length > 1) return { several: close.map((r) => r.label) };
  return { none: true };
}

/** A category name as said, matched to this store's categories. Two close fits: ask which. */
export function matchCategory<T extends { id: string; name: string }>(raw: string, cats: T[]): { match: T } | { several: T[] } | { none: true } {
  const q = singular(norm(raw).replace(/^(the|a|an) /, "").replace(/ (category|categorie)$/, ""));
  if (!q) return { none: true };
  const exact = cats.filter((c) => singular(norm(c.name)) === q);
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { several: exact };
  const close = cats.filter((c) => { const n = singular(norm(c.name)); return n.startsWith(q) || q.startsWith(n) || n.includes(q); });
  if (close.length === 1) return { match: close[0] };
  if (close.length > 1) return { several: close };
  return { none: true };
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Monday = 0 for a yyyy-MM-dd date (calendar math only, no clock). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
/** Weekday words ("monday", "Thu") or numbers to sorted Monday = 0 numbers; null if any is not a weekday. */
export function parseDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = new Set<number>();
  for (const x of raw) {
    if (typeof x === "number" && x >= 0 && x <= 6) { out.add(x); continue; }
    const w = String(x ?? "").trim().toLowerCase();
    const i = WEEKDAYS.findIndex((d) => w.length >= 3 && d.toLowerCase().startsWith(w.slice(0, 3)));
    if (i === -1) return null;
    out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}
/** "8", "08:00", "8:00:00" -> "08:00"; null if not a time. */
export function eventTime(raw: unknown): string | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
export function fmt12(t: string) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const joinAnd = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
/** "Saturday, Oct 17 · 8:00 AM to 9:00 AM" or "Every Monday and Thursday · 8:00 AM". */
export function whenLabel(e: { mode: "one-time" | "recurring"; date?: string | null; days?: number[]; start: string; end?: string | null }) {
  const time = e.end ? `${fmt12(e.start)} to ${fmt12(e.end)}` : fmt12(e.start);
  if (e.mode === "recurring") return `Every ${joinAnd((e.days || []).map((d) => WEEKDAYS[d]))} · ${time}`;
  const [, m, d] = (e.date || "").split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(e.date!)]}, ${MONTHS[m - 1]} ${d} · ${time}`;
}

export type EventDraft = { name: string; mode: "one-time" | "recurring" | null; date: string | null; days: number[]; start: string | null; end: string | null };
/** Required fields and end vs start. ask = a question (no preview); stop = says why (no preview); warnings never block. */
export function eventChecks(e: EventDraft, today: string): { ask?: string; stop?: string; warnings: string[] } {
  if (!e.name.trim()) return { ask: "What should the event be called?", warnings: [] };
  if (e.mode === "recurring" ? e.days.length === 0 : !e.date) return { ask: e.mode === "recurring" ? "Which days?" : "Which day?", warnings: [] };
  if (!e.start) return { ask: "What time does it start?", warnings: [] };
  if (e.end && e.end <= e.start) return { stop: `The end time (${fmt12(e.end)}) isn't after the start (${fmt12(e.start)}). What time does it end?`, warnings: [] };
  const warnings: string[] = [];
  if (e.mode !== "recurring" && e.date && e.date < today) warnings.push("That date is in the past.");
  return { warnings };
}

export type ExistingEvent = { id: string; event_name: string; event_time: string; is_recurring: boolean | null; event_date: string | null; day_of_week: number | null; days_of_week: number[] | null };
const daysOf = (x: ExistingEvent) => (Array.isArray(x.days_of_week) && x.days_of_week.length ? x.days_of_week : x.day_of_week != null ? [x.day_of_week] : []);
/** Warning (never a block): an event with the same name and start already on that day at this store. */
export function duplicateWarning(e: { name: string; mode: "one-time" | "recurring"; date?: string | null; days?: number[]; start: string }, existing: ExistingEvent[]): string | null {
  const name = norm(e.name);
  const hits = existing.filter((x) => norm(x.event_name) === name && String(x.event_time).slice(0, 5) === e.start).filter((x) => {
    if (e.mode === "one-time") return x.is_recurring ? daysOf(x).includes(weekdayOf(e.date!)) : x.event_date === e.date;
    return x.is_recurring ? daysOf(x).some((d) => (e.days || []).includes(d)) : false;
  });
  return hits.length ? `"${hits[0].event_name}" at ${fmt12(e.start)} is already on the schedule that day.` : null;
}
