// Clover → clover_sales_cache sync (Playa Bowls scoped).
// Mirrors the QU/Blaze sync shape: per-day rows with net_sales, guest_count,
// avg_ticket, hourly_data, product_mix, payments_data.
//
// Brand guard: hard-refuses any location whose organization is not Playa Bowls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLAYA_BOWLS_BRAND_ID = "5fb4ef79-b0e4-4f06-9e88-1f88510dc4ab";
const TZ = "America/Los_Angeles";

const BASE = (env: string) =>
  env === "sandbox" ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";

interface Body {
  action: "sync_today" | "sync_yesterday" | "sync_date" | "sync_range" | "sync_all_today";
  locationId?: string;    // required except for sync_all_today
  date?: string;          // yyyy-MM-dd, for sync_date
  startDate?: string;     // for sync_range
  endDate?: string;       // for sync_range
}

interface CloverCreds {
  api_token: string;
  merchant_id: string;
  environment?: "production" | "sandbox";
}

// ── Date helpers (PST/PDT, yyyy-MM-dd strings) ──────────────────────────────
function pstNow(): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
  };
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

// Convert business date (PST midnight to next PST midnight) to UTC ms window.
function businessDayWindowMs(date: string): { startMs: number; endMs: number } {
  // Use Intl to find the UTC offset at this date in TZ.
  const [y, m, d] = date.split("-").map(Number);
  // Build noon-local then derive midnight using the offset.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMin = -new Date(probe.toLocaleString("en-US", { timeZone: TZ })).getTimezoneOffset();
  // Simpler & robust: start = 00:00 in TZ; build it via a UTC date offset by tz offset (in minutes).
  const tzOffsetMs = (new Date(probe).getTime() - new Date(probe.toLocaleString("en-US", { timeZone: TZ })).getTime());
  const startLocalUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const startMs = startLocalUtc + tzOffsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

// ── Brand guard ─────────────────────────────────────────────────────────────
async function assertPlayaLocation(supabase: any, locationId: string) {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, organization_id, organizations!inner(brand_id)")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(`Location lookup failed: ${error.message}`);
  if (!data) throw new Error(`Location ${locationId} not found`);
  const brandId = data.organizations?.brand_id;
  if (brandId !== PLAYA_BOWLS_BRAND_ID) {
    throw new Error(
      `Brand guard: location ${locationId} brand ${brandId} is not Playa Bowls. Clover sync refused.`,
    );
  }
  return { name: data.name as string };
}

async function getCloverCreds(supabase: any, locationId: string): Promise<CloverCreds> {
  const { data, error } = await supabase
    .from("location_integrations")
    .select("credentials, is_active")
    .eq("location_id", locationId)
    .eq("integration_type", "clover")
    .maybeSingle();
  if (error) throw new Error(`Creds lookup failed: ${error.message}`);
  if (!data) throw new Error(`No Clover integration configured for location ${locationId}`);
  if (!data.is_active) throw new Error(`Clover integration is disabled for location ${locationId}`);
  const c = data.credentials as CloverCreds;
  if (!c?.api_token || !c?.merchant_id) throw new Error("Clover credentials missing api_token or merchant_id");
  return { api_token: c.api_token, merchant_id: c.merchant_id, environment: c.environment ?? "production" };
}

// ── Clover API ──────────────────────────────────────────────────────────────
async function cloverFetch(
  creds: CloverCreds,
  path: string,
  qs: Array<[string, string | number]> = [],
) {
  const url = new URL(`${BASE(creds.environment ?? "production")}${path}`);
  for (const [k, v] of qs) url.searchParams.append(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${creds.api_token}` } });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Clover ${path} ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

// Fetch all paid orders in the window. Clover paginates with offset/limit (max 1000).
async function fetchOrdersForWindow(creds: CloverCreds, startMs: number, endMs: number) {
  const all: any[] = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const page = await cloverFetch(creds, `/v3/merchants/${creds.merchant_id}/orders`, [
      ["filter", `clientCreatedTime>=${startMs}`],
      ["filter", `clientCreatedTime<${endMs}`],
      ["expand", "lineItems,payments"],
      ["limit", limit],
      ["offset", offset],
    ]);
    const items: any[] = page.elements ?? [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
    if (offset > 20000) break;
  }
  return all;
}

async function fetchPaymentsForWindow(creds: CloverCreds, startMs: number, endMs: number) {
  const all: any[] = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const page = await cloverFetch(creds, `/v3/merchants/${creds.merchant_id}/payments`, [
      ["filter", `createdTime>=${startMs}`],
      ["filter", `createdTime<${endMs}`],
      ["expand", "tender"],
      ["limit", limit],
      ["offset", offset],
    ]);
    const items: any[] = page.elements ?? [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
    if (offset > 20000) break;
  }
  return all;
}

// ── Aggregation ─────────────────────────────────────────────────────────────
type Hour = { hour: string; sales: number; checksCount: number };

function aggregateOrders(orders: any[], startMs: number) {
  // Clover amounts are in cents.
  let netSales = 0;
  let guestCount = 0;
  let checkCount = 0;
  const hourly: Hour[] = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    sales: 0,
    checksCount: 0,
  }));

  // Product mix: aggregate line items by item id/name.
  const mix = new Map<string, { item_id: string; name: string; quantity: number; gross: number }>();

  for (const o of orders) {
    // Skip voided/refunded orders entirely.
    if (o.state === "open" || o.state === "voided") continue;
    if (o.deletedTimestamp) continue;

    const total = (o.total ?? 0) / 100; // cents → dollars
    if (total <= 0) continue;

    netSales += total;
    checkCount += 1;
    // Guest count: Clover stores in o.note rarely; fall back to 1 per order.
    const guests = Math.max(1, Number(o.guestCount ?? 0) || 1);
    guestCount += guests;

    // Hour bucket (PST hour within window). Use clientCreatedTime if present.
    const t = o.clientCreatedTime ?? o.createdTime ?? startMs;
    const hourIdx = Math.max(0, Math.min(23, Math.floor((t - startMs) / (60 * 60 * 1000))));
    hourly[hourIdx].sales += total;
    hourly[hourIdx].checksCount += 1;

    // Line items.
    const li: any[] = o.lineItems?.elements ?? [];
    for (const item of li) {
      const id = String(item.item?.id ?? item.id ?? item.name ?? "unknown");
      const name = String(item.name ?? "Unknown");
      const qty = Number(item.unitQty ?? 1) || 1;
      const gross = Number(item.price ?? 0) / 100;
      const prev = mix.get(id) ?? { item_id: id, name, quantity: 0, gross: 0 };
      prev.quantity += qty;
      prev.gross += gross;
      mix.set(id, prev);
    }
  }

  return {
    netSales,
    guestCount,
    avgTicket: checkCount > 0 ? netSales / checkCount : 0,
    hourly,
    productMix: Array.from(mix.values()),
  };
}

function aggregatePayments(payments: any[]) {
  // Build a payments_data structure: { tenders: [{label, count, amount, tips}], total_tips }
  const byTender = new Map<string, { label: string; count: number; amount: number; tips: number }>();
  let totalTips = 0;
  for (const p of payments) {
    const label = String(p.tender?.label ?? p.tender?.labelKey ?? "Unknown");
    const amount = (Number(p.amount) || 0) / 100;
    const tip = (Number(p.tipAmount) || 0) / 100;
    totalTips += tip;
    const prev = byTender.get(label) ?? { label, count: 0, amount: 0, tips: 0 };
    prev.count += 1;
    prev.amount += amount;
    prev.tips += tip;
    byTender.set(label, prev);
  }
  return {
    source: "clover",
    tenders: Array.from(byTender.values()),
    total_tips: totalTips,
  };
}

// ── Sync one day ────────────────────────────────────────────────────────────
async function syncOneDay(
  supabase: any,
  locationId: string,
  creds: CloverCreds,
  date: string,
) {
  const { startMs, endMs } = businessDayWindowMs(date);
  const [orders, payments] = await Promise.all([
    fetchOrdersForWindow(creds, startMs, endMs),
    fetchPaymentsForWindow(creds, startMs, endMs),
  ]);

  const agg = aggregateOrders(orders, startMs);
  const paymentsData = aggregatePayments(payments);

  // Conditional spread merge — protect projections / overrides that came from elsewhere.
  const { data: existing } = await supabase
    .from("clover_sales_cache")
    .select("*")
    .eq("location_id", locationId)
    .eq("sale_date", date)
    .maybeSingle();

  const row = {
    ...(existing ?? {}),
    location_id: locationId,
    sale_date: date,
    net_sales: agg.netSales,
    guest_count: agg.guestCount,
    avg_ticket: agg.avgTicket,
    hourly_data: agg.hourly,
    product_mix: agg.productMix,
    payments_data: paymentsData,
    flagged_no_sales: agg.netSales === 0,
    fetched_at: new Date().toISOString(),
  };
  // Don't carry id from existing into the upsert payload duplicate.
  delete (row as any).created_at;

  const { error } = await supabase
    .from("clover_sales_cache")
    .upsert(row, { onConflict: "location_id,sale_date" });
  if (error) throw new Error(`Upsert failed for ${date}: ${error.message}`);

  // ── Dual-write: normalized row into the shared mailroom (sales_cache) ────
  // Conditional spread protects projections/overrides set elsewhere.
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
    pos_source: "clover",
    net_sales: agg.netSales,
    guest_count: agg.guestCount,
    pizza_count: 0,
    avg_ticket: agg.avgTicket,
    hourly_data: agg.hourly,
    product_mix: agg.productMix,
    payments_data: paymentsData,
    flagged_no_sales: agg.netSales === 0,
    fetched_at: new Date().toISOString(),
  };

  const { error: mailErr } = await supabase
    .from("sales_cache")
    .upsert(mailRow, { onConflict: "location_id,sale_date" });
  if (mailErr) throw new Error(`sales_cache upsert failed for ${date}: ${mailErr.message}`);

  return {
    date,
    net_sales: agg.netSales,
    guest_count: agg.guestCount,
    orders: orders.length,
    payments: payments.length,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────
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

    // ── Fan-out: sync today for every active Playa Clover location ───────
    if (action === "sync_all_today") {
      const { data: integrations, error } = await supabase
        .from("location_integrations")
        .select("location_id, locations!inner(id, name, organizations!inner(brand_id))")
        .eq("integration_type", "clover")
        .eq("is_active", true);
      if (error) throw new Error(`fan-out lookup failed: ${error.message}`);

      const playaLocations = (integrations ?? []).filter(
        (i: any) => i.locations?.organizations?.brand_id === PLAYA_BOWLS_BRAND_ID,
      );
      const today = pstNow().date;
      const results: any[] = [];
      for (const i of playaLocations) {
        const lid = i.location_id as string;
        const lname = i.locations?.name as string;
        try {
          const creds = await getCloverCreds(supabase, lid);
          const r = await syncOneDay(supabase, lid, creds, today);
          results.push({ location: lname, ...r });
        } catch (e) {
          console.error(`[clover-sync] fan-out ${lid} failed:`, e);
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

    const { name } = await assertPlayaLocation(supabase, locationId);
    const creds = await getCloverCreds(supabase, locationId);

    const today = pstNow().date;
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
    } else {
      throw new Error(`unknown action: ${action}`);
    }

    const results: any[] = [];
    for (const d of dates) {
      try {
        results.push(await syncOneDay(supabase, locationId, creds, d));
      } catch (e) {
        console.error(`[clover-sync] ${locationId} ${d} failed:`, e);
        results.push({ date: d, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({ success: true, location: name, action, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[clover-sync] error", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
