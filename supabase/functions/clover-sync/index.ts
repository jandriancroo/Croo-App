// Clover → clover_sales_cache sync (Playa Bowls scoped).
// Mirrors the QU/Blaze sync shape: per-day rows with net_sales, guest_count,
// avg_ticket, hourly_data, product_mix, payments_data.
//
// Brand guard: hard-refuses any location whose organization is not Playa Bowls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuthorizedCaller } from "../_shared/callerAuth.ts";
import {
  fetchHistoricalDataFromCache,
  generateHourlyProjections,
  generateProjections,
  getCurrentHourInTimezone,
  getCurrentMinutesInTimezone,
} from "../_shared/projections.ts";


declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLAYA_BOWLS_BRAND_ID = "5fb4ef79-b0e4-4f06-9e88-1f88510dc4ab";
const DEFAULT_TZ = "America/Los_Angeles";

// Resolve the store-local IANA timezone (falls back to PST/PDT if unset).
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

const BASE = (env: string) =>
  env === "sandbox" ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";

interface Body {
  action: "sync_today" | "sync_yesterday" | "sync_date" | "sync_range" | "sync_dates" | "sync_all_today" | "sync_all_yesterday" | "get_live_expected_cash";
  locationId?: string;    // required except for sync_all_*
  date?: string;          // yyyy-MM-dd, for sync_date / get_live_expected_cash (defaults to today)
  startDate?: string;     // for sync_range
  endDate?: string;       // for sync_range
  dates?: string[];       // for sync_dates (batch)
}


interface CloverCreds {
  api_token: string;
  merchant_id: string;
  environment?: "production" | "sandbox";
}

// ── Date helpers (store-local, yyyy-MM-dd strings) ──────────────────────────


function todayInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
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

// Convert a yyyy-MM-dd business date to the UTC ms window for midnight→midnight
// in the **store's** timezone. Self-corrects across DST boundaries.
function businessDayWindowMs(date: string, tz: string): { startMs: number; endMs: number } {
  const [y, m, d] = date.split("-").map(Number);
  // Probe at noon UTC of the date — safely inside the calendar day for US zones.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // Offset = (UTC wall) − (TZ wall) of the same instant. Positive west of UTC.
  const tzOffsetMs = probe.getTime() - new Date(probe.toLocaleString("en-US", { timeZone: tz })).getTime();
  const startLocalUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const startMs = startLocalUtc + tzOffsetMs;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { startMs, endMs };
}

