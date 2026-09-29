// Toast → toast_sales_cache + sales_cache (pos_source='toast') + labor_cache (source='toast').
//
// Homemade Toast integration (no paid Toast API). Data arrives from two
// GitHub robots, both posting the SAME normalized day payload here:
//   • data_source='export' — nightly Toast Data Export (SFTP CSVs). Truth.
//   • data_source='live'   — headless Toast Web scrape during open hours.
// When the official Toast API is bought later, a fetcher posts
// data_source='api' with the same payload and nothing downstream changes.
//
// Rules: export/api rows are never overwritten by live rows for the same day.
// Conditional-spread merge protects projections/overrides in sales_cache.
//
// Labor: Toast owns the punches (corrections happen in Toast — read-only).
// The live robot posts its GetShiftsV2 punches here as `ingest-labor`; we
// write labor_cache with source='toast' (protected source tag, unique on
// location_id + labor_date + source). CrooHQ stays the schedule of record:
// punches are paired to scheduled_shifts for late clock-in / missed
// clock-out alerts. Toast hours only become labor_cost where a Toast
// employee is matched to a CrooHQ profile (wage_history / profiles wage).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@3.23.8";
import { requireInternalCaller } from "../_shared/callerAuth.ts";
import {
  computeAndSavePace,
  fetchHistoricalDataFromCache,
  generateHourlyProjections,
  generateProjections,
  getCurrentHourInTimezone,
  getCurrentMinutesInTimezone,
} from "../_shared/projections.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_TZ = "America/Los_Angeles";
const SOURCE_RANK: Record<string, number> = { live: 1, export: 2, api: 2 };

const DaySchema = z.object({
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["export", "live", "api"]),
  netSales: z.number().finite().min(0),
  guestCount: z.number().int().min(0).default(0),
  checkCount: z.number().int().min(0).default(0),
  hourly: z.array(z.object({
    hour: z.string().regex(/^\d{2}:00$/),
    sales: z.number().finite(),
    checksCount: z.number().int().min(0).default(0),
  })).default([]),
  payments: z.object({
    tenders: z.array(z.object({
      label: z.string().max(80),
      count: z.number().int().min(0).default(0),
      amount: z.number().finite(),
      tips: z.number().finite().default(0),
    })).default([]),
    total_tips: z.number().finite().default(0),
  }).default({ tenders: [], total_tips: 0 }),
  raw: z.unknown().optional(),
});

// ── Labor (read-only Toast punches → labor_cache source='toast') ───────────
const ShiftSchema = z.object({
  id: z.string().min(1),
  employeeName: z.string().max(160),
  toastUserId: z.string().max(80),
  restaurantUserId: z.string().max(80).nullable().optional(),
  externalEmployeeId: z.string().max(120).nullable().optional(),
  status: z.string().max(40), // IN_PROGRESS | FINISHED_BY_USER | ...
  inTime: z.string().min(1), // ISO-8601 UTC
  outTime: z.string().nullable().optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  isTipped: z.boolean().default(false),
  tips: z.number().finite().default(0),
  payableSeconds: z.number().finite().min(0).default(0),
  overtimeSeconds: z.number().finite().min(0).default(0),
  unpaidBreakSeconds: z.number().finite().min(0).default(0),
  takenBreaks: z.array(z.object({
    start: z.string().nullable().optional(),
    end: z.string().nullable().optional(),
  })).default([]),
  missedBreaks: z.array(z.unknown()).default([]),
  anomalyCount: z.number().int().min(0).default(0),
  hourlyWage: z.number().finite().min(0).max(500).nullable().optional(),
});

const BodySchema = z.object({
  action: z.literal("ingest"),
  days: z.array(DaySchema).min(1).max(400),
});

const LaborBodySchema = z.object({
  action: z.literal("ingest-labor"),
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shifts: z.array(ShiftSchema).max(400),
});

