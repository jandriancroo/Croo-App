import { DateTime } from "luxon";
import type { ScheduleLaborCheck } from "@/hooks/useScheduleApproval";

const p1 = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const goal = (v: number | null | undefined) => (v == null ? "—" : `${Number(v)}%`);
const day = (iso: string) => DateTime.fromISO(iso).toFormat("ccc LLL d");
const hrs = (v: number) => Number(v.toFixed(2)).toString();

/** The one wording for problems found by schedule_week_labor_check (Post confirm + approver Issues). */
export function laborCheckIssues(lc: ScheduleLaborCheck | null | undefined, opts: { people?: boolean; dailyOt?: number | null } = {}): string[] {
  if (!lc) return [];
  const out: string[] = [];
  if (lc.week_over_goal) out.push(`Week: ${p1(lc.labor_pct)} vs ${goal(lc.target_pct)} goal`);
  for (const d of lc.days ?? []) {
    if (d.over_goal) out.push(`${day(d.date)}: ${p1(d.labor_pct)} vs ${goal(d.target_pct)} goal`);
  }
  if (opts.people) {
    for (const p of lc.people ?? []) {
      const name = p.name || "Someone";
      if (p.over_weekly && p.weekly_threshold != null) out.push(`${name}: ${hrs(p.week_hours)} hrs this week (over ${hrs(p.weekly_threshold)})`);
      for (const o of p.days_over_daily ?? []) out.push(`${name}: ${hrs(o.hours)} hrs on ${day(o.date)} (over daily OT${opts.dailyOt ? ` ${hrs(Number(opts.dailyOt))}` : ""})`);
      if (p.seventh_day) out.push(`${name}: 7th day in a row on ${day(p.seventh_day)} (OT pay)`);
      for (const d of p.meal_premium_days ?? []) out.push(`${name}: no room for a meal on ${day(d)} (+1 hr premium)`);
    }
  }
  return out;
}
