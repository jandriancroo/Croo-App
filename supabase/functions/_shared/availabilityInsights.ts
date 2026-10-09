// @ts-nocheck
// ---------------------------------------------------------------------------
// Availability Insights — next schedule week's time off + weekly availability.
//
// One builder used by the availability-insights function:
//   - run_hourly: acts only where the store's local hour is 7, and only when at
//     least one new time-off request was created there the previous local day.
//   - dry_run / samples: same builder, nothing queued for dry runs.
//
// Pure parts (gates, week range, coverage flag, HTML) have no I/O so vitest can
// check them. Shows pending + approved requests with status and full names;
// never selects request_type, hours_requested, notes, denial_reason or pay.
// ---------------------------------------------------------------------------
import {
  DAY_KEYS_SUNDAY_FIRST,
  normalizeWeeklyAvailability,
  sanitizeBlocks,
} from "./availabilityMirror.ts";
import { escapeEmailHtml as escapeHtml, renderEmailHeader } from "./emailHeader.ts";

export { escapeHtml };
export const INSIGHTS_NOTIFICATION_TYPE = "time_off_weekly_digest";
export const INSIGHTS_LOCAL_HOUR = 7;
export const COVERAGE_THRESHOLD = 2;

const RECIPIENT_ROLES = ["admin", "general_manager", "manager", "org_admin", "super_admin"];
const DOW_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Date helpers (string-first, store timezone) ───────────────────────────