// Full Toast roster for the pairing screens (names only — no wages).
const EmployeeBodySchema = z.object({
  action: z.literal("ingest-employees"),
  locationId: z.string().uuid(),
  employees: z.array(z.object({
    toastUserId: z.string().min(1).max(80),
    toastGuid: z.string().max(80).nullable().optional(),
    toastName: z.string().min(1).max(160),
    jobTitle: z.string().max(120).nullable().optional(),
    hourlyWage: z.number().finite().min(0).max(500).nullable().optional(),
  })).max(400),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Hourly buckets must add up to net sales exactly (remainder on biggest hour).
function reconcileHourly(net: number, hourly: z.infer<typeof DaySchema>["hourly"]) {
  const sum = hourly.reduce((s, h) => s + h.sales, 0);
  if (!(net > 0) || !(sum > 0) || Math.abs(sum - net) < 0.005) return hourly;
  const k = net / sum;
  const out = hourly.map((h) => ({ ...h, sales: Math.round(h.sales * k * 100) / 100 }));
  const diff = Math.round((net - out.reduce((s, h) => s + h.sales, 0)) * 100) / 100;
  if (diff !== 0) {
    let big = 0;
    out.forEach((h, i) => { if (h.sales > out[big].sales) big = i; });
    out[big].sales = Math.round((out[big].sales + diff) * 100) / 100;
  }
  return out;
}

async function assertToastLocation(supabase: any, locationId: string) {
  const { data } = await supabase
    .from("location_integrations")
    .select("is_active")
    .eq("location_id", locationId)
    .eq("integration_type", "toast")
    .maybeSingle();
  if (!data?.is_active) throw new Error(`Toast is not connected for location ${locationId}`);
}

async function ingestDay(supabase: any, day: z.infer<typeof DaySchema>) {
  const { locationId, date, source } = day;
  await assertToastLocation(supabase, locationId);

  const { data: existingRaw } = await supabase
    .from("toast_sales_cache")
    .select("data_source")
    .eq("location_id", locationId)
    .eq("sale_date", date)
    .maybeSingle();
  if (existingRaw && (SOURCE_RANK[existingRaw.data_source] ?? 0) > (SOURCE_RANK[source] ?? 0)) {
    return { date, skipped: `kept ${existingRaw.data_source} data` };
  }

  const hourly = reconcileHourly(day.netSales, day.hourly);
  const guests = Math.max(day.guestCount, day.checkCount);
  const avgTicket = day.checkCount > 0 ? day.netSales / day.checkCount : 0;
  const paymentsData = {
    source: "toast",
    tenders: day.payments.tenders,
    total_tips: day.payments.total_tips,
    metrics: { check_count: day.checkCount },
    toast_data_source: source,
  };
  const now = new Date().toISOString();

  const { error: rawErr } = await supabase.from("toast_sales_cache").upsert({
    location_id: locationId,
    sale_date: date,
    data_source: source,
    net_sales: day.netSales,
    guest_count: guests,
    check_count: day.checkCount,
    avg_ticket: avgTicket,
    hourly_data: hourly,
    payments_data: paymentsData,
    raw_payload: day.raw ?? null,
    flagged_no_sales: day.netSales === 0,
    fetched_at: now,
  }, { onConflict: "location_id,sale_date" });
  if (rawErr) throw new Error(`toast_sales_cache upsert failed for ${date}: ${rawErr.message}`);

  const { data: existingMail } = await supabase
    .from("sales_cache")
    .select("projected_sales, living_projection, override_projection, override_at, override_by, initial_projection, validation_status, validation_attempts, yoy_sale_date, yoy_net_sales, yoy_hourly_data")
    .eq("location_id", locationId)
    .eq("sale_date", date)
    .maybeSingle();

  const { error: mailErr } = await supabase.from("sales_cache").upsert({
    ...(existingMail ?? {}),
    location_id: locationId,
    sale_date: date,
    pos_source: "toast",
    net_sales: day.netSales,
    guest_count: guests,
    pizza_count: 0,
    avg_ticket: avgTicket,
    hourly_data: hourly,
    payments_data: paymentsData,
    flagged_no_sales: day.netSales === 0,
    fetched_at: now,
  }, { onConflict: "location_id,sale_date" });
  if (mailErr) throw new Error(`sales_cache upsert failed for ${date}: ${mailErr.message}`);

  // SDLY seed (−364d, same weekday).
  try {
    const yoyDate = addDays(date, -364);
    const { data: yoy } = await supabase
      .from("sales_cache").select("net_sales, hourly_data")
      .eq("location_id", locationId).eq("sale_date", yoyDate).maybeSingle();
    const yoyNet = Number(yoy?.net_sales ?? 0);
    if (yoyNet > 0 && !existingMail?.yoy_net_sales) {
      const hasProj = (existingMail?.living_projection ?? 0) > 0 || (existingMail?.initial_projection ?? 0) > 0 || (existingMail?.override_projection ?? 0) > 0;
      await supabase.from("sales_cache").update({
        yoy_sale_date: yoyDate,
        yoy_net_sales: yoyNet,
        yoy_hourly_data: yoy?.hourly_data ?? null,
        ...(hasProj ? {} : { initial_projection: yoyNet, living_projection: yoyNet }),
      }).eq("location_id", locationId).eq("sale_date", date);
    }
  } catch (e) {
    console.warn(`[toast-sync] SDLY seed skipped for ${date}:`, e);
  }

  // Live pace — only for the store's current business date.
  if (source === "live") {
    try {
      const { data: bd } = await supabase.rpc("business_date", { _location_id: locationId });
      if (bd && String(bd).slice(0, 10) === date) await runPace(supabase, locationId, date, day.netSales, hourly);
    } catch (e) {
      console.warn(`[toast-sync] pace skipped for ${date}:`, e);
    }
  }

  return { date, source, net_sales: day.netSales };
}

async function runPace(supabase: any, locationId: string, date: string, netSales: number, hourly: any[]) {
  const { data: settings } = await supabase
    .from("location_settings").select("timezone, hours_open, hours_close")
    .eq("location_id", locationId).maybeSingle();
  const tz = settings?.timezone || DEFAULT_TZ;
  const h = (v: unknown, d: number) => { const n = parseInt(String(v ?? "").split(":")[0], 10); return Number.isFinite(n) ? n : d; };
  const open = h(settings?.hours_open, 10);
  const close = h(settings?.hours_close, 22);

  const hist = await fetchHistoricalDataFromCache(supabase, locationId, date);
  const d = new Date(date + "T12:00:00Z");
  const dow = d.getUTCDay();
  const weekStart = addDays(date, -(dow === 0 ? 6 : dow - 1));
  const [{ data: weekRows }, { data: monthRows }] = await Promise.all([
    supabase.from("sales_cache").select("sale_date, net_sales").eq("location_id", locationId).gte("sale_date", weekStart).lte("sale_date", date),
    supabase.from("sales_cache").select("sale_date, net_sales").eq("location_id", locationId).gte("sale_date", `${date.slice(0, 7)}-01`).lte("sale_date", date),
  ]);
  const wb = (weekRows || []).map((r: any) => ({ date: r.sale_date, sales: Number(r.net_sales) || 0 }));
  const mb = (monthRows || []).map((r: any) => ({ date: r.sale_date, sales: Number(r.net_sales) || 0 }));
  const provisional =
    hist.fourWeekAverage?.avgDailyByDayOfWeek.find((x: any) => x.dayOfWeek === dow)?.avgSales ||
    hist.lastYearData?.sameDay || netSales || 0;

  const hourlyProj = generateHourlyProjections(hourly, open, close, date, locationId, provisional, hist.fourWeekHourlyPattern, hist.lastYearData?.hourlyData);
  const proj = generateProjections(
    netSales, wb.reduce((s: number, r: any) => s + r.sales, 0), mb.reduce((s: number, r: any) => s + r.sales, 0),
    wb, mb, getCurrentHourInTimezone(tz), getCurrentMinutesInTimezone(tz), open, close, date, locationId, hourlyProj,
    hist.lastYearData ? {
      sameDay: hist.lastYearData.sameDay, sameWeek: hist.lastYearData.sameWeek, sameMonth: hist.lastYearData.sameMonth,
      weeklyBreakdown: hist.lastYearData.weeklyBreakdown, yoyHourlyData: hist.lastYearData.hourlyData,
    } : undefined,
    hist.fourWeekAverage, hist.holidayContext,
  );

  if (proj.todayProjected > 0) {
    const { data: seed } = await supabase.from("sales_cache").select("initial_projection").eq("location_id", locationId).eq("sale_date", date).maybeSingle();
    await supabase.from("sales_cache").update({
      living_projection: proj.todayProjected,
      ...(!(Number(seed?.initial_projection) > 0) ? { initial_projection: proj.todayProjected } : {}),
    }).eq("location_id", locationId).eq("sale_date", date);
  }
  await computeAndSavePace(supabase, { locationId, date, timezone: tz, openHour: open, closeHour: close });
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function localHour(iso: string | null | undefined, tz: string, fallbackNow = true): number | null {
  if (!iso && !fallbackNow) return null;
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false })
      .formatToParts(d);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
    return Number.isFinite(h) ? (h === 24 ? 0 : h) : null;
  } catch {
    return null;
  }
}

