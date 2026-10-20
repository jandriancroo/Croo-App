// Builds the Dash "Nudge" list from targets that already passed canNudge* (nudgePlan.ts). Pure: no database.
// Lateness matches the Dash: checklists late after due_by_time (carry-over adds a day), alarm tasks late once triggered,
// events are always "coming up" and drop off once over (canNudgeEvent).
import { lockLabel, type TargetType } from "./nudgePlan.ts";

export type NudgeListItem = {
  type: TargetType; id: string; title: string; group: "overdue" | "coming_up";
  status: string; minutes_since_last_nudge: number | null; sort: number;
};

type T = { type: TargetType; id: string; title: string; done: number | null; total: number | null };

const parts = (now: number, tz: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "0";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, min: Number(g("hour")) * 60 + Number(g("minute")) };
};
const tMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function lateText(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min late`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min late` : `${h} hr late`;
}
const progress = (t: T) => (t.total && t.total > 0 ? `${t.done ?? 0} of ${t.total}` : null);
const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" · ");

export function buildNudgeList(a: {
  targets: T[]; now: number; tz: string; businessDate: string | null;
  checklists: { id: string; due_by_time: string | null }[];
  tasks: { id: string; task_style: string | null; last_triggered_at: string | null; expires_at: string | null }[];
  events: { id: string; event_time: string | null; event_end_time: string | null }[];
  logs: { target_type: string; target_id: string; created_at: string }[];
}): NudgeListItem[] {
  const local = parts(a.now, a.tz);
  const nowMin = local.min + (a.businessDate && a.businessDate !== local.date ? 1440 : 0);
  const cl = new Map(a.checklists.map((c) => [c.id, c]));
  const tk = new Map(a.tasks.map((t) => [t.id, t]));
  const ev = new Map(a.events.map((e) => [e.id, e]));
  const last = new Map<string, number>();
  for (const l of a.logs) {
    const k = `${l.target_type}:${l.target_id}`;
    const ago = Math.max(0, Math.floor((a.now - new Date(l.created_at).getTime()) / 60000));
    if (!last.has(k) || ago < last.get(k)!) last.set(k, ago);
  }

  const out: NudgeListItem[] = a.targets.map((t) => {
    const nudged = last.get(`${t.type}:${t.id}`) ?? null;
    const base = { type: t.type, id: t.id, title: t.title, minutes_since_last_nudge: nudged };
    if (t.type === "checklist") {
      const due = cl.get(t.id)?.due_by_time;
      if (due && nowMin > tMin(due)) {
        const late = nowMin - tMin(due);
        return { ...base, group: "overdue", status: join(lateText(late), progress(t)), sort: -late };
      }
      return { ...base, group: "coming_up", status: join(due ? `Due ${lockLabel(due)}` : null, progress(t)) || "Not finished", sort: due ? tMin(due) - nowMin : 1e6 };
    }
    if (t.type === "task") {
      const r = tk.get(t.id);
      if (r?.task_style === "alarm" && r.last_triggered_at) {
        const late = (a.now - new Date(r.last_triggered_at).getTime()) / 60000;
        return { ...base, group: "overdue", status: join(lateText(late), progress(t)), sort: -late };
      }
      const exp = r?.expires_at;
      return { ...base, group: "coming_up", status: join("Quick task", exp ? `due ${clock(exp, a.tz)}` : null, progress(t)), sort: exp ? (new Date(exp).getTime() - a.now) / 60000 : 1e6 };
    }
    const e = ev.get(t.id);
    const start = e?.event_time ? tMin(e.event_time) : null;
    const until = start == null ? null : start - local.min;
    const when = until == null ? null : until > 0 ? `in ${until < 60 ? `${until} min` : `${Math.floor(until / 60)} hr${until % 60 ? ` ${until % 60} min` : ""}`}` : "now";
    return { ...base, group: "coming_up", status: join("Event", e?.event_time ? lockLabel(e.event_time) : null, when), sort: until ?? 1e6 };
  });
  return out.sort((x, y) => (x.group === y.group ? x.sort - y.sort : x.group === "overdue" ? -1 : 1));
}
