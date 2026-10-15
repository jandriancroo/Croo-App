// query_task_history: Theo's read of Tasks > History. All history logic comes from
// ../_shared/taskHistory/core.ts (the same code the History page runs); this file only
// handles args, filtering, names and local-time formatting. Run with the caller's client.
import {
  loadChecklistHistory,
  loadCompletedQuickTasks,
  loadEventCompletions,
  loadLogbookEntries,
  type TaskHistoryCtx,
} from "../_shared/taskHistory/core.ts";
import { getBusinessDayRangeInTimezone } from "../_shared/taskHistory/helpers.ts";
import { bestMatches, closest } from "../_shared/fuzzyMatch.ts";

export const MAX_HISTORY_DAYS = 14;
export const TASK_HISTORY_KINDS = ["checklist", "task", "alarm", "event", "logbook", "all"] as const;
type Kind = typeof TASK_HISTORY_KINDS[number];

export const QUERY_TASK_HISTORY_TOOL = {
  type: "function",
  function: {
    name: "query_task_history",
    description: "Tasks > History exactly as the app shows it: checklist percentages (items done/total, last completed, who), completed quick tasks, alarm slots (done or missed), completed daily schedule events, and logbook entries, for one business date or a range (max 14 days). Lists only COMPLETED work. Use for 'was X done', 'who did Y', 'when', or a checklist percentage.",
    parameters: {
      type: "object",
      properties: {
        location_id: { type: "string", description: "UUID of the location" },
        date: { type: "string", description: "Business date YYYY-MM-DD (default: today's business date)" },
        start_date: { type: "string", description: "Range start YYYY-MM-DD (use with end_date instead of date)" },
        end_date: { type: "string", description: "Range end YYYY-MM-DD, at most 14 days after start inclusive" },
        kind: { type: "string", enum: [...TASK_HISTORY_KINDS], description: "What to return (default all)" },
        title: { type: "string", description: "Optional checklist/task/event/logbook title, fuzzy matched" },
        person: { type: "string", description: "Optional person's name, fuzzy matched" },
      },
      required: ["location_id"],
    },
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86400000;
const toUtcDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fromUtcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function resolveDates(args: any, today: string): { dates: string[] } | { error: string } {
  const start = args?.start_date || args?.date || today;
  const end = args?.start_date ? (args?.end_date || args.start_date) : start;
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return { error: "Dates must be YYYY-MM-DD." };
  const a = toUtcDay(start), b = toUtcDay(end);
  if (b < a) return { error: "end_date is before start_date." };
  const n = Math.round((b - a) / dayMs) + 1;
  if (n > MAX_HISTORY_DAYS) return { error: `That's ${n} days. Task history covers at most ${MAX_HISTORY_DAYS} days at a time — ask the manager to narrow the range.` };
  return { dates: Array.from({ length: n }, (_, i) => fromUtcDay(a + i * dayMs)) };
}

const fmt = (iso: string | null | undefined, tz: string, withDate: boolean) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
    ...(withDate ? { month: "short", day: "numeric" } : {}),
  }).format(d);
};

export interface TaskHistoryToolCtx {
  timezone: string;
  closeTime: string | null;
  today: string;
  now: Date;
}