export function localDateInTimezone(timezone: string, base: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(base).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHourInTimezone(timezone: string, base: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(base).find((x) => x.type === "hour")?.value;
  return Number(h) % 24;
}

/** Gate 1: the hourly check only acts when it's 7 AM at the store. */
export function isInsightsHour(timezone: string, now: Date = new Date()): boolean {
  return localHourInTimezone(timezone, now) === INSIGHTS_LOCAL_HOUR;
}

function parts(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

export function dowOf(dateStr: string): number {
  const { y, m, d } = parts(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const { y, m, d } = parts(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Next Mon–Sun schedule week relative to a store-local date. */
export function nextWeekRange(localDate: string): { weekStart: string; weekEnd: string } {
  const dow = dowOf(localDate);
  const thisMonday = addDays(localDate, dow === 0 ? -6 : 1 - dow);
  const weekStart = addDays(thisMonday, 7);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

function prettyDate(dateStr: string): string {
  const { m, d } = parts(dateStr);
  return `${MONTHS[m - 1]} ${d}`;
}

export function weekRangeLabel(weekStart: string, weekEnd: string): string {
  return `${prettyDate(weekStart)} – ${prettyDate(weekEnd)}`;
}

export function insightsSubject(weekStart: string, weekEnd: string, isSample = false): string {
  return `${isSample ? "[Sample] " : ""}Availability Insights · ${weekRangeLabel(weekStart, weekEnd)}`;
}

/** Gate 2: how many requests were created on `localDate` in the store's timezone. */
export function countCreatedOnLocalDate(rows: { created_at: string }[], timezone: string, localDate: string): number {
  return (rows || []).filter((r) => r?.created_at && localDateInTimezone(timezone, new Date(r.created_at)) === localDate).length;
}

/** Coverage: 2+ different people out or unavailable that day. */
export function needsCoverage(peopleOut: number): boolean {
  return peopleOut >= COVERAGE_THRESHOLD;
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const suffix = h >= 12 ? "p" : "a";
  h = h % 12 === 0 ? 12 : h % 12;
  return mStr && mStr !== "00" ? `${h}:${mStr}${suffix}` : `${h}${suffix}`;
}

function money(n: number | null): string {
  if (n === null || !isFinite(n) || n <= 0) return "";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function fullName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ") || "Team member";
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface TimeOffEntry {
  userId: string; name: string; status: "pending" | "approved";
  startDate: string; endDate: string; timeScope: string; startTime: string | null; endTime: string | null;
}
export interface AvailabilityEntry { userId: string; name: string; allDay: boolean; blocks: { start: string; end: string }[] }
export interface InsightsDay {
  date: string; dow: number; label: string; dayNumber: number;
  goal: number | null; busy: boolean;
  timeOff: TimeOffEntry[]; availability: AvailabilityEntry[];
  peopleOut: number; coverage: boolean;
}
export interface InsightsData {
  locationId: string; locationName: string; orgName: string;
  weekStart: string; weekEnd: string; days: InsightsDay[];
  pending: number; approved: number;
}

/** Pure: puts requests + weekly availability onto the 7 days. */
export function buildInsightDays(input: {
  weekStart: string;
  requests: TimeOffEntry[];
  roster: { userId: string; name: string; weekly: any }[];
  goals?: Map<string, number>;
  busyDows?: Set<number>;
}): InsightsDay[] {
  const days: InsightsDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(input.weekStart, i);
    const dow = dowOf(date);
    const key = DAY_KEYS_SUNDAY_FIRST[dow];
    const timeOff = input.requests.filter((r) => r.startDate <= date && r.endDate >= date);
    const availability: AvailabilityEntry[] = [];
    for (const p of input.roster) {
      const day = p.weekly?.[key];
      if (!day) continue;
      if (day.available === false) availability.push({ userId: p.userId, name: p.name, allDay: true, blocks: [] });
      else {
        const blocks = sanitizeBlocks(day.blocks);
        if (blocks.length) availability.push({ userId: p.userId, name: p.name, allDay: false, blocks });
      }
    }
    // Counted as out: any time-off request that day, or can't work all day.
    const out = new Set<string>([
      ...timeOff.map((r) => r.userId),
      ...availability.filter((a) => a.allDay).map((a) => a.userId),
    ]);
    days.push({
      date, dow, label: DOW_LABELS[dow], dayNumber: parts(date).d,
      goal: input.goals?.get(date) ?? null, busy: input.busyDows?.has(dow) ?? false,
      timeOff, availability, peopleOut: out.size, coverage: needsCoverage(out.size),
    });
  }
  return days;
}

// ── Loader ────────────────────────────────────────────────────────────────

export async function loadInsights(supabase: any, locationId: string, weekStart: string, weekEnd: string): Promise<InsightsData> {
  const { data: loc, error: locErr } = await supabase
    .from("locations").select("id, name, organization_id").eq("id", locationId).maybeSingle();
  if (locErr) throw new Error(`locations read failed: ${locErr.message}`);

  let orgName = "CrooHQ";
  if (loc?.organization_id) {
    const { data: org } = await supabase.from("organizations").select("name, brand_name").eq("id", loc.organization_id).maybeSingle();
    orgName = org?.brand_name || org?.name || orgName;
  }

  const { data: reqRows, error: reqErr } = await supabase
    .from("availability_requests")
    .select("id, user_id, status, time_scope, start_date, end_date, start_time, end_time")
    .eq("location_id", locationId)
    .in("status", ["pending", "approved"])
    .lte("start_date", weekEnd);
  if (reqErr) throw new Error(`availability_requests read failed: ${reqErr.message}`);
  const overlapping = (reqRows || []).filter((r: any) => (r.end_date || r.start_date) >= weekStart);

  // Same weekly-availability source as the schedule grid: profiles.weekly_availability
  // through the shared normalizer, store hours from location_hours.
  const { data: assigned, error: ulErr } = await supabase.from("user_locations").select("user_id").eq("location_id", locationId);
  if (ulErr) throw new Error(`user_locations read failed: ${ulErr.message}`);
  const rosterIds = [...new Set([...(assigned || []).map((r: any) => r.user_id), ...overlapping.map((r: any) => r.user_id)])];

  const profiles = new Map<string, any>();
  if (rosterIds.length) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles").select("id, full_name, weekly_availability, is_active, appears_on_schedule").in("id", rosterIds);
    if (pErr) throw new Error(`profiles read failed: ${pErr.message}`);
    for (const p of profs || []) profiles.set(p.id, p);
  }

  const { data: hoursRows } = await supabase
    .from("location_hours").select("day_of_week, open_time, close_time, is_closed").eq("location_id", locationId);
  const hours: any = {};
  for (const r of hoursRows || []) {
    const k = DAY_KEYS_SUNDAY_FIRST[r.day_of_week];
    if (k && !r.is_closed && r.open_time && r.close_time) hours[k] = { open: String(r.open_time).slice(0, 5), close: String(r.close_time).slice(0, 5) };
  }

  const assignedSet = new Set((assigned || []).map((r: any) => r.user_id));
  const roster = [...profiles.values()]
    .filter((p) => assignedSet.has(p.id) && p.is_active !== false && p.appears_on_schedule !== false && p.weekly_availability)
    .map((p) => ({ userId: p.id, name: fullName(p.full_name), weekly: normalizeWeeklyAvailability(p.weekly_availability, hours) }));

  const requests: TimeOffEntry[] = overlapping.map((r: any) => ({
    userId: r.user_id, name: fullName(profiles.get(r.user_id)?.full_name), status: r.status,
    startDate: r.start_date, endDate: r.end_date || r.start_date, timeScope: r.time_scope,
    startTime: r.start_time, endTime: r.end_time,
  }));

  const goals = await loadDailyGoals(supabase, locationId, weekStart, weekEnd);
  const { busyDows } = await loadBusiestDows(supabase, locationId, weekStart);

  return {
    locationId, locationName: loc?.name || "Location", orgName, weekStart, weekEnd,
    days: buildInsightDays({ weekStart, requests, roster, goals, busyDows }),
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
  };
}

/** New time-off requests created at the store on the previous local day. */
export async function countNewRequestsYesterday(supabase: any, locationId: string, timezone: string, localToday: string): Promise<number> {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data, error } = await supabase
    .from("availability_requests").select("created_at").eq("location_id", locationId).gte("created_at", since);
  if (error) throw new Error(`availability_requests read failed: ${error.message}`);
  return countCreatedOnLocalDate(data || [], timezone, addDays(localToday, -1));
}

/** Per-day sales goal: schedule projection → sales_cache projection → DOW average. */
async function loadDailyGoals(
  supabase: any,
  locationId: string,
  weekStart: string,
  weekEnd: string,
): Promise<Map<string, number>> {
  const goals = new Map<string, number>();

  // 1. schedule_projected_sales for that location-week
  const { data: sched, error: schedErr } = await supabase
    .from("schedules")
    .select("id")
    .eq("location_id", locationId)
    .eq("week_start_date", weekStart)
    .maybeSingle();
  if (schedErr) console.error("[insights] schedules read failed:", schedErr);

  if (sched?.id) {
    const { data: proj, error: projErr } = await supabase
      .from("schedule_projected_sales")
      .select("day_of_week, projected_sales")
      .eq("schedule_id", sched.id);
    if (projErr) console.error("[insights] schedule_projected_sales read failed:", projErr);
    for (const row of proj || []) {
      const amount = Number(row.projected_sales || 0);
      if (amount <= 0) continue;
      for (let i = 0; i < 7; i++) {
        const date = addDays(weekStart, i);
        if (dowOf(date) === Number(row.day_of_week)) goals.set(date, amount);
      }
    }
  }

  // 2. sales_cache projections already stored for those future dates
  const { data: cacheRows, error: cacheErr } = await supabase
    .from("sales_cache")
    .select("sale_date, projected_sales, override_projection, living_projection, initial_projection")
    .eq("location_id", locationId)
    .gte("sale_date", weekStart)
    .lte("sale_date", weekEnd);
  if (cacheErr) console.error("[insights] sales_cache projection read failed:", cacheErr);
  for (const row of cacheRows || []) {
    if (goals.has(row.sale_date)) continue;
    const amount = Number(
      (Number(row.override_projection) || Number(row.living_projection) || Number(row.initial_projection) || Number(row.projected_sales) || 0),
    );
    if (amount > 0) goals.set(row.sale_date, amount);
  }

  // 3. Same-weekday average from the trailing 12 weeks
  const histStart = addDays(weekStart, -84);
  const { data: hist, error: histErr } = await supabase
    .from("sales_cache")
    .select("sale_date, net_sales")
    .eq("location_id", locationId)
    .gte("sale_date", histStart)
    .lt("sale_date", weekStart);
  if (histErr) console.error("[insights] sales_cache history read failed:", histErr);

  const byDow = new Map<number, number[]>();
  for (const row of hist || []) {
    const net = Number(row.net_sales || 0);
    if (net <= 0) continue;
    const dow = dowOf(row.sale_date);
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow)!.push(net);
  }
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    if (goals.has(date)) continue;
    const vals = byDow.get(dowOf(date)) || [];
    if (vals.length === 0) continue;
    goals.set(date, vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  return goals;
}

/** Stars the store's historically strongest weekdays (trailing 12 weeks of net sales). */
async function loadBusiestDows(
  supabase: any,
  locationId: string,
  weekStart: string,
): Promise<{ busyDows: Set<number>; busiestDowLabel: string | null }> {
  const histStart = addDays(weekStart, -84);
  const { data: hist, error } = await supabase
    .from("sales_cache")
    .select("sale_date, net_sales")
    .eq("location_id", locationId)
    .gte("sale_date", histStart)
    .lt("sale_date", weekStart);
  if (error) {
    console.error("[insights] busiest-dow read failed:", error);
    return { busyDows: new Set(), busiestDowLabel: null };
  }

  const byDow = new Map<number, number[]>();
  for (const row of hist || []) {
    const net = Number(row.net_sales || 0);
    if (net <= 0) continue;
    const dow = dowOf(row.sale_date);
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow)!.push(net);
  }

  const averages: { dow: number; avg: number; n: number }[] = [];
  for (const [dow, vals] of byDow) {
    if (vals.length < 3) continue; // thin history for that weekday
    averages.push({ dow, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length });
  }
  if (averages.length < 5) return { busyDows: new Set(), busiestDowLabel: null };

  averages.sort((a, b) => b.avg - a.avg);
  const top = averages[0];
  const busyDows = new Set<number>([top.dow]);
  // A close second counts too (within 3%).
  if (averages[1] && averages[1].avg >= top.avg * 0.97) busyDows.add(averages[1].dow);

  return { busyDows, busiestDowLabel: DOW_LABELS[top.dow] };
}

// ── Recipients (same list the old Who's Out digest used) ──────────────────

/**
 * Location-scoped managers/admins only. Shift managers (and shift managers in
 * training) are deliberately excluded. Missing preference row = ON.
 */
export async function resolveInsightsRecipients(
  supabase: any,
  locationId: string,
): Promise<InsightsRecipient[]> {
  const { data: assigned, error: assignErr } = await supabase
    .from("user_locations")
    .select("user_id")
    .eq("location_id", locationId);
  if (assignErr) throw new Error(`user_locations read failed: ${assignErr.message}`);

  const assignedIds = [...new Set((assigned || []).map((r: any) => r.user_id))];
  if (assignedIds.length === 0) return [];

  const { data: roles, error: roleErr } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("user_id", assignedIds)
    .in("role", RECIPIENT_ROLES);
  if (roleErr) throw new Error(`user_roles read failed: ${roleErr.message}`);

  const candidateIds = [...new Set((roles || []).map((r: any) => r.user_id))];
  if (candidateIds.length === 0) return [];

  const { data: profs, error: profErr } = await supabase
    .from("profiles")
    .select("id, full_name, email, is_active")
    .in("id", candidateIds);
  if (profErr) throw new Error(`profiles read failed: ${profErr.message}`);

  const withEmail = (profs || []).filter((p: any) => p.is_active !== false && p.email);
  if (withEmail.length === 0) return [];

  const emails = withEmail.map((p: any) => p.email);
  const { data: bounced, error: bounceErr } = await supabase
    .from("bounced_emails")
    .select("email_address")
    .in("email_address", emails);
  if (bounceErr) console.error("[insights] bounced_emails read failed:", bounceErr);
  const bouncedSet = new Set((bounced || []).map((b: any) => b.email_address));

  const { data: prefs, error: prefErr } = await supabase
    .from("user_notification_settings")
    .select("user_id, email_enabled")
    .eq("notification_type", INSIGHTS_NOTIFICATION_TYPE)
    .eq("location_id", locationId)
    .in("user_id", withEmail.map((p: any) => p.id));
  if (prefErr) console.error("[insights] user_notification_settings read failed:", prefErr);
  const offFor = new Set(
    (prefs || []).filter((p: any) => p.email_enabled === false).map((p: any) => p.user_id),
  );

  return withEmail
    .filter((p: any) => !bouncedSet.has(p.email) && !offFor.has(p.id))
    .map((p: any) => ({ id: p.id, email: p.email, name: p.full_name || "" }));
}

// ── HTML ──────────────────────────────────────────────────────────────────

const TEAL = "#0a7a8a";
const TEAL_TINT = "#e8f1f2";
const TEAL_DEEP = "#0f565e";
const ORANGE = "#e8733d";
const ORANGE_TINT = "#fdf0e8";
const AMBER = "#b7791f";
const CREAM = "#eae7dd";
const INK = "#1a1d21";
const MUTED = "#8a8f95";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function timeOffDetail(e: TimeOffEntry, date: string): string {
  if (e.timeScope === "partial_day" && e.startTime) return `${fmtTime(e.startTime)}–${fmtTime(e.endTime)}`;
  if (e.startDate < date || e.endDate > date) return `${prettyDate(e.startDate)}–${prettyDate(e.endDate)}`;
  return "full day";
}

function dayCard(day: InsightsDay): string {
  const border = day.coverage ? `2px solid ${ORANGE}` : "1px solid #e4e1d8";
  const bg = day.coverage ? ORANGE_TINT : "#ffffff";
  const flag = day.coverage
    ? `<div style="color:${ORANGE};font-size:10px;font-weight:800;letter-spacing:0.6px;margin-bottom:4px;">${day.peopleOut} OUT &middot; COVERAGE</div>`
    : day.busy ? `<div style="color:${ORANGE};font-size:10px;font-weight:800;letter-spacing:0.6px;margin-bottom:4px;">&#9733; BUSY</div>` : "";
  const timeOff = day.timeOff.map((e) => {
    const pending = e.status === "pending";
    return `<div style="margin-top:6px;font-size:12px;line-height:1.4;color:${INK};"><strong>${escapeHtml(e.name)}</strong><br/><span style="color:${pending ? AMBER : TEAL_DEEP};font-weight:700;font-size:10px;letter-spacing:0.4px;">${pending ? "PENDING" : "APPROVED"}</span> <span style="color:${MUTED};font-size:11px;">&middot; ${escapeHtml(timeOffDetail(e, day.date))}</span></div>`;
  }).join("");
  const avail = day.availability.map((a) => {
    const what = a.allDay ? "unavailable all day" : `can't work ${a.blocks.map((b) => `${fmtTime(b.start)}–${fmtTime(b.end)}`).join(", ")}`;
    return `<div style="margin-top:6px;font-size:12px;line-height:1.4;color:${INK};">${escapeHtml(a.name)}<br/><span style="color:${MUTED};font-size:11px;">${escapeHtml(what)}</span></div>`;
  }).join("");
  const empty = !timeOff && !avail ? `<div style="color:${MUTED};font-size:11px;margin-top:6px;">clear</div>` : "";
  return `<td class="ai-day" width="14%" valign="top" style="padding:3px;">
<div style="border:${border};background:${bg};border-radius:12px;padding:10px 8px;min-height:120px;">
${flag}<div style="color:${day.coverage ? ORANGE : MUTED};font-size:10px;font-weight:700;letter-spacing:0.8px;">${day.label} ${day.dayNumber}</div>
<div style="color:${MUTED};font-size:11px;font-weight:600;">${escapeHtml(money(day.goal) || "—")}</div>
${timeOff ? `<div style="margin-top:6px;color:${TEAL_DEEP};font-size:9px;font-weight:800;letter-spacing:0.6px;">TIME OFF</div>${timeOff}` : ""}
${avail ? `<div style="margin-top:8px;color:${TEAL_DEEP};font-size:9px;font-weight:800;letter-spacing:0.6px;">AVAILABILITY</div>${avail}` : ""}
${empty}
</div></td>`;
}

export function buildInsightsHtml(
  data: InsightsData,
  opts: { logoUrl?: string; logoAlt?: string; newRequestsYesterday?: number; isSample?: boolean } = {},
): string {
  const range = weekRangeLabel(data.weekStart, data.weekEnd);
  const coverageDays = data.days.filter((d) => d.coverage).length;
  const summary = [
    opts.newRequestsYesterday ? `${opts.newRequestsYesterday} new ${opts.newRequestsYesterday === 1 ? "request" : "requests"} yesterday` : "",
    `${data.pending} pending`,
    `${data.approved} approved`,
    coverageDays ? `${coverageDays} ${coverageDays === 1 ? "day needs" : "days need"} coverage` : "",
  ].filter(Boolean).join(" &middot; ");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>@media only screen and (max-width:620px){.ai-day{display:block!important;width:100%!important;box-sizing:border-box;}}</style></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT};">
<table width="100%" style="border-collapse:collapse;background:${CREAM};"><tr><td style="padding:26px 10px;">
<table width="100%" style="max-width:760px;margin:0 auto;border-collapse:collapse;background:#ffffff;border-radius:22px;overflow:hidden;">
${renderEmailHeader({ title: "Availability Insights", logoUrl: opts.logoUrl, alt: opts.logoAlt, line1: data.locationName, line2: range, background: TEAL })}
<tr><td style="padding:20px 16px 8px;">
<p style="color:${INK};font-size:14px;margin:0 0 4px;font-weight:700;">Next week &middot; ${escapeHtml(range)}</p>
<p style="color:${MUTED};font-size:12px;margin:0 0 14px;">${summary}</p>
<table width="100%" style="border-collapse:collapse;"><tr>${data.days.map(dayCard).join("")}</tr></table>
<p style="color:${MUTED};font-size:11px;line-height:1.6;margin:12px 2px 0;"><span style="color:${ORANGE};font-weight:800;">COVERAGE</span> = ${COVERAGE_THRESHOLD}+ people out or unavailable all day &middot; amount under each day is the sales goal &middot; <span style="color:${ORANGE};font-weight:800;">&#9733; BUSY</span> = historically strongest day</p>
<div style="text-align:center;margin:24px 0 8px;">
<a href="https://croohq.com/availability" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;padding:14px 34px;border-radius:12px;font-weight:800;font-size:15px;">Review in CrooHQ</a>
</div>
<p style="color:${MUTED};font-size:11px;text-align:center;margin:0 0 10px;">${opts.isSample ? "Sample preview." : "Sent at 7 AM after new time-off requests."}</p>
</td></tr>
<tr><td style="background:${CREAM};padding:20px;text-align:center;border-top:1px solid #e4e1d8;">
<span style="color:#3a5f7d;font-size:14px;">Powered by</span> <strong style="color:#1a1a1a;font-size:16px;letter-spacing:-0.5px;">croo</strong>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function dayCounts(data: InsightsData) {
  return data.days.map((d) => ({
    date: d.date, timeOff: d.timeOff.length,
    pending: d.timeOff.filter((t) => t.status === "pending").length,
    unavailable: d.availability.length, peopleOut: d.peopleOut, coverage: d.coverage,
  }));
}
