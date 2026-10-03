// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findShifts, candidatesScreen, buildCoverProposal } from "./cover.ts";
import { roleForUser, theoActionsAt, NO_ACTIONS } from "../_shared/theoActions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Theo's brain. Chosen by Jordan after the Oct 2 2026 bake-off (Luna + action guard). Reasoning must stay off with tools.
const THEO_MODEL = "openai/gpt-6-luna";

// ─────────────────────────────────────────────────────────────────────────────
// MIRROR OF src/utils/countItemValue.ts — keep in sync.
// Single source of truth for valuing a count item. See countItemValue.test.ts
// for the canonical test cases. Edits here without updating the TS twin will
// silently desynchronize Period view, Review view, COGS report, and AI answers.
// ─────────────────────────────────────────────────────────────────────────────
interface LegForValue {
  entered_cases: number | null;
  entered_units: number | null;
  entered_inner_packs?: number | null;
  quantity_common: number | null;
  pack_quantity_at_count: number | null;
  inner_pack_quantity_at_count?: number | null;
  cost_at_count?: number | null;
}

function calculateCountItemValue(ci: any, item: any, conversion: any, forceLiveData: boolean = false, legs?: LegForValue[] | null): number {
  // Multi-config leg-aware branch — mirror of src/utils/countItemValue.ts §3.2/3.3.
  // When legs[] is non-empty AND item is not a recipe, value = Σ per-leg valuation.
  // Each leg recurses as a synthetic single-row ci with lens/conversion null; cost
  // falls back to ci.cost_at_count (shared across legs per §3.3).
  // Recipes are guarded out — they never multi-config.
  if (legs && legs.length > 0 && !item?.is_recipe) {
    const legItem = { ...(item || {}), lens: null };
    let total = 0;
    for (const leg of legs) {
      const legCi = {
        quantity: leg.quantity_common,
        entered_cases: leg.entered_cases,
        entered_units: leg.entered_units,
        entered_inner_packs: leg.entered_inner_packs ?? null,
        cost_at_count: leg.cost_at_count ?? ci?.cost_at_count,
        pack_quantity_at_count: leg.pack_quantity_at_count,
        inner_pack_quantity_at_count: leg.inner_pack_quantity_at_count ?? null,
      };
      total += calculateCountItemValue(legCi, legItem, null, forceLiveData);
    }
    return total;
  }

  // Snapshot-wins guard — submitted counts are frozen forever, even if a caller
  // opts into live data. Mirror of src/utils/countItemValue.ts.
  const hasSnapshot = ci?.pack_quantity_at_count != null || ci?.cost_at_count != null;
  const useLive = forceLiveData && !hasSnapshot;

  const costPerCase = useLive
    ? Number(item?.cost_per_unit) || 0
    : (ci?.cost_at_count != null
        ? Number(ci.cost_at_count) || 0
        : Number(item?.cost_per_unit) || 0);
  if (costPerCase === 0) return 0;

  // Recipe items: cost_per_unit is the cost to make ONE BATCH that produces
  // recipe_yield_qty of recipe_yield_unit. Divide by yield to get cost per
  // counted unit. Convert via oz-bridge if count unit differs from yield unit.
  if (item?.is_recipe) {
    const qty = ci?.quantity != null
      ? Number(ci.quantity) || 0
      : (Number(ci?.entered_cases || 0) + Number(ci?.entered_units || 0) + Number(ci?.entered_inner_packs || 0));
    const yieldQty = Number(item?.recipe_yield_qty) || 0;
    if (yieldQty > 0) {
      const TO_OZ: Record<string, number> = { oz:1, lb:16, tsp:0.1667, tbsp:0.5, cup:8, cups:8, pt:16, qt:32, gal:128, g:0.03527, kg:35.274, ml:0.033814, cl:0.33814, l:33.814, ea:1 };
      const norm = (u: any) => {
        if (!u) return "";
        const c = String(u).trim().toLowerCase().replace(/\s+/g,"").replace(/_/g,"-");
        const map: Record<string,string> = { lbs:"lb", pound:"lb", pounds:"lb", gallon:"gal", gallons:"gal", quart:"qt", quarts:"qt", pint:"pt", pints:"pt", cup:"cups", liter:"l", liters:"l", each:"ea", count:"ea" };
        if (map[c]) return map[c];
        if (TO_OZ[c] != null) return c;
        return c;
      };
      const cu = norm(item?.unit);
      const yu = norm(item?.recipe_yield_unit);
      let qtyInYield: number | null = qty;
      if (cu && yu && cu !== yu) {
        const f = TO_OZ[cu]; const t = TO_OZ[yu];
        qtyInYield = (f != null && t != null) ? (qty * f) / t : null;
      }
      if (qtyInYield != null && Number.isFinite(qtyInYield)) {
        return qtyInYield * (costPerCase / yieldQty);
      }
    }
    return qty * costPerCase;
  }


  const enteredCasesNum = Number(ci?.entered_cases || 0);
  const enteredUnitsNum = Number(ci?.entered_units || 0);
  const enteredInnerPacksNum = Number(ci?.entered_inner_packs || 0);
  const quantityNum = Number(ci?.quantity || 0);

  const pipeline1PackQty = conversion
    ? Number(conversion.outer_qty) * Number(conversion.canonical_qty_per_inner ?? 1)
    : null;

  // Pack quantity wins over Pipeline 1 always — Pipeline 1 conversions
  // (item_conversions) are for cost-per-oz math, NOT for count quantity
  // reconstruction. Using them here breaks case-level counting for items
  // where pack_quantity = 1 is genuinely correct (e.g., olive oil sold by case).
  const packQtyRaw = useLive
    ? (item?.pack_quantity_override ?? item?.pack_quantity ?? pipeline1PackQty ?? 1)
    : (ci?.pack_quantity_at_count ?? item?.pack_quantity_override ?? item?.pack_quantity ?? pipeline1PackQty ?? 1);

  const packQty = Number(packQtyRaw);
  const safePackQty = Number.isFinite(packQty) && packQty > 0 ? packQty : 1;
  const innerPackQtyRaw = useLive
    ? (item?.inner_pack_quantity ?? null)
    : (ci?.inner_pack_quantity_at_count ?? item?.inner_pack_quantity ?? null);
  const innerPackQty = Number(innerPackQtyRaw);
  const safeInnerPackQty = Number.isFinite(innerPackQty) && innerPackQty > 0 ? innerPackQty : 0;
  const caseUnits = safeInnerPackQty > 0 ? safePackQty * safeInnerPackQty : safePackQty;

  const hasEntered = ci?.entered_cases != null || ci?.entered_units != null || ci?.entered_inner_packs != null;
  let value: number;
  if (hasEntered) {
    // Pan-inclusive: derive non-case units from quantity (which folds in pan units)
    // so Period/Review match Edit Count's pan-aware total.
    const caseValue = enteredCasesNum * costPerCase;
    const derivedNonCaseUnits = quantityNum - (enteredCasesNum * caseUnits);
    const fallbackNonCaseUnits = enteredUnitsNum + (enteredInnerPacksNum * safeInnerPackQty);
    const nonCaseUnits = quantityNum > 0 && derivedNonCaseUnits >= fallbackNonCaseUnits
      ? derivedNonCaseUnits
      : fallbackNonCaseUnits;
    const unitValue = (nonCaseUnits * costPerCase) / caseUnits;
    value = caseValue + unitValue;
  } else {
    value = quantityNum * (costPerCase / caseUnits);
  }

  if (!Number.isFinite(value) || value < 0) {
    console.warn("[calculateCountItemValue] Invalid result, returning 0", { ci, item, conversion, value });
    return 0;
  }
  return value;
}

function getTzOffset(tz: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(p => p.type === "timeZoneName");
  if (tzPart?.value) {
    const match = tzPart.value.match(/GMT([+-]\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const sign = hours >= 0 ? "+" : "-";
      return `${sign}${String(Math.abs(hours)).padStart(2, "0")}:00`;
    }
  }
  return "-08:00";
}

// === STORE DATE / TIME HELPERS (Round 1: one number, one path) ===
// Business date + day windows come ONLY from public.business_date / public.business_day_window.
function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
function tzOffsetMs(ms: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}
/** Store-local wall time (yyyy-MM-dd + HH:mm[:ss]) → UTC ms. */
function localToUtcMs(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}
function localHour(iso: string, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
}
function localDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Fri 2026-10-02" — weekday for a yyyy-MM-dd date (calendar date, no time zone shift). */
function wd(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${WD[new Date(d + "T12:00:00Z").getUTCDay()]} ${d}` : d;
}
/** "Thu Oct 1, 8:04 PM" in the store's time zone. */
function localStamp(iso: string, tz: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).formatToParts(dt);
  const g = (t: string) => parts.find((x) => x.type === t)?.value || "";
  return `${g("weekday")} ${g("month")} ${g("day")}, ${g("hour")}:${g("minute")} ${g("dayPeriod")}`;
}
/** Every tool result: each UTC timestamp gets a store-local *_local twin, each date a *_weekday twin. The model never converts UTC. */
function addLocalTimes(result: string, tz: string): string {
  let parsed: any;
  try { parsed = JSON.parse(result); } catch { return result; }
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = walk(val);
        if (typeof val === "string") {
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val) && !(`${k}_local` in v)) out[`${k}_local`] = localStamp(val, tz);
          else if (/^\d{4}-\d{2}-\d{2}$/.test(val) && !(`${k}_weekday` in v)) out[`${k}_weekday`] = WD[new Date(val + "T12:00:00Z").getUTCDay()];
        }
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(parsed));
}
type DayWindow = { start_at: string; end_at: string };
async function dayWindow(admin: any, locationId: string, date: string): Promise<DayWindow | null> {
  const { data, error } = await admin.rpc("business_day_window", { _location_id: locationId, _date: date });
  if (error) { console.error("business_day_window failed", error.message); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  return row?.start_at && row?.end_at ? { start_at: row.start_at, end_at: row.end_at } : null;
}
/** Start of the first business day → end of the last business day. */
async function rangeWindow(admin: any, locationId: string, start: string, end: string): Promise<DayWindow | null> {
  const [a, b] = await Promise.all([dayWindow(admin, locationId, start), dayWindow(admin, locationId, end)]);
  return a && b ? { start_at: a.start_at, end_at: b.end_at } : null;
}
/** Per-date windows (capped at 120 days) so punches can be assigned to their business date. */
async function windowsFor(admin: any, locationId: string, start: string, end: string): Promise<Record<string, DayWindow>> {
  const dates = datesBetween(start, end).slice(0, 120);
  const ws = await Promise.all(dates.map((d) => dayWindow(admin, locationId, d)));
  const out: Record<string, DayWindow> = {};
  dates.forEach((d, i) => { if (ws[i]) out[d] = ws[i]!; });
  return out;
}
function businessDateOf(iso: string, windows: Record<string, DayWindow>, tz: string): string {
  const t = new Date(iso).getTime();
  for (const [d, w] of Object.entries(windows)) {
    if (t >= new Date(w.start_at).getTime() && t < new Date(w.end_at).getTime()) return d;
  }
  return localDate(iso, tz);
}

// === LABOR: ONLY public.get_store_labor (same function as the dashboard) ===
// Called with the SIGNED-IN user's client so the function's own role + store checks decide.
async function fetchStoreLaborRows(userClient: any, locationId: string, start: string, end: string): Promise<{ rows: any[] | null; error: string | null }> {
  const windows: Array<[string, string]> = [];
  for (let cur = start; cur <= end; ) {
    const wEnd = addDays(cur, 89) < end ? addDays(cur, 89) : end;
    windows.push([cur, wEnd]);
    cur = addDays(wEnd, 1);
  }
  const res = await Promise.all(windows.map(([s, e]) => userClient.rpc("get_store_labor", { _location_ids: [locationId], _start: s, _end: e })));
  const bad = res.find((r: any) => r.error);
  if (bad) { console.error("get_store_labor failed", bad.error?.message); return { rows: null, error: bad.error?.message || "error" }; }
  return { rows: res.flatMap((r: any) => r.data || []), error: null };
}
const LABOR_UNAVAILABLE = { labor_unavailable: true, message: "Theo can't see labor for this store right now." };
/** One entry per business date; missing days get an explicit marker (never 0%). */
function laborByDay(rows: any[], start: string, end: string) {
  const map: Record<string, any> = {};
  for (const r of rows) map[String(r.date).slice(0, 10)] = r;
  return datesBetween(start, end).map((d) => {
    const r = map[d];
    if (!r || (Number(r.hours) <= 0 && Number(r.cost) <= 0)) {
      return { date: d, no_labor_data: true, message: "No labor data for this day — skip labor, never say 0% or give a grade." };
    }
    return {
      date: d,
      labor_hours: Number(r.hours),
      labor_cost: Number(r.cost),
      net_sales: r.net_sales == null ? null : Number(r.net_sales),
      labor_pct: r.labor_pct == null ? null : Number(r.labor_pct),
      ...(r.labor_pct == null ? { labor_pct_note: "No sales for this day, so no labor %." } : {}),
      is_live: !!r.is_live,
      source: r.source,
    };
  });
}

// === CONTEXT SNAPSHOT CACHE ===
// In-memory cache keyed by locationId. Survives across warm invocations in the same Deno isolate.
// TTL: 60 seconds — multiple managers querying the same location reuse the same DB lookups.
const snapshotCache = new Map<string, { data: string; expiry: number }>();
const SNAPSHOT_TTL_MS = 60_000; // 60 seconds

async function getCachedSnapshot(supabase: any, locationId: string, today: string, yesterday: string, tomorrow: string, weekStart: string): Promise<string> {
  const cacheKey = `${locationId}:${today}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) {
    console.log(`[context-cache] HIT for ${locationId} (${Math.round((cached.expiry - Date.now()) / 1000)}s remaining)`);
    return cached.data;
  }

  console.log(`[context-cache] MISS for ${locationId} — building fresh snapshot`);
  const snapshot = await buildContextSnapshot(supabase, locationId, today, yesterday, tomorrow, weekStart);
  snapshotCache.set(cacheKey, { data: snapshot, expiry: Date.now() + SNAPSHOT_TTL_MS });

  // Prune expired entries (keep map clean)
  for (const [key, val] of snapshotCache) {
    if (Date.now() >= val.expiry) snapshotCache.delete(key);
  }

  return snapshot;
}

// === CONTEXT INJECTION: Build a daily snapshot to prepend to system prompt ===
// Goal/pace — mirrors SalesSummary.tsx exactly (resolveProjection goal; pace = max(pace_adjusted_projection, sales so far);
// status thresholds from getPaceStatus). Pace never falls back to the goal.
function rowGoal(r: any): number {
  return (Number(r.override_projection) || Number(r.living_projection) || Number(r.initial_projection) || Number(r.projected_sales) || 0);
}
function todayPaceOf(r: any): number | null {
  const p = Number(r?.pace_adjusted_projection) || 0;
  if (p <= 0) return null;
  return Math.max(p, Number(r?.net_sales) || 0);
}
function paceStatus(actual: number, pace: number | null, goal: number): { status: string; pct: number } | null {
  if (actual < 100 || !pace || pace <= 0 || goal <= 0) return null;
  const pct = (pace / goal) * 100;
  return { status: pct >= 102 ? "ahead" : pct >= 95 ? "on track" : "behind", pct: Math.round(pct * 10) / 10 };
}
function money(n: number): string { return `$${Math.round(n).toLocaleString()}`; }