export async function runQueryTaskHistory(db: any, args: any, c: TaskHistoryToolCtx): Promise<any> {
  const kind: Kind = TASK_HISTORY_KINDS.includes(args?.kind) ? args.kind : "all";
  const want = (k: Kind) => kind === "all" || kind === k;
  const r = resolveDates(args, c.today);
  if ("error" in r) return { error: r.error };
  const multi = r.dates.length > 1;

  const days = await Promise.all(r.dates.map(async (dateStr) => {
    const { start, end } = getBusinessDayRangeInTimezone(dateStr, c.timezone, c.closeTime);
    const ctx: TaskHistoryCtx = { locationId: args.location_id, dateStr, timezone: c.timezone, closeTime: c.closeTime, periodStart: start, periodEnd: end, now: c.now };
    const [cl, qt, ev, lb] = await Promise.all([
      want("checklist") ? loadChecklistHistory(db, ctx) : [],
      want("task") || want("alarm") ? loadCompletedQuickTasks(db, ctx) : [],
      want("event") ? loadEventCompletions(db, ctx) : [],
      want("logbook") ? loadLogbookEntries(db, ctx) : [],
    ]);
    return { dateStr, cl, qt, ev, lb };
  }));

  const ids = new Set<string>();
  for (const d of days) {
    d.cl.forEach((h: any) => (h.contributorIds || []).forEach((i: string) => ids.add(i)));
    [...d.qt, ...d.ev, ...d.lb].forEach((t: any) => t.completed_by && ids.add(t.completed_by));
  }
  const names: Record<string, string> = {};
  if (ids.size) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", Array.from(ids));
    (data || []).forEach((p: any) => { names[p.id] = p.full_name; });
  }
  const nm = (id: string | null) => (id ? names[id] || null : null);

  const out = days.map((d) => ({
    date: d.dateStr,
    // Header average uses every checklist that day (before any title/person filter).
    avg: d.cl.length ? Math.round(d.cl.reduce((sum: number, h: any) => sum + Math.round(h.completionRate * 100), 0) / d.cl.length) : null,
    checklists: d.cl.map((h: any) => ({
      title: h.title,
      completed_items: h.completedCount,
      total_items: h.itemCount,
      percent: Math.round(h.completionRate * 100),
      last_completed_local: fmt(h.lastCompletedAt, c.timezone, multi),
      contributors: (h.contributorIds || []).map((i: string) => names[i]).filter(Boolean),
    })),
    quick_tasks: d.qt.filter((t: any) => t.task_style !== "alarm" && t.task_style !== "alarm-missed").map((t: any) => ({
      title: t.title, completed_at_local: fmt(t.completed_at, c.timezone, multi), completed_by: nm(t.completed_by),
    })),
    alarms: d.qt.filter((t: any) => t.task_style === "alarm" || t.task_style === "alarm-missed").map((t: any) => ({
      title: t.title, slot_local: fmt(t.completed_at, c.timezone, multi),
      status: t.task_style === "alarm" ? "done" : "missed", completed_by: nm(t.completed_by),
    })),
    events_completed: d.ev.map((t: any) => ({ title: t.title, completed_at_local: fmt(t.completed_at, c.timezone, multi), completed_by: nm(t.completed_by) })),
    logbook: d.lb.map((t: any) => ({ title: t.title, at_local: fmt(t.completed_at, c.timezone, multi), by: nm(t.created_by ?? t.completed_by) })),
  }));

  // Optional title / person filters, matched across the whole range.
  const sections = ["checklists", "quick_tasks", "alarms", "events_completed", "logbook"] as const;
  const rowPeople = (row: any): string[] => row.contributors || [row.completed_by || row.by].filter(Boolean);
  for (const [field, getVals] of [
    ["title", (row: any) => [row.title]],
    ["person", rowPeople],
  ] as const) {
    const q = typeof args?.[field] === "string" ? args[field].trim() : "";
    if (!q) continue;
    const all = out.flatMap((d) => sections.flatMap((s) => (d as any)[s].flatMap(getVals)));
    const hits = new Set(bestMatches(q, all));
    if (!hits.size) return { none: true, [field]: q, did_you_mean: closest(q, all, 5) };
    for (const d of out) for (const s of sections) (d as any)[s] = (d as any)[s].filter((row: any) => getVals(row).some((v: string) => hits.has(v)));
  }

  const result = out.map((d) => {
    const avg = d.avg;
    const day: any = { date: d.date };
    if (want("checklist")) {
      day.checklists = d.checklists;
      day.checklist_average_percent = avg;
      day.checklist_average_label = "average of checklists (same as the History header)";
    }
    if (want("task")) day.quick_tasks = d.quick_tasks;
    if (want("alarm")) day.alarms = d.alarms;
    if (want("event")) day.events_completed = d.events_completed;
    if (want("logbook")) day.logbook = d.logbook;
    return day;
  });

  return {
    timezone: c.timezone,
    note: "History lists only COMPLETED work. If something isn't here, say you don't see it completed (not that it wasn't done).",
    days: result,
  };
}