// ── Brand guard ─────────────────────────────────────────────────────────────
// Returns null (instead of throwing) when the location isn't a Playa Bowls
// location. Callers like the drawer-count form probe Clover first and fall back
// to Qu, so a non-Playa location must be a graceful "not applicable", not a 500.
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
    console.log(`[clover-sync] skip: location ${locationId} brand ${brandId} is not Playa Bowls`);
    return null;
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
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function cloverFetch(
  creds: CloverCreds,
  path: string,
  qs: Array<[string, string | number]> = [],
) {
  const url = new URL(`${BASE(creds.environment ?? "production")}${path}`);
  for (const [k, v] of qs) url.searchParams.append(k, String(v));
  // Retry on 429/5xx with exponential backoff.
  const maxAttempts = 6;
  let lastErr = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${creds.api_token}` } });
    if (r.ok) return r.json();
    const text = await r.text();
    lastErr = `Clover ${path} ${r.status}: ${text.slice(0, 300)}`;
    if (r.status === 429 || r.status >= 500) {
      // Honor Retry-After if present, else 500ms * 2^attempt + jitter.
      const ra = parseInt(r.headers.get("retry-after") ?? "", 10);
      const wait = Number.isFinite(ra) && ra > 0
        ? ra * 1000
        : 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
      await sleep(Math.min(wait, 15000));
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(`${lastErr} (after ${maxAttempts} attempts)`);
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
      ["expand", "lineItems,payments,discounts,lineItems.discounts,lineItems.modifications"],
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

// Refunds issued inside the window. Clover's "Net sales" is
// gross − discounts − refunds, and the refund's tax/tip/service-charge portion
// is NOT part of net sales (those live in their own report rows).
async function fetchRefundsForWindow(creds: CloverCreds, startMs: number, endMs: number) {
  const all: any[] = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const page = await cloverFetch(creds, `/v3/merchants/${creds.merchant_id}/refunds`, [
      ["filter", `createdTime>=${startMs}`],
      ["filter", `createdTime<${endMs}`],
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

function aggregateRefunds(refunds: any[]) {
  // Each refund's `amount` is the full money returned (item value + tax + tip
  // + service charge). Only the item portion reduces net sales.
  let netRefundCents = 0;
  let taxRefundCents = 0;
  let tipRefundCents = 0;
  for (const r of refunds) {
    const amount = Math.abs(Math.round(Number(r.amount ?? 0) || 0));
    const tax = Math.abs(Math.round(Number(r.taxAmount ?? 0) || 0));
    const tip = Math.abs(Math.round(Number(r.tipAmount ?? 0) || 0));
    const svc = Math.abs(Math.round(Number(r.serviceChargeAmount ?? 0) || 0));
    netRefundCents += Math.max(0, amount - tax - tip - svc);
    taxRefundCents += tax;
    tipRefundCents += tip;
  }
  return { netRefundCents, taxRefundCents, tipRefundCents, count: refunds.length };
}


// ── Aggregation ─────────────────────────────────────────────────────────────
type Hour = { hour: string; sales: number; checksCount: number };

// Clover "Net sales" definition (verified against the merchant dashboard):
//   item sales (line price + modifier amounts, revenue items only)
//   − discounts (line-level + order-level, capped at the order subtotal)
//   and it EXCLUDES tax, tips, service/order fees and non-revenue items
//   (gift cards, delivery fees, courier tips).
// All math is done in integer cents so days reconcile to the penny.
const cts = (v: unknown) => Math.round(Number(v ?? 0) || 0);

function lineBaseCents(li: any): number {
  return cts(li.price);
}
function lineModifierCents(li: any): number {
  const mods: any[] = li.modifications?.elements ?? [];
  return mods.reduce((s, m) => s + cts(m.amount), 0);
}
function isNonRevenueLine(li: any): boolean {
  return li.isRevenue === false || li.isOrderFee === true;
}
// A discount can be a fixed amount (negative cents) or a percentage.
// Percentage line discounts apply to the line's base price (not its modifiers).
function discountCents(d: any, baseCents: number): number {
  if (d?.amount) return Math.abs(cts(d.amount));
  const pct = Number(d?.percentage ?? 0) || 0;
  return pct ? Math.round((baseCents * pct) / 100) : 0;
}

// Per-order breakdown in cents.
function orderBreakdown(o: any) {
  let grossCents = 0;        // revenue item sales incl. modifiers
  let nonRevenueCents = 0;   // gift cards, delivery fees, courier tips
  let lineDiscountCents = 0;

  for (const li of (o.lineItems?.elements ?? []) as any[]) {
    if (li.deleted) continue;
    const base = lineBaseCents(li);
    const withMods = base + lineModifierCents(li);
    if (isNonRevenueLine(li)) { nonRevenueCents += withMods; continue; }
    grossCents += withMods;
    for (const d of (li.discounts?.elements ?? []) as any[]) {
      lineDiscountCents += discountCents(d, base);
    }
  }

  const subtotalCents = grossCents - lineDiscountCents;
  let orderDiscountCents = 0;
  for (const d of (o.discounts?.elements ?? []) as any[]) {
    if (d.lineItemRef) continue; // already counted at the line level
    orderDiscountCents += discountCents(d, subtotalCents);
  }
  // Clover never discounts below zero on an order.
  orderDiscountCents = Math.min(orderDiscountCents, Math.max(subtotalCents, 0));

  return {
    grossCents,
    nonRevenueCents,
    discountCents: lineDiscountCents + orderDiscountCents,
    netCents: subtotalCents - orderDiscountCents,
  };
}

function aggregateOrders(orders: any[], startMs: number) {
  let netCents = 0;
  let grossCents = 0;
  let discountsCents = 0;
  let nonRevenueCents = 0;
  let guestCount = 0;
  let checkCount = 0;
  const hourlyCents: number[] = Array.from({ length: 24 }, () => 0);
  const hourlyChecks: number[] = Array.from({ length: 24 }, () => 0);

  // Product mix: aggregate line items by item id/name.
  const mix = new Map<string, { item_id: string; name: string; quantity: number; gross: number }>();

  for (const o of orders) {
    // Skip open/voided/deleted orders entirely.
    if (o.state === "open" || o.state === "voided") continue;
    if (o.deletedTimestamp) continue;

    const b = orderBreakdown(o);
    if (b.netCents <= 0 && b.grossCents <= 0) continue;

    netCents += b.netCents;
    grossCents += b.grossCents;
    discountsCents += b.discountCents;
    nonRevenueCents += b.nonRevenueCents;
    checkCount += 1;
    const guests = Math.max(1, Number(o.guestCount ?? 0) || 1);
    guestCount += guests;

    // Hour bucket (store-local hour within the window).
    const t = o.clientCreatedTime ?? o.createdTime ?? startMs;
    const hourIdx = Math.max(0, Math.min(23, Math.floor((t - startMs) / (60 * 60 * 1000))));
    hourlyCents[hourIdx] += b.netCents;
    hourlyChecks[hourIdx] += 1;

    // Line items → product mix (revenue items only, modifiers included).
    for (const item of (o.lineItems?.elements ?? []) as any[]) {
      if (item.deleted || isNonRevenueLine(item)) continue;
      const id = String(item.item?.id ?? item.id ?? item.name ?? "unknown");
      const name = String(item.name ?? "Unknown");
      const qty = Number(item.unitQty ?? 1) || 1;
      const lineGross = (lineBaseCents(item) + lineModifierCents(item)) / 100;
      const prev = mix.get(id) ?? { item_id: id, name, quantity: 0, gross: 0 };
      prev.quantity += qty;
      prev.gross += lineGross;
      mix.set(id, prev);
    }
  }

  const netSales = netCents / 100;
  const hourly: Hour[] = hourlyCents.map((cents, h) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    sales: cents / 100,
    checksCount: hourlyChecks[h],
  }));

  return {
    netSales,
    grossSales: grossCents / 100,
    discounts: discountsCents / 100,
    nonRevenue: nonRevenueCents / 100,
    guestCount,
    avgTicket: checkCount > 0 ? netCents / 100 / checkCount : 0,
    hourly,
    productMix: Array.from(mix.values()),
  };
}

function aggregatePayments(payments: any[]) {
  // Build a payments_data structure: { tenders: [{label, count, amount, tips}], total_tips }
  // Only SUCCESSful, non-voided/refunded payments count toward tips. Clover keeps
  // FAIL / declined attempts in the payments feed and they must never inflate the pool.
  const byTender = new Map<string, { label: string; count: number; amount: number; tips: number }>();
  let totalTips = 0;
  let excludedCount = 0;
  let excludedTips = 0;
  for (const p of payments) {
    const result = String(p.result ?? "SUCCESS").toUpperCase();
    const voided = p.voided === true || Boolean(p.voidReason);
    if (result !== "SUCCESS" || voided) {
      excludedCount += 1;
      excludedTips += (Number(p.tipAmount) || 0) / 100;
      continue;
    }
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
  if (excludedCount > 0) {
    console.log(
      `[clover-sync] excluded ${excludedCount} non-success/voided payment(s), $${excludedTips.toFixed(2)} in tips`,
    );
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
  tz: string,
) {
  const { startMs, endMs } = businessDayWindowMs(date, tz);
  // Serialize to avoid Clover 429s; retry inside cloverFetch handles transient throttling.
  const orders = await fetchOrdersForWindow(creds, startMs, endMs);
  await sleep(150);
  const payments = await fetchPaymentsForWindow(creds, startMs, endMs);
  await sleep(150);
  const refunds = await fetchRefundsForWindow(creds, startMs, endMs);

  const rawAgg = aggregateOrders(orders, startMs);
  const ref = aggregateRefunds(refunds);
  const paymentsData = aggregatePayments(payments);

  // Net sales = item sales − discounts − refunds (item portion only).
  // Refunded tips leave the pool too, so the tip total nets them out.
  const netAfterRefunds = Math.max(
    0,
    Math.round(rawAgg.netSales * 100) - ref.netRefundCents,
  ) / 100;
  const agg = {
    ...rawAgg,
    netSales: netAfterRefunds,
    refunds: ref.netRefundCents / 100,
    avgTicket: rawAgg.guestCount > 0 && rawAgg.avgTicket > 0
      ? netAfterRefunds / Math.max(1, Math.round(rawAgg.netSales / rawAgg.avgTicket))
      : rawAgg.avgTicket,
  };
  if (ref.tipRefundCents > 0) {
    paymentsData.total_tips = Math.max(
      0,
      Math.round(paymentsData.total_tips * 100) - ref.tipRefundCents,
    ) / 100;
  }

  // Conditional spread merge — protect projections / overrides that came from elsewhere.
  const { data: existing } = await supabase
    .from("clover_sales_cache")
    .select("*")
    .eq("location_id", locationId)
    .eq("sale_date", date)
    .maybeSingle();

  console.log(
    `[clover-sync] ${date} recon: gross=$${agg.grossSales.toFixed(2)} ` +
    `discounts=-$${agg.discounts.toFixed(2)} refunds=-$${agg.refunds.toFixed(2)} ` +
    `net=$${agg.netSales.toFixed(2)} ` +
    `(excluded non-revenue $${agg.nonRevenue.toFixed(2)}, refunded tax $${(ref.taxRefundCents / 100).toFixed(2)}, ` +
    `refunded tips $${(ref.tipRefundCents / 100).toFixed(2)}, tax/tips/fees excluded)`,
  );


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

  // ── Dual-write: daily_tips (parity with QU flow) ────────────────────────
  // Clover reports CC/debit tips per payment; cash tips are not declared at POS.
  // Aggregate all non-cash tender tips as total_cc_tips; cash defaults to 0
  // (manual entry can override later if we add UI for it).
  try {
    let ccTips = 0;
    let cashTips = 0;
    for (const t of (paymentsData.tenders ?? [])) {
      const label = String(t.label ?? "").toLowerCase();
      if (label.includes("cash")) cashTips += Number(t.tips) || 0;
      else ccTips += Number(t.tips) || 0;
    }
    if (ccTips > 0 || cashTips > 0) {
      const { error: tipsErr } = await supabase
        .from("daily_tips")
        .upsert({
          location_id: locationId,
          tip_date: date,
          total_cc_tips: ccTips,
          total_cash_tips: cashTips,
          fetched_at: new Date().toISOString(),
        }, { onConflict: "location_id,tip_date" });
      if (tipsErr) console.error(`[clover-sync] daily_tips upsert failed for ${date}:`, tipsErr.message);
      else console.log(`[clover-sync] daily_tips saved ${date}: cc=$${ccTips.toFixed(2)} cash=$${cashTips.toFixed(2)}`);
    }
  } catch (e) {
    console.error(`[clover-sync] daily_tips error for ${date}:`, e);
  }

  // ── YOY projection seed (only if missing) ──────────────────────────────
  // Pull same-day last year (-364 days to keep day-of-week aligned).
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
    } else {
      // Still backfill yoy_* reference fields if missing (cheap, read-only refs).
      if (!existingProj.yoy_net_sales) {
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
    }
  } catch (e) {
    console.warn(`[clover-sync] YOY seed skipped for ${date}:`, e);
  }

  // ── Shared projection + pace engine (POS-agnostic) ─────────────────────
  // Only runs for "today" — historical days already have net_sales/hourly
  // frozen and don't need a live pace number.
  try {
    const todayLocal = todayInTz(tz);
    if (date === todayLocal) {
      // Fetch hours-open / hours-close (defaults 10–22 if unset).
      let hoursOpen = 10;
      let hoursClose = 22;
      try {
        const { data: hoursRow } = await supabase
          .from("location_settings")
          .select("hours_open, hours_close")
          .eq("location_id", locationId)
          .maybeSingle();
        // hours_open/hours_close are TIME values ("10:00:00") — take the hour part.
        const parseHour = (v: unknown): number | null => {
          if (v == null) return null;
          const h = parseInt(String(v).split(":")[0], 10);
          return Number.isFinite(h) ? h : null;
        };
        const openH = parseHour(hoursRow?.hours_open);
        const closeH = parseHour(hoursRow?.hours_close);
        if (openH != null) hoursOpen = openH;
        if (closeH != null) hoursClose = closeH;
      } catch {}

      const hist = await fetchHistoricalDataFromCache(supabase, locationId, date);

      // Weekly / monthly breakdowns from sales_cache for orchestrator inputs.
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

      const weeklyBreakdown = (weekRows || []).map((r: any) => ({
        date: r.sale_date, sales: Number(r.net_sales) || 0,
      }));
      const monthlyBreakdown = (monthRows || []).map((r: any) => ({
        date: r.sale_date, sales: Number(r.net_sales) || 0,
      }));
      const weeklySales = weeklyBreakdown.reduce((s: number, r: { sales: number }) => s + r.sales, 0);
      const monthlySales = monthlyBreakdown.reduce((s: number, r: { sales: number }) => s + r.sales, 0);

      // Provisional daily projection to shape hourly curve, then run pace.
      const provisionalDaily =
        (hist.fourWeekAverage?.avgDailyByDayOfWeek.find(
          (d) => d.dayOfWeek === new Date(date + "T12:00:00").getDay(),
        )?.avgSales) ||
        hist.lastYearData?.sameDay ||
        agg.netSales ||
        0;

      const hourlyProjections = generateHourlyProjections(
        agg.hourly,
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
        agg.netSales,
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

      // Persist: living_projection = today's target (refresh each sync),
      // initial_projection = seed if empty, pace_adjusted_projection = live pace.
      const paceUpdate: Record<string, any> = {
        pace_adjusted_projection: projections.todayPaceAdjusted,
        pace_calculated_at: new Date().toISOString(),
      };
      if (projections.todayProjected > 0) {
        paceUpdate.living_projection = projections.todayProjected;
        // Only seed initial if missing (respect the "first projection wins" rule).
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
        `[clover-sync] pace for ${locationId} ${date}: ` +
        `actual=$${agg.netSales.toFixed(0)}, target=$${projections.todayProjected.toFixed(0)}, ` +
        `pace=$${projections.todayPaceAdjusted}`,
      );
    }
  } catch (e) {
    console.warn(`[clover-sync] pace calc skipped for ${date}:`, e);
  }

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

  // Service key, CRON_SECRET, or a signed-in user (incl. paired kiosk devices).
  {
    const denied = await requireAuthorizedCaller(req, corsHeaders);
    if (denied) return denied;
  }

  try {
    const body = (await req.json()) as Body;
    const { action } = body;
    if (!action) throw new Error("action required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Fan-out: sync today/yesterday for every active Playa Clover location ──
    if (action === "sync_all_today" || action === "sync_all_yesterday") {
      const { data: integrations, error } = await supabase
        .from("location_integrations")
        .select("location_id, locations!inner(id, name, organizations!inner(brand_id))")
        .eq("integration_type", "clover")
        .eq("is_active", true);
      if (error) throw new Error(`fan-out lookup failed: ${error.message}`);

      const playaLocations: any[] = ((integrations ?? []) as any[]).filter(
        (i: any) => i.locations?.organizations?.brand_id === PLAYA_BOWLS_BRAND_ID,
      );
      const results: any[] = [];
      for (const i of playaLocations) {
        const lid = i.location_id as string;
        const lname = i.locations?.name as string;
        try {
          const tz = await getLocationTimezone(supabase, lid);
          const todayLocal = todayInTz(tz);
          const target = action === "sync_all_today" ? todayLocal : addDays(todayLocal, -1);
          const creds = await getCloverCreds(supabase, lid);
          const r = await syncOneDay(supabase, lid, creds, target, tz);
          results.push({ location: lname, tz, ...r });
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

    const guard = await assertPlayaLocation(supabase, locationId);
    if (!guard) {
      // Not a Clover/Playa location — respond 200 so probing callers can fall
      // back to their own POS without surfacing a runtime error.
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "not_clover_location" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { name } = guard;
    const creds = await getCloverCreds(supabase, locationId);
    const tz = await getLocationTimezone(supabase, locationId);

    const today = todayInTz(tz);

    // ── Live expected cash for drawer count (QU-parity behavior) ──
    // Georgetown runs a single drawer; Clover has no shift/drawer object,
    // so "expected cash" = sum of cash tenders − sum of cash refunds
    // since start-of-business-day (store TZ) through right now.
    if (action === "get_live_expected_cash") {
      const targetDate = body.date || today;
      const { startMs } = businessDayWindowMs(targetDate, tz);
      const endMs = targetDate === today ? Date.now() : businessDayWindowMs(targetDate, tz).endMs;

      const payments = await fetchPaymentsForWindow(creds, startMs, endMs);

      let cashIn = 0;
      let cashOut = 0;
      let cashTxCount = 0;
      for (const p of payments) {
        const label = String(p?.tender?.label ?? p?.tender?.labelKey ?? "").toLowerCase();
        const isCash = label.includes("cash");
        if (!isCash) continue;
        const amount = Number(p.amount ?? 0) / 100; // cents → dollars
        const refunded = Number(p.refunded ?? 0); // boolean-ish in Clover, but guard
        if (amount > 0 && !refunded) {
          cashIn += amount;
          cashTxCount += 1;
        } else if (amount < 0) {
          cashOut += Math.abs(amount);
          cashTxCount += 1;
        }
      }
      const expectedCash = Math.max(0, cashIn - cashOut);

      return new Response(
        JSON.stringify({
          success: true,
          location: name,
          date: targetDate,
          tz,
          expectedCash,
          breakdown: { cashIn, cashOut, txCount: cashTxCount },
          asOf: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
        console.error(`[clover-sync] ${locationId} ${d} failed:`, e);
        results.push({ date: d, error: e instanceof Error ? e.message : String(e) });
      }
      await sleep(200); // gentle pace between days
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
