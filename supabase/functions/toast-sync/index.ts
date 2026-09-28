// Toast → toast_sales_cache + sales_cache (pos_source='toast').
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
// No labor — labor_cache is never touched by Toast.

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

const BodySchema = z.object({
  action: z.literal("ingest"),
  days: z.array(DaySchema).min(1).max(400),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
