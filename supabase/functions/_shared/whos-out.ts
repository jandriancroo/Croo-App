// @ts-nocheck
// ---------------------------------------------------------------------------
// Who's Out — next-week time-off digest (Option E)
//
// Shared loader + recipient resolver + pure HTML builder. Used by:
//   - maintenance-service nightly task "whos-out-next-week"
//   - whos-out-email (manual sample, caller's own address only)
//
// Privacy rules baked in here on purpose:
//   - APPROVED requests only. Pending / denied never load, never render.
//   - request_type (paid/unpaid), hours_requested, notes, denial_reason are
//     never selected and never rendered.
//   - No wage or pay data anywhere in this file.
// ---------------------------------------------------------------------------

export const WHOS_OUT_NOTIFICATION_TYPE = "time_off_weekly_digest";

const RECIPIENT_ROLES = ["admin", "general_manager", "manager", "org_admin", "super_admin"];

const DOW_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Date helpers (string-first, location timezone) ─────────────────────────

export function localDateInTimezone(timezone: string, base: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(base)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** yyyy-MM-dd → {y,m,d} with no Date object involved. */
function parts(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

/** Day of week (0=Sun) for a yyyy-MM-dd string, timezone-free. */
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

/** Next Mon–Sun relative to a location-local date. */
export function nextWeekRange(localDate: string): { weekStart: string; weekEnd: string } {
  const dow = dowOf(localDate); // 0=Sun
  const daysToThisMonday = dow === 0 ? -6 : 1 - dow;
  const thisMonday = addDays(localDate, daysToThisMonday);
  const weekStart = addDays(thisMonday, 7);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

function prettyDate(dateStr: string): string {
  const { m, d } = parts(dateStr);
  return `${MONTHS[m - 1]} ${d}`;
}

function firstName(full: string | null | undefined): string {
  return String(full || "Team member").trim().split(/\s+/)[0];
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

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface WhosOutEntry {
  userId: string;
  name: string;
  first: string;
  startDate: string;
  endDate: string;
  timeScope: string;
  startTime: string | null;
  endTime: string | null;
}

export interface WhosOutDay {
  date: string;
  dow: number;
  label: string;
  dayNumber: number;
  goal: number | null;
  busy: boolean;
  entries: WhosOutEntry[];
}

export interface WhosOutData {
  locationId: string;
  locationName: string;
  orgName: string;
  weekStart: string;
  weekEnd: string;
  days: WhosOutDay[];
  totalRequests: number;
  peopleOut: number;
  busiestDowLabel: string | null;
  notes: string[];
}

// ── Loader ────────────────────────────────────────────────────────────────

export async function loadWhosOut(
  supabase: any,
  locationId: string,
  weekStart: string,
  weekEnd: string,
): Promise<WhosOutData> {
  const { data: loc, error: locErr } = await supabase
    .from("locations")
    .select("id, name, organization_id")
    .eq("id", locationId)
    .maybeSingle();
  if (locErr) throw new Error(`locations read failed: ${locErr.message}`);

  let orgName = "CrooHQ";
  if (loc?.organization_id) {
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("name, brand_name")
      .eq("id", loc.organization_id)
      .maybeSingle();
    if (orgErr) console.error("[whos-out] organizations read failed:", orgErr);
    orgName = org?.brand_name || org?.name || orgName;
  }

  // Approved only. Overlap window covers multi-day requests that straddle the week.
  const { data: reqRows, error: reqErr } = await supabase
    .from("availability_requests")
    .select("id, user_id, time_scope, start_date, end_date, start_time, end_time")
    .eq("location_id", locationId)
    .eq("status", "approved")
    .lte("start_date", weekEnd);
  if (reqErr) throw new Error(`availability_requests read failed: ${reqErr.message}`);

  const overlapping = (reqRows || []).filter((r: any) => {
    const end = r.end_date || r.start_date;
    return end >= weekStart;
  });

  const userIds = [...new Set(overlapping.map((r: any) => r.user_id))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    if (profErr) throw new Error(`profiles read failed: ${profErr.message}`);
    for (const p of profs || []) names.set(p.id, p.full_name || "Team member");
  }

  const entries: WhosOutEntry[] = overlapping.map((r: any) => ({
    userId: r.user_id,
    name: names.get(r.user_id) || "Team member",
    first: firstName(names.get(r.user_id)),
    startDate: r.start_date,
    endDate: r.end_date || r.start_date,
    timeScope: r.time_scope,
    startTime: r.start_time,
    endTime: r.end_time,
  }));

  const goals = await loadDailyGoals(supabase, locationId, weekStart, weekEnd);
  const { busyDows, busiestDowLabel } = await loadBusiestDows(supabase, locationId, weekStart);

  const days: WhosOutDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const dow = dowOf(date);
    days.push({
      date,
      dow,
      label: DOW_LABELS[dow],
      dayNumber: parts(date).d,
      goal: goals.get(date) ?? null,
      busy: busyDows.has(dow),
      entries: entries.filter((e) => e.startDate <= date && e.endDate >= date),
    });
  }

  const notes = await buildHabitNotes(supabase, locationId, days, entries, busiestDowLabel);

  return {
    locationId,
    locationName: loc?.name || "Location",
    orgName,
    weekStart,
    weekEnd,
    days,
    totalRequests: entries.length,
    peopleOut: new Set(entries.map((e) => e.userId)).size,
    busiestDowLabel,
    notes,
  };
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
  if (schedErr) console.error("[whos-out] schedules read failed:", schedErr);

  if (sched?.id) {
    const { data: proj, error: projErr } = await supabase
      .from("schedule_projected_sales")
      .select("day_of_week, projected_sales")
      .eq("schedule_id", sched.id);
    if (projErr) console.error("[whos-out] schedule_projected_sales read failed:", projErr);
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
  if (cacheErr) console.error("[whos-out] sales_cache projection read failed:", cacheErr);
  for (const row of cacheRows || []) {
    if (goals.has(row.sale_date)) continue;
    const amount = Number(
      row.override_projection || row.living_projection || row.projected_sales || row.initial_projection || 0,
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
  if (histErr) console.error("[whos-out] sales_cache history read failed:", histErr);

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
    console.error("[whos-out] busiest-dow read failed:", error);
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

  return { busyDows, busiestDowLabel: DOW_LONG[top.dow] };
}

/**
 * Habit notes from PUBLISHED schedule history — factual counts only, max 5.
 * Skipped entirely when the store has thin published history.
 */
async function buildHabitNotes(
  supabase: any,
  locationId: string,
  days: WhosOutDay[],
  entries: WhosOutEntry[],
  busiestDowLabel: string | null,
): Promise<string[]> {
  const notes: string[] = [];
  const outUserIds = [...new Set(entries.map((e) => e.userId))];
  if (outUserIds.length === 0) return notes;

  const firstDay = days[0].date;
  const historyStart = addDays(firstDay, -84);

  const { data: schedules, error: schedErr } = await supabase
    .from("schedules")
    .select("id, week_start_date")
    .eq("location_id", locationId)
    .eq("is_published", true)
    .gte("week_start_date", historyStart)
    .lt("week_start_date", firstDay);
  if (schedErr) {
    console.error("[whos-out] published schedules read failed:", schedErr);
    return notes;
  }

  const scheduleIds = (schedules || []).map((s: any) => s.id);
  const weeksOfHistory = scheduleIds.length;
  if (weeksOfHistory < 4) return notes; // thin history — skip notes entirely

  const { data: shifts, error: shiftErr } = await supabase
    .from("scheduled_shifts")
    .select("user_id, shift_date, day_of_week")
    .in("schedule_id", scheduleIds)
    .in("user_id", outUserIds)
    .eq("is_time_off", false);
  if (shiftErr) {
    console.error("[whos-out] scheduled_shifts read failed:", shiftErr);
    return notes;
  }

  // worked[userId][dow] = count of distinct dates
  const worked = new Map<string, Map<number, Set<string>>>();
  for (const s of shifts || []) {
    if (!s.user_id) continue;
    const dow = dowOf(s.shift_date);
    if (!worked.has(s.user_id)) worked.set(s.user_id, new Map());
    const perDow = worked.get(s.user_id)!;
    if (!perDow.has(dow)) perDow.set(dow, new Set());
    perDow.get(dow)!.add(s.shift_date);
  }

  const nameOf = new Map(entries.map((e) => [e.userId, e.first]));

  // 1. The busiest day, when people are out on it.
  const busyDay = days.find((d) => d.busy && d.entries.length > 0);
  if (busyDay && busiestDowLabel) {
    notes.push(
      `${DOW_LONG[busyDay.dow]} is this store's strongest sales day over the last ${weeksOfHistory} weeks — ${busyDay.entries.length} out.`,
    );
  }

  // 2. Per-person rarity on a day they're out (the "don't count on them" note).
  const seenPerson = new Set<string>();
  for (const day of days) {
    for (const entry of day.entries) {
      if (notes.length >= 5) break;
      const key = `${entry.userId}|${day.dow}`;
      if (seenPerson.has(key)) continue;
      seenPerson.add(key);
      const count = worked.get(entry.userId)?.get(day.dow)?.size ?? 0;
      if (count === 0) {
        notes.push(
          `${entry.first} has not worked a ${DOW_LONG[day.dow]} in the last ${weeksOfHistory} weeks — covering that day may be hard in-house.`,
        );
      } else if (count <= Math.max(1, Math.floor(weeksOfHistory * 0.25))) {
        notes.push(
          `${entry.first} has worked ${count} of the last ${weeksOfHistory} ${DOW_LONG[day.dow]}s — thin cover there.`,
        );
      }
    }
    if (notes.length >= 5) break;
  }

  // 3. Days with 2+ out and a real goal attached.
  for (const day of days) {
    if (notes.length >= 5) break;
    if (day.entries.length >= 2 && day.goal) {
      notes.push(
        `${DOW_LONG[day.dow]} ${prettyDate(day.date)} carries a ${money(day.goal)} goal with ${day.entries.length} out.`,
      );
    }
  }

  return notes.slice(0, 5);
}

// ── Recipients ────────────────────────────────────────────────────────────

export interface WhosOutRecipient {
  id: string;
  email: string;
  name: string;
}

/**
 * Location-scoped managers/admins only. Shift managers (and shift managers in
 * training) are deliberately excluded. Missing preference row = ON.
 */
export async function resolveWhosOutRecipients(
  supabase: any,
  locationId: string,
): Promise<WhosOutRecipient[]> {
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
  if (bounceErr) console.error("[whos-out] bounced_emails read failed:", bounceErr);
  const bouncedSet = new Set((bounced || []).map((b: any) => b.email_address));

  const { data: prefs, error: prefErr } = await supabase
    .from("user_notification_settings")
    .select("user_id, email_enabled")
    .eq("notification_type", WHOS_OUT_NOTIFICATION_TYPE)
    .eq("location_id", locationId)
    .in("user_id", withEmail.map((p: any) => p.id));
  if (prefErr) console.error("[whos-out] user_notification_settings read failed:", prefErr);
  const offFor = new Set(
    (prefs || []).filter((p: any) => p.email_enabled === false).map((p: any) => p.user_id),
  );

  return withEmail
    .filter((p: any) => !bouncedSet.has(p.email) && !offFor.has(p.id))
    .map((p: any) => ({ id: p.id, email: p.email, name: p.full_name || "" }));
}

// ── HTML (Option E) ───────────────────────────────────────────────────────

const TEAL = "#146b74";
const TEAL_DEEP = "#0f565e";
const TEAL_TINT = "#e8f1f2";
const ORANGE = "#e8733d";
const ORANGE_TINT = "#fdf0e8";
const CREAM = "#eae7dd";
const INK = "#1a1d21";
const MUTED = "#8a8f95";
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function buildWhosOutHtml(data: WhosOutData, opts: { isSample?: boolean } = {}): string {
  const anyoneOut = data.totalRequests > 0;
  const rangeLabel = `${DOW_LONG[dowOf(data.weekStart)].slice(0, 3)} ${prettyDate(data.weekStart)} – ${DOW_LONG[dowOf(data.weekEnd)].slice(0, 3)} ${prettyDate(data.weekEnd)}`;

  // ── Header pills ──
  const pills: string[] = [];
  if (anyoneOut) {
    pills.push(
      `<span style="display:inline-block;background:rgba(255,255,255,0.18);color:#ffffff;font-size:12px;font-weight:700;padding:6px 14px;border-radius:999px;margin-right:8px;">${data.peopleOut} ${data.peopleOut === 1 ? "person" : "people"}</span>`,
    );
  }
  if (data.busiestDowLabel) {
    pills.push(
      `<span style="display:inline-block;background:${ORANGE};color:#ffffff;font-size:12px;font-weight:700;padding:6px 14px;border-radius:999px;">${escapeHtml(data.busiestDowLabel)} historically busiest</span>`,
    );
  }

  // ── Week strip ──
  const chipCells = data.days
    .map((day) => {
      const heavy = day.entries.length >= 2;
      const highlighted = heavy || day.busy;
      const border = highlighted ? `2px solid ${ORANGE}` : "1px solid #e4e1d8";
      const bg = highlighted ? ORANGE_TINT : "#ffffff";
      const topLabel = heavy
        ? `<div style="color:${ORANGE};font-size:9px;font-weight:800;letter-spacing:0.6px;">${day.entries.length} OUT</div>`
        : day.busy
          ? `<div style="color:${ORANGE};font-size:9px;font-weight:800;letter-spacing:0.6px;">&#9733; BUSY</div>`
          : "";
      const dowColor = highlighted ? ORANGE : MUTED;
      const numColor = highlighted ? ORANGE : INK;
      const nameChips = day.entries.length
        ? day.entries
            .map(
              (e) =>
                `<div style="background:${heavy ? ORANGE : TEAL_TINT};color:${heavy ? "#ffffff" : TEAL_DEEP};font-size:10px;font-weight:700;border-radius:999px;padding:3px 8px;margin-top:4px;">${escapeHtml(e.first)}</div>`,
            )
            .join("")
        : `<div style="color:${MUTED};font-size:10px;margin-top:6px;">clear</div>`;
      return `<td width="14%" valign="top" style="padding:3px;">
<div style="border:${border};background:${bg};border-radius:12px;padding:10px 6px;text-align:center;">
${topLabel}
<div style="color:${dowColor};font-size:10px;font-weight:700;letter-spacing:0.8px;">${day.label}</div>
<div style="color:${numColor};font-size:22px;font-weight:800;line-height:1.1;">${day.dayNumber}</div>
<div style="color:${MUTED};font-size:11px;font-weight:600;">${escapeHtml(money(day.goal) || "—")}</div>
${nameChips}
</div></td>`;
    })
    .join("");

  // ── AI notes ──
  const notesBlock = data.notes.length
    ? `<div style="background:${TEAL_TINT};border-radius:14px;padding:18px 20px;margin:0 0 26px;">
<div style="color:${TEAL_DEEP};font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">AI notes &middot; from schedule + sales history</div>
${data.notes.map((n) => `<p style="color:${INK};font-size:13px;line-height:1.6;margin:0 0 8px;">&bull; ${escapeHtml(n)}</p>`).join("")}
</div>`
    : "";

  // ── Detail breakout: busiest / most-out days first ──
  const detailDays = data.days
    .filter((d) => d.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length || a.date.localeCompare(b.date));

  const detailBlock = detailDays
    .map((day) => {
      const heavy = day.entries.length >= 2;
      const headBg = heavy ? ORANGE_TINT : "#f4f3ee";
      const headColor = heavy ? ORANGE : "#5b6167";
      const star = day.busy ? " &middot; &#9733; historically busiest" : "";
      const goalLabel = day.goal ? ` &middot; goal ${money(day.goal)}` : "";
      const rows = day.entries
        .map((e) => {
          let detail = "full day";
          if (e.timeScope === "partial_day" && e.startTime) {
            detail = `${fmtTime(e.startTime)}–${fmtTime(e.endTime)}`;
          } else if (e.startDate < day.date && e.endDate > day.date) {
            detail = `continues through ${prettyDate(e.endDate)}`;
          } else if (e.startDate < day.date) {
            detail = `last day of ${prettyDate(e.startDate)}–${prettyDate(e.endDate)}`;
          } else if (e.endDate > day.date) {
            detail = `through ${prettyDate(e.endDate)}`;
          }
          return `<tr><td style="padding:12px 16px;border-top:1px solid #efece4;"><strong style="color:${INK};font-size:14px;">${escapeHtml(e.name)}</strong> <span style="color:${MUTED};font-size:13px;">&middot; ${escapeHtml(detail)}</span></td></tr>`;
        })
        .join("");
      return `<table width="100%" style="border-collapse:collapse;border:1px solid ${heavy ? ORANGE : "#e4e1d8"};border-radius:12px;overflow:hidden;margin-bottom:14px;">
<tr><td style="background:${headBg};padding:10px 16px;color:${headColor};font-size:12px;font-weight:800;">${DOW_LONG[day.dow].slice(0, 3)} ${prettyDate(day.date)} &middot; ${day.entries.length} ${day.entries.length === 1 ? "request" : "requests"}${goalLabel}${star}</td></tr>
${rows}
</table>`;
    })
    .join("");

  const emptyBlock = `<div style="background:${TEAL_TINT};border-radius:14px;padding:26px 20px;text-align:center;margin-bottom:24px;">
<div style="color:${TEAL_DEEP};font-size:16px;font-weight:800;">Nobody is out next week.</div>
<div style="color:${MUTED};font-size:13px;margin-top:6px;">Full roster available ${escapeHtml(rangeLabel)}.</div>
</div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT};">
<table width="100%" style="border-collapse:collapse;background:${CREAM};"><tr><td style="padding:26px 14px;">
<table width="100%" style="max-width:640px;margin:0 auto;border-collapse:collapse;background:#ffffff;border-radius:22px;overflow:hidden;">

<tr><td style="background:${TEAL};padding:26px 28px;">
<div style="color:rgba(255,255,255,0.82);font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${escapeHtml(data.orgName)} &middot; ${escapeHtml(data.locationName)} &middot; nightly digest</div>
<div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;margin:8px 0 4px;">Next week&rsquo;s time-off</div>
<div style="color:rgba(255,255,255,0.88);font-size:13px;font-weight:500;margin-bottom:14px;">${escapeHtml(rangeLabel)} &middot; ${data.totalRequests} ${data.totalRequests === 1 ? "request" : "requests"}</div>
${pills.join("")}
</td></tr>

<tr><td style="padding:24px 22px 8px;">
<div style="color:#5b6167;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Week at a glance &middot; sales goal under each day</div>
<table width="100%" style="border-collapse:collapse;"><tr>${chipCells}</tr></table>
<p style="color:${MUTED};font-size:11px;line-height:1.6;margin:12px 2px 20px;"><span style="color:${ORANGE};font-weight:800;">&#9733; BUSY</span> = historically one of this store&rsquo;s strongest sales days &middot; orange border also when 2+ people are out</p>
${notesBlock}
${anyoneOut ? `<div style="color:#5b6167;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Who&rsquo;s out &middot; detail</div>${detailBlock}` : emptyBlock}
<div style="text-align:center;margin:26px 0 8px;">
<a href="https://croohq.com/availability" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;padding:14px 34px;border-radius:12px;font-weight:800;font-size:15px;">Review time-off in CrooHQ</a>
</div>
<p style="color:${MUTED};font-size:11px;text-align:center;margin:0 0 10px;">Approved requests only. ${opts.isSample ? "Sample preview." : "Sent nightly for next week."}</p>
</td></tr>

<tr><td style="background:${CREAM};padding:20px;text-align:center;border-top:1px solid #e4e1d8;">
<span style="color:#3a5f7d;font-size:14px;">Powered by</span> <strong style="color:#1a1a1a;font-size:16px;letter-spacing:-0.5px;">croo</strong>
</td></tr>

</table></td></tr></table></body></html>`;
}

export function whosOutSubject(data: WhosOutData, isSample = false): string {
  // Samples use the plain named subject Jordan asked for; nightly sends keep
  // the count + date range so an inbox scan shows the week at a glance.
  if (isSample) return `[Sample] Next week’s time-off — ${data.locationName}`;
  if (data.totalRequests === 0) {
    return `${data.locationName}: nobody out next week (${prettyDate(data.weekStart)}–${prettyDate(data.weekEnd)})`;
  }
  return `${data.locationName}: ${data.peopleOut} out next week (${prettyDate(data.weekStart)}–${prettyDate(data.weekEnd)})`;
}