// Distribute a shift's payable seconds across the store-local hours it spans
// (proportional, so hourly buckets always sum to the shift total).
function distributeHours(inIso: string, outIso: string | null, tz: string, totalHours: number) {
  const byHour: Record<number, number> = {};
  const startMs = new Date(inIso).getTime();
  if (Number.isNaN(startMs)) return byHour;
  const endMs = outIso ? new Date(outIso).getTime() : Date.now();
  if (Number.isNaN(endMs) || endMs <= startMs || !(totalHours > 0)) {
    const h0 = localHour(inIso, tz, false);
    if (h0 != null) byHour[h0] = (byHour[h0] ?? 0) + totalHours;
    return byHour;
  }
  // Walk the shift in 5-minute slices and bucket each slice by its local hour.
  const stepMs = 5 * 60_000;
  const share = totalHours / Math.ceil((endMs - startMs) / stepMs);
  for (let t = startMs; t < endMs; t += stepMs) {
    const h = localHour(new Date(t).toISOString(), tz, false);
    if (h != null) byHour[h] = (byHour[h] ?? 0) + share;
  }
  return byHour;
}

function minutesBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoA).getTime() - new Date(isoB).getTime()) / 60000);
}

// Full Toast roster → toast_employees. Names/job titles only; wages go to
// toast_employee_wages (admin-only) so paired profiles get Toast rates even
// before their first punch.
async function ingestEmployees(supabase: any, body: z.infer<typeof EmployeeBodySchema>) {
  const { locationId, employees } = body;
  await assertToastLocation(supabase, locationId);
  const dedup = new Map<string, { toast_name: string; job_title: string | null }>();
  for (const e of employees) dedup.set(e.toastUserId, { toast_name: e.toastName, job_title: e.jobTitle ?? null });
  if (dedup.size > 0) {
    const rows = [...dedup.entries()].map(([toastUserId, v]) => ({
      location_id: locationId,
      toast_user_id: toastUserId,
      toast_name: v.toast_name,
      job_title: v.job_title,
      is_active: true,
    }));
    const { error } = await supabase
      .from("toast_employees")
      .upsert(rows, { onConflict: "location_id,toast_user_id" });
    if (error) throw error;
  }
  const wages = new Map<string, number>();
  for (const e of employees) {
    if (e.hourlyWage && e.hourlyWage > 0) wages.set(e.toastUserId, e.hourlyWage);
  }
  if (wages.size > 0) {
    await supabase.from("toast_employee_wages").upsert(
      [...wages].map(([toastUserId, w]) => ({ location_id: locationId, toast_user_id: toastUserId, hourly_wage: w, updated_at: new Date().toISOString() })),
      { onConflict: "location_id,toast_user_id" },
    );
  }
  return { ok: true, employees: dedup.size, wages: wages.size };
}

