// Aloha (NCR Aloha Enterprise) → aloha_sales_cache sync — Buffalo Wild Wings GO.
//
// Mirrors clover-sync exactly:
//   • Brand guard: refuses non-BWW GO locations.
//   • Dual-write: raw → aloha_sales_cache, normalized → sales_cache (pos_source='aloha').
//   • YOY seed (−364d) inside syncOneDay.
//   • Shared projection + pace engine for "today" only.
//   • Conditional-spread merge protects projected/labor/payments_data.
//   • Labor optionally dual-written to labor_cache with source='aloha'.
//
// The ONLY stubbed piece is fetchAlohaDay(). Fill it in once the data path is
// confirmed (Aloha Cloud API vs Insight SFTP vs portal scrape) — everything
// downstream lights up automatically. See docs/brands/bww-go.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  fetchHistoricalDataFromCache,
  generateHourlyProjections,
  generateProjections,
  getCurrentHourInTimezone,
  getCurrentMinutesInTimezone,
} from "../_shared/projections.ts";
import {
  alohaLogin,
  fetchAlohaGridCsv,
  parseAlohaGridCsv,
  type AlohaGridRow,
} from "../_shared/aloha-portal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BWW_GO_BRAND_ID = "164ed861-d3bd-426d-8993-0403aa390634";
const DEFAULT_TZ = "America/Los_Angeles";

interface Body {
  action:
    | "sync_today"
    | "sync_yesterday"
    | "sync_date"
    | "sync_range"
    | "sync_dates"
    | "sync_all_today"
    | "sync_all_yesterday";
  locationId?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  dates?: string[];
}

interface AlohaCreds {
  portal_url: string;
  company_id: string;
  username: string;
  password: string;
  store_id?: string | null;   // Aloha store name/number for matching CSV rows
}

interface Hour {
  hour: string;
  sales: number;
  checksCount: number;
}

interface AlohaDayPayload {
  netSales: number;
  guestCount: number;
  avgTicket: number;
  hourly: Hour[];
  productMix: Array<{ item_id: string; name: string; quantity: number; gross: number }>;
  paymentsData: {
    source: "aloha";
    tenders: Array<{ label: string; count: number; amount: number; tips: number }>;
    total_tips: number;
  };
  labor?: {
    total_hours: number;
    total_cost: number;
    hourly: Array<{ hour: string; hours: number; cost: number }>;
  };
}