async function buildContextSnapshot(supabase: any, locationId: string, today: string, yesterday: string, tomorrow: string, weekStart: string): Promise<string> {
  try {
    // Calculate end of week (Sunday) from weekStart (Monday)
    const weekEnd = addDays(weekStart, 6);

    // Fetch full week sales (yesterday through Sunday) for projections
    const fetchStart = yesterday < weekStart ? yesterday : weekStart;
    const { data: salesRows } = await supabase
      .from("sales_cache")
      .select("sale_date, net_sales, guest_count, override_projection, initial_projection, projected_sales, living_projection, pace_adjusted_projection")
      .eq("location_id", locationId)
      .gte("sale_date", fetchStart)
      .lte("sale_date", weekEnd)
      .order("sale_date");

    // Labor is NOT in this cached snapshot — it is fetched per request with the
    // asking user's permissions (see buildLaborLines) so one person's labor never
    // reaches someone who would have been refused.

    // Fetch today's schedule count
    const { data: scheduleRows } = await supabase
      .from("scheduled_shifts")
      .select("id, schedules!inner(location_id)")
      .eq("schedules.location_id", locationId)
      .eq("schedules.is_published", true)
      .eq("shift_date", today)
      .not("user_id", "is", null);

    // Fetch tomorrow's schedule count
    const { data: tomorrowSchedule } = await supabase
      .from("scheduled_shifts")
      .select("id, schedules!inner(location_id)")
      .eq("schedules.location_id", locationId)
      .eq("schedules.is_published", true)
      .eq("shift_date", tomorrow)
      .not("user_id", "is", null);

    // Week-to-date rows derived from the full-week sales fetch above
    const weekRows = (salesRows || []).filter((r: any) => r.sale_date >= weekStart && r.sale_date <= today);

    // Fetch today's tips
    const { data: tipsRow } = await supabase
      .from("daily_tips")
      .select("total_cc_tips, total_cash_tips")
      .eq("location_id", locationId)
      .eq("tip_date", today)
      .maybeSingle();

    // Fetch location hours for today
    const dayOfWeek = new Date(today + "T12:00:00Z").getUTCDay();
    const { data: hoursRow } = await supabase
      .from("location_hours")
      .select("open_time, close_time, is_closed")
      .eq("location_id", locationId)
      .eq("day_of_week", dayOfWeek)
      .maybeSingle();

    // Pending time-off requests
    const { data: pendingPto } = await supabase
      .from("availability_requests")
      .select("id")
      .eq("location_id", locationId)
      .eq("status", "pending");

    // Build snapshot
    const lines: string[] = ["📊 LIVE CONTEXT SNAPSHOT (auto-injected, do NOT repeat raw numbers — use them to answer naturally):"];

    // Yesterday
    const yd = (salesRows || []).find((r: any) => r.sale_date === yesterday);
    if (yd) {
      const goal = (Number(yd.override_projection) || Number(yd.living_projection) || Number(yd.initial_projection) || Number(yd.projected_sales) || 0);
      const vs = goal > 0 ? ((yd.net_sales / goal - 1) * 100).toFixed(1) : "N/A";
      lines.push(`Yesterday (${wd(yesterday)}): Net Sales $${(yd.net_sales || 0).toLocaleString()} | Goal $${goal.toLocaleString()} (${Number(vs) >= 0 ? '+' : ''}${vs}%) | Guests: ${yd.guest_count || 0}`);
    }

    // Today
    const td = (salesRows || []).find((r: any) => r.sale_date === today);
    if (td) {
      const goal = (Number(td.override_projection) || Number(td.living_projection) || Number(td.initial_projection) || Number(td.projected_sales) || 0);
      const sold = Number(td.net_sales) || 0;
      const pace = sold >= 100 ? todayPaceOf(td) : null;
      const st = paceStatus(sold, pace, goal);
      const paceTxt = pace && st
        ? `Pace ${money(pace)} (where today is trending to finish) | Status: ${st.status.toUpperCase()} (${st.pct}% of goal, ${pace - goal >= 0 ? '+' : '-'}${money(Math.abs(pace - goal))} vs goal)`
        : `Pace: not available yet`;
      lines.push(`Today (${wd(today)}): Net Sales So Far ${money(sold)} | Goal ${money(goal)} | ${paceTxt} | Guests: ${td.guest_count || 0}`);
    }

    // Tomorrow
    const tm = (salesRows || []).find((r: any) => r.sale_date === tomorrow);
    if (tm) {
      const goal = (Number(tm.override_projection) || Number(tm.living_projection) || Number(tm.initial_projection) || Number(tm.projected_sales) || 0);
      // SANITY CHECK: flag if projection seems absurdly low
      const flagged = goal > 0 && goal < 500 ? " ⚠️ THIS PROJECTION LOOKS SUSPICIOUSLY LOW — it may be a stale override or data error. Tell the user the number seems off and suggest they check/update the projection." : "";
      lines.push(`Tomorrow (${wd(tomorrow)}): Projected $${goal.toLocaleString()}${flagged}`);
    }

    // Week-to-date
    if (weekRows && weekRows.length > 0) {
      const wtdSales = weekRows.reduce((s: number, r: any) => s + (r.net_sales || 0), 0);
      const wtdGoal = weekRows.reduce((s: number, r: any) => s + (Number(r.override_projection) || Number(r.living_projection) || Number(r.initial_projection) || Number(r.projected_sales) || 0), 0);
      lines.push(`Week-to-date (${wd(weekStart)} → ${wd(today)}): Sales $${wtdSales.toLocaleString()} | Goal $${wtdGoal.toLocaleString()} (${wtdGoal > 0 ? ((wtdSales / wtdGoal - 1) * 100).toFixed(1) : 'N/A'}%)`);
    }

    // Remaining week projections (days after today through Sunday)
    const futureDays = (salesRows || []).filter((r: any) => r.sale_date > today && r.sale_date <= weekEnd);
    if (futureDays.length > 0) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const futureLines = futureDays.map((r: any) => {
        const dayName = dayNames[new Date(r.sale_date + "T12:00:00Z").getUTCDay()];
        const proj = (Number(r.override_projection) || Number(r.living_projection) || Number(r.initial_projection) || Number(r.projected_sales) || 0);
        return `${dayName} ${r.sale_date}: $${proj.toLocaleString()}`;
      });
      lines.push(`Remaining Week Projections: ${futureLines.join(" | ")}`);
      const totalRemaining = futureDays.reduce((s: number, r: any) => s + (Number(r.override_projection) || Number(r.living_projection) || Number(r.initial_projection) || Number(r.projected_sales) || 0), 0);
      const wtdSales = weekRows ? weekRows.reduce((s: number, r: any) => s + (r.net_sales || 0), 0) : 0;
      const fullWeekProj = (weekRows ? weekRows.reduce((s: number, r: any) => s + (Number(r.override_projection) || Number(r.living_projection) || Number(r.initial_projection) || Number(r.projected_sales) || 0), 0) : 0) + totalRemaining;
      lines.push(`Full Week Projection: $${fullWeekProj.toLocaleString()} (Remaining: $${totalRemaining.toLocaleString()})`);
    }

    // Week pace vs week goal — same as the dashboard: past days actual (goal if no sales), today's pace, remaining days' goals.
    {
      const wk = (salesRows || []).filter((r: any) => r.sale_date >= weekStart && r.sale_date <= weekEnd);
      if (wk.length > 0) {
        const weekGoal = wk.reduce((a: number, r: any) => a + rowGoal(r), 0);
        const weekSold = wk.filter((r: any) => r.sale_date <= today).reduce((a: number, r: any) => a + (Number(r.net_sales) || 0), 0);
        let weekPace = 0;
        for (const r of wk) {
          const sold = Number(r.net_sales) || 0;
          if (r.sale_date < today) weekPace += sold > 0 ? sold : rowGoal(r);
          else if (r.sale_date === today) weekPace += Number(r.pace_adjusted_projection) || (sold > 0 ? sold : rowGoal(r));
          else weekPace += rowGoal(r);
        }
        const st = paceStatus(weekSold, weekPace, weekGoal);
        lines.push(st
          ? `Week pace (${wd(weekStart)} → ${wd(weekEnd)}): Pace ${money(weekPace)} vs Week Goal ${money(weekGoal)} | Status: ${st.status.toUpperCase()} (${st.pct}%, ${weekPace - weekGoal >= 0 ? '+' : '-'}${money(Math.abs(weekPace - weekGoal))})`
          : `Week pace (${wd(weekStart)} → ${wd(weekEnd)}): not available yet | Week Goal ${money(weekGoal)}`);
      }
    }

    // Tips
    if (tipsRow) {
      lines.push(`Today's Tips: CC $${tipsRow.total_cc_tips?.toLocaleString() || 0} | Cash $${tipsRow.total_cash_tips?.toLocaleString() || 0}`);
    }

    // Schedule
    lines.push(`Scheduled Today (published schedule only): ${scheduleRows?.length || 0} shifts | Tomorrow: ${tomorrowSchedule?.length || 0} shifts`);

    // Hours
    if (hoursRow) {
      lines.push(`Store Hours Today: ${hoursRow.is_closed ? 'CLOSED' : `${hoursRow.open_time} - ${hoursRow.close_time}`}`);
    }

    // Pending PTO
    if (pendingPto && pendingPto.length > 0) {
      lines.push(`Pending Time-Off Requests: ${pendingPto.length}`);
    }

    return lines.join("\n");
  } catch (e) {
    console.error("Context snapshot error:", e);
    return "⚠️ Context snapshot unavailable — use tools to fetch data.";
  }
}

// Per-request labor lines for the snapshot (NOT cached; uses the asking user's permissions).
async function buildLaborLines(userClient: any, locationId: string, yesterday: string, today: string): Promise<string> {
  if (!locationId) return "";
  const { rows, error } = await fetchStoreLaborRows(userClient, locationId, yesterday, today);
  if (error || !rows) return "Labor: Theo can't see labor for this store right now.";
  return laborByDay(rows, yesterday, today).map((d: any) => {
    const label = d.date === today ? `Labor today so far (${d.date})` : `Labor yesterday (${d.date})`;
    if (d.no_labor_data) return `${label}: no labor data yet — skip labor, never say 0% or a grade.`;
    return `${label}: $${Math.round(d.labor_cost).toLocaleString()} | ${d.labor_hours.toFixed(1)} hrs | ${d.labor_pct == null ? "labor % n/a (no sales)" : `${d.labor_pct.toFixed(1)}%`}${d.is_live ? " (live)" : ""}`;
  }).join("\n");
}

// Tool definitions for the AI model
const tools = [
  {
    type: "function",
    function: {
      name: "query_sales",
      description: "Query sales data including net sales, guest count, pizza count, avg ticket, projections, and product mix (menu items sold with quantities). Use for questions about revenue, sales performance, items sold, product mix, and comparisons between dates.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD (defaults to start_date if omitted)" },
          include_product_mix: { type: "boolean", description: "Include item-level sales breakdown (product mix)" },
          include_hourly: { type: "boolean", description: "Include hourly sales breakdown" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_labor",
      description: "Query labor data: labor cost, hours, overtime, employee breakdown. Also queries individual time punches (clock in/out times) for specific employees or all staff on a date. Use for labor cost/hours and who clocked in/out. NOT for lateness — any late, tardy or on-time question goes to query_punch_patterns.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
          include_punches: { type: "boolean", description: "Include individual clock in/out punch records" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_schedule",
      description: "Query scheduled shifts for a location on specific dates. Shows who is scheduled, shift times, positions, and coverage. Use for 'who was the opener', 'who is working today', shift coverage questions.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_checklists",
      description: "Query checklist completion data. ALWAYS returns full item-level responses (questions, answers, temperatures, who completed each item). Use for ANY checklist question: 'who temped the tomatoes', 'what time did they flip the line', 'was the shift change checklist done', 'what was the walk-in temp'. Use checklist_title to find the right checklist and item_keyword to find specific items within it.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD" },
          checklist_title: { type: "string", description: "Filter by checklist title (partial match, e.g. 'AM Line', 'shift change', 'opening', 'closing'). ALWAYS set this when the user mentions a checklist name." },
          item_keyword: { type: "string", description: "Filter items by keyword in the question text (e.g. 'tomato', 'walk-in', 'flip', 'temp'). Set this when asking about a specific item." },
        },
        required: ["location_id", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_tasks",
      description: "Query tasks (quick tasks, recurring tasks, alarm tasks) and their subtasks/completions. Use for questions about task status, what's incomplete, who completed what, task details.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          task_title: { type: "string", description: "Filter by task title (partial match)" },
          include_subtasks: { type: "boolean", description: "Include subtask details and completion status. Default true." },
          active_only: { type: "boolean", description: "Only show active tasks. Default true." },
          date: { type: "string", description: "Date for checking completions YYYY-MM-DD (defaults to today)" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_logbook",
      description: "Query logbook entries (Safe Count, Drawer Count, Pass Down, Incident Report, Maintenance Request, and any custom categories). Returns full details including JSON data for financial entries (denomination counts, totals, variance, deposit amounts). Use for questions about drawer counts, safe counts, deposits, pass downs, incidents, maintenance, or any logbook category.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD" },
          category_name: { type: "string", description: "Filter by category name (partial match, e.g. 'safe', 'drawer', 'pass down', 'incident', 'maintenance')" },
          entry_keyword: { type: "string", description: "Filter entries by keyword in title or value text" },
        },
        required: ["location_id", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_labor_intelligence",
      description: "Query AI-generated labor intelligence reports with grades (A-F), findings, and staffing suggestions. Use for questions about labor efficiency, labor grade, overstaffing, understaffing, or scheduling optimization insights. IMPORTANT: Reports are generated nightly for the PREVIOUS day — never request today's date. Omit the `date` param to get the most recent reports (best for 'this week', 'lately', or improvement questions). Only pass `date` if the user names a specific past day.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD (defaults to most recent report)" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_inventory",
      description: "Query inventory count data AND calculate food cost (COGS). Use for ANY question about food cost, COGS percentage, inventory value, what items were counted, stock on hand, or period comparisons. Set calculate_cogs=true when the user asks about food cost, COGS, or food cost percentage — this computes: Beginning Inventory + Purchases - Ending Inventory = Usage, then Usage / Net Sales = COGS%.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          period_end_date: { type: "string", description: "Period end date YYYY-MM-DD to find a specific count period" },
          status: { type: "string", description: "Filter by status: 'completed', 'in_progress', 'upcoming'" },
          item_keyword: { type: "string", description: "Filter items by name keyword (e.g. 'chicken', 'cheese', 'lettuce')" },
          include_items: { type: "boolean", description: "Include item-level detail (quantities, costs, variance). Default false for summary, true when asking about specific items." },
          calculate_cogs: { type: "boolean", description: "Calculate COGS/food cost for the most recent completed weekly period. Set true when user asks about food cost, COGS %, or cost of goods sold." },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_catering",
      description: "Query catering orders with customer name, pickup date/time, items, headcount, status, total price, notes. Use for questions about catering orders, upcoming pickups, order details, or catering revenue.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start of date range YYYY-MM-DD" },
          end_date: { type: "string", description: "End of date range YYYY-MM-DD" },
          status: { type: "string", description: "Filter by status: 'pending', 'completed', 'cancelled'" },
          customer_name: { type: "string", description: "Filter by customer name (partial match)" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_availability",
      description: "Query time-off and availability requests. Shows who requested off, dates, status (pending/approved/denied), type (time_off/availability_change), and reviewer info. Use for questions about who has time off, pending requests, coverage gaps, or upcoming absences.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start of date range YYYY-MM-DD" },
          end_date: { type: "string", description: "End of date range YYYY-MM-DD" },
          status: { type: "string", description: "Filter by status: 'pending', 'approved', 'denied'" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
        },
        required: ["location_id"],
      },
    },
  },
  // === NEW TOOLS ===
  {
    type: "function",
    function: {
      name: "query_tips",
      description: "Query daily tip data (credit card tips and cash tips) for a date range. Use for questions about tips, tip trends, tip totals.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_certifications",
      description: "Query employee certifications (food handler, ServSafe, etc.) including expiration dates and approval status. Use for 'whose cert is expiring', 'who has food handler', compliance questions.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location (used to filter employees at this location)" },
          cert_type: { type: "string", description: "Filter by certification type (partial match)" },
          status: { type: "string", description: "Filter by status: 'pending', 'approved', 'expired'" },
          expiring_within_days: { type: "number", description: "Find certs expiring within this many days" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_shift_marketplace",
      description: "Query shift offers (shift marketplace / shift swap requests). Shows who posted, who claimed, shift details. Use for shift swap and marketplace questions.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          status: { type: "string", description: "Filter: 'open', 'claimed', 'approved', 'cancelled'" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_store_hours",
      description: "Query location operating hours for each day of the week. Use for questions about when the store opens/closes, business hours.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_employee_notes",
      description: "Query employee notes/write-ups. Use for questions about employee history, notes, write-ups, disciplinary records.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location (to filter employees)" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_ovation_reviews",
      description: "Query OvationUp guest reviews and feedback scores for this location. Returns recent reviews with ratings, customer names, feedback text, and whether the review was responded to. Returns a ready summary object (window_start, window_end, review_count, average_rating) for exactly the window asked — quote it, never recount. Use for questions about guest reviews, customer feedback, Ovation scores, review trends, or guest satisfaction. When a review mentions an employee by name, cross-reference with team members at the location and tag matches with [[employee:Full Name]].",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Window start YYYY-MM-DD (store date). For 'this week' use this week's Monday." },
          end_date: { type: "string", description: "Window end YYYY-MM-DD (defaults to today)" },
          days: { type: "number", description: "Used only when start_date is not given: number of days back including today (default 7)" },
          min_rating: { type: "number", description: "Filter reviews with rating >= this value" },
          max_rating: { type: "number", description: "Filter reviews with rating <= this value" },
          search_keyword: { type: "string", description: "Search feedback text for a keyword" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_resource_content",
      description: "Fetch and extract the full content of an OPUS training resource (PDF/document). Use this when the user selects a specific resource from the search results list and wants to see its full content. This downloads the actual document and extracts text from it.",
      parameters: {
        type: "object",
        properties: {
          resource_name: { type: "string", description: "The exact title of the OPUS resource to extract content from" },
          location_id: { type: "string", description: "UUID of the location" },
        },
        required: ["resource_name", "location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_my_chats",
      description: "Search the user's own chat conversations (DMs, group chats, announcements) for messages matching a keyword or from a specific person. Only returns chats the current user is a member of. Use for questions like 'what did someone say in chat', 'find the message about X', 'what was discussed about Y'.",
      parameters: {
        type: "object",
        properties: {
          search_keyword: { type: "string", description: "Keyword to search in message content (partial match)" },
          sender_name: { type: "string", description: "Filter messages by sender's name (partial match)" },
          chat_title: { type: "string", description: "Filter by chat/group name (partial match)" },
          days_back: { type: "number", description: "How many days back to search (default 14, max 90)" },
          limit: { type: "number", description: "Max messages to return (default 20, max 50)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_callout_patterns",
      description: "Detect callouts (scheduled but didn't show), find replacement workers, and calculate dollar impact. Use for questions about who missed shifts, who covered them, repeat no-show offenders, attendance reliability, and the cost of absenteeism. Cross-references published schedule against actual punches and approved time-off requests.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "Location UUID" },
          start_date: { type: "string", description: "ISO date YYYY-MM-DD" },
          end_date: { type: "string", description: "ISO date YYYY-MM-DD (defaults to start_date)" },
          employee_name: { type: "string", description: "Optional partial name filter" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_punch_patterns",
      description: "USE FOR ANY 'late', 'tardy' or 'on time' question. Returns, per person per day, scheduled start, first clock-in, minutes late and a ready late: true/false flag (7-minute grace applied), plus late_count. Also analyzes scheduled-vs-actual punch behavior over time. Detects employees who clock in early, clock out late, work without being scheduled, or get auto-punched out (forgot to clock out). Calculates 'stolen' labor minutes and dollar impact. Use for time theft, punch abuse, payroll integrity, and attendance discipline questions.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "Location UUID" },
          start_date: { type: "string", description: "ISO date YYYY-MM-DD" },
          end_date: { type: "string", description: "ISO date YYYY-MM-DD (defaults to start_date)" },
          pattern_type: { type: "string", enum: ["early_in", "late_out", "no_schedule", "auto_punch", "all"], description: "Filter to a single pattern (default 'all')" },
          employee_name: { type: "string", description: "Optional partial name filter" },
          threshold_minutes: { type: "number", description: "Minimum variance in minutes to count as a pattern (default 7)" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_crew_performance",
      description: "Identify which crew compositions (groups of employees working together) drive the best — or worst — operational outcomes. Correlates who was clocked in during a shift block (AM/PM) with sales, labor %, SPLH, and checklist completion over a date range. Use for cross-domain questions like 'which team crushes Saturday nights', 'who works best together', 'which crew runs the cleanest shift'.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "Location UUID" },
          start_date: { type: "string", description: "ISO date YYYY-MM-DD" },
          end_date: { type: "string", description: "ISO date YYYY-MM-DD" },
          shift_block: { type: "string", enum: ["am", "pm", "all"], description: "AM = before 14:00, PM = 14:00 onward (default 'all')" },
          min_occurrences: { type: "number", description: "Only include crews that worked together this many times (default 2)" },
          day_of_week: { type: "number", description: "Optional: filter to a single day of week (0=Sun..6=Sat)" },
        },
        required: ["location_id", "start_date", "end_date"],
      },
    },
  },
];

// TEMPORARY (bake-off actions dry-run only): never offered on normal requests, writes nothing.
const PROPOSE_ACTION_TOOL = {
  type: "function",
  function: {
    name: "propose_action",
    description: "Propose an action for the manager to confirm. Only call after resolving people and shifts with the read tools (use employee_id from query_schedule). If anything needed is missing (e.g. shift times), ask instead of proposing. Only these four actions exist.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_task", "create_shift", "swap_shifts", "create_checklist"] },
        employees: { type: "array", items: { type: "object", properties: { employee_id: { type: "string" }, name: { type: "string" } } }, description: "People involved (one for create_shift, two for swap_shifts)" },
        date: { type: "string", description: "Calendar date YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:MM 24h" },
        end_time: { type: "string", description: "HH:MM 24h" },
        task_title: { type: "string" },
        due_time: { type: "string", description: "HH:MM 24h" },
        checklist_title: { type: "string" },
        lock_time: { type: "string", description: "HH:MM 24h" },
        items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, input_type: { type: "string", description: "e.g. photo_temperature, checkbox, text, number" } } } },
        shifts: { type: "array", items: { type: "object", properties: { employee_id: { type: "string" }, date: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" } } }, description: "For swap_shifts: the two current shifts being swapped" },
      },
      required: ["action"],
    },
  },
};

// query_inventory is parked (not offered to the model) — see THEO_INVENTORY.md. Code kept for later.
const THEO_TOOLS = tools.filter((t: any) => t.function?.name !== "query_inventory");

// ---- THEO HANDS (build 1): real proposals, super admin + voice only. Never writes. ----
const TASK_ROLES: Record<string, string> = {
  team_member: "Team Member", shift_manager_in_training: "Shift Manager in Training", shift_manager: "Shift Manager",
  manager: "Manager", admin: "Admin", org_admin: "Org Admin", brand_admin: "Brand Admin",
};
const TASK_DURATIONS = ["1h", "3h", "1d", "3d", "1w", "1m", "none"];
const FIND_CREW_TOOL = {
  type: "function",
  function: {
    name: "find_crew",
    description: "Look up ACTIVE crew members at this store by name (first name, nickname or full name). Returns every match with employee_id. Always use this to resolve a person before proposing a task for them.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
};
const PROPOSE_TASK_TOOL = {
  type: "function",
  function: {
    name: "propose_action",
    description: "Show the manager a PREVIEW of a change: create_task (a standard quick task) or cover_shift (give one shift to another person). Saves nothing — only the manager's tap on Create task saves it. Call only when you have a title AND at least one person (employee_id from find_crew) or role. Also call it again with the full revised task when the manager changes a preview that is on screen.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_task", "cover_shift"] },
        shift_id: { type: "string", description: "cover_shift only: shift_id from find_shifts" },
        replacement_employee_id: { type: "string", description: "cover_shift only: employee_id (from find_crew) of the person taking the shift" },
        title: { type: "string", description: "Short task title. Keep any time the manager said and write it with AM/PM, e.g. 'by 3' becomes 'Wipe down the patio tables by 3 PM'." },
        employee_ids: { type: "array", items: { type: "string" }, description: "employee_id values from find_crew" },
        roles: { type: "array", items: { type: "string", enum: Object.keys(TASK_ROLES) }, description: "Only roles the manager named out loud (e.g. 'the shift managers'). Never use team_member for 'everyone', 'all', 'the crew' or 'the team' — for those, do not call this tool; ask who it's for." },
        duration: { type: "string", enum: TASK_DURATIONS, description: "How long it stays up: 1h, 3h, 1d, 3d, 1w, 1m, none (= Until Complete, the default)" },
      },
      required: ["action"],
    },
  },
};
// Task-only version for people who have create_task but not cover_shift.
const PROPOSE_TASK_ONLY_TOOL = {
  type: "function",
  function: {
    name: "propose_action",
    description: "Show the manager a PREVIEW of a standard quick task. Saves nothing — only the manager's tap on Create task saves it. Call only when you have a title AND at least one person (employee_id from find_crew) or role. Also call it again with the full revised task when the manager changes a preview that is on screen.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_task"] },
        title: PROPOSE_TASK_TOOL.function.parameters.properties.title,
        employee_ids: PROPOSE_TASK_TOOL.function.parameters.properties.employee_ids,
        roles: PROPOSE_TASK_TOOL.function.parameters.properties.roles,
        duration: PROPOSE_TASK_TOOL.function.parameters.properties.duration,
      },
      required: ["action"],
    },
  },
};
const FIND_SHIFTS_TOOL = {
  type: "function",
  function: {
    name: "find_shifts",
    description: "Cover a shift, step 1. With a name: that person's shifts on the date (default today). With no name: the store's remaining shifts today, shown on screen to tap. Returns status, shift_id(s) and a 'next' instruction to follow exactly.",
    parameters: { type: "object", properties: { name: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD; omit for today" } } },
  },
};
const COVER_CANDIDATES_TOOL = {
  type: "function",
  function: {
    name: "cover_candidates",
    description: "Cover a shift, step 2: the app's ranked list of who can take this shift (shown on screen). Saves nothing.",
    parameters: { type: "object", properties: { shift_id: { type: "string" } }, required: ["shift_id"] },
  },
};
const CANCEL_PENDING_TOOL = {
  type: "function",
  function: {
    name: "cancel_pending_action",
    description: "The manager wants to drop the preview (task or cover) that is on screen (e.g. 'never mind', 'cancel', 'forget it').",
    parameters: { type: "object", properties: {} },
  },
};

async function activeCrewAt(admin: any, locationId: string): Promise<{ id: string; full_name: string; nickname: string | null }[]> {
  const { data: ul } = await admin.from("user_locations").select("user_id").eq("location_id", locationId);
  const ids = (ul || []).map((r: any) => r.user_id);
  if (!ids.length) return [];
  const { data } = await admin.from("profiles").select("id, full_name, nickname").in("id", ids).eq("is_active", true);
  return data || [];
}

const crewName = (p: { full_name: string; nickname: string | null }) => {
  const parts = (p.full_name || "").trim().split(/\s+/);
  return p.nickname?.trim() && parts.length > 1 ? [p.nickname.trim(), ...parts.slice(1)].join(" ") : (p.nickname?.trim() || p.full_name);
};

function validateTaskProposal(args: any, crew: { id: string; full_name: string; nickname: string | null }[]): { ok: true; proposal: any } | { ok: false; error: string } {
  if (args?.action !== "create_task") return { ok: false, error: "Only create_task exists." };
  const title = typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
  if (!title) return { ok: false, error: "No task title. Ask the manager what the task is." };
  const ids: string[] = Array.isArray(args.employee_ids) ? [...new Set(args.employee_ids.filter((x: any) => typeof x === "string"))] as string[] : [];
  const roles: string[] = Array.isArray(args.roles) ? [...new Set(args.roles.filter((x: any) => typeof x === "string"))] as string[] : [];
  const byId = new Map(crew.map((c) => [c.id, c]));
  const badId = ids.find((id) => !byId.has(id));
  if (badId) return { ok: false, error: `employee_id ${badId} is not an active crew member at this store. Use find_crew, or ask the manager who they meant.` };
  const badRole = roles.find((r) => !TASK_ROLES[r]);
  if (badRole) return { ok: false, error: `${badRole} is not a real role.` };
  if (!ids.length && !roles.length) return { ok: false, error: "Nobody assigned. Ask the manager who it's for (a person or a role)." };
  const duration = TASK_DURATIONS.includes(args.duration) ? args.duration : "none";
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(),
      action: "create_task",
      title,
      employees: ids.map((id) => ({ id, name: crewName(byId.get(id)!) })),
      roles,
      duration,
    },
  };
}