async function ingestLabor(supabase: any, body: z.infer<typeof LaborBodySchema>) {
  const { locationId, date, shifts } = body;
  await assertToastLocation(supabase, locationId);
  // Toast's time-entries page sometimes loads blank. An empty read must never
  // wipe labor we already have for the day — keep the last good numbers.
  if (shifts.length === 0) {
    const { count } = await supabase.from("toast_shifts")
      .select("id", { count: "exact", head: true })
      .eq("location_id", locationId).eq("shift_date", date);
    if ((count ?? 0) > 0) return { ok: true, skipped: "empty_read_kept_existing", shifts: 0 };
  }

  const { data: settings } = await supabase
    .from("location_settings").select("timezone")
    .eq("location_id", locationId).maybeSingle();
  const tz = settings?.timezone || DEFAULT_TZ;

  // ── Employee matching: saved mappings first, then auto-match by exact name ──
  const { data: mappings } = await supabase
    .from("toast_employee_mappings").select("*")
    .eq("location_id", locationId);
  const byToastUser = new Map<string, any>((mappings || []).map((m: any) => [m.toast_user_id, m]));

  const unmatchedNames = [...new Set(shifts.map((s) => s.employeeName).filter(Boolean))]
    .filter((n) => ![...byToastUser.values()].some((m: any) => m.toast_name && norm(m.toast_name) === norm(n)));
  if (unmatchedNames.length > 0) {
    const { data: roster } = await supabase
      .from("user_locations")
      .select("user_id, profiles(full_name)")
      .eq("location_id", locationId);
    const byName = new Map<string, string>();
    for (const r of roster || []) {
      const full = String((r as any)?.profiles?.full_name ?? "").trim();
      if (full) byName.set(norm(full), (r as any).user_id);
    }
    for (const shift of shifts) {
      if (byToastUser.has(shift.toastUserId)) continue;
      const crooId = byName.get(norm(shift.employeeName)) ?? null;
      const { data: inserted, error: insErr } = await supabase
        .from("toast_employee_mappings")
        .upsert({
          location_id: locationId,
          toast_user_id: shift.toastUserId,
          toast_restaurant_user_id: shift.restaurantUserId ?? null,
          toast_name: shift.employeeName,
          croo_user_id: crooId,
          match_method: crooId ? "auto" : "auto",
        }, { onConflict: "location_id,toast_user_id" })
        .select("id, croo_user_id")
        .maybeSingle();
      if (!insErr) byToastUser.set(shift.toastUserId, { toast_name: shift.employeeName, croo_user_id: inserted?.croo_user_id ?? crooId });
    }
  }

  // Toast pay rates (Toast always wins). Private table; trigger pushes to paired profiles.
  const toastWage = new Map<string, number>();
  for (const sh of shifts) if (sh.hourlyWage && sh.hourlyWage > 0) toastWage.set(sh.toastUserId, sh.hourlyWage);
  if (toastWage.size > 0) {
    await supabase.from("toast_employee_wages").upsert(
      [...toastWage].map(([k, w]) => ({ location_id: locationId, toast_user_id: k, hourly_wage: w, updated_at: new Date().toISOString() })),
      { onConflict: "location_id,toast_user_id" });
  }
  {
    const missing = [...new Set(shifts.map((s) => s.toastUserId))].filter((k) => !toastWage.has(k));
    if (missing.length) {
      const { data: saved } = await supabase.from("toast_employee_wages")
        .select("toast_user_id, hourly_wage").eq("location_id", locationId).in("toast_user_id", missing);
      for (const r of saved || []) toastWage.set(r.toast_user_id, Number(r.hourly_wage));
    }
  }

  const crooIds = [...new Set(shifts.map((s) => byToastUser.get(s.toastUserId)?.croo_user_id).filter(Boolean))];
  const wageByUser = new Map<string, number | null>();
  if (crooIds.length > 0) {
    const [{ data: wages }, { data: profs }] = await Promise.all([
      supabase.from("wage_history")
        .select("user_id, hourly_wage, effective_date")
        .in("user_id", crooIds).lte("effective_date", date)
        .order("effective_date", { ascending: false }),
      supabase.from("profiles").select("id, hourly_wage").in("id", crooIds),
    ]);
    const best = new Map<string, number>();
    for (const w of wages || []) {
      if (!best.has(w.user_id)) best.set(w.user_id, Number(w.hourly_wage));
    }
    for (const p of profs || []) {
      if (!best.has(p.id)) best.set(p.id, Number(p.hourly_wage));
    }
    for (const id of crooIds) wageByUser.set(id, best.has(id) ? best.get(id)! : null);
  }

  // ── Pair punches against the CrooHQ schedule for alerts ──
  const { data: scheduled } = await supabase
    .from("scheduled_shifts")
    .select("id, user_id, start_time, end_time, is_time_off")
    .eq("shift_date", date)
    .in("user_id", crooIds.length > 0 ? crooIds : ["00000000-0000-0000-0000-000000000000"]);
  const scheduledByUser = new Map<string, any[]>();
  for (const s of scheduled || []) {
    const list = scheduledByUser.get(s.user_id) || [];
    list.push(s);
    scheduledByUser.set(s.user_id, list);
  }

  const isToday = await (async () => {
    try {
      const { data: bd } = await supabase.rpc("business_date", { _location_id: locationId });
      return bd && String(bd).slice(0, 10) === date;
    } catch { return false; }
  })();

  // Store managers receive the punch alerts.
  let managerIds: string[] = [];
  if (isToday) {
    const { data: loc } = await supabase
      .from("locations").select("organization_id").eq("id", locationId).maybeSingle();
    if (loc?.organization_id) {
      const { data: members } = await supabase
        .from("organization_members")
        .select("user_id, org_role")
        .eq("organization_id", loc.organization_id)
        .in("org_role", ["admin", "super_admin", "org_admin", "general_manager", "manager"]);
      managerIds = (members || []).map((m: any) => m.user_id);
    }
  }

  const employeeBreakdown: unknown[] = [];
  const hourlyByHour: Record<number, number> = {};
  let totalHours = 0;
  let totalCost: number | null = 0;

  for (const shift of shifts) {
    const mapping = byToastUser.get(shift.toastUserId) ?? null;
    const crooId: string | null = mapping?.croo_user_id ?? null;
    const outIso = shift.outTime ?? null;
    // Toast reports 0 payable hours until clock-out; count open shifts live.
    let paySec = shift.payableSeconds;
    if (!shift.outTime && paySec === 0) {
      paySec = Math.max(0, (Date.now() - new Date(shift.inTime).getTime()) / 1000 - shift.unpaidBreakSeconds);
    }
    const hours = Math.round((paySec / 3600) * 100) / 100;
    totalHours += hours;

    // Breaks: taken breaks, plus "currently on break" for active shifts.
    const takenBreaks = (shift.takenBreaks || []).map((b) => ({ start: b.start ?? null, end: b.end ?? null }));
    const openBreak = shift.status === "IN_PROGRESS"
      ? (takenBreaks.find((b) => b.start && !b.end) ?? null)
      : null;

    const scheduledList = crooId ? scheduledByUser.get(crooId) || [] : [];
    const pairedScheduled = scheduledList.find((s) => !s.is_time_off) ?? scheduledList[0] ?? null;
    let lateMinutes: number | null = null;
    if (pairedScheduled) {
      // Compare in store-local wall clock (both sides are HH:mm strings of the same date).
      const inLocal = localHour(shift.inTime, tz, false);
      if (inLocal != null) {
        const schedHour = parseInt(String(pairedScheduled.start_time).slice(0, 2), 10);
        const schedMin = parseInt(String(pairedScheduled.start_time).slice(3, 5), 10);
        const late = (inLocal * 60) - (schedHour * 60 + schedMin);
        if (late > 5) lateMinutes = late;
      }
    }

    employeeBreakdown.push({
      id: shift.id,
      employeeName: shift.employeeName,
      toast_user_id: shift.toastUserId,
      croo_user_id: crooId,
      status: shift.status,
      in_time: shift.inTime,
      out_time: outIso,
      hours,
      job_title: shift.jobTitle ?? null,
      is_tipped: shift.isTipped,
      tips: shift.tips,
      on_break: !!openBreak,
      current_break_start: openBreak?.start ?? null,
      breaks: takenBreaks,
      missed_breaks: shift.missedBreaks?.length ?? 0,
      anomalies: shift.anomalyCount,
      late_minutes: lateMinutes,
      overtime_hours: Math.round((shift.overtimeSeconds / 3600) * 100) / 100,
    });

    // Persist the read-only shift row for the mobile schedule / pairing UI.
    await supabase.from("toast_shifts").upsert({
      location_id: locationId,
      toast_shift_id: shift.id,
      shift_date: date,
      employee_name: shift.employeeName,
      toast_user_id: shift.toastUserId,
      restaurant_user_id: shift.restaurantUserId ?? null,
      external_employee_id: shift.externalEmployeeId ?? null,
      status: shift.status,
      in_time: shift.inTime,
      out_time: outIso,
      breaks: takenBreaks,
      missed_breaks: shift.missedBreaks ?? [],
      job_title: shift.jobTitle ?? null,
      is_tipped: shift.isTipped,
      tips: shift.tips,
      payable_seconds: Math.round(shift.payableSeconds),
      overtime_seconds: Math.round(shift.overtimeSeconds),
      unpaid_break_seconds: Math.round(shift.unpaidBreakSeconds),
      anomaly_count: shift.anomalyCount,
      croo_user_id: crooId,
      croo_scheduled_shift_id: pairedScheduled?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "location_id,toast_shift_id" });

    const byHour = distributeHours(shift.inTime, outIso, tz, hours);
    for (const [h, v] of Object.entries(byHour)) hourlyByHour[Number(h)] = (hourlyByHour[Number(h)] ?? 0) + v;

    const rate = toastWage.get(shift.toastUserId) ?? (crooId ? wageByUser.get(crooId) ?? null : null);
    if (rate != null) totalCost = (totalCost ?? 0) + hours * rate;
  }
  totalCost = totalCost == null || totalCost === 0 ? null : Math.round(totalCost * 100) / 100;

  const hourlyBreakdown = Object.entries(hourlyByHour)
    .map(([h, v]) => ({ hour: `${String(Number(h)).padStart(2, "0")}:00`, hours: Math.round(v * 100) / 100 }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const now = new Date().toISOString();
  const { error: labErr } = await supabase.from("labor_cache").upsert({
    location_id: locationId,
    labor_date: date,
    source: "toast",
    labor_hours: Math.round(totalHours * 100) / 100,
    labor_cost: totalCost,
    overtime_hours: Math.round(employeeBreakdown.reduce((s: number, e: any) => s + (e.overtime_hours || 0), 0) * 100) / 100,
    hourly_breakdown: hourlyBreakdown,
    employee_breakdown: employeeBreakdown,
    is_stale: false,
    fetched_at: now,
    updated_at: now,
  }, { onConflict: "location_id,labor_date,source" });
  if (labErr) throw new Error(`labor_cache upsert failed for ${date}: ${labErr.message}`);

  // ── Punch alerts (today only, paired against the CrooHQ schedule) ──
  if (isToday) {
    const queueRows: any[] = [];
    for (const e of employeeBreakdown as any[]) {
      if (e.croo_user_id && e.late_minutes != null) {
        queueRows.push({
          alert_type: "toast_late_clock_in",
          dedup_key: `toast-late-in:${e.id}`,
          location_id: locationId,
          payload: {
            title: "Late clock-in",
            body: `${e.employeeName} clocked in ${e.late_minutes} min late (from Toast).`,
            user_ids: managerIds,
            notification_type: "toast_late_clock_in",
            data: { location_id: locationId, shift_id: e.id, late_minutes: e.late_minutes },
          },
        });
      }
      // Active shift still on the clock well past its scheduled end.
      if (e.croo_user_id && e.status === "IN_PROGRESS" && scheduledByUser.get(e.croo_user_id)?.length) {
        const sched = scheduledByUser.get(e.croo_user_id).find((s: any) => !s.is_time_off);
        if (sched) {
          const endH = parseInt(String(sched.end_time).slice(0, 2), 10);
          const endM = parseInt(String(sched.end_time).slice(3, 5), 10);
          const nowLocal = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
          const [nh, nm] = nowLocal.split(":").map(Number);
          const over = (nh * 60 + nm) - (endH * 60 + endM);
          if (over > 15) {
            queueRows.push({
              alert_type: "toast_no_clock_out",
              dedup_key: `toast-no-out:${e.id}:${date}`,
              location_id: locationId,
              payload: {
                title: "Missing clock-out",
                body: `${e.employeeName} is still on the clock ${over} min past their scheduled end (from Toast).`,
                user_ids: managerIds,
                notification_type: "toast_no_clock_out",
                data: { location_id: locationId, shift_id: e.id, minutes_over: over },
              },
            });
          }
        }
      }
    }
    if (queueRows.length > 0 && managerIds.length > 0) {
      await supabase.from("alert_queue").upsert(queueRows, { onConflict: "dedup_key" });
    }
  }

  return {
    location_id: locationId,
    date,
    hours: Math.round(totalHours * 100) / 100,
    employees: employeeBreakdown.length,
    matched: employeeBreakdown.filter((e: any) => (e as any).croo_user_id).length,
    alerts: (employeeBreakdown.filter((e: any) => e.late_minutes != null) as any[]).length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if ((body as any)?.action === "ingest-labor") {
    const labor = LaborBodySchema.safeParse(body);
    if (!labor.success) return json({ error: labor.error.flatten() }, 400);
    const supabaseLabor = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    try {
      const result = await ingestLabor(supabaseLabor, labor.data);
      return json({ success: true, result });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if ((body as any)?.action === "ingest-employees") {
    const emp = EmployeeBodySchema.safeParse(body);
    if (!emp.success) return json({ error: emp.error.flatten() }, 400);
    const supabaseEmp = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    try {
      const result = await ingestEmployees(supabaseEmp, emp.data);
      return json({ success: true, result });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (parsed.data.action === "ingest-labor") {
    const labor = LaborBodySchema.safeParse(body);
    if (!labor.success) return json({ error: labor.error.flatten() }, 400);
    try {
      const result = await ingestLabor(supabase, labor.data);
      return json({ success: true, result });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  const results: unknown[] = [];
  for (const day of parsed.data.days) {
    try {
      results.push(await ingestDay(supabase, day));
    } catch (e) {
      results.push({ date: day.date, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json({ success: true, results });
});