// ── Date helpers (store-local, yyyy-MM-dd strings) ─────────────────────────
function todayInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const y2 = dt.getUTCFullYear();
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getUTCDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function getLocationTimezone(supabase: any, locationId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("location_settings")
      .select("timezone")
      .eq("location_id", locationId)
      .maybeSingle();
    return (data?.timezone as string) || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

// ── Brand guard ────────────────────────────────────────────────────────────
async function assertBwwGoLocation(supabase: any, locationId: string) {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, organization_id, organizations!inner(brand_id)")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(`Location lookup failed: ${error.message}`);
  if (!data) throw new Error(`Location ${locationId} not found`);
  const brandId = data.organizations?.brand_id;
  if (brandId !== BWW_GO_BRAND_ID) {
    throw new Error(
      `Brand guard: location ${locationId} brand ${brandId} is not Buffalo Wild Wings GO. Aloha sync refused.`,
    );
  }
  return { name: data.name as string };
}

async function getAlohaCreds(supabase: any, locationId: string): Promise<AlohaCreds> {
  const { data, error } = await supabase
    .from("location_integrations")
    .select("credentials, is_active")
    .eq("location_id", locationId)
    .eq("integration_type", "aloha")
    .maybeSingle();
  if (error) throw new Error(`Creds lookup failed: ${error.message}`);
  if (!data) throw new Error(`No Aloha integration configured for location ${locationId}`);
  if (!data.is_active) throw new Error(`Aloha integration is disabled for location ${locationId}`);
  const c = data.credentials as AlohaCreds;
  if (!c?.username || !c?.password) throw new Error("Aloha credentials missing username or password");
  return {
    portal_url: c.portal_url ?? "https://sierrafoodgroup.alohaenterprise.com",
    company_id: c.company_id ?? "sfg07",
    username: c.username,
    password: c.password,
    store_id: c.store_id ?? null,
  };
}

async function getLocationName(supabase: any, locationId: string): Promise<string> {
  const { data } = await supabase.from("locations").select("name").eq("id", locationId).maybeSingle();
  return (data?.name as string) ?? "";
}

// ═══════════════════════════════════════════════════════════════════════════
// fetchAlohaDay — pulls the "AllStores" grid summary for the given date,
// finds the row matching this location, and maps it into AlohaDayPayload.
//
// The Aloha Insight grid gives us daily totals only — Net Sales, Labor $/hrs,
// Guest Count, PPA, Comps, Promos, Voids. Hourly breakdown and product mix
// come from separate report endpoints; those can be layered in later.
// For now hourly[] is a single lump bucket at open, productMix[] is empty,
// and paymentsData carries a placeholder single "aloha" tender row.
// ═══════════════════════════════════════════════════════════════════════════
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchAlohaDay(
  creds: AlohaCreds,
  date: string,
  _tz: string,
  locationName: string,
): Promise<AlohaDayPayload> {
  const session = await alohaLogin({
    portalUrl: creds.portal_url,
    companyId: creds.company_id,
    loginName: creds.username,
    password: creds.password,
  });

  // 5 = AllStores. Aloha date format on this deployment is YYYY-MM-DD.
  const csv = await fetchAlohaGridCsv(session, creds.portal_url, date, date, 5, 0);
  const { stores } = parseAlohaGridCsv(csv);

  if (stores.length === 0) {
    throw new Error(`Aloha returned no rows for ${date} — CSV empty`);
  }

  const target = normalizeName(creds.store_id || locationName);
  let row: AlohaGridRow | undefined = stores.find((s) => normalizeName(s.StoreName) === target);
  if (!row && stores.length === 1) row = stores[0];
  if (!row) {
    const known = stores.map((s) => s.StoreName).join(", ");
    throw new Error(
      `Aloha: no store row matched "${creds.store_id || locationName}". ` +
      `Available: ${known}. Update the Store ID field on the integration card to one of these names.`,
    );
  }

  return {
    netSales: row.NetSales,
    guestCount: row.GuestCount,
    avgTicket: row.CKAvg || (row.CheckCount > 0 ? row.NetSales / row.CheckCount : 0),
    hourly: [],
    productMix: [],
    paymentsData: {
      source: "aloha",
      tenders: [],
      total_tips: 0,
    },
    labor: {
      total_hours: row.LaborHours,
      total_cost: row.LaborDollars,
      hourly: [],
    },
  };
}

// ── Sync one day ────────────────────────────────────────────────────────────
async function syncOneDay(
  supabase: any,
  locationId: string,
  creds: AlohaCreds,
  date: string,
  tz: string,
  locationName: string,
) {
  const payload = await fetchAlohaDay(creds, date, tz, locationName);

  // ── Raw archive: aloha_sales_cache (conditional-spread merge) ─────────
  const { data: existingRaw } = await supabase
    .from("aloha_sales_cache")
    .select("*")
    .eq("location_id", locationId)
    .eq("sale_date", date)
    .maybeSingle();

  const rawRow = {
    ...(existingRaw ?? {}),
    location_id: locationId,
    sale_date: date,
    net_sales: payload.netSales,
    guest_count: payload.guestCount,
    avg_ticket: payload.avgTicket,
    hourly_data: payload.hourly,
    product_mix: payload.productMix,
    payments_data: payload.paymentsData,
    flagged_no_sales: payload.netSales === 0,
    fetched_at: new Date().toISOString(),
  };
  delete (rawRow as any).created_at;

  const { error: rawErr } = await supabase
    .from("aloha_sales_cache")
    .upsert(rawRow, { onConflict: "location_id,sale_date" });
  if (rawErr) throw new Error(`aloha_sales_cache upsert failed for ${date}: ${rawErr.message}`);

  // ── Mailroom: sales_cache (POS-agnostic, protects projections/overrides) ─
  const { data: existingMail } = await supabase
    .from("sales_cache")
    .select("projected_sales, living_projection, override_projection, override_at, override_by, initial_projection, validation_status, validation_attempts, yoy_sale_date, yoy_net_sales, yoy_hourly_data")
    .eq("location_id", locationId)
    .eq("sale_date", date)
    .maybeSingle();

  const mailRow = {
    ...(existingMail ?? {}),
    location_id: locationId,
    sale_date: date,
    pos_source: "aloha",
    net_sales: payload.netSales,
    guest_count: payload.guestCount,
    pizza_count: 0,
    avg_ticket: payload.avgTicket,
    hourly_data: payload.hourly,
    product_mix: payload.productMix,
    payments_data: payload.paymentsData,
    flagged_no_sales: payload.netSales === 0,
    fetched_at: new Date().toISOString(),
  };

  const { error: mailErr } = await supabase
    .from("sales_cache")
    .upsert(mailRow, { onConflict: "location_id,sale_date" });
  if (mailErr) throw new Error(`sales_cache upsert failed for ${date}: ${mailErr.message}`);

  // ── Labor dual-write (source='aloha'). Punch clock keeps writing
  //     source='punch_clock' independently; both coexist per unique
  //     (location_id, labor_date, source). ──
  if (payload.labor) {
    try {
      await supabase.from("labor_cache").upsert(
        {
          location_id: locationId,
          labor_date: date,
          source: "aloha",
          labor_hours: payload.labor.total_hours,
          labor_cost: payload.labor.total_cost,
          hourly_breakdown: payload.labor.hourly,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "location_id,labor_date,source" },
      );
    } catch (e) {
      console.warn(`[aloha-sync] labor_cache upsert skipped for ${date}:`, e);
    }
  }

  // ── YOY projection seed (−364d, same weekday) ─────────────────────────
  try {
    const existingProj = existingMail ?? {};
    const hasProjection =
      (existingProj.living_projection ?? 0) > 0 ||
      (existingProj.initial_projection ?? 0) > 0 ||
      (existingProj.override_projection ?? 0) > 0;
    if (!hasProjection) {
      const yoyDate = addDays(date, -364);
      const { data: yoy } = await supabase
        .from("sales_cache")
        .select("net_sales, hourly_data")
        .eq("location_id", locationId)
        .eq("sale_date", yoyDate)
        .maybeSingle();
      const yoyNet = Number(yoy?.net_sales ?? 0);
      if (yoyNet > 0) {
        await supabase.from("sales_cache").update({
          initial_projection: yoyNet,
          living_projection: yoyNet,
          yoy_sale_date: yoyDate,
          yoy_net_sales: yoyNet,
          yoy_hourly_data: yoy?.hourly_data ?? null,
        }).eq("location_id", locationId).eq("sale_date", date);
      }
    } else if (!existingProj.yoy_net_sales) {
      const yoyDate = addDays(date, -364);
      const { data: yoy } = await supabase
        .from("sales_cache")
        .select("net_sales, hourly_data")
        .eq("location_id", locationId)
        .eq("sale_date", yoyDate)
        .maybeSingle();
      if (yoy?.net_sales) {
        await supabase.from("sales_cache").update({
          yoy_sale_date: yoyDate,
          yoy_net_sales: Number(yoy.net_sales),
          yoy_hourly_data: yoy.hourly_data ?? null,
        }).eq("location_id", locationId).eq("sale_date", date);
      }
    }
  } catch (e) {
    console.warn(`[aloha-sync] YOY seed skipped for ${date}:`, e);
  }

  // ── Shared projection + pace engine (POS-agnostic) — today only ────────
  try {
    const todayLocal = todayInTz(tz);
    if (date === todayLocal) {
      let hoursOpen = 10;
      let hoursClose = 22;
      try {
        const { data: hoursRow } = await supabase
          .from("location_settings")
          .select("business_hours_open, business_hours_close")
          .eq("location_id", locationId)
          .maybeSingle();
        if (hoursRow?.business_hours_open != null) hoursOpen = Number(hoursRow.business_hours_open);
        if (hoursRow?.business_hours_close != null) hoursClose = Number(hoursRow.business_hours_close);
      } catch {}

      const hist = await fetchHistoricalDataFromCache(supabase, locationId, date);

      const [{ data: weekRows }, { data: monthRows }] = await Promise.all([
        supabase.from("sales_cache")
          .select("sale_date, net_sales")
          .eq("location_id", locationId)
          .gte("sale_date", (() => {
            const d = new Date(date + "T12:00:00");
            const dow = d.getDay();
            const diff = dow === 0 ? 6 : dow - 1;
            d.setDate(d.getDate() - diff);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          })())
          .lte("sale_date", date),
        supabase.from("sales_cache")
          .select("sale_date, net_sales")
          .eq("location_id", locationId)
          .gte("sale_date", `${date.slice(0, 7)}-01`)
          .lte("sale_date", date),
      ]);

      const weeklyBreakdown = (weekRows || []).map((r: any) => ({ date: r.sale_date, sales: Number(r.net_sales) || 0 }));
      const monthlyBreakdown = (monthRows || []).map((r: any) => ({ date: r.sale_date, sales: Number(r.net_sales) || 0 }));
      const weeklySales = weeklyBreakdown.reduce((s, r) => s + r.sales, 0);
      const monthlySales = monthlyBreakdown.reduce((s, r) => s + r.sales, 0);

      const provisionalDaily =
        (hist.fourWeekAverage?.avgDailyByDayOfWeek.find(
          (d) => d.dayOfWeek === new Date(date + "T12:00:00").getDay(),
        )?.avgSales) ||
        hist.lastYearData?.sameDay ||
        payload.netSales ||
        0;

      const hourlyProjections = generateHourlyProjections(
        payload.hourly,
        hoursOpen,
        hoursClose,
        date,
        locationId,
        provisionalDaily,
        hist.fourWeekHourlyPattern,
        hist.lastYearData?.hourlyData,
      );

      const currentHour = getCurrentHourInTimezone(tz);
      const currentMinutes = getCurrentMinutesInTimezone(tz);

      const projections = generateProjections(
        payload.netSales,
        weeklySales,
        monthlySales,
        weeklyBreakdown,
        monthlyBreakdown,
        currentHour,
        currentMinutes,
        hoursOpen,
        hoursClose,
        date,
        locationId,
        hourlyProjections,
        hist.lastYearData
          ? {
              sameDay: hist.lastYearData.sameDay,
              sameWeek: hist.lastYearData.sameWeek,
              sameMonth: hist.lastYearData.sameMonth,
              weeklyBreakdown: hist.lastYearData.weeklyBreakdown,
              yoyHourlyData: hist.lastYearData.hourlyData,
            }
          : undefined,
        hist.fourWeekAverage,
        hist.holidayContext,
      );

      const paceUpdate: Record<string, any> = {
        pace_adjusted_projection: projections.todayPaceAdjusted,
        pace_calculated_at: new Date().toISOString(),
      };
      if (projections.todayProjected > 0) {
        paceUpdate.living_projection = projections.todayProjected;
        const { data: seedCheck } = await supabase
          .from("sales_cache")
          .select("initial_projection")
          .eq("location_id", locationId)
          .eq("sale_date", date)
          .maybeSingle();
        if (!seedCheck?.initial_projection || Number(seedCheck.initial_projection) <= 0) {
          paceUpdate.initial_projection = projections.todayProjected;
        }
      }
      await supabase
        .from("sales_cache")
        .update(paceUpdate)
        .eq("location_id", locationId)
        .eq("sale_date", date);

      console.log(
        `[aloha-sync] pace for ${locationId} ${date}: actual=$${payload.netSales.toFixed(0)}, ` +
        `target=$${projections.todayProjected.toFixed(0)}, pace=$${projections.todayPaceAdjusted}`,
      );
    }
  } catch (e) {
    console.warn(`[aloha-sync] pace calc skipped for ${date}:`, e);
  }

  return {
    date,
    net_sales: payload.netSales,
    guest_count: payload.guestCount,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { action } = body;
    if (!action) throw new Error("action required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fan-out: sync today/yesterday for every active BWW GO Aloha location
    if (action === "sync_all_today" || action === "sync_all_yesterday") {
      const { data: integrations, error } = await supabase
        .from("location_integrations")
        .select("location_id, locations!inner(id, name, organizations!inner(brand_id))")
        .eq("integration_type", "aloha")
        .eq("is_active", true);
      if (error) throw new Error(`fan-out lookup failed: ${error.message}`);

      const bwwLocations = (integrations ?? []).filter(
        (i: any) => i.locations?.organizations?.brand_id === BWW_GO_BRAND_ID,
      );
      const results: any[] = [];
      for (const i of bwwLocations) {
        const lid = i.location_id as string;
        const lname = i.locations?.name as string;
        try {
          const tz = await getLocationTimezone(supabase, lid);
          const todayLocal = todayInTz(tz);
          const target = action === "sync_all_today" ? todayLocal : addDays(todayLocal, -1);
          const creds = await getAlohaCreds(supabase, lid);
          const r = await syncOneDay(supabase, lid, creds, target, tz);
          results.push({ location: lname, tz, ...r });
        } catch (e) {
          console.error(`[aloha-sync] fan-out ${lid} failed:`, e);
          results.push({ location: lname, locationId: lid, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return new Response(
        JSON.stringify({ success: true, action, count: results.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const locationId = body.locationId;
    if (!locationId) throw new Error("locationId required");

    const { name } = await assertBwwGoLocation(supabase, locationId);
    const creds = await getAlohaCreds(supabase, locationId);
    const tz = await getLocationTimezone(supabase, locationId);
    const today = todayInTz(tz);

    let dates: string[] = [];
    if (action === "sync_today") dates = [today];
    else if (action === "sync_yesterday") dates = [addDays(today, -1)];
    else if (action === "sync_date") {
      if (!body.date) throw new Error("date required for sync_date");
      dates = [body.date];
    } else if (action === "sync_range") {
      if (!body.startDate || !body.endDate) throw new Error("startDate and endDate required");
      let cur = body.startDate;
      while (cur <= body.endDate) { dates.push(cur); cur = addDays(cur, 1); }
      if (dates.length > 60) throw new Error("range too large (max 60 days)");
    } else if (action === "sync_dates") {
      if (!Array.isArray(body.dates) || body.dates.length === 0) {
        throw new Error("dates[] required for sync_dates");
      }
      if (body.dates.length > 30) throw new Error("max 30 dates per sync_dates call");
      dates = body.dates;
    } else {
      throw new Error(`unknown action: ${action}`);
    }

    const results: any[] = [];
    for (const d of dates) {
      try {
        results.push(await syncOneDay(supabase, locationId, creds, d, tz));
      } catch (e) {
        console.error(`[aloha-sync] ${locationId} ${d} failed:`, e);
        results.push({ date: d, error: e instanceof Error ? e.message : String(e) });
      }
      await sleep(200);
    }

    return new Response(
      JSON.stringify({ success: true, location: name, action, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[aloha-sync] error", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