// Execute tool calls against the database
const MANAGER_PLUS_ROLES = ["manager", "general_manager", "admin", "org_admin", "brand_admin", "super_admin"];

async function executeTool(supabase: any, toolName: string, args: any, timezone: string, userId?: string, userRole?: string, ctx: { userClient?: any; today?: string; exposeIds?: boolean } = {}): Promise<string> {
  const storeToday = ctx.today || new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const offset = getTzOffset(timezone);
  // Per-person wage/cost data is manager+ only.
  const canSeeWages = MANAGER_PLUS_ROLES.includes(userRole || "");
  try {
    // Only when a specific store is requested: the caller must have access to it.
    // Tools without a location (org-wide, admin queries) are never refused here.
    if (args?.location_id && userId) {
      const { data: hasAccess, error: accessErr } = await supabase.rpc("has_location_access", {
        _user_id: userId,
        _location_id: args.location_id,
      });
      if (accessErr || hasAccess !== true) {
        return JSON.stringify({ error: "You don't have access to that location." });
      }
    }
    switch (toolName) {
      case "query_sales": {
        const endDate = args.end_date || args.start_date;
        const { data, error } = await supabase
          .from("sales_cache")
          .select("sale_date, net_sales, guest_count, pizza_count, avg_ticket, projected_sales, living_projection, override_projection, initial_projection, pace_adjusted_projection, hourly_data, product_mix")
          .eq("location_id", args.location_id)
          .gte("sale_date", args.start_date)
          .lte("sale_date", endDate)
          .order("sale_date");
        if (error) {
          console.error("query_sales error:", error);
          return JSON.stringify({ error: error.message });
        }

        const results = (data || []).map((row: any) => {
          const projection = row.override_projection || row.living_projection || row.initial_projection || row.projected_sales;
          const r: any = {
            date: row.sale_date,
            net_sales: row.net_sales,
            guest_count: row.guest_count,
            pizza_count: row.pizza_count,
            avg_ticket: row.avg_ticket,
            projection,
          };
          // Sanity flag for suspiciously low projections on future dates
          if (projection > 0 && projection < 500 && row.net_sales === 0) {
            r._warning = "This projection looks suspiciously low — may be a stale override or data error.";
          }
          if (row.sale_date === storeToday) {
            const sold = Number(row.net_sales) || 0;
            const goal = rowGoal(row);
            const pace = sold >= 100 ? todayPaceOf(row) : null;
            const st = paceStatus(sold, pace, goal);
            r.goal = goal;
            r.pace = st ? Math.round(pace!) : null;
            r.pace_vs_goal_pct = st ? st.pct : null;
            r.pace_status = st ? st.status : "pace not available yet";
            if (st) r.pace_gap = Math.round(pace! - goal);
          } else if (row.sale_date < storeToday) {
            r.goal = rowGoal(row);
          }
          if (args.include_hourly && row.hourly_data) r.hourly = row.hourly_data;
          return r;
        });

        // Aggregate product mix across all days in the range
        if (args.include_product_mix) {
          let workingData = data || [];
          
          // Detect days missing product mix and backfill from QU API
          const missingMixDates = workingData
            .filter((row: any) => !row.product_mix || !Array.isArray(row.product_mix) || (row.product_mix as any[]).length === 0)
            .map((row: any) => row.sale_date as string);
          
          if (missingMixDates.length > 0 && missingMixDates.length <= 31) {
            console.log(`[ai-assistant] Backfilling p-mix for ${missingMixDates.length} dates via sales-service`);
            try {
              const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
              const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
              const syncResp = await fetch(`${supabaseUrl}/functions/v1/sales-service?action=sync-dates`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
                body: JSON.stringify({ locationId: args.location_id, dates: missingMixDates }),
              });
              if (syncResp.ok) {
                console.log(`[ai-assistant] P-mix backfill complete, re-querying cache`);
                // Re-query cache to get the freshly synced data
                const { data: freshData } = await supabase
                  .from("sales_cache")
                  .select("sale_date, net_sales, guest_count, pizza_count, avg_ticket, projected_sales, living_projection, override_projection, initial_projection, hourly_data, product_mix")
                  .eq("location_id", args.location_id)
                  .gte("sale_date", args.start_date)
                  .lte("sale_date", endDate)
                  .order("sale_date");
                if (freshData) workingData = freshData;
              } else {
                console.error(`[ai-assistant] P-mix backfill failed: ${syncResp.status}`);
              }
            } catch (backfillErr) {
              console.error(`[ai-assistant] P-mix backfill error:`, backfillErr);
            }
          }
          
          const mixMap: Record<string, { quantity: number; sales: number }> = {};
          let daysWithMix = 0;
          for (const row of workingData) {
            if (row.product_mix && Array.isArray(row.product_mix) && (row.product_mix as any[]).length > 0) daysWithMix++;
            if (row.product_mix && Array.isArray(row.product_mix)) {
              for (const item of row.product_mix as any[]) {
                const name = item.itemName || item.name || item.item_name || 'Unknown';
                const qty = Number(item.quantity || item.qty || item.count || 0);
                const sales = Number(item.netSales || item.sales || item.net_sales || 0);
                if (!mixMap[name]) mixMap[name] = { quantity: 0, sales: 0 };
                mixMap[name].quantity += qty;
                mixMap[name].sales += sales;
              }
            }
          }
          const aggregatedMix = Object.entries(mixMap)
            .map(([name, d]) => ({ name, quantity: d.quantity, net_sales: Math.round(d.sales * 100) / 100, price_zero: d.sales === 0 }))
            // Same order as the dashboard's "Top 20 Products by Sales": net sales, highest first, no filter.
            .sort((a, b) => b.net_sales - a.net_sales)
            .map((it, i) => ({ rank: i + 1, ...it }));
          
          const totalDays = workingData.length;
          const mixNote = daysWithMix < totalDays 
            ? `Note: Product mix data is only available for ${daysWithMix} of ${totalDays} days in this range. Totals may be incomplete.` 
            : undefined;

          if (aggregatedMix.length > 0) {
            return JSON.stringify({
              summary: results.length > 1 ? {
                total_net_sales: results.reduce((s: number, r: any) => s + (r.net_sales || 0), 0),
                total_guests: results.reduce((s: number, r: any) => s + (r.guest_count || 0), 0),
                days: totalDays,
                days_with_product_mix: daysWithMix,
                date_range: `${args.start_date} to ${endDate}`,
              } : undefined,
              daily: results.length <= 7 ? results : undefined,
              product_mix_ranking: "Ranked by net sales, highest first — same as the dashboard's Top 20 Products by Sales. price_zero items are free add-ons/modifiers.",
              product_mix: aggregatedMix.slice(0, 50),
              product_mix_note: mixNote,
            });
          }
        }

        return JSON.stringify(results.length ? results : { message: "No sales data found for this date range." });
      }

      case "query_labor": {
        const endDate = args.end_date || args.start_date;
        // Day totals (hours, cost, net sales, labor %) come ONLY from get_store_labor,
        // called as the signed-in user. Never total labor_cache rows; never fall back.
        const result: any = {};
        const { rows: storeRows, error: storeErr } = ctx.userClient
          ? await fetchStoreLaborRows(ctx.userClient, args.location_id, args.start_date, endDate)
          : { rows: null, error: "no user client" };
        if (storeErr || !storeRows) {
          result.labor_summary = LABOR_UNAVAILABLE;
        } else {
          result.labor_summary = laborByDay(storeRows, args.start_date, endDate);
          // Per-employee breakdown (manager+ only) may still come from labor_cache, but only
          // from the row whose source matches the one get_store_labor used for that day.
          if (canSeeWages) {
            const srcByDate: Record<string, string> = {};
            storeRows.forEach((r: any) => { srcByDate[String(r.date).slice(0, 10)] = r.source; });
            const { data: bd } = await supabase
              .from("labor_cache")
              .select("labor_date, source, employee_breakdown")
              .eq("location_id", args.location_id)
              .gte("labor_date", args.start_date)
              .lte("labor_date", endDate);
            const byDate: Record<string, any> = {};
            (bd || []).forEach((row: any) => {
              if (srcByDate[row.labor_date] && row.source === srcByDate[row.labor_date] && row.employee_breakdown) byDate[row.labor_date] = row.employee_breakdown;
            });
            result.labor_summary = result.labor_summary.map((d: any) => byDate[d.date] ? { ...d, employee_breakdown: byDate[d.date] } : d);
          }
        }

        if (args.include_punches) {
          const win = await rangeWindow(supabase, args.location_id, args.start_date, endDate);
          const startTs = win?.start_at || `${args.start_date}T00:00:00${offset}`;
          const endTs = win?.end_at || `${addDays(endDate, 1)}T00:00:00${offset}`;
          result.business_day_window = win;
          const { data: punches, error: punchError } = await supabase
            .from("time_punches")
            .select("user_id, punch_type, punch_time, notes, profiles!time_punches_user_id_fkey(full_name)")
            .eq("location_id", args.location_id)
            .gte("punch_time", startTs)
            .lte("punch_time", endTs)
            .order("punch_time");

          if (punchError) {
            console.error("query_labor punches error:", punchError);
            result.punches_error = punchError.message;
          } else {
            let punchResults = (punches || []).map((p: any) => {
              // Convert UTC punch_time to local timezone for accurate display
              const utcDate = new Date(p.punch_time);
              const localTime = utcDate.toLocaleString("en-US", { 
                timeZone: timezone, 
                hour: "numeric", 
                minute: "2-digit", 
                hour12: true 
              });
              const localDate = utcDate.toLocaleDateString("en-CA", { timeZone: timezone });
              return {
                name: p.profiles?.full_name,
                type: p.punch_type,
                time: localTime,
                date: localDate,
                notes: p.notes,
              };
            });
            if (args.employee_name) {
              const q = args.employee_name.toLowerCase();
              punchResults = punchResults.filter((p: any) => p.name?.toLowerCase().includes(q));
            }
            result.punches = punchResults;
          }
        }

        return JSON.stringify(result);
      }

      case "query_schedule": {
        const endDate = args.end_date || args.start_date;
        const { data, error } = await supabase
          .from("scheduled_shifts")
          .select("shift_date, start_time, end_time, is_time_off, user_id, template_id, schedule_id, schedules!inner(location_id, week_start_date, week_end_date, is_published), shift_templates(position, template_name)")
          .eq("schedules.location_id", args.location_id)
          .eq("schedules.is_published", true)
          .gte("shift_date", args.start_date)
          .lte("shift_date", endDate)
          .not("user_id", "is", null)
          .order("shift_date")
          .order("start_time");
        
        if (error) {
          console.error("query_schedule error:", error);
          return JSON.stringify({ error: error.message });
        }

        const userIds = Array.from(new Set((data || []).map((s: any) => s.user_id).filter(Boolean)));
        let profileMap: Record<string, string> = {};

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          profileMap = (profiles || []).reduce((acc: Record<string, string>, p: any) => {
            acc[p.id] = p.full_name;
            return acc;
          }, {});
        }

        let results = (data || []).map((s: any) => ({
          date: s.shift_date,
          name: profileMap[s.user_id] || "Unknown",
          ...(ctx.exposeIds ? { employee_id: s.user_id } : {}),
          start: s.start_time,
          end: s.end_time,
          position: s.shift_templates?.position || s.shift_templates?.template_name || null,
          time_off: s.is_time_off,
        }));

        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          results = results.filter((s: any) => s.name?.toLowerCase().includes(q));
        }
        if (results.length) return JSON.stringify(results);
        if ((data || []).length === 0) {
          // Is there any published schedule covering this range at all?
          const { data: pub } = await supabase
            .from("schedules").select("id").eq("location_id", args.location_id).eq("is_published", true)
            .gte("week_end_date", args.start_date).lte("week_start_date", endDate).limit(1);
          if (!pub || pub.length === 0) {
            const marker: any = { no_published_schedule: true, message: "There's no published schedule for that week." };
            if (MANAGER_PLUS_ROLES.includes(userRole || "")) {
              const { count } = await supabase
                .from("scheduled_shifts")
                .select("id, schedules!inner(location_id, is_published)", { count: "exact", head: true })
                .eq("schedules.location_id", args.location_id)
                .eq("schedules.is_published", false)
                .gte("shift_date", args.start_date)
                .lte("shift_date", endDate)
                .not("user_id", "is", null);
              marker.draft_shifts = count || 0;
              marker.draft_note = "Draft shifts are not the schedule — only mention the count, never list them as who is working.";
            }
            return JSON.stringify(marker);
          }
        }
        return JSON.stringify({ message: "No scheduled shifts found for this date range on the published schedule." });
      }

      case "query_checklists": {
        const cWin = await dayWindow(supabase, args.location_id, args.date);
        const startTs = cWin?.start_at || `${args.date}T00:00:00${offset}`;
        const endTs = cWin?.end_at || `${addDays(args.date, 1)}T00:00:00${offset}`;

        const { data, error } = await supabase
          .from("checklist_submissions")
          .select(`
            submitted_at, submitted_by, 
            profiles!checklist_submissions_submitted_by_fkey(full_name), 
            checklists(title),
            checklist_responses(
              item_id, response_text, response_image_url, created_at,
              extracted_temperature, temperature_valid, completed_by,
              checklist_items(question, item_type, requires_temperature_validation)
            )
          `)
          .eq("location_id", args.location_id)
          .gte("submitted_at", startTs)
          .lte("submitted_at", endTs);

        if (error) {
          console.error("query_checklists error:", error);
          return JSON.stringify({ error: error.message });
        }

        const completedByIds = new Set<string>();
        (data || []).forEach((s: any) => {
          s.checklist_responses?.forEach((r: any) => {
            if (r.completed_by) completedByIds.add(r.completed_by);
          });
        });
        
        let profileMap: Record<string, string> = {};
        if (completedByIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", Array.from(completedByIds));
          (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
        }

        let results = (data || []).map((s: any) => {
          const base: any = {
            checklist: s.checklists?.title,
            submitted_by: s.profiles?.full_name,
            submitted_at: s.submitted_at,
            business_date: args.date,
            responses_count: s.checklist_responses?.length || 0,
          };

          if (s.checklist_responses) {
            let responses = s.checklist_responses.map((r: any) => ({
              question: r.checklist_items?.question,
              item_type: r.checklist_items?.item_type,
              answer: r.response_text,
              temperature: r.extracted_temperature,
              temp_valid: r.temperature_valid,
              completed_by: r.completed_by ? profileMap[r.completed_by] || r.completed_by : s.profiles?.full_name,
              completed_at: r.created_at || s.submitted_at,
              has_photo: !!r.response_image_url,
            }));

            if (args.item_keyword) {
              const rawKeyword = String(args.item_keyword).toLowerCase().trim();
              const stopWords = new Set(["the", "a", "an", "to", "for", "of", "on", "in", "at", "did", "does", "do", "is", "are", "was", "were", "who", "what", "when", "where", "how", "today", "yesterday"]);
              const keywordTokens = Array.from(new Set(
                rawKeyword
                  .replace(/[^a-z0-9\s-]/g, " ")
                  .split(/\s+/)
                  .filter((t) => t.length >= 3 && !stopWords.has(t))
              ));

              responses = responses.filter((r: any) => {
                const haystack = `${r.question || ""} ${r.answer || ""}`.toLowerCase();
                if (!haystack) return false;
                if (rawKeyword && haystack.includes(rawKeyword)) return true;
                if (keywordTokens.length === 0) return false;
                return keywordTokens.some((token) => haystack.includes(token));
              });
            }
            base.responses = responses;
          }
          return base;
        });

        if (args.checklist_title) {
          const q = args.checklist_title.toLowerCase();
          results = results.filter((r: any) => r.checklist?.toLowerCase().includes(q));
        }
        return JSON.stringify(results.length ? results : { message: "No checklist submissions found for this date." });
      }

      case "query_logbook": {
        let catFilter: string[] = [];
        if (args.category_name) {
          const { data: cats } = await supabase
            .from("logbook_categories")
            .select("id, name")
            .eq("location_id", args.location_id)
            .eq("is_active", true)
            .ilike("name", `%${args.category_name}%`);
          catFilter = (cats || []).map((c: any) => c.id);
          if (catFilter.length === 0) {
            return JSON.stringify({ message: `No logbook category matching "${args.category_name}" found.` });
          }
        }

        let query = supabase
          .from("logbook_entries")
          .select(`
            id, entry_date, created_at, category_id,
            logbook_categories(name),
            profiles(full_name),
            logbook_entry_values(field_id, value_text, value_number, logbook_fields(field_name, field_type))
          `)
          .eq("location_id", args.location_id)
          .eq("entry_date", args.date)
          .order("created_at", { ascending: false });

        if (catFilter.length > 0) {
          query = query.in("category_id", catFilter);
        }

        const { data: entries, error: logError } = await query.limit(50);
        if (logError) {
          console.error("query_logbook error:", logError);
          return JSON.stringify({ error: logError.message });
        }

        const results = (entries || []).map((e: any) => {
          const entry: any = {
            category: e.logbook_categories?.name,
            submitted_by: e.profiles?.full_name,
            submitted_at: e.created_at,
          };

          const values: any[] = [];
          (e.logbook_entry_values || []).forEach((v: any) => {
            const fieldName = v.logbook_fields?.field_name || "value";
            const fieldType = v.logbook_fields?.field_type;
            
            if (v.value_text) {
              try {
                const parsed = JSON.parse(v.value_text);
                values.push({ field: fieldName, type: fieldType, data: parsed });
              } catch {
                values.push({ field: fieldName, type: fieldType, text: v.value_text });
              }
            } else if (v.value_number !== null && v.value_number !== undefined) {
              values.push({ field: fieldName, type: fieldType, number: v.value_number });
            }
          });

          if (values.length > 0) entry.details = values;

          if (args.entry_keyword) {
            const kw = args.entry_keyword.toLowerCase();
            const searchText = JSON.stringify(entry).toLowerCase();
            if (!searchText.includes(kw)) return null;
          }

          return entry;
        }).filter(Boolean);

        return JSON.stringify(results.length ? results : { message: "No logbook entries found for this date." });
      }

      case "query_tasks": {
        const activeOnly = args.active_only !== false;
        let query = supabase
          .from("temporary_tasks")
          .select("id, title, description, icon_name, accent_color, created_at, expires_at, completed_at, completed_by, is_active, is_recurring, frequency_type, task_style, show_on_dashboard, alarm_start_time, alarm_end_time, profiles!temporary_tasks_created_by_fkey(full_name)")
          .eq("location_id", args.location_id);

        if (activeOnly) query = query.eq("is_active", true);
        if (args.task_title) query = query.ilike("title", `%${args.task_title}%`);

        const { data: tasks, error: taskError } = await query.order("created_at", { ascending: false }).limit(50);
        if (taskError) {
          console.error("query_tasks error:", taskError);
          return JSON.stringify({ error: taskError.message });
        }

        const includeSubtasks = args.include_subtasks !== false;
        const taskIds = (tasks || []).map((t: any) => t.id);

        let subtaskMap: Record<string, any[]> = {};
        let completionMap: Record<string, any[]> = {};

        if (includeSubtasks && taskIds.length > 0) {
          const { data: subtasks } = await supabase
            .from("temporary_task_subtasks")
            .select("id, task_id, title, order_index, completed_at, completed_by, item_type, days_of_week")
            .in("task_id", taskIds)
            .order("order_index");

          (subtasks || []).forEach((st: any) => {
            if (!subtaskMap[st.task_id]) subtaskMap[st.task_id] = [];
            subtaskMap[st.task_id].push(st);
          });

          const targetDate = args.date || storeToday;
          const tWin = await dayWindow(supabase, args.location_id, targetDate);
          const { data: completions } = await supabase
            .from("task_subtask_completions")
            .select("subtask_id, task_id, completed_by, completed_date, completed_at")
            .in("task_id", taskIds)
            .eq("completed_date", targetDate);
          
          (completions || []).forEach((c: any) => {
            if (!completionMap[c.task_id]) completionMap[c.task_id] = [];
            completionMap[c.task_id].push(c);
          });

          const { data: alarmCompletions } = await supabase
            .from("alarm_task_completions")
            .select("task_id, completed_by, completed_at, interval_key, profiles!alarm_task_completions_completed_by_fkey(full_name)")
            .in("task_id", taskIds)
            .gte("completed_at", tWin?.start_at || `${targetDate}T00:00:00${offset}`)
            .lt("completed_at", tWin?.end_at || `${addDays(targetDate, 1)}T00:00:00${offset}`);

          (alarmCompletions || []).forEach((c: any) => {
            if (!completionMap[c.task_id]) completionMap[c.task_id] = [];
            completionMap[c.task_id].push({ ...c, type: "alarm", completed_by_name: c.profiles?.full_name });
          });
        }

        const allCompletedByIds = new Set<string>();
        Object.values(subtaskMap).flat().forEach((st: any) => { if (st.completed_by) allCompletedByIds.add(st.completed_by); });
        Object.values(completionMap).flat().forEach((c: any) => { if (c.completed_by) allCompletedByIds.add(c.completed_by); });
        (tasks || []).forEach((t: any) => { if (t.completed_by) allCompletedByIds.add(t.completed_by); });

        let profileMap: Record<string, string> = {};
        if (allCompletedByIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", Array.from(allCompletedByIds));
          (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
        }

        const results = (tasks || []).map((t: any) => {
          const task: any = {
            title: t.title,
            description: t.description,
            style: t.task_style,
            is_recurring: t.is_recurring,
            frequency: t.frequency_type,
            created_by: t.profiles?.full_name,
            completed: !!t.completed_at,
            completed_by: t.completed_by ? profileMap[t.completed_by] : null,
          };

          if (t.alarm_start_time) {
            task.alarm_window = `${t.alarm_start_time} - ${t.alarm_end_time}`;
          }

          if (includeSubtasks && subtaskMap[t.id]) {
            const todayCompletions = completionMap[t.id] || [];
            task.subtasks = subtaskMap[t.id].map((st: any) => {
              const todayDone = todayCompletions.find((c: any) => c.subtask_id === st.id);
              return {
                title: st.title,
                type: st.item_type,
                completed: !!st.completed_at || !!todayDone,
                completed_by: todayDone?.completed_by_name || (todayDone?.completed_by ? profileMap[todayDone.completed_by] : null) || (st.completed_by ? profileMap[st.completed_by] : null),
              };
            });
            task.total_subtasks = task.subtasks.length;
            task.completed_subtasks = task.subtasks.filter((s: any) => s.completed).length;
          }

          if (completionMap[t.id]?.some((c: any) => c.type === "alarm")) {
            task.alarm_completions = completionMap[t.id]
              .filter((c: any) => c.type === "alarm")
              .map((c: any) => ({
                interval: c.interval_key,
                completed_by: c.completed_by_name || profileMap[c.completed_by],
                completed_at: c.completed_at,
              }));
          }

          return task;
        });

        return JSON.stringify(results.length ? results : { message: "No tasks found." });
      }

      case "query_labor_intelligence": {
        let query = supabase
          .from("labor_insights")
          .select("insight_date, analysis, created_at")
          .eq("location_id", args.location_id)
          .order("insight_date", { ascending: false })
          .limit(5);

        if (args.date) {
          query = supabase
            .from("labor_insights")
            .select("insight_date, analysis, created_at")
            .eq("location_id", args.location_id)
            .eq("insight_date", args.date)
            .limit(1);
        }

        const { data, error } = await query;
        if (error) {
          console.error("query_labor_intelligence error:", error);
          return JSON.stringify({ error: error.message });
        }

        const results = (data || []).map((r: any) => ({
          date: r.insight_date,
          ...r.analysis,
          generated_at: r.created_at,
        }));
        return JSON.stringify(results.length ? results : { message: "No labor intelligence reports found." });
      }

      case "query_inventory": {
        // If calculate_cogs is requested, compute full COGS formula
        if (args.calculate_cogs) {
          // Find the two most recent completed weekly counts for this location
          const { data: recentCounts } = await supabase
            .from("inventory_counts")
            .select("id, period_type, period_end_date, status, counted_at, completed_at, profiles!inventory_counts_counted_by_fkey(full_name)")
            .eq("location_id", args.location_id)
            .eq("status", "completed")
            .eq("period_type", "weekly")
            .order("period_end_date", { ascending: false })
            .limit(2);

          if (!recentCounts || recentCounts.length < 2) {
            return JSON.stringify({ message: "Need at least 2 completed weekly inventory counts to calculate COGS. Currently have " + (recentCounts?.length || 0) + "." });
          }

          const endingCount = recentCounts[0];
          const beginningCount = recentCounts[1];

          const [beginItemsRes, endItemsRes] = await Promise.all([
            supabase.from("inventory_count_items").select("item_id, quantity, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, entered_cases, entered_units, entered_inner_packs").eq("count_id", beginningCount.id),
            supabase.from("inventory_count_items").select("item_id, quantity, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, entered_cases, entered_units, entered_inner_packs").eq("count_id", endingCount.id),
          ]);

          // Collect all item_ids referenced in either count (matches UI logic in PeriodDetailPanel.tsx)
          // CRITICAL: do NOT filter by is_active — deactivated items still need to be valued
          const referencedIds = new Set<string>();
          for (const ci of (beginItemsRes.data || [])) referencedIds.add(ci.item_id);
          for (const ci of (endItemsRes.data || [])) referencedIds.add(ci.item_id);

          const { data: invItems } = await supabase
            .from("inventory_items")
            .select("id, name, cost_per_unit, pack_quantity, pack_quantity_override, inner_pack_quantity, count_units_per_case, brand_item_id, is_recipe, unit, recipe_yield_qty, recipe_yield_unit")
            .in("id", Array.from(referencedIds));

          const itemMap = new Map((invItems || []).map((i: any) => [i.id, i]));

          // Pipeline 1 conversion fallback: resolve brand and load active conversions
          const { data: locRow } = await supabase
            .from("locations").select("organization_id").eq("id", args.location_id).maybeSingle();
          const { data: orgRow } = locRow?.organization_id
            ? await supabase.from("organizations").select("brand_id").eq("id", locRow.organization_id).maybeSingle()
            : { data: null };
          const brandIdForConv = orgRow?.brand_id || null;
          const conversionMap = new Map<string, any>();
          if (brandIdForConv) {
            const { data: convs } = await supabase
              .from("item_conversions")
              .select("brand_template_id, outer_qty, canonical_qty_per_inner")
              .eq("brand_id", brandIdForConv)
              .is("effective_to", null);
            for (const c of convs || []) conversionMap.set(c.brand_template_id, c);
          }

          // PHASE 1: forceLiveData=true (recompute via live data; ignore snapshots).
          const getCountItemLineValue = (ci: any) => {
            const item: any = itemMap.get(ci.item_id);
            const conversion = item?.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
            return calculateCountItemValue(ci, item, conversion, true);
          };

          let beginValue = 0;
          for (const ci of (beginItemsRes.data || [])) {
            beginValue += getCountItemLineValue(ci);
          }
          let endValue = 0;
          for (const ci of (endItemsRes.data || [])) {
            endValue += getCountItemLineValue(ci);
          }

          const weekStartDate = beginningCount.period_end_date;
          const weekEndDate = endingCount.period_end_date;

          const [pfgRes, paRes] = await Promise.all([
            supabase.from("pfg_orders").select("total_amount, delivery_date").eq("location_id", args.location_id)
              .gte("delivery_date", weekStartDate).lte("delivery_date", weekEndDate),
            supabase.from("pa_orders").select("total_amount, delivery_date").eq("location_id", args.location_id)
              .gte("delivery_date", weekStartDate).lte("delivery_date", weekEndDate),
          ]);

          const purchasesCost = [...(pfgRes.data || []), ...(paRes.data || [])].reduce((s: number, o: any) => s + (Number(o.total_amount) || 0), 0);

          const { data: salesRows } = await supabase
            .from("sales_cache")
            .select("net_sales")
            .eq("location_id", args.location_id)
            .gte("sale_date", weekStartDate)
            .lte("sale_date", weekEndDate);

          const totalSales = (salesRows || []).reduce((s: number, r: any) => s + (Number(r.net_sales) || 0), 0);

          const actualUsage = beginValue + purchasesCost - endValue;
          const cogsPercent = totalSales > 0 ? (actualUsage / totalSales) * 100 : 0;

          return JSON.stringify({
            cogs_report: {
              period: `${weekStartDate} to ${weekEndDate}`,
              beginning_inventory: Math.round(beginValue * 100) / 100,
              beginning_count_date: beginningCount.period_end_date,
              beginning_counted_by: beginningCount.profiles?.full_name,
              purchases: Math.round(purchasesCost * 100) / 100,
              pfg_orders: (pfgRes.data || []).length,
              pa_orders: (paRes.data || []).length,
              ending_inventory: Math.round(endValue * 100) / 100,
              ending_count_date: endingCount.period_end_date,
              ending_counted_by: endingCount.profiles?.full_name,
              actual_usage: Math.round(actualUsage * 100) / 100,
              net_sales: Math.round(totalSales * 100) / 100,
              cogs_percent: Math.round(cogsPercent * 10) / 10,
              target_range: "21-22%",
            }
          });
        }

        // Standard inventory query (non-COGS)
        let countQuery = supabase
          .from("inventory_counts")
          .select("id, period_type, period_end_date, status, count_date, counted_at, completed_at, is_late_close, duration_seconds, notes, profiles!inventory_counts_counted_by_fkey(full_name)")
          .eq("location_id", args.location_id)
          .order("period_end_date", { ascending: false })
          .limit(10);

        if (args.period_end_date) countQuery = countQuery.eq("period_end_date", args.period_end_date);
        if (args.status) countQuery = countQuery.eq("status", args.status);

        const { data: counts, error: countError } = await countQuery;
        if (countError) {
          console.error("query_inventory error:", countError);
          return JSON.stringify({ error: countError.message });
        }

        const results = [];
        for (const count of (counts || [])) {
          const period: any = {
            period_type: count.period_type,
            period_end_date: count.period_end_date,
            status: count.status,
            counted_by: count.profiles?.full_name,
            counted_at: count.counted_at,
            is_late_close: count.is_late_close,
            duration_minutes: count.duration_seconds ? Math.round(count.duration_seconds / 60) : null,
          };

          if (args.include_items) {
            const { data: items } = await supabase
              .from("inventory_count_items")
              .select("quantity, entered_cases, entered_units, entered_inner_packs, theoretical_quantity, variance, variance_cost, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, inventory_items(product_name, common_name, category, cost_per_case, cost_per_unit, pack_quantity, pack_quantity_override, inner_pack_quantity, is_recipe, unit, recipe_yield_qty, recipe_yield_unit)")
              .eq("count_id", count.id);

            let itemResults = (items || []).map((i: any) => {
              // Single source of truth — see src/utils/countItemValue.ts (mirrored at top of this file)
              // PHASE 1: forceLiveData=true (recompute via live data; ignore snapshots).
              const totalCost = calculateCountItemValue(i, i.inventory_items, null, true);

              return {
                name: i.inventory_items?.common_name || i.inventory_items?.product_name,
                category: i.inventory_items?.category,
                quantity: i.quantity,
                cases: i.entered_cases,
                units: i.entered_units,
                cost_per_case: i.inventory_items?.cost_per_case,
                total_cost: i.quantity ? Number(totalCost.toFixed(2)) : null,
                variance: i.variance,
                variance_cost: i.variance_cost,
              };
            });

            if (args.item_keyword) {
              const kw = args.item_keyword.toLowerCase();
              itemResults = itemResults.filter((i: any) => 
                (i.name || "").toLowerCase().includes(kw) || (i.category || "").toLowerCase().includes(kw)
              );
            }

            period.items = itemResults;
            period.total_items = itemResults.length;
            period.total_value = Number(itemResults.reduce((sum: number, i: any) => sum + (i.total_cost || 0), 0).toFixed(2));
          }

          results.push(period);
        }

        return JSON.stringify(results.length ? results : { message: "No inventory counts found." });
      }

      case "query_catering": {
        const endDate = args.end_date || args.start_date;
        let query = supabase
          .from("catering_orders")
          .select("customer_name, pickup_date, pickup_time, status, items, headcount, total_price, notes, order_number, vendor, contact_phone, source_url, completed_at, profiles!catering_orders_created_by_fkey(full_name)")
          .eq("location_id", args.location_id)
          .gte("pickup_date", args.start_date)
          .lte("pickup_date", endDate)
          .order("pickup_date")
          .order("pickup_time");

        if (args.status) query = query.eq("status", args.status);

        const { data, error } = await query;
        if (error) {
          console.error("query_catering error:", error);
          return JSON.stringify({ error: error.message });
        }

        let results = (data || []).map((o: any) => ({
          customer: o.customer_name,
          pickup_date: o.pickup_date,
          pickup_time: o.pickup_time,
          status: o.status,
          headcount: o.headcount,
          total_price: o.total_price,
          items: o.items,
          notes: o.notes,
          order_number: o.order_number,
          vendor: o.vendor,
          contact_phone: o.contact_phone,
          created_by: o.profiles?.full_name,
        }));

        if (args.customer_name) {
          const q = args.customer_name.toLowerCase();
          results = results.filter((o: any) => o.customer?.toLowerCase().includes(q));
        }

        return JSON.stringify(results.length ? results : { message: "No catering orders found for this date range." });
      }

      case "query_availability": {
        let query = supabase
          .from("availability_requests")
          .select("request_type, time_scope, start_date, end_date, start_time, end_time, hours_requested, status, notes, denial_reason, created_at, reviewed_at, profiles!availability_requests_user_id_fkey(full_name), reviewer:profiles!availability_requests_reviewed_by_fkey(full_name)", { count: "exact" })
          .eq("location_id", args.location_id)
          .order("start_date", { ascending: true });

        if (args.start_date) query = query.gte("start_date", args.start_date);
        if (args.end_date) query = query.lte("start_date", args.end_date);
        if (args.status) query = query.eq("status", args.status);

        const { data, error, count: matchCount } = await query.limit(50);
        if (error) {
          console.error("query_availability error:", error);
          return JSON.stringify({ error: error.message });
        }

        let results = (data || []).map((r: any) => ({
          employee: r.profiles?.full_name,
          type: r.request_type,
          scope: r.time_scope,
          start_date: r.start_date,
          end_date: r.end_date,
          start_time: r.start_time,
          end_time: r.end_time,
          hours: r.hours_requested,
          status: r.status,
          notes: r.notes,
          denial_reason: r.denial_reason,
          requested_at: r.created_at,
          reviewed_by: r.reviewer?.full_name,
          reviewed_at: r.reviewed_at,
        }));

        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          results = results.filter((r: any) => r.employee?.toLowerCase().includes(q));
        }

        const { data: pend } = await supabase.from("availability_requests").select("start_date, end_date").eq("location_id", args.location_id).eq("status", "pending");
        const pendRows = pend || [];
        const pendingUpcoming = pendRows.filter((r: any) => (r.end_date || r.start_date) >= storeToday).length;
        const total = args.employee_name ? results.length : (matchCount ?? results.length);
        return JSON.stringify({
          pending_total: pendRows.length,
          pending_upcoming: pendingUpcoming,
          pending_past_dated: pendRows.length - pendingUpcoming,
          counts_note: "pending_* counts are for the whole store, all dates. Quote these counts; do not count the list.",
          showing: `showing ${results.length} of ${total}`,
          requests: results,
          message: results.length ? undefined : "No availability/time-off requests found for that filter.",
        });
      }

      // === NEW TOOL IMPLEMENTATIONS ===

      case "query_tips": {
        const endDate = args.end_date || args.start_date;
        const { data, error } = await supabase
          .from("daily_tips")
          .select("tip_date, total_cc_tips, total_cash_tips, fetched_at")
          .eq("location_id", args.location_id)
          .gte("tip_date", args.start_date)
          .lte("tip_date", endDate)
          .order("tip_date");
        
        if (error) return JSON.stringify({ error: error.message });
        
        const results = (data || []).map((r: any) => ({
          date: r.tip_date,
          cc_tips: r.total_cc_tips,
          cash_tips: r.total_cash_tips,
          total_tips: (r.total_cc_tips || 0) + (r.total_cash_tips || 0),
        }));
        return JSON.stringify(results.length ? results : { message: "No tip data found for this date range." });
      }

      case "query_certifications": {
        // Get user IDs at this location
        const { data: locUsers } = await supabase
          .from("user_locations")
          .select("user_id")
          .eq("location_id", args.location_id);
        
        const userIds = (locUsers || []).map((u: any) => u.user_id);
        if (userIds.length === 0) return JSON.stringify({ message: "No employees at this location." });

        let query = supabase
          .from("certifications")
          .select("certification_type, expiration_date, status, approved_at, created_at, profiles!certifications_user_id_fkey(full_name)")
          .in("user_id", userIds)
          .order("expiration_date");

        if (args.cert_type) query = query.ilike("certification_type", `%${args.cert_type}%`);
        if (args.status) query = query.eq("status", args.status);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });

        let results = (data || []).map((c: any) => ({
          employee: c.profiles?.full_name,
          type: c.certification_type,
          expires: c.expiration_date,
          status: c.status,
        }));

        if (args.expiring_within_days) {
          const cutoffStr = addDays(storeToday, Number(args.expiring_within_days) || 0);
          results = results.filter((c: any) => c.expires && c.expires <= cutoffStr);
        }

        return JSON.stringify(results.length ? results : { message: "No certifications found." });
      }

      case "query_shift_marketplace": {
        let query = supabase
          .from("shift_offers")
          .select("id, shift_date, start_time, end_time, status, reason, croo_cash_reward, created_at, profiles!shift_offers_offered_by_fkey(full_name), claimer:profiles!shift_offers_claimed_by_fkey(full_name)")
          .eq("location_id", args.location_id)
          .order("shift_date");

        if (args.start_date) query = query.gte("shift_date", args.start_date);
        if (args.end_date) query = query.lte("shift_date", args.end_date);
        if (args.status) query = query.eq("status", args.status);

        const { data, error } = await query.limit(50);
        if (error) return JSON.stringify({ error: error.message });

        const results = (data || []).map((s: any) => ({
          date: s.shift_date,
          start: s.start_time,
          end: s.end_time,
          status: s.status,
          offered_by: s.profiles?.full_name,
          claimed_by: s.claimer?.full_name,
          reason: s.reason,
          croo_cash_reward: s.croo_cash_reward,
        }));
        return JSON.stringify(results.length ? results : { message: "No shift marketplace offers found." });
      }

      case "query_store_hours": {
        const { data, error } = await supabase
          .from("location_hours")
          .select("day_of_week, open_time, close_time, is_closed")
          .eq("location_id", args.location_id)
          .order("day_of_week");
        
        if (error) return JSON.stringify({ error: error.message });

        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const results = (data || []).map((h: any) => ({
          day: dayNames[h.day_of_week] || h.day_of_week,
          open: h.is_closed ? "CLOSED" : h.open_time,
          close: h.is_closed ? "CLOSED" : h.close_time,
        }));
        return JSON.stringify(results.length ? results : { message: "No store hours configured." });
      }

      case "query_employee_notes": {
        // Get user IDs at this location
        const { data: locUsers } = await supabase
          .from("user_locations")
          .select("user_id")
          .eq("location_id", args.location_id);
        
        const userIds = (locUsers || []).map((u: any) => u.user_id);
        if (userIds.length === 0) return JSON.stringify({ message: "No employees at this location." });

        let query = supabase
          .from("employee_notes")
          .select("note, created_at, profiles!employee_notes_user_id_fkey(full_name), creator:profiles!employee_notes_created_by_fkey(full_name)")
          .in("user_id", userIds)
          .order("created_at", { ascending: false })
          .limit(50);

        const { data, error } = await query;
        if (error) return JSON.stringify({ error: error.message });

        let results = (data || []).map((n: any) => ({
          employee: n.profiles?.full_name,
          note: n.note,
          created_by: n.creator?.full_name,
          created_at: n.created_at,
        }));

        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          results = results.filter((n: any) => n.employee?.toLowerCase().includes(q));
        }

        return JSON.stringify(results.length ? results : { message: "No employee notes found." });
      }

      case "query_ovation_reviews": {
        // Fetch reviews via the ovation-service edge function
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
        const tzToday = ctx.today || new Date().toLocaleDateString("en-CA", { timeZone: timezone });
        const winEnd: string = args.end_date || tzToday;
        const winStart: string = args.start_date || addDays(winEnd, -((args.days || 7) - 1));
        const days = Math.max(1, Math.round((Date.parse(tzToday + "T12:00:00Z") - Date.parse(winStart + "T12:00:00Z")) / 86400000) + 2);
        
        try {
          const ovationResp = await fetch(`${supabaseUrl}/functions/v1/ovation-service?action=fetch_reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
            body: JSON.stringify({ locationId: args.location_id, days, pageSize: 500 }),
          });
          
          if (!ovationResp.ok) {
            return JSON.stringify({ message: "OvationUp is not configured for this location." });
          }
          
          const ovationData = await ovationResp.json();
          
          if (ovationData.error || !ovationData.reviews) {
            return JSON.stringify({ message: ovationData.error || "No OvationUp data available for this location." });
          }
          
          // Keep only reviews whose STORE-LOCAL date is inside the asked window.
          let reviews = (ovationData.reviews || []).filter((r: any) => {
            if (!r.createdAt) return false;
            const d = localDate(r.createdAt, timezone);
            return d >= winStart && d <= winEnd;
          });
          const rated = reviews.filter((r: any) => typeof r.rating === "number");
          const summary = {
            window_start: winStart,
            window_end: winEnd,
            review_count: reviews.length,
            average_rating: rated.length ? Math.round((rated.reduce((a: number, r: any) => a + r.rating, 0) / rated.length) * 100) / 100 : null,
            note: "Quote review_count and average_rating from here. Do not recount the reviews list.",
          };
          
          // Apply filters
          if (args.min_rating) {
            reviews = reviews.filter((r: any) => r.rating >= args.min_rating);
          }
          if (args.max_rating) {
            reviews = reviews.filter((r: any) => r.rating <= args.max_rating);
          }
          if (args.search_keyword) {
            const kw = args.search_keyword.toLowerCase();
            reviews = reviews.filter((r: any) => r.feedback?.toLowerCase().includes(kw));
          }
          
          // Fetch team members at this location to match names in reviews
          const { data: teamProfiles } = await supabase
            .from("user_locations")
            .select("profiles!inner(id, full_name)")
            .eq("location_id", args.location_id);
          
          const teamMembers = (teamProfiles || []).map((tp: any) => ({
            id: tp.profiles.id,
            name: tp.profiles.full_name,
          })).filter((t: any) => t.name);
          
          // Cross-reference reviews with team members — only match against active employees, NOT customer names
          const enrichedReviews = reviews.map((r: any) => {
            const matched: string[] = [];
            if (r.feedback) {
              const feedbackLower = r.feedback.toLowerCase();
              const customerNameLower = (r.customer_name || "").toLowerCase();
              for (const member of teamMembers) {
                const nameParts = member.name.toLowerCase().split(/\s+/);
                const firstName = nameParts[0];
                // Skip if the employee first name matches the customer name (it's the reviewer, not a team member mention)
                if (firstName && customerNameLower.includes(firstName)) continue;
                // Match first name (3+ chars) in feedback text
                if (firstName && firstName.length >= 3 && feedbackLower.includes(firstName)) {
                  matched.push(member.name);
                }
              }
            }
            return {
              ...r,
              matched_employees: matched.length > 0 ? matched : undefined,
            };
          });
          
          const shown = enrichedReviews.slice(0, 25);
          const result: any = {
            summary,
            filtered_count: (args.min_rating || args.max_rating || args.search_keyword) ? enrichedReviews.length : undefined,
            showing: `showing ${shown.length} of ${enrichedReviews.length}`,
            reviews: shown,
          };
          
          if (enrichedReviews.some((r: any) => r.matched_employees)) {
            result.employee_matching_note = "Reviews with matched_employees contain team member names found in the feedback. When presenting these reviews, tag matched employees with [[employee:Full Name]] format so they appear as badges in the chat.";
          }
          
          return JSON.stringify(result);
        } catch (e: any) {
          console.error("query_ovation_reviews error:", e);
          return JSON.stringify({ message: "Could not fetch OvationUp reviews. Integration may not be configured." });
        }
      }

      case "fetch_resource_content": {
        const { resource_name, location_id: resLocId } = args;
        // Call the opus-service edge function to extract content
        const opusResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/opus-service`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "fetch_resource_content",
            location_id: resLocId,
            resource_name,
          }),
        });
        const opusData = await opusResp.json();
        if (opusData.error) {
          return JSON.stringify({ error: opusData.error });
        }
        // Extract just the content after [EXTRACTED CONTENT] if present
        const fullContent = opusData.content || "";
        const extractedIdx = fullContent.indexOf("[EXTRACTED CONTENT]");
        if (extractedIdx >= 0) {
          return JSON.stringify({ 
            resource: resource_name,
            content: fullContent.substring(extractedIdx + "[EXTRACTED CONTENT]".length).trim()
          });
        }
        return JSON.stringify({ 
          resource: resource_name,
          content: opusData.already_extracted ? "Content already extracted but no [EXTRACTED CONTENT] marker found." : "Content extraction was triggered. The document may take a moment to process.",
          raw: fullContent.substring(0, 500)
        });
      }

      case "query_my_chats": {
        if (!userId) return JSON.stringify({ error: "User not authenticated" });
        
        const daysBack = Math.min(args.days_back || 14, 90);
        const maxResults = Math.min(args.limit || 20, 50);
        const cutoffDate = new Date(Date.now() - daysBack * 86400000).toISOString();

        // Step 1: Get chat IDs user is a member of
        const { data: memberships, error: memErr } = await supabase
          .from("chat_members")
          .select("chat_id")
          .eq("user_id", userId);
        
        if (memErr) return JSON.stringify({ error: memErr.message });
        if (!memberships || memberships.length === 0) return JSON.stringify({ message: "You're not a member of any chats." });

        const chatIds = memberships.map((m: any) => m.chat_id);

        // Step 2: Optionally filter by chat title
        let filteredChatIds = chatIds;
        if (args.chat_title) {
          const { data: matchingChats } = await supabase
            .from("chats")
            .select("id, title")
            .in("id", chatIds)
            .ilike("title", `%${args.chat_title}%`);
          if (matchingChats && matchingChats.length > 0) {
            filteredChatIds = matchingChats.map((c: any) => c.id);
          } else {
            return JSON.stringify({ message: `No chats found matching "${args.chat_title}".` });
          }
        }

        // Step 3: Query messages
        let query = supabase
          .from("messages")
          .select("id, content, created_at, chat_id, sender_id, profiles:sender_id(full_name), chats:chat_id(title, is_group, is_announcement)")
          .in("chat_id", filteredChatIds)
          .gte("created_at", cutoffDate)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(maxResults);

        if (args.search_keyword) {
          query = query.ilike("content", `%${args.search_keyword}%`);
        }

        const { data: msgs, error: msgErr } = await query;
        if (msgErr) return JSON.stringify({ error: msgErr.message });
        if (!msgs || msgs.length === 0) return JSON.stringify({ message: "No matching messages found." });

        // Step 4: Filter by sender name if specified
        let results = msgs.map((m: any) => ({
          sender: m.profiles?.full_name || "Unknown",
          chat: m.chats?.title || (m.chats?.is_announcement ? "Announcement" : "DM"),
          content: m.content,
          time: new Date(m.created_at).toLocaleString("en-US", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }),
        }));

        if (args.sender_name) {
          const q = args.sender_name.toLowerCase();
          results = results.filter((r: any) => r.sender.toLowerCase().includes(q));
          if (results.length === 0) return JSON.stringify({ message: `No messages found from "${args.sender_name}".` });
        }

        return JSON.stringify({ messages: results, total: results.length });
      }

      case "query_callout_patterns": {
        const endDate = args.end_date || args.start_date;

        const { data: schedules } = await supabase
          .from("schedules")
          .select("id")
          .eq("location_id", args.location_id)
          .eq("is_published", true)
          .gte("week_end_date", args.start_date)
          .lte("week_start_date", endDate);
        const scheduleIds = (schedules || []).map((s: any) => s.id);
        if (scheduleIds.length === 0) {
          return JSON.stringify({ message: "No published schedules in this date range." });
        }

        const { data: shifts, error: sErr } = await supabase
          .from("scheduled_shifts")
          .select("id, user_id, shift_date, start_time, end_time, is_time_off")
          .in("schedule_id", scheduleIds)
          .gte("shift_date", args.start_date)
          .lte("shift_date", endDate)
          .eq("is_time_off", false);
        if (sErr) return JSON.stringify({ error: sErr.message });

        const coWin = await rangeWindow(supabase, args.location_id, args.start_date, endDate);
        if (!coWin) return JSON.stringify({ error: "Couldn't work out the store's business day for those dates." });
        const { data: punches } = await supabase
          .from("time_punches")
          .select("user_id, shift_id, punch_type, punch_time")
          .eq("location_id", args.location_id)
          .gte("punch_time", coWin.start_at)
          .lt("punch_time", coWin.end_at);

        // Resolve names in one batch
        const userIdSet = new Set<string>();
        (shifts || []).forEach((s: any) => userIdSet.add(s.user_id));
        (punches || []).forEach((p: any) => userIdSet.add(p.user_id));
        const { data: profileRows } = userIdSet.size > 0
          ? await supabase.from("profiles").select("id, full_name").in("id", Array.from(userIdSet))
          : { data: [] as any[] };
        const nameMap: Record<string, string> = {};
        (profileRows || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });

        const { data: timeOffs } = await supabase
          .from("availability_requests")
          .select("user_id, start_date, end_date, request_type")
          .eq("location_id", args.location_id)
          .eq("status", "approved")
          .lte("start_date", endDate)
          .gte("end_date", args.start_date);

        const { data: laborRows } = canSeeWages
          ? await supabase
              .from("labor_cache")
              .select("labor_date, employee_breakdown")
              .eq("location_id", args.location_id)
              .gte("labor_date", args.start_date)
              .lte("labor_date", endDate)
          : { data: [] as any[] };
        const wageMap: Record<string, number> = {};
        (laborRows || []).forEach((row: any) => {
          (row.employee_breakdown || []).forEach((e: any) => {
            if (e.user_id && e.wage) wageMap[e.user_id] = Number(e.wage);
          });
        });

        const userPunchedForShift = (userId: string, shiftDate: string, startTime: string) => {
          const shiftStart = localToUtcMs(shiftDate, startTime, timezone);
          return (punches || []).some((p: any) => {
            if (p.user_id !== userId || p.punch_type !== "clock_in") return false;
            const pTime = new Date(p.punch_time).getTime();
            return Math.abs(pTime - shiftStart) <= 90 * 60 * 1000;
          });
        };
        const userOnApprovedTimeOff = (userId: string, shiftDate: string) =>
          (timeOffs || []).some((t: any) =>
            t.user_id === userId && t.start_date <= shiftDate && t.end_date >= shiftDate
          );

        const callouts: any[] = [];
        for (const shift of shifts || []) {
          if (userPunchedForShift(shift.user_id, shift.shift_date, shift.start_time)) continue;
          if (userOnApprovedTimeOff(shift.user_id, shift.shift_date)) continue;

          const shiftStart = localToUtcMs(shift.shift_date, shift.start_time, timezone);
          const scheduledUserIdsToday = (shifts || [])
            .filter((s: any) => s.shift_date === shift.shift_date)
            .map((s: any) => s.user_id);
          const replacementPunch = (punches || []).find((p: any) => {
            if (p.punch_type !== "clock_in") return false;
            if (scheduledUserIdsToday.includes(p.user_id)) return false;
            const pTime = new Date(p.punch_time).getTime();
            return Math.abs(pTime - shiftStart) <= 2 * 60 * 60 * 1000;
          });

          const startMs = localToUtcMs(shift.shift_date, shift.start_time, timezone);
          let endMs = localToUtcMs(shift.shift_date, shift.end_time, timezone);
          if (endMs < startMs) endMs += 86400000;
          const hours = Math.max(0, (endMs - startMs) / 3600000);
          const wage = replacementPunch ? (wageMap[replacementPunch.user_id] || 0) : 0;
          const cost = hours * wage;

          callouts.push({
            date: shift.shift_date,
            employee: nameMap[shift.user_id] || "Unknown",
            scheduled_start: shift.start_time,
            scheduled_end: shift.end_time,
            replacement: replacementPunch ? (nameMap[replacementPunch.user_id] || "Unknown") : null,
            replacement_cost_estimate: Math.round(cost * 100) / 100,
          });
        }

        let filtered = callouts;
        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          filtered = callouts.filter((c) => c.employee.toLowerCase().includes(q));
        }

        const byEmployee: Record<string, any> = {};
        filtered.forEach((c) => {
          if (!byEmployee[c.employee]) byEmployee[c.employee] = { name: c.employee, callouts: 0, cost_impact: 0, dates: [] };
          byEmployee[c.employee].callouts++;
          byEmployee[c.employee].cost_impact += c.replacement_cost_estimate;
          byEmployee[c.employee].dates.push(c.date);
        });
        const ranked = Object.values(byEmployee).sort((a: any, b: any) => b.callouts - a.callouts);

        return JSON.stringify({
          business_day_window: coWin,
          total_scheduled_shifts: shifts?.length || 0,
          total_callouts: filtered.length,
          callout_rate_pct: shifts?.length ? Math.round((filtered.length / shifts.length) * 1000) / 10 : 0,
          total_dollar_impact: Math.round(filtered.reduce((s, c) => s + c.replacement_cost_estimate, 0) * 100) / 100,
          by_employee: ranked,
          callouts: filtered.slice(0, 50),
        });
      }

      case "query_punch_patterns": {
        const endDate = args.end_date || args.start_date;
        const threshold = (args.threshold_minutes || 7) * 60 * 1000;
        const patternFilter = args.pattern_type || "all";

        const ppWins = await windowsFor(supabase, args.location_id, args.start_date, endDate);
        const ppWin = await rangeWindow(supabase, args.location_id, args.start_date, endDate);
        if (!ppWin) return JSON.stringify({ error: "Couldn't work out the store's business day for those dates." });
        const bizDate = (iso: string) => businessDateOf(iso, ppWins, timezone);
        const { data: punches, error: pErr } = await supabase
          .from("time_punches")
          .select("user_id, shift_id, punch_type, punch_time, is_auto_punched_out")
          .eq("location_id", args.location_id)
          .gte("punch_time", ppWin.start_at)
          .lt("punch_time", ppWin.end_at)
          .order("punch_time");
        if (pErr) return JSON.stringify({ error: pErr.message });

        const { data: schedules } = await supabase
          .from("schedules")
          .select("id")
          .eq("location_id", args.location_id)
          .eq("is_published", true)
          .gte("week_end_date", args.start_date)
          .lte("week_start_date", endDate);
        const scheduleIds = (schedules || []).map((s: any) => s.id);
        const shiftsRes = scheduleIds.length > 0
          ? await supabase
              .from("scheduled_shifts")
              .select("id, user_id, shift_date, start_time, end_time, is_time_off")
              .in("schedule_id", scheduleIds)
              .gte("shift_date", args.start_date)
              .lte("shift_date", endDate)
              .eq("is_time_off", false)
          : { data: [] as any[] };
        const shifts = shiftsRes.data || [];

        const { data: laborRows } = canSeeWages
          ? await supabase
              .from("labor_cache")
              .select("employee_breakdown")
              .eq("location_id", args.location_id)
              .gte("labor_date", args.start_date)
              .lte("labor_date", endDate)
          : { data: [] as any[] };
        const wageMap: Record<string, number> = {};
        (laborRows || []).forEach((row: any) => {
          (row.employee_breakdown || []).forEach((e: any) => {
            if (e.user_id && e.wage) wageMap[e.user_id] = Number(e.wage);
          });
        });

        const userIdSet2 = new Set<string>();
        (punches || []).forEach((p: any) => userIdSet2.add(p.user_id));
        const { data: profileRows2 } = userIdSet2.size > 0
          ? await supabase.from("profiles").select("id, full_name").in("id", Array.from(userIdSet2))
          : { data: [] as any[] };
        const nameMap: Record<string, string> = {};
        (profileRows2 || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });

        const shiftPunches: Record<string, any> = {};
        (punches || []).forEach((p: any) => {
          const key = p.shift_id || `${p.user_id}-${bizDate(p.punch_time)}`;
          if (!shiftPunches[key]) shiftPunches[key] = { user_id: p.user_id, name: nameMap[p.user_id] || "Unknown", in: null, out: null, auto: false };
          if (p.punch_type === "clock_in" && !shiftPunches[key].in) shiftPunches[key].in = p.punch_time;
          if (p.punch_type === "clock_out") {
            shiftPunches[key].out = p.punch_time;
            if (p.is_auto_punched_out) shiftPunches[key].auto = true;
          }
        });

        const findScheduled = (userId: string, punchInIso: string | null) => {
          if (!punchInIso) return null;
          const date = bizDate(punchInIso);
          const punchMs = new Date(punchInIso).getTime();
          let best: any = null;
          let bestDiff = Infinity;
          shifts.forEach((s: any) => {
            if (s.user_id !== userId || s.shift_date !== date) return;
            const schedMs = localToUtcMs(s.shift_date, s.start_time, timezone);
            const diff = Math.abs(schedMs - punchMs);
            if (diff < bestDiff && diff <= 4 * 60 * 60 * 1000) {
              bestDiff = diff;
              best = s;
            }
          });
          return best;
        };

        const findings: any[] = [];
        const arrivals: any[] = [];
        const graceMin = args.threshold_minutes || 7;
        Object.values(shiftPunches).forEach((sp: any) => {
          const sched = findScheduled(sp.user_id, sp.in);
          if (sched && sp.in) {
            const lateMin = Math.round((new Date(sp.in).getTime() - localToUtcMs(sched.shift_date, sched.start_time, timezone)) / 60000);
            arrivals.push({ employee: sp.name, date: sched.shift_date, scheduled_start: String(sched.start_time).slice(0, 5), first_clock_in: sp.in, minutes_late: Math.max(0, lateMin), late: lateMin > graceMin });
          }

          if (sp.auto && (patternFilter === "all" || patternFilter === "auto_punch")) {
            findings.push({ type: "auto_punch", employee: sp.name, date: (sp.in || sp.out) ? bizDate(sp.in || sp.out) : null, detail: "Forgot to clock out — system auto-punched" });
          }

          if (!sched && sp.in && (patternFilter === "all" || patternFilter === "no_schedule")) {
            findings.push({ type: "no_schedule", employee: sp.name, date: bizDate(sp.in), detail: "Worked without being on the schedule" });
            return;
          }

          if (sched && sp.in && (patternFilter === "all" || patternFilter === "early_in")) {
            const schedMs = localToUtcMs(sched.shift_date, sched.start_time, timezone);
            const inMs = new Date(sp.in).getTime();
            const earlyMs = schedMs - inMs;
            if (earlyMs > threshold) {
              const minutes = Math.round(earlyMs / 60000);
              const wage = wageMap[sp.user_id] || 0;
              const cost = (minutes / 60) * wage;
              findings.push({ type: "early_in", employee: sp.name, date: sched.shift_date, minutes_early: minutes, cost_impact: Math.round(cost * 100) / 100 });
            }
          }

          if (sched && sp.out && (patternFilter === "all" || patternFilter === "late_out")) {
            let schedMs = localToUtcMs(sched.shift_date, sched.end_time, timezone);
            if (sched.end_time < sched.start_time) schedMs += 86400000;
            const outMs = new Date(sp.out).getTime();
            const lateMs = outMs - schedMs;
            if (lateMs > threshold) {
              const minutes = Math.round(lateMs / 60000);
              const wage = wageMap[sp.user_id] || 0;
              const cost = (minutes / 60) * wage;
              findings.push({ type: "late_out", employee: sp.name, date: sched.shift_date, minutes_late: minutes, cost_impact: Math.round(cost * 100) / 100 });
            }
          }
        });

        let filtered = findings;
        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          filtered = findings.filter((f) => (f.employee || "").toLowerCase().includes(q));
        }

        const byEmployee: Record<string, any> = {};
        filtered.forEach((f) => {
          if (!byEmployee[f.employee]) byEmployee[f.employee] = { name: f.employee, total: 0, early_in: 0, late_out: 0, no_schedule: 0, auto_punch: 0, cost_impact: 0 };
          byEmployee[f.employee].total++;
          byEmployee[f.employee][f.type]++;
          if (f.cost_impact) byEmployee[f.employee].cost_impact += f.cost_impact;
        });
        const ranked = Object.values(byEmployee).sort((a: any, b: any) => b.total - a.total);
        let arr = arrivals.sort((a, b) => (a.date + a.scheduled_start).localeCompare(b.date + b.scheduled_start));
        if (args.employee_name) { const q = args.employee_name.toLowerCase(); arr = arr.filter((a) => (a.employee || "").toLowerCase().includes(q)); }
        const lateCount = arr.filter((a) => a.late).length;

        return JSON.stringify({
          lateness: {
            grace_minutes: graceMin,
            shifts_checked: arr.length,
            late_count: lateCount,
            summary: lateCount === 0 ? "Nobody was late." : `${lateCount} late arrival${lateCount === 1 ? "" : "s"}.`,
            arrivals: arr.slice(0, 150),
          },
          business_day_window: ppWin,
          total_findings: filtered.length,
          total_dollar_impact: Math.round(filtered.reduce((s, f) => s + (f.cost_impact || 0), 0) * 100) / 100,
          by_employee: ranked,
          findings: filtered.slice(0, 100),
        });
      }

      case "query_crew_performance": {
        const minOccurrences = args.min_occurrences || 2;
        const shiftBlock = args.shift_block || "all";

        const cpWins = await windowsFor(supabase, args.location_id, args.start_date, args.end_date);
        const cpWin = await rangeWindow(supabase, args.location_id, args.start_date, args.end_date);
        if (!cpWin) return JSON.stringify({ error: "Couldn't work out the store's business day for those dates." });
        const { data: punches, error: pErr } = await supabase
          .from("time_punches")
          .select("user_id, punch_type, punch_time")
          .eq("location_id", args.location_id)
          .gte("punch_time", cpWin.start_at)
          .lt("punch_time", cpWin.end_at)
          .order("punch_time");
        if (pErr) return JSON.stringify({ error: pErr.message });

        const { data: salesRows } = await supabase
          .from("sales_cache")
          .select("sale_date, net_sales, hourly_data")
          .eq("location_id", args.location_id)
          .gte("sale_date", args.start_date)
          .lte("sale_date", args.end_date);

        // Day labor totals ONLY from get_store_labor (signed-in user). Never labor_cache.
        const { rows: crewLaborRows, error: crewLaborErr } = ctx.userClient
          ? await fetchStoreLaborRows(ctx.userClient, args.location_id, args.start_date, args.end_date)
          : { rows: null, error: "no user client" };
        if (crewLaborErr || !crewLaborRows) return JSON.stringify(LABOR_UNAVAILABLE);
        const laborRows = crewLaborRows.map((r: any) => ({ labor_date: String(r.date).slice(0, 10), labor_cost: Number(r.cost) || 0, labor_hours: Number(r.hours) || 0 }));

        const salesMap: Record<string, any> = {};
        (salesRows || []).forEach((r: any) => salesMap[r.sale_date] = r);
        const laborMap: Record<string, any> = {};
        (laborRows || []).forEach((r: any) => laborMap[r.labor_date] = r);

        const userIdSet3 = new Set<string>();
        (punches || []).forEach((p: any) => userIdSet3.add(p.user_id));
        const { data: profileRows3 } = userIdSet3.size > 0
          ? await supabase.from("profiles").select("id, full_name").in("id", Array.from(userIdSet3))
          : { data: [] as any[] };
        const nameMap: Record<string, string> = {};
        (profileRows3 || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });

        const dayBlockCrew: Record<string, Set<string>> = {};
        (punches || []).forEach((p: any) => {
          if (p.punch_type !== "clock_in") return;
          const date = businessDateOf(p.punch_time, cpWins, timezone);
          const hour = localHour(p.punch_time, timezone);
          const block = hour < 14 ? "am" : "pm";
          if (shiftBlock !== "all" && block !== shiftBlock) return;
          if (args.day_of_week !== undefined && args.day_of_week !== null) {
            const dow = new Date(`${date}T12:00:00`).getDay();
            if (dow !== args.day_of_week) return;
          }
          const key = `${date}|${block}`;
          if (!dayBlockCrew[key]) dayBlockCrew[key] = new Set();
          dayBlockCrew[key].add(p.user_id);
        });

        const dayBlockOutcome = (date: string, block: string) => {
          const sales = salesMap[date];
          const labor = laborMap[date];
          let blockSales = 0;
          let blockLaborCost = 0;
          let blockLaborHours = 0;

          if (sales?.hourly_data && Array.isArray(sales.hourly_data)) {
            sales.hourly_data.forEach((h: any) => {
              const hour = h.hour;
              if (block === "am" && hour < 14) blockSales += Number(h.sales || 0);
              if (block === "pm" && hour >= 14) blockSales += Number(h.sales || 0);
            });
          }
          if (labor?.labor_cost) {
            blockLaborCost = Number(labor.labor_cost) * 0.5;
            blockLaborHours = Number(labor.labor_hours || 0) * 0.5;
          }
          if (blockSales === 0 && sales?.net_sales) {
            blockSales = Number(sales.net_sales) * 0.5;
          }
          return { sales: blockSales, laborCost: blockLaborCost, laborHours: blockLaborHours };
        };

        const crewMap: Record<string, any> = {};
        Object.entries(dayBlockCrew).forEach(([key, crew]) => {
          const [date, block] = key.split("|");
          const crewKey = Array.from(crew).sort().join(",");
          if (!crewMap[crewKey]) {
            crewMap[crewKey] = {
              members: Array.from(crew).map((id) => nameMap[id] || "Unknown").sort(),
              shifts_worked: 0,
              total_sales: 0,
              total_labor_cost: 0,
              total_labor_hours: 0,
            };
          }
          const out = dayBlockOutcome(date, block);
          crewMap[crewKey].shifts_worked++;
          crewMap[crewKey].total_sales += out.sales;
          crewMap[crewKey].total_labor_cost += out.laborCost;
          crewMap[crewKey].total_labor_hours += out.laborHours;
        });

        const crews = Object.values(crewMap)
          .filter((c: any) => c.shifts_worked >= minOccurrences)
          .map((c: any) => {
            const avg_sales = c.total_sales / c.shifts_worked;
            const avg_labor_pct = c.total_sales > 0 ? (c.total_labor_cost / c.total_sales) * 100 : 0;
            const avg_splh = c.total_labor_hours > 0 ? c.total_sales / c.total_labor_hours : 0;
            return {
              members: c.members,
              shifts_worked: c.shifts_worked,
              avg_sales: Math.round(avg_sales * 100) / 100,
              avg_labor_pct: Math.round(avg_labor_pct * 10) / 10,
              avg_splh: Math.round(avg_splh * 100) / 100,
              composite_score: Math.round(avg_splh * 10) / 10,
            };
          })
          .sort((a: any, b: any) => b.composite_score - a.composite_score);

        return JSON.stringify({
          business_day_window: cpWin,
          total_unique_crews: crews.length,
          total_shift_blocks_analyzed: Object.keys(dayBlockCrew).length,
          top_crews: crews.slice(0, 10),
          worst_crews: crews.slice(-5).reverse(),
          note: "SPLH = Sales Per Labor Hour. Composite is currently SPLH-based. AM = before 14:00, PM = 14:00 onward. Day labor comes from the same labor total as the dashboard; the AM/PM split is a 50/50 estimate. Days with no labor data count as zero labor here — say labor was unavailable rather than quoting labor % for them.",
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`Tool ${toolName} exception:`, e);
    return JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Every role row, reduced to the highest (people can hold more than one).
    const { role: highest } = await roleForUser(supabaseAdmin, user.id);
    
    const managerRoles = ["shift_manager", "shift_manager_in_training", "manager", "general_manager", "admin", "org_admin", "fbc", "brand_admin", "super_admin"];
    if (!highest || !managerRoles.includes(highest)) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userRole = highest;
    const { messages, location_id, location_name, source: usageSource, model_override, reasoning_override, actions_dry_run, action_guard, pending_action, pick, list_context } = await req.json();
    // TEMPORARY model bake-off (test only). Honored only for a super admin AND source "bakeoff"
    // AND one of these ids; otherwise ignored and Theo runs on gemini-2.5-flash. Bake-off calls
    // write no usage rows and return token counts instead. Remove after the bake-off.
    const BAKEOFF_MODELS = ["google/gemini-2.5-flash", "google/gemini-3.1-flash-lite", "openai/gpt-6-luna"];
    const bakeoff = usageSource === "bakeoff" && userRole === "super_admin" && BAKEOFF_MODELS.includes(model_override);
    const bakeModel: string | null = bakeoff ? model_override : null;
    const toolsCalled: string[] = [];
    // Actions dry-run (bake-off only): propose_action is offered, writes nothing, returns preview_ready.
    const dryRun = bakeoff && actions_dry_run === true;
    const proposals: any[] = [];
    const toolOutputs: any[] = [];
    const lunaEffort = bakeoff && ["none", "low", "medium", "high"].includes(reasoning_override) ? reasoning_override : "none";
    // Store time zone from location_settings (same place useLocationTimezone and the
    // business-day functions read). "Today" is the store's BUSINESS date.
    let timezone = "America/Los_Angeles";
    if (location_id) {
      const { data: tzRow } = await supabaseAdmin.from("location_settings").select("timezone").eq("location_id", location_id).maybeSingle();
      if (tzRow?.timezone) timezone = tzRow.timezone;
    }
    let today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
    if (location_id) {
      const { data: bd } = await supabaseAdmin.rpc("business_date", { _location_id: location_id, _at: new Date().toISOString() });
      if (typeof bd === "string" && /^\d{4}-\d{2}-\d{2}/.test(bd)) today = bd.slice(0, 10);
    }
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const dayOfWeek = new Date(today + "T12:00:00Z").getUTCDay();
    const weekStart = addDays(today, -(dayOfWeek === 0 ? 6 : dayOfWeek - 1));

    // === BUILD CONTEXT SNAPSHOT (cached per location for 60s; labor added per request) ===
    const [cachedSnapshot, laborLines] = await Promise.all([
      getCachedSnapshot(supabaseAdmin, location_id, today, yesterday, tomorrow, weekStart),
      buildLaborLines(supabaseUser, location_id, yesterday, today),
    ]);
    const contextSnapshot = laborLines ? `${cachedSnapshot}\n${laborLines}` : cachedSnapshot;

    // === RETRIEVE THEO'S LONG-TERM MEMORY ===
    let memoryContext = "";
    try {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
      if (lastUserMsg?.content) {
        const queryText = lastUserMsg.content;
        const isOpusQuery = /@opus\b/i.test(queryText);
        const cleanQuery = queryText.replace(/@opus\b/i, "").trim();

        // Try vector search first for normal questions only.
        // For @OPUS, always use the title index first so search/list mode is deterministic.
        let relevant: any[] = [];

        if (!isOpusQuery) {
          try {
            const memResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/theo-memory`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                action: "search",
                location_id: location_id,
                query: cleanQuery,
              }),
            });
            if (memResp.ok) {
              const memData = await memResp.json();
              relevant = memData.results || [];
            }
          } catch (e) {
            console.error("Vector memory search failed, falling back to text:", e);
          }
        }

        // Honesty check: if @OPUS is invoked but this location has no active OPUS integration,
        // short-circuit with a clear "not connected" notice instead of silently returning empty.
        let opusNotConnected = false;
        if (isOpusQuery) {
          const { data: opusIntegration } = await supabaseAdmin
            .from("location_integrations")
            .select("id")
            .eq("location_id", location_id)
            .eq("integration_type", "opus")
            .eq("is_active", true)
            .maybeSingle();
          if (!opusIntegration) {
            opusNotConnected = true;
            console.log(`[ai-assistant] @OPUS query but no active integration for location ${location_id}`);
          }
        }

        // Fallback / primary OPUS search
        // OPUS resources are shared across locations in the same brand,
        // so search brand-wide instead of just the current location.
        if (relevant.length === 0 && !opusNotConnected) {
          // Resolve all sibling location IDs in the same brand
          let opusLocationIds: string[] = [location_id];
          try {
            const { data: locData } = await supabaseAdmin
              .from("locations")
              .select("organization_id")
              .eq("id", location_id)
              .single();
            if (locData) {
              const { data: orgData } = await supabaseAdmin
                .from("organizations")
                .select("brand_id")
                .eq("id", locData.organization_id)
                .single();
              if (orgData?.brand_id) {
                const { data: brandOrgs } = await supabaseAdmin
                  .from("organizations")
                  .select("id")
                  .eq("brand_id", orgData.brand_id);
                if (brandOrgs && brandOrgs.length > 0) {
                  const { data: brandLocs } = await supabaseAdmin
                    .from("locations")
                    .select("id")
                    .in("organization_id", brandOrgs.map((o: any) => o.id));
                  if (brandLocs && brandLocs.length > 0) {
                    opusLocationIds = brandLocs.map((l: any) => l.id);
                  }
                }
              }
            }
          } catch (e) {
            console.error("[ai-assistant] Brand location lookup failed:", e);
          }

          if (isOpusQuery && cleanQuery.length > 0) {
            const stopWords = new Set(["how", "what", "when", "where", "why", "make", "show", "find", "pull", "open", "need", "with", "from", "into", "this", "that", "the", "and", "for"]);
            const searchWords = cleanQuery
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, " ")
              .split(/\s+/)
              .filter((w: string) => w.length > 2 && !stopWords.has(w));

            const fallbackWords = searchWords.length > 0
              ? searchWords
              : cleanQuery.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w: string) => w.length > 1);

            const orConditions = fallbackWords.map((w: string) => `title.ilike.%${w}%`).join(",");

            const { data: indexHits, error: indexError } = await supabaseAdmin
              .from("opus_resource_index")
              .select("title, resource_type, opus_id, theo_knowledge_id")
              .in("location_id", opusLocationIds)
              .or(orConditions)
              .limit(20);

            if (indexError) {
              console.error("[ai-assistant] OPUS index search error:", indexError);
            }

            if (indexHits && indexHits.length > 0) {
              // Build the full search phrase for exact/substring matching
              const fullPhrase = fallbackWords.join(" ");
              const scored = indexHits
                .map((hit: any) => {
                  const titleLower = (hit.title || "").toLowerCase();
                  let score = 0;
                  // Big bonus for exact phrase match
                  if (titleLower.includes(fullPhrase)) score += 10;
                  // Count individual word matches
                  for (const word of fallbackWords) {
                    if (titleLower.includes(word)) score += 1;
                  }
                  // Bonus for shorter titles (more specific match)
                  if (score > 0) score += Math.max(0, 5 - Math.floor(titleLower.length / 20));
                  return { ...hit, _score: score };
                })
                .filter((hit: any) => hit._score > 0)
                .sort((a: any, b: any) => b._score - a._score || a.title.localeCompare(b.title))
                .slice(0, 8);

              console.log(`[ai-assistant] @OPUS index search: "${cleanQuery}" → ${scored.length} ranked results`);

              const knowledgeIds = scored
                .filter((s: any) => s.theo_knowledge_id)
                .map((s: any) => s.theo_knowledge_id);

              if (knowledgeIds.length > 0) {
                const { data: fullContent } = await supabaseAdmin
                  .from("theo_knowledge")
                  .select("id, topic, content")
                  .in("id", knowledgeIds);

                const contentMap = new Map((fullContent || []).map((c: any) => [c.id, c]));
                relevant = scored.map((s: any) => {
                  const full = contentMap.get(s.theo_knowledge_id);
                  return full || {
                    topic: `opus_training_${String(s.resource_type || "resource").toLowerCase()}`,
                    content: `[OPUS Training Resource] ${s.title}\nType: ${s.resource_type}\nOPUS ID: ${s.opus_id}`,
                  };
                });
              } else {
                relevant = scored.map((s: any) => ({
                  topic: `opus_training_${String(s.resource_type || "resource").toLowerCase()}`,
                  content: `[OPUS Training Resource] ${s.title}\nType: ${s.resource_type}\nOPUS ID: ${s.opus_id}`,
                }));
              }
            } else {
              relevant = [];
            }
          } else if (isOpusQuery) {
            const { data: samples } = await supabaseAdmin
              .from("opus_resource_index")
              .select("title, resource_type, opus_id")
              .in("location_id", opusLocationIds)
              .limit(10);

            relevant = (samples || []).map((s: any) => ({
              topic: `opus_training_${String(s.resource_type || "resource").toLowerCase()}`,
              content: `[OPUS Training Resource] ${s.title}\nType: ${s.resource_type}\nOPUS ID: ${s.opus_id}`,
            }));
          } else {
            const { data: memories } = await supabaseAdmin
              .from("theo_knowledge")
              .select("topic, content")
              .eq("location_id", location_id)
              .limit(20);

            if (memories && memories.length > 0) {
              const queryLower = cleanQuery.toLowerCase();
              const queryWords = queryLower.split(/\s+/).filter((w: string) => w.length > 3);
              relevant = memories.filter((m: any) => {
                const contentLower = m.content.toLowerCase();
                const topicLower = m.topic.toLowerCase();
                return queryWords.some((w: string) => contentLower.includes(w) || topicLower.includes(w));
              }).slice(0, 5);
            }
          }
        }

        if (isOpusQuery && relevant.length > 0) {
          relevant = relevant.filter((m: any) =>
            (m.topic && m.topic.startsWith("opus_training_")) ||
            (m.content && (m.content.includes("[OPUS Training Resource]") || m.content.includes("[OPUS Training Module]")))
          );

          console.log(`[ai-assistant] @OPUS usable results after filter: ${relevant.length}`);
        }
        
        if (opusNotConnected) {
          memoryContext = "\n\nOPUS INTEGRATION STATUS: This location does NOT have an active OPUS connection. " +
            "You CANNOT search OPUS training resources for this location. Tell the user plainly that OPUS isn't connected " +
            "for this store and suggest they connect it via Settings → Integrations. Do NOT pretend to search or fabricate results.\n";
        } else if (relevant.length > 0) {
          const header = isOpusQuery 
            ? "\n\nOPUS TRAINING LIBRARY (filtered by @OPUS tag — these are training resources & modules from your LMS):\n"
            : "\n\nTHEO'S PINNED KNOWLEDGE (facts saved by managers at this location — treat as ground truth):\n";
          memoryContext = header +
            relevant.map((m: any) => `- [${m.topic}]: ${m.content}`).join("\n");
        } else if (isOpusQuery) {
          memoryContext = "\n\nOPUS SEARCH RESULT: No matching OPUS resources found for this query at this location. " +
            "Tell the user nothing matched — do NOT fabricate resources.\n";
        }
      }
    } catch (e) {
      console.error("Memory retrieval error (non-fatal):", e);
    }

    const systemPrompt = `You are Theo, an elite Restaurant Operations Assistant for CrooHQ. You are the Digital General Manager and Co-Pilot for the team at ${location_name || "this location"}.

You are NOT a generic AI — you have direct, real-time access to this restaurant's live pulse: POS sales (including top items), labor data, schedules, checklists, guest reviews, and more.

YOUR IDENTITY:
- Direct, concise, and professional. No flowery AI introductions. No "I'd be happy to help."
- You speak like a seasoned operator who's run hundreds of shifts — restaurant lingo comes naturally ("the line", "the pass", "86'd", "in the weeds").
- When numbers are good, you celebrate genuinely: "Crushed it 🔥" / "Labor is dialed in 💪"
- When things need attention, you're honest but constructive: "Labor's running hot at 34% — might want to trim a closer" not "Labor costs are exceeding targets."
- You're precise with data — always include actual numbers — but wrap them in context a manager cares about.
- Use emojis sparingly but naturally (📊 data, 🔥 wins, ⚠️ concerns, ✅ completions).
- Short, punchy answers unless detail is requested. Bullet points over paragraphs.

Current business date: ${wd(today)} (store time zone: ${timezone}). The store's business day starts at its morning cutover, so after-midnight closing hours belong to the previous business date.
Yesterday: ${wd(yesterday)}
Tomorrow: ${wd(tomorrow)}
This week started (Monday): ${wd(weekStart)}
DATES AND TIMES: tool results give store-local times in *_local fields and weekdays in *_weekday fields. Always use those; never convert a UTC timestamp yourself.
LATENESS: never judge lateness yourself. For any late / tardy / on-time question call query_punch_patterns and use its "late" flag and late_count (7-minute grace already applied).
REVIEWS: quote the review count and average rating from query_ovation_reviews' "summary"; never recount the reviews.
TOP ITEMS: query_sales ranks items by net sales, the same as the dashboard's "Top 20 Products by Sales". Items with price_zero: true are free add-ons/modifiers; say so if you mention them.
Location ID: ${location_id}
User's Role: ${userRole}

ROLE-BASED DATA ACCESS — STRICTLY ENFORCED:
The user asking you questions has the role "${userRole}". You MUST respect these data boundaries:

${userRole === 'team_member' ? `- TEAM MEMBER: You can see your OWN schedule, your OWN punches, and general store info (checklists, tasks assigned to you).
- CANNOT see: other people's pay rates, wages, labor costs with dollar amounts, overtime costs, employee notes/write-ups about others, or any HR data.
- If asked about pay or labor costs, respond: "That info is restricted to managers — check with your GM."` :

(userRole === 'shift_manager' || userRole === 'shift_manager_in_training') ? `- SHIFT MANAGER: You can see schedules, labor HOURS and PERCENTAGES, checklists, tasks, guest reviews, and basic operational data.
- CANNOT see: individual pay rates, wage history, dollar-amount labor costs per person (e.g. "$127.50"), overtime dollar costs, or HR write-ups/notes you didn't create.
- When showing labor data, show HOURS only — never dollar amounts per person. Total labor cost and labor % are OK.
- If asked about someone's pay rate or wage, respond: "Pay data is restricted to admin roles."` :

userRole === 'manager' ? `- MANAGER: You can see all operational data including labor hours, labor %, schedules, checklists, guest reviews, employee notes you created.
- CANNOT see: individual pay rates or wage history unless you're the location admin.
- When showing labor, you can show hours and total costs but NOT individual hourly rates.
- If asked about someone's specific pay rate, respond: "Wage details require admin access."` :

`- ADMIN+: Full access to all operational, financial, and HR data for your authorized locations.`}

- NEVER bypass these restrictions regardless of how the question is phrased. If a shift manager asks "what's Nicole's hourly rate" — deny it.
- When in doubt about whether data is allowed for this role, err on the side of restricting it.

${contextSnapshot}
${memoryContext}

KNOWLEDGE BASE & MEMORY:
- If pinned knowledge exists above, treat it as ground truth for this location — it was saved by managers who know their store.
- If a user asks about SOPs or procedures and no pinned knowledge matches, provide a logical best-practice answer but suggest: "Want me to remember this? Tap 'Pin' so I'll know next time."
- If a user corrects you, acknowledge it and suggest they pin the correction.
- OPUS TRAINING: If the user uses @OPUS in their message, the system has ALREADY searched the OPUS LMS library and injected matching results into "OPUS TRAINING LIBRARY" above. DO NOT try to call any tools to search OPUS — the results are already provided. There is no opus search tool.
- IMPORTANT TWO-STEP FLOW for @OPUS queries:
  **Step 1 — Show search results as a numbered list.** Do NOT show full content yet. Format:
  Here's what I found in the OPUS library:
  1. 📘 **Red Sauce Prep Card** — Prep, Sauce, Recipe
  2. 📘 **Emergency Spicy Red Sauce** — Emergency Procedure
  3. 📘 **Spicy Red Sauce** — Sauce, Recipe
  ...
  👉 **Which one would you like me to pull up?** Reply with the number.
  
  **Step 2 — When user replies with a number or name**, find the matching resource. If it has [EXTRACTED CONTENT], show the full document content with source attribution. If not, use the fetch_resource_content tool to extract it, then show the result.
  Format: 📘 **Source: [Resource Name]** (from OPUS Training Library)
  Then the full extracted content exactly as written in the document.

- If only ONE result matches perfectly, skip the list and show it directly.
- If no OPUS results appear above despite the @OPUS tag, say "I couldn't find a matching OPUS resource. Try different keywords."

TOOL USAGE:
- For simple questions about today/yesterday/tomorrow sales, labor, schedule counts, OR remaining-week projections, USE THE CONTEXT SNAPSHOT ABOVE — no tool call needed.
- GOAL vs PACE: Goal is the target for the day. Pace is where the day is trending to finish. They are different numbers. When asked whether the store is on pace, compare pace to goal and say ahead, on track or behind with the dollar gap. If pace is not available, say so; never treat the goal as the pace.
- The snapshot includes projections for EVERY remaining day this week (Thu-Sun, etc.). Use them directly.
- For deeper dives, specific employees, checklists, or other details, invoke your tools to fetch real-time data.
- For multi-week or month-level projection lookups, use query_sales with a date range.
- You get up to 5 tool calls per question — USE THEM for retries and cross-referencing.

EMPLOYEE NAME MATCHING:
- When analyzing guest reviews, automatically cross-reference names mentioned in feedback with the location's roster.
- Tag matched employees with [[employee:Full Name]] format — the UI renders these as interactive badges.
- NEVER tag customer/reviewer names — only match against active team members.

SANITY CHECKS:
- If a projection or sales number seems absurdly low (e.g. $40 for a full day), flag it: "That projection looks off — might be a stale override."
- If tomorrow shows $0 net sales, that's expected (it hasn't happened yet). Report the PROJECTION, not net sales.

SELF-HEALING & RECOVERY:
- If a tool returns empty results or an error, DO NOT give up. Try a different tool, broaden the date range, or remove filters.
- NEVER mention retries, tool failures, or recovery attempts to the user. Just give them the answer.
- Only after exhausting alternatives should you tell the user you couldn't find the data.

TOPIC BOUNDARIES:
- You ONLY answer questions related to restaurant operations: sales (including top items / product mix), labor, schedules, checklists, tasks, catering, availability, tips, certifications, shift marketplace, store hours, employee notes, logbook entries, guest reviews (OvationUp), team chat messages, and general restaurant management advice.
- If someone asks about something unrelated, politely redirect: "I'm all about the ops — sales, labor, schedules, reviews, chats, and keeping your store running smooth. What can I pull up for you?"

INVENTORY IS OUT OF SCOPE (for now):
- For inventory counts, count values, pack sizes, food cost / COGS, variance, vendor orders, invoices, transfers, waste, recipes or menu pricing, answer exactly: "Inventory isn't something I can help with yet." Then offer what you can do (sales and top items, labor, schedule, checklists, tasks, reviews). Never give numbers for these.
- Item sales (top items by units and dollars from the POS) are sales data — answer those normally with query_sales.

MISSING DATA:
- If labor shows no_labor_data or labor_unavailable, say you don't have labor for that day (or can't see labor for this store right now) and skip it. Never say 0% and never give a grade.
- Schedules are PUBLISHED only. If a tool returns no_published_schedule, say "There's no published schedule for that week." If draft_shifts is present, you may add how many draft shifts exist — never list draft shifts as who is working.

CRITICAL RULES:
- NEVER FABRICATE EMPLOYEE NAMES. Only mention an employee by name if their name was explicitly returned by a tool call. If unsure, say "no data found" — NEVER guess or invent names.
- NEVER expose internal tool names, parameter names, or technical details.
- Date inference: "this week" = ${weekStart} to ${today}, "last week" = prior Mon-Sun, "this month" = 1st to today. ALWAYS infer — never ask unless truly ambiguous.
- Format currency with $ and commas. Format times in 12-hour AM/PM.

RESPONSE FORMATTING:
- THIS APP IS USED ON MOBILE. Never create tables wider than 2-3 short columns. If data has 4+ columns, use a LIST format.
- For SCHEDULES and SHIFTS, use this compact stacked format:
  **Nicole Mendez** — AM Manager
  9:00 AM – 5:00 PM

  **Joshua Haro** — PM Manager
  3:00 PM – 11:00 PM

- For LABOR data with hours/cost:
  **Nicole Mendez** — 7.5 hrs ($127.50)
  **Joshua Haro** — 8.0 hrs ($140.00)

- Use markdown TABLES only for narrow comparisons (2-3 short columns max).
- For checklist items, tasks, or logbook entries with 3+ items, use bullet lists.
- After any data list, add a brief 1-2 sentence insight or takeaway.
- Use **bold** for key numbers.

TOOL SELECTION — REASON, DON'T PATTERN-MATCH:
Don't match keywords to tools. Reason about intent. Ask yourself: "What data would actually answer this question?" Then pick the tool whose description says it holds that data. Read the tool descriptions — they tell you what each one returns.

- Use multiple tools in parallel when a question spans multiple data sources (e.g. "did we crush it this week" → sales + labor; "who bounced last night" → punches + schedule to compare scheduled vs actual).
- Cross-reference proactively. If a punch question implies comparing to a schedule, call both. If a guest review names an employee, also pull schedule/punches for that shift.
- Prefer fewer, broader calls over many narrow ones, but don't hesitate to call 2-3 tools at once when needed.

NEVER GIVE UP AFTER ONE EMPTY RESULT:
If a tool returns empty/no data, do NOT tell the user you can't help. Instead:
1. Try the same tool with broader parameters (drop the date, widen the range, remove filters).
2. Try a different tool that holds adjacent data (e.g. no labor intelligence report? Pull raw query_labor + query_sales and analyze the gap yourself).
3. Only after 2-3 genuine attempts should you tell the user what's missing — and even then, give them whatever partial answer the data DOES support.

For "how can I improve my labor" / "labor recommendations" / "what should I fix":
- Call query_labor_intelligence WITHOUT a date (gets the most recent grade + findings + suggestions).
- In parallel, call query_labor and query_sales for the current week (week-to-date raw numbers).
- Synthesize: cite the most recent grade, surface the top 1-3 findings, then add concrete week-to-date observations (which day was worst, where labor % spiked vs sales). Always end with 2-3 specific, actionable recommendations.

DOMAIN DISAMBIGUATION (only when terms are non-obvious):
- "Flip the line" = Shift Change Line Check completion. Submission time IS when the line was flipped.
- "Drawer count", "safe count", "pass down", "incident", "deposit" are logbook entries, not sales records.
- "Labor grade", "staffing efficiency suggestions" come from query_labor_intelligence (AI analysis), not raw query_labor.
- query_my_chats only searches chats the current user is a member of — never claim to search "all chats".
- For guest reviews from query_ovation_reviews, tag matched employees with [[employee:Full Name]].

DATE ANCHORS:
- "Today" = ${wd(today)}, "yesterday" = ${wd(yesterday)}, "tomorrow" = ${wd(tomorrow)}.
- query_availability defaults to the next 14 days unless the user specifies a range.`;

    // TEMPORARY (actions dry-run guard test only).
    const actionGuard = dryRun && action_guard === true;
    const GUARD_RULE = `

ACTION RULE (strict): Call propose_action ONLY when you are actually proposing that change in this reply. Do NOT call it when: the change already exists (e.g. the person already has that shift), the request is impossible (e.g. a person has no shift to swap), the action is not one of the four supported, or any required detail (like times) is missing — in those cases just tell the manager in words and propose nothing. Your words and your tool calls must agree.`;
    // THEO HANDS: which actions this person has at this store — decided only in _shared/theoActions.ts.
    // The store access check runs here, once, before any crew lookup, list, preview, tap or re-check below.
    // Voice only, never in the bake-off.
    const theoActions = !bakeoff && usageSource === "voice" ? await theoActionsAt(supabaseAdmin, user.id, userRole, location_id) : { ...NO_ACTIONS };
    const actionsOn = theoActions.create_task || theoActions.cover_shift;
    const coverOn = theoActions.cover_shift;
    const pending = actionsOn && pending_action && typeof pending_action === "object" && pending_action.action === "create_task" ? {
      title: String(pending_action.title || "").slice(0, 200),
      employees: Array.isArray(pending_action.employees) ? pending_action.employees.slice(0, 20).map((e: any) => ({ employee_id: String(e?.id || ""), name: String(e?.name || "").slice(0, 80) })) : [],
      roles: Array.isArray(pending_action.roles) ? pending_action.roles.filter((r: any) => typeof r === "string" && TASK_ROLES[r]) : [],
      duration: TASK_DURATIONS.includes(pending_action.duration) ? pending_action.duration : "none",
    } : null;
    const pendingCover = coverOn && pending_action && typeof pending_action === "object" && pending_action.action === "cover_shift" ? {
      shift_id: String(pending_action.shift_id || ""),
      covered: String(pending_action.covered?.name || "").slice(0, 80),
      replacement_id: String(pending_action.replacement?.id || ""),
      replacement: String(pending_action.replacement?.name || "").slice(0, 80),
      when: `${String(pending_action.date_label || "").slice(0, 40)} ${String(pending_action.time_label || "").slice(0, 40)}`,
    } : null;
    const anyPending = !!(pending || pendingCover);
    const listShift = coverOn && list_context && typeof list_context.shift_id === "string" ? String(list_context.shift_id).slice(0, 36) : null;
    const crewForActions = actionsOn ? await activeCrewAt(supabaseAdmin, location_id) : [];
    const matchCrew = (raw: string) => {
      const q = raw.trim().toLowerCase();
      return q ? crewForActions.filter((c) => {
        const full = (c.full_name || "").toLowerCase();
        const nick = (c.nickname || "").toLowerCase();
        return full.split(/\s+/).some((w) => w.startsWith(q)) || full.startsWith(q) || (nick && nick.startsWith(q)) || full.includes(q);
      }) : [];
    };
    const nowHHMM = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

    // Screen taps (a shift, a person or a name on the list) and the Confirm re-check: answered by code, no AI.
    if (coverOn && pick && typeof pick === "object") {
      const reply = (o: any) => new Response(JSON.stringify(o), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const sid = String(pick.shift_id || "");
      const shiftToScreen = async (shiftId: string) => {
        const r: any = await candidatesScreen(supabaseAdmin, location_id, shiftId, crewForActions, crewName);
        if (r.declined) return reply({ content: r.declined });
        if (r.error) return reply({ content: r.error });
        return reply({ content: r.screen.title, screen: r.screen });
      };
      if (pick.kind === "shift") return await shiftToScreen(sid);
      if (pick.kind === "person") {
        if (!crewForActions.some((c) => c.id === pick.employee_id)) return reply({ content: "I can't find that person at this store." });
        const r: any = await findShifts(supabaseAdmin, location_id, crewForActions, crewName, { employee_id: String(pick.employee_id || ""), date: pick.date }, today, nowHHMM, matchCrew);
        if (r.status === "one_shift") return await shiftToScreen(r.shift_id);
        if (r.screen) return reply({ content: r.screen.title, screen: r.screen });
        const said = String(r.next || "").match(/"([^"]+)"/)?.[1] || "I couldn't find that shift.";
        return reply({ content: said });
      }
      if (pick.kind === "candidate") {
        const v: any = await buildCoverProposal(supabaseAdmin, location_id, sid, String(pick.employee_id || ""), crewForActions, crewName);
        if (v.ok) return reply({ content: "Here's the change. Does this look right to you?", proposal: v.proposal });
        return reply({ content: v.hurdle ? `${v.error}. Want to see who else can cover?` : v.error });
      }
      if (pick.kind === "recheck" && pick.proposal && typeof pick.proposal === "object") {
        const p = pick.proposal;
        const v: any = await buildCoverProposal(supabaseAdmin, location_id, String(p.shift_id || ""), String(p.replacement?.id || ""), crewForActions, crewName);
        if (!v.ok) return reply({ recheck: { ok: false, changed: /shift_id/.test(v.error) ? "That shift isn't on the schedule anymore." : v.error } });
        const n = v.proposal;
        if (n.covered.id !== p.covered?.id) return reply({ recheck: { ok: false, changed: `This shift now belongs to ${n.covered.name}.` } });
        if (n.shift_date !== p.shift_date || n.start_time !== p.start_time || n.end_time !== p.end_time) return reply({ recheck: { ok: false, changed: `The shift moved to ${n.date_label}, ${n.time_label}.` } });
        return reply({ recheck: { ok: true, published: n.published } });
      }
      return reply({ content: "I couldn't use that tap. Try again." });
    }

    const ACTIONS_RULES = `

QUICK TASKS (you can PROPOSE a standard quick task at ${location_name || "this store"}):
- A proposal is only a preview. Nothing is saved until the manager taps "Create task" on screen. Never say a task was created, saved, added or assigned.
- Needed: a title and who it's for (one or more people and/or roles). Optional: how long it stays up (1h, 3h, 1d, 3d, 1w, 1m, or none = Until Complete, the default). There is no due time field; keep any time the manager says in the title ("Wipe down the patio tables by 3 PM").
- Resolve every person with find_crew and use the employee_id it returns. Never guess. If find_crew returns several matches, propose nothing and ask which one, naming them. If it returns none, propose nothing and say you can't find that person at this store.
- Roles you can assign: ${Object.values(TASK_ROLES).join(", ")}. Only assign a role the manager actually named. "Everyone", "all", "the crew" or "the team" is NOT a role and NOT Team Member: propose nothing, ask who it's for and say you can assign specific people or a role.
- Missing the task? Ask "What's the task?". Missing who? Ask "Who's it for?". In those cases do NOT call propose_action.
- When you call propose_action for a task, your whole reply must be exactly: "Here's the task. Does this look right to you?"
- Examples of meaning (not keywords): "Have Alle wipe down the patio tables" = task for Alle. "Remind the shift managers to check the walk-in temps" = task for the Shift Manager role. "keep it up for 3 hours" = 3h.
- Telling, asking or getting someone to DO A JOB is a task (examples of meaning): "Tell Jordan to clean the bathroom" = task "Clean the bathroom" for Jordan. "Ask Alle to restock the sauce station" = task "Restock the sauce station" for Alle. "Get Jaysen to sweep the lobby" = task "Sweep the lobby" for Jaysen.
- You cannot send messages. If it is plainly a message and not a job ("tell Jordan I'm running late", "let Alle know the meeting moved"), propose nothing and say you can't send messages.

${coverOn ? `COVER A SHIFT (you can also PROPOSE giving one existing shift to another person at this store):
- A cover needs three things: WHO needs cover, WHICH shift, WHO takes it. Ask only for what is missing. The app does all checking (time off, availability, already working, role); never judge who can cover yourself.
- Nobody named ("I need coverage", "someone called out"): call find_shifts with no name.
- Person named ("who can cover Ryan", "Ryan called out", "Ryan can't make it", "find someone for Ryan's shift tomorrow"): call find_shifts with name and date (no day said or "tonight" = today ${today}; "tomorrow" = ${tomorrow}; a weekday = the next one from today).
- Every find_shifts / cover_candidates / propose_action result has a "next" or "error": follow it exactly and say its quoted line.
- find_shifts status one_shift with nobody named to take it: call cover_candidates with its shift_id.
- A replacement named ("cover Ryan's shift with Deborah", "have Deborah take Ryan's Saturday shift", "put Deborah on for Ryan"): find the shift with find_shifts, resolve the replacement with find_crew (several matches: ask which one; none: say you can't find them), then call propose_action with action cover_shift, shift_id and replacement_employee_id.
- When propose_action cover_shift returns preview_shown, your whole reply must be exactly: "Here's the change. Does this look right to you?" A preview saves nothing; never say a shift was changed, moved or covered.
- If a shift is posted in the shift pool, say "That shift is posted in the shift pool. Handle it there." and propose nothing.
` : `COVER A SHIFT is not something you can do yet: for any cover request ("who can cover Ryan?", "Ryan called out", "cover Ryan's shift with Deborah") propose nothing, say you can't do that yet and to handle it on the Schedule page. Never say a shift was changed, moved or covered.
`}
NOT BUILT YET (propose nothing, say it's not something you can do yet and where in the app to do it by hand): alarm, team or QR tasks (Tasks page); editing or deleting a task (Tasks page); checklists (Checklists page); time off, including giving someone a day off (Availability page); swapping two people's shifts, adding or deleting a shift, changing shift times, or posting a shift offer (Schedule page).
- ACTION RULE (strict): Call propose_action ONLY when you are actually proposing the change in this reply. If you ask a question or say you can't, propose nothing. Your words and your tool calls must agree.${listShift ? `

A LIST OF WHO CAN COVER IS ON SCREEN for shift_id ${listShift}. If the manager names someone, resolve them with find_crew and call propose_action (cover_shift) with this shift_id.` : ""}${pending ? `

A TASK PREVIEW IS ON SCREEN RIGHT NOW (not saved):
${JSON.stringify(pending)}
- If the manager changes it ("make it 3 hours", "make it for Jaysen instead"), call propose_action with the FULL revised task (resolve new people with find_crew; keep unchanged parts).
- If the manager wants to drop it ("never mind", "cancel"), call cancel_pending_action and say "Okay, I dropped that task."
- If the manager agrees (yes / do it / confirm / looks good / sounds right), do NOT call propose_action or any tool. Agreeing changes nothing. Reply exactly: "Tap Create task to save it."` : ""}${pendingCover ? `

A COVER PREVIEW IS ON SCREEN RIGHT NOW (not saved): ${pendingCover.replacement} takes ${pendingCover.covered}'s shift ${pendingCover.when} (shift_id ${pendingCover.shift_id}).
- If the manager names someone else ("actually make it Janessa"), resolve them with find_crew and call propose_action (cover_shift) with the SAME shift_id and the new replacement_employee_id.
- If the manager wants to drop it ("never mind", "cancel"), call cancel_pending_action and say "Okay, I dropped that change."
- If the manager agrees (yes / do it / confirm / looks good / sounds right), do NOT call any tool. Agreeing changes nothing. Reply exactly: "Tap Confirm change to save it."` : ""}`;
    // Rule G: wherever actions are not offered, Theo must never claim a change.
    const NEVER_CLAIM = `

You cannot create, change or delete anything in CrooHQ (tasks, shifts, checklists, time off or anything else). Never say you did. If asked, say you can't do that and tell them where in the app to do it. Telling or asking someone to do a job ("tell Jordan to clean the bathroom") means a quick task: say you can't assign it from here and to add it on the Tasks page — don't talk about messages.`;
    const sysContent = actionGuard ? systemPrompt + GUARD_RULE : actionsOn ? systemPrompt + ACTIONS_RULES : dryRun ? systemPrompt : systemPrompt + NEVER_CLAIM;
    const aiMessages = [
      { role: "system", content: sysContent },
      ...messages,
    ];
    let liveProposal: any = null;
    let cancelPending = false;
    let coverScreen: any = null;
    // Ids Theo was actually given this turn. The model sometimes mistypes a long id by a character or
    // two; snap to the nearest id it was given (never an id it wasn't), then the server checks it as usual.
    const seenShiftIds = new Set<string>([...(listShift ? [listShift] : []), ...(pendingCover ? [pendingCover.shift_id] : [])]);
    const seenCrewIds = new Set<string>();
    const lev = (a: string, b: string) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const snap = (id: string, seen: Set<string>) => { if (seen.has(id)) return id; let best = id, bd = 5; for (const s2 of seen) { const x = lev(id, s2); if (x < bd) { bd = x; best = s2; } } return best; };
    let postedDecline = false;

    let finalResponse: any = null;
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let currentMessages = [...aiMessages];
    const usage = { calls: 0, pt: 0, ct: 0, cached: 0 };

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      const aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: bakeModel ?? THEO_MODEL,
          // gpt-6-luna on chat-completions only accepts function tools with reasoning off.
          ...((bakeModel ?? THEO_MODEL) === "openai/gpt-6-luna" ? { reasoning_effort: bakeoff ? lunaEffort : "none" } : {}),
          messages: currentMessages,
          tools: dryRun ? [...THEO_TOOLS, PROPOSE_ACTION_TOOL] : actionsOn ? [...THEO_TOOLS, FIND_CREW_TOOL, ...(coverOn ? [FIND_SHIFTS_TOOL, COVER_CANDIDATES_TOOL, PROPOSE_TASK_TOOL] : [PROPOSE_TASK_ONLY_TOOL]), ...(anyPending ? [CANCEL_PENDING_TOOL] : [])] : THEO_TOOLS,
          tool_choice: "auto",
        }),
      });

      if (!aiResp.ok) {
        const status = aiResp.status;
        const errText = await aiResp.text();
        console.error("AI error:", status, errText);
        
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited, please try again in a moment." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI error: ${status}`);
      }

      const aiData = await aiResp.json();
      usage.calls++;
      usage.pt += aiData.usage?.prompt_tokens || 0;
      usage.ct += aiData.usage?.completion_tokens || 0;
      usage.cached += aiData.usage?.prompt_tokens_details?.cached_tokens || 0;
      const choice = aiData.choices?.[0];
      
      if (!choice) throw new Error("No AI response");

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        finalResponse = choice.message.content;
        break;
      }

      currentMessages.push(choice.message);
      
      for (const tc of choice.message.tool_calls) {
        const args = typeof tc.function.arguments === "string" 
          ? JSON.parse(tc.function.arguments) 
          : tc.function.arguments;
        
        console.log(`Tool: ${tc.function.name}`, JSON.stringify(args));
        toolsCalled.push(tc.function.name);
        let result: string;
        if (dryRun && tc.function.name === "propose_action") {
          proposals.push(args);
          result = JSON.stringify({ status: "preview_ready" });
        } else if (actionsOn && tc.function.name === "find_crew") {
          const matches = matchCrew(String(args?.name || ""));
          matches.forEach((c) => seenCrewIds.add(c.id));
          result = JSON.stringify({ matches: matches.slice(0, 10).map((c) => ({ employee_id: c.id, name: crewName(c) })) });
        } else if (coverOn && tc.function.name === "find_shifts") {
          const r: any = await findShifts(supabaseAdmin, location_id, crewForActions, crewName, args || {}, today, nowHHMM, matchCrew);
          if (r.shift_id) seenShiftIds.add(r.shift_id);
          (r.shifts || []).forEach((x: any) => seenShiftIds.add(x.shift_id));
          (r.matches || []).forEach((x: any) => seenCrewIds.add(x.employee_id));
          if (r.status === "posted") postedDecline = true;
          if (r.screen) coverScreen = r.screen;
          const { screen: _s, ...forTheo } = r;
          result = JSON.stringify(forTheo);
        } else if (coverOn && tc.function.name === "cover_candidates") {
          const r: any = await candidatesScreen(supabaseAdmin, location_id, snap(String(args?.shift_id || ""), seenShiftIds), crewForActions, crewName);
          if (r.declined) { postedDecline = true; coverScreen = null; result = JSON.stringify({ status: "posted", next: `Say exactly "${r.declined}" Propose nothing.` }); }
          else if (r.error) result = JSON.stringify({ error: r.error });
          else { coverScreen = r.screen; result = JSON.stringify({ status: "list_shown", ...r.for_theo, next: `Reply "Here's who can cover ${String(r.for_theo.covered).split(" ")[0]}." plus at most the top two names.` }); }
        } else if (coverOn && tc.function.name === "propose_action" && args?.action === "cover_shift") {
          const v: any = await buildCoverProposal(supabaseAdmin, location_id, snap(String(args?.shift_id || ""), seenShiftIds), snap(String(args?.replacement_employee_id || ""), seenCrewIds), crewForActions, crewName);
          if (v.ok) { liveProposal = v.proposal; cancelPending = false; result = JSON.stringify({ status: "preview_shown" }); }
          else {
            liveProposal = null;
            if (v.posted) postedDecline = true;
            result = JSON.stringify({ error: v.error, next: v.hurdle ? `Say "${v.error}. Want to see who else can cover?" Propose nothing.` : "Tell the manager in words. Propose nothing." });
          }
        } else if (actionsOn && tc.function.name === "propose_action" && args?.action !== "cover_shift") {
          const v = validateTaskProposal(args, crewForActions);
          if (v.ok) { liveProposal = v.proposal; cancelPending = false; result = JSON.stringify({ status: "preview_shown" }); }
          else { liveProposal = null; result = JSON.stringify({ error: v.error }); }
        } else if (actionsOn && anyPending && tc.function.name === "cancel_pending_action") {
          cancelPending = true; liveProposal = null;
          result = JSON.stringify({ status: "dropped" });
        } else {
          result = addLocalTimes(await executeTool(supabaseAdmin, tc.function.name, args, timezone, user.id, userRole, { userClient: supabaseUser, today, exposeIds: dryRun }), timezone);
        }
        if (bakeoff) toolOutputs.push({ tool: tc.function.name, args, output: result.slice(0, 6000) });
        console.log(`Tool result (${tc.function.name}): ${result.substring(0, 200)}...`);
        
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    if (!finalResponse) {
      finalResponse = "I wasn't able to fully process your request. Please try rephrasing.";
    }

    // Usage log for Settings → Super Admin → Theo Usage (never blocks the reply).
    if (bakeoff) {
      // TEMPORARY guard safety check: drop proposals when Theo's own words say no change is being made.
      let guardDropped = false;
      let keptProposals = proposals;
      if (actionGuard && proposals.length > 0) {
        const t = String(finalResponse || "").toLowerCase();
        const saysNo = /\b(can['’]?t|cannot|unable|not able|isn['’]?t able|no (additional|new|need)|not needed|already (has|have|scheduled|working|on)|doesn['’]?t have|does not have|has no shift|no shift|not scheduled|what time|which times|need the (start|times)|please (tell|share|let me know)|not something i can)\b/.test(t);
        if (saysNo) { guardDropped = true; keptProposals = []; }
      }
      return new Response(JSON.stringify({ content: finalResponse, bakeoff: { model: bakeModel, prompt_tokens: usage.pt, completion_tokens: usage.ct, cached_tokens: usage.cached, round_trips: usage.calls, tools: toolsCalled, proposals: keptProposals, raw_proposals: proposals, guard_dropped: guardDropped, tool_outputs: toolOutputs } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (usage.calls > 0) {
      await supabaseAdmin.from("theo_ai_usage").insert({
        user_id: user.id,
        location_id: location_id || null,
        source: usageSource === "voice" ? "voice" : "chat",
        model: THEO_MODEL,
        prompt_tokens: usage.pt,
        completion_tokens: usage.ct,
      }).then(({ error }: any) => error && console.error("usage log failed", error.message));
    }

    if (actionsOn) {
      const out: any = {};
      // Re-proposing the exact task already on screen is not a change: keep the preview, point to the button.
      if (liveProposal?.action === "create_task" && pending) {
        const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
        if (liveProposal.title === pending.title && liveProposal.duration === pending.duration && sameIds(liveProposal.roles, pending.roles)
          && sameIds(liveProposal.employees.map((e: any) => e.id), pending.employees.map((e: any) => e.employee_id))) {
          liveProposal = null; finalResponse = "Tap Create task to save it.";
        }
      }
      if (liveProposal?.action === "cover_shift" && pendingCover && liveProposal.shift_id === pendingCover.shift_id && liveProposal.replacement.id === pendingCover.replacement_id) {
        liveProposal = null; finalResponse = "Tap Confirm change to save it.";
      }
      if (liveProposal) {
        // Words and proposal must agree: a question or a "can't" drops the proposal.
        const rest = String(finalResponse || "").replace(/here['’]?s the (task|change)\.?\s*does this look right( to you)?\??/i, "").toLowerCase();
        const saysNo = rest.includes("?") || /\b(can['’]?t|cannot|unable|not able|not something i can|which one|who['’]?s it for|what['’]?s the task|shift pool)\b/.test(rest);
        if (saysNo) console.log("action guard dropped proposal");
        else {
          out.proposal = liveProposal;
          out.content = liveProposal.action === "cover_shift" ? "Here's the change. Does this look right to you?" : "Here's the task. Does this look right to you?";
        }
      } else if (cancelPending) out.cancel_pending = true;
      else if (coverScreen && !postedDecline) out.screen = coverScreen;
      if (postedDecline) out.content = "That shift is posted in the shift pool. Handle it there.";
      out.content ??= finalResponse;
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ content: finalResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
