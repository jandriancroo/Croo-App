// Genius Order Coach — usage forecasting engine
// Actions: buildUsagePeriods, refreshDowProfile, fitUsageRate, recommendOrder
//
// Business-date rule: every date field books to the location's business date
// (close_time + buffer aware). Sales, counts, and receipts must resolve to the
// same business date or the math silently breaks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { DateTime } from "https://esm.sh/luxon@3.4.4";
import {
  applyRounding,
  clamp,
  daysBetween,
  dowFromDate,
  eachDate,
  fitWeeklyUsage,
  forecastSalesLinked,
  markOutliers,
  type PeriodInput,
  type RoundingPolicy,
  type UsageModel,
} from "../_shared/usageMath.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Env {
  supabase: ReturnType<typeof createClient>;
}

function svc(): Env {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return { supabase: createClient(url, key) };
}

// ------------------------------------------------------------
// Location timezone + business-date helpers
// ------------------------------------------------------------

async function getLocationCtx(supabase: any, locationId: string) {
  const { data: settings } = await supabase
    .from("location_settings")
    .select("timezone")
    .eq("location_id", locationId)
    .maybeSingle();
  const timezone = settings?.timezone || "America/Los_Angeles";

  const { data: hours } = await supabase
    .from("location_hours")
    .select("day_of_week, close_time")
    .eq("location_id", locationId);
  const closeByDow = new Map<number, string | null>();
  (hours || []).forEach((h: any) => closeByDow.set(h.day_of_week, h.close_time));

  return { timezone, closeByDow };
}

/**
 * Resolve a wall-clock timestamp to a business date (yyyy-MM-dd) in location tz.
 * If wall time is before the store's close_time+3h buffer, we book to the prior day.
 */
function toBusinessDate(
  ts: string | Date,
  timezone: string,
  closeByDow: Map<number, string | null>,
): string {
  const dt = DateTime.fromJSDate(new Date(ts)).setZone(timezone);
  const dow = dt.weekday % 7; // Luxon 1..7 (Mon..Sun) -> 0..6 with Sun=0
  const closeStr = closeByDow.get(dow);
  // Default cutoff = 4:00 AM local when unknown.
  let cutoffHour = 4;
  if (closeStr) {
    const [h, m] = closeStr.split(":").map((n) => parseInt(n, 10));
    // 3h buffer after close
    const total = (h ?? 0) + (m ?? 0) / 60 + 3;
    cutoffHour = total % 24;
  }
  const hourFloat = dt.hour + dt.minute / 60;
  const businessDay = hourFloat < cutoffHour ? dt.minus({ days: 1 }) : dt;
  return businessDay.toFormat("yyyy-MM-dd");
}

// ------------------------------------------------------------
// buildUsagePeriods
// ------------------------------------------------------------

async function buildUsagePeriods(supabase: any, itemId: string) {
  // Load item + location
  const { data: item } = await supabase
    .from("lite_inventory_items")
    .select("id, location_id, case_qty, units_per_case")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { periods: 0, error: "item not found" };
  const locationId = item.location_id as string;
  const unitsPerCase = Number(item.units_per_case ?? item.case_qty ?? 1) || 1;

  const ctx = await getLocationCtx(supabase, locationId);

  // Submitted counts, oldest first
  const { data: counts } = await supabase
    .from("lite_inventory_counts")
    .select("id, period_end, status, submitted_at")
    .eq("location_id", locationId)
    .eq("status", "submitted")
    .order("period_end", { ascending: true });
  const heads = (counts || []) as any[];
  if (heads.length < 2) return { periods: 0 };

  const headIds = heads.map((h) => h.id);
  // Count items for this item
  const { data: countItems } = await supabase
    .from("lite_inventory_count_items")
    .select("count_id, item_id, quantity, case_quantity, inner_quantity, case_qty_at_count")
    .in("count_id", headIds)
    .eq("item_id", itemId);
  const qtyByCount = new Map<string, number>();
  (countItems || []).forEach((r: any) => {
    const q =
      Number(r.quantity ?? 0) +
      Number(r.case_quantity ?? 0) * Number(r.case_qty_at_count ?? unitsPerCase) +
      Number(r.inner_quantity ?? 0);
    qtyByCount.set(r.count_id, q);
  });

  // Invoices
  const { data: invs } = await supabase
    .from("lite_vendor_invoices")
    .select("id, invoice_date, delivery_date")
    .eq("location_id", locationId);
  const invMap = new Map<string, { date: string; source: "physical" | "invoice" }>();
  (invs || []).forEach((i: any) => {
    if (i.delivery_date) invMap.set(i.id, { date: i.delivery_date, source: "physical" });
    else if (i.invoice_date) invMap.set(i.id, { date: i.invoice_date, source: "invoice" });
  });
  const { data: invLines } = await supabase
    .from("lite_vendor_invoice_items")
    .select("invoice_id, matched_item_id, quantity")
    .eq("matched_item_id", itemId);
  const receipts = ((invLines as any[]) || [])
    .map((l) => {
      const inv = invMap.get(l.invoice_id);
      if (!inv) return null;
      return {
        date: inv.date as string,
        source: inv.source,
        qty: Number(l.quantity ?? 0) * unitsPerCase,
      };
    })
    .filter((x): x is { date: string; source: "physical" | "invoice"; qty: number } => !!x);

  // Sales by business date
  const firstDate = heads[0].period_end as string;
  const lastDate = heads[heads.length - 1].period_end as string;
  const { data: salesRows } = await supabase
    .from("sales_cache")
    .select("sale_date, net_sales")
    .eq("location_id", locationId)
    .gte("sale_date", firstDate)
    .lte("sale_date", lastDate);
  const salesByDate = new Map<string, number>();
  (salesRows || []).forEach((r: any) => {
    const d = r.sale_date;
    if (!d) return;
    salesByDate.set(d, (salesByDate.get(d) || 0) + Number(r.net_sales ?? 0));
  });

  // Build period rows
  const periodRows: any[] = [];
  for (let i = 0; i < heads.length - 1; i++) {
    const a = heads[i];
    const b = heads[i + 1];
    const qtyA = qtyByCount.get(a.id);
    const qtyB = qtyByCount.get(b.id);
    if (qtyA == null || qtyB == null) continue;

    const inWindow = receipts.filter(
      (r) => r.date > a.period_end && r.date <= b.period_end,
    );
    const received = inWindow.reduce((s, r) => s + r.qty, 0);
    const sources = new Set(inWindow.map((r) => r.source));
    const source =
      sources.size === 0
        ? null
        : sources.size > 1
          ? "mixed"
          : Array.from(sources)[0];

    const usage = qtyA + received - qtyB;
    const days = daysBetween(a.period_end, b.period_end);

    let netSales = 0;
    for (const d of eachDate(a.period_end, b.period_end)) {
      // exclude the start day itself since periods are open on the left
      if (d === a.period_end) continue;
      netSales += salesByDate.get(d) || 0;
    }
    const upd = netSales > 0 && usage >= 0 ? usage / netSales : null;

    // Auto-exclusions
    let isExcluded = false;
    let reason: string | null = null;
    if (days > 9) {
      isExcluded = true;
      reason = "missing_count";
    } else if (qtyB <= 0) {
      isExcluded = true;
      reason = "stockout";
    } else if (usage < 0) {
      isExcluded = true;
      reason = "bad_count";
    }

    periodRows.push({
      item_id: itemId,
      location_id: locationId,
      period_start_date: a.period_end,
      period_end_date: b.period_end,
      days_in_period: days,
      qty_start: qtyA,
      qty_received: received,
      qty_end: qtyB,
      usage,
      net_sales: netSales,
      usage_per_dollar: upd,
      receipt_date_source: source,
      is_excluded: isExcluded,
      exclusion_reason: reason,
    });
  }

  // Outlier pass (2.5 MAD on usage_per_dollar). Preserve existing manual excludes.
  const withOutliers = markOutliers(periodRows as unknown as PeriodInput[]);
  for (let i = 0; i < periodRows.length; i++) {
    if (!periodRows[i].is_excluded && (withOutliers[i] as any).is_excluded) {
      periodRows[i].is_excluded = true;
      periodRows[i].exclusion_reason = "manual"; // outlier
    }
  }

  // Upsert (preserve manual excludes)
  const { data: existing } = await supabase
    .from("item_usage_periods")
    .select("period_end_date, is_excluded, exclusion_reason, excluded_by")
    .eq("item_id", itemId);
  const preserve = new Map<string, any>();
  (existing || []).forEach((e: any) => {
    if (e.exclusion_reason === "manual" && e.excluded_by) {
      preserve.set(e.period_end_date, e);
    }
  });

  const upserts = periodRows.map((r) => {
    const p = preserve.get(r.period_end_date);
    if (p) return { ...r, is_excluded: true, exclusion_reason: "manual" };
    return r;
  });

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("item_usage_periods")
      .upsert(upserts, { onConflict: "item_id,period_end_date" });
    if (error) throw error;
  }

  return { periods: upserts.length };
}

// ------------------------------------------------------------
// refreshDowProfile
// ------------------------------------------------------------

async function refreshDowProfile(supabase: any, locationId: string) {
  const cutoff = DateTime.now().minus({ weeks: 16 }).toFormat("yyyy-MM-dd");
  const { data: sales } = await supabase
    .from("sales_cache")
    .select("sale_date, net_sales")
    .eq("location_id", locationId)
    .gte("sale_date", cutoff);

  const byDow = new Map<number, number[]>();
  const weeksByDow = new Map<number, Set<string>>();
  (sales || []).forEach((r: any) => {
    const d = r.sale_date as string;
    if (!d) return;
    const dow = dowFromDate(d);
    const ns = Number(r.net_sales ?? 0);
    if (!Number.isFinite(ns) || ns <= 0) return;
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow)!.push(ns);
    const wk = DateTime.fromFormat(d, "yyyy-MM-dd").toFormat("kkkk-'W'WW");
    if (!weeksByDow.has(dow)) weeksByDow.set(dow, new Set());
    weeksByDow.get(dow)!.add(wk);
  });

  // Compute per-DOW aggregates
  const perDow: any[] = [];
  let totalAvg = 0;
  for (let dow = 0; dow < 7; dow++) {
    const arr = byDow.get(dow) || [];
    if (arr.length === 0) {
      perDow.push({ day_of_week: dow, avg: 0, min: 0, max: 0, stddev: 0, weeks: 0 });
      continue;
    }
    const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const variance =
      arr.reduce((s, v) => s + (v - avg) ** 2, 0) / Math.max(1, arr.length - 1);
    const stddev = Math.sqrt(variance);
    const weeks = (weeksByDow.get(dow) || new Set()).size;
    perDow.push({ day_of_week: dow, avg, min, max, stddev, weeks });
    totalAvg += avg;
  }

  const rows = perDow.map((p) => ({
    location_id: locationId,
    day_of_week: p.day_of_week,
    avg_net_sales: Number(p.avg.toFixed(2)),
    share_of_week: totalAvg > 0 ? Number((p.avg / totalAvg).toFixed(4)) : 1 / 7,
    weeks_in_sample: p.weeks,
    min_net_sales: Number(p.min.toFixed(2)),
    max_net_sales: Number(p.max.toFixed(2)),
    stddev: Number(p.stddev.toFixed(2)),
    computed_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("dow_sales_profile")
    .upsert(rows, { onConflict: "location_id,day_of_week" });
  if (error) throw error;

  return { days: rows.length, typicalWeekSales: totalAvg };
}

// ------------------------------------------------------------
// fitUsageRate
// ------------------------------------------------------------

async function fitUsageRate(supabase: any, itemId: string) {
  const { data: item } = await supabase
    .from("lite_inventory_items")
    .select("id, location_id, usage_model, usage_model_locked, par_level")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "item not found" };

  const { data: periods } = await supabase
    .from("item_usage_periods")
    .select(
      "period_start_date, period_end_date, days_in_period, qty_start, qty_received, qty_end, usage, net_sales, usage_per_dollar, is_excluded",
    )
    .eq("item_id", itemId)
    .order("period_end_date", { ascending: false })
    .limit(24);

  const fit = fitWeeklyUsage((periods as unknown as PeriodInput[]) || [], 0.35);

  // Auto-classify unless locked
  let usage_model: UsageModel = (item.usage_model as UsageModel) || "sales_linked";
  if (!item.usage_model_locked) {
    if (fit.r2_usage_vs_sales != null && fit.r2_usage_vs_sales >= 0.6) {
      usage_model = "sales_linked";
    } else if (item.par_level != null && Number(item.par_level) > 0) {
      usage_model = "par_based";
    } else {
      usage_model = "time_based";
    }
  }

  await supabase.from("item_usage_rates").upsert(
    {
      item_id: itemId,
      location_id: item.location_id,
      weekly_usage_level: fit.weekly_usage_level,
      alpha: fit.alpha,
      residual_stddev: fit.residual_stddev,
      r2_usage_vs_sales: fit.r2_usage_vs_sales,
      periods_used: fit.periods_used,
      last_fitted_at: new Date().toISOString(),
    },
    { onConflict: "item_id" },
  );

  if (!item.usage_model_locked && usage_model !== item.usage_model) {
    await supabase
      .from("lite_inventory_items")
      .update({ usage_model })
      .eq("id", itemId);
  }

  return { ...fit, usage_model, low_confidence: fit.periods_used < 4 };
}

// ------------------------------------------------------------
// recommendOrder
// ------------------------------------------------------------

async function recommendOrder(supabase: any, itemId: string, asOfDate: string) {
  const { data: item } = await supabase
    .from("lite_inventory_items")
    .select(
      "id, location_id, name, usage_model, par_level, units_per_case, case_qty, rounding_policy, lead_time_days, delivery_dows",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "item not found" };

  const unitsPerCase = Number(item.units_per_case ?? item.case_qty ?? 1) || 1;
  const rounding = (item.rounding_policy as RoundingPolicy) || "up";
  const leadDays = Number(item.lead_time_days ?? 0);
  const deliveryDows: number[] =
    Array.isArray(item.delivery_dows) && item.delivery_dows.length > 0
      ? item.delivery_dows
      : [];

  // Next delivery
  const asOf = DateTime.fromFormat(asOfDate, "yyyy-MM-dd");
  let nextDelivery = asOf.plus({ days: 1 });
  if (deliveryDows.length > 0) {
    let best = Infinity;
    for (const dow of deliveryDows) {
      const todayDow = asOf.weekday % 7;
      let diff = dow - todayDow;
      if (diff <= 0) diff += 7;
      if (diff < best) best = diff;
    }
    nextDelivery = asOf.plus({ days: best });
  }
  const coverageEnd = nextDelivery.plus({ days: leadDays });
  const coverageDates = eachDate(
    asOf.toFormat("yyyy-MM-dd"),
    coverageEnd.toFormat("yyyy-MM-dd"),
  );

  // Fitted rate + DOW profile
  const { data: rate } = await supabase
    .from("item_usage_rates")
    .select("weekly_usage_level, residual_stddev, r2_usage_vs_sales, periods_used")
    .eq("item_id", itemId)
    .maybeSingle();
  const { data: dow } = await supabase
    .from("dow_sales_profile")
    .select("day_of_week, share_of_week, avg_net_sales")
    .eq("location_id", item.location_id);
  const typicalWeekSales = (dow || []).reduce(
    (s: number, r: any) => s + Number(r.avg_net_sales || 0),
    0,
  );

  // Daily projection overrides for coverage window — sales_cache carries
  // override_projection / living_projection for future dates on some POS
  // integrations. Any date without a row falls back to the DOW average.
  const dailySalesOverride = new Map<string, number>();
  const { data: projRows } = await supabase
    .from("sales_cache")
    .select("sale_date, override_projection, living_projection, initial_projection")
    .eq("location_id", item.location_id)
    .in("sale_date", coverageDates);
  (projRows || []).forEach((r: any) => {
    const v = r.override_projection ?? r.living_projection ?? r.initial_projection;
    if (r.sale_date && v != null) {
      dailySalesOverride.set(r.sale_date, Number(v));
    }
  });

  // Projected on-hand: last count + receipts since − usage since
  const { data: lastCount } = await supabase
    .from("lite_inventory_counts")
    .select("id, period_end")
    .eq("location_id", item.location_id)
    .eq("status", "submitted")
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  let projectedOnHand: number | null = null;
  if (lastCount) {
    const { data: lc } = await supabase
      .from("lite_inventory_count_items")
      .select("quantity, case_quantity, inner_quantity, case_qty_at_count")
      .eq("count_id", lastCount.id)
      .eq("item_id", itemId)
      .maybeSingle();
    const lastQty =
      Number(lc?.quantity ?? 0) +
      Number(lc?.case_quantity ?? 0) * Number(lc?.case_qty_at_count ?? unitsPerCase) +
      Number(lc?.inner_quantity ?? 0);

    const { data: invs } = await supabase
      .from("lite_vendor_invoices")
      .select("id, invoice_date, delivery_date")
      .eq("location_id", item.location_id)
      .or(`delivery_date.gte.${lastCount.period_end},invoice_date.gte.${lastCount.period_end}`);
    const invDateById = new Map<string, string>();
    (invs || []).forEach((i: any) => {
      invDateById.set(i.id, i.delivery_date || i.invoice_date);
    });
    const { data: lines } = await supabase
      .from("lite_vendor_invoice_items")
      .select("invoice_id, quantity")
      .eq("matched_item_id", itemId)
      .in("invoice_id", Array.from(invDateById.keys()));
    let receivedSince = 0;
    (lines || []).forEach((l: any) => {
      const d = invDateById.get(l.invoice_id);
      if (d && d > lastCount.period_end && d <= asOfDate) {
        receivedSince += Number(l.quantity ?? 0) * unitsPerCase;
      }
    });

    const daysSince = daysBetween(lastCount.period_end, asOfDate);
    const weekly = Number(rate?.weekly_usage_level ?? 0);
    const usedSince = (weekly / 7) * daysSince;
    projectedOnHand = Math.max(0, lastQty + receivedSince - usedSince);
  }

  // Forecast per model
  let usageModel = item.usage_model as UsageModel;
  let shapeSource:
    | "sales_linked_dow"
    | "daily_projection"
    | "manager_override"
    | "time_based"
    | "par_based" = "time_based";
  let forecastQty = 0;
  let trend = 1;
  let perDay: { date: string; dow: number; forecast: number }[] = [];

  if (usageModel === "par_based" && item.par_level != null) {
    forecastQty = Number(item.par_level) - (projectedOnHand ?? 0);
    shapeSource = "par_based";
  } else if (usageModel === "sales_linked" && rate?.weekly_usage_level) {
    // trend factor
    const projectedWeekTotal = coverageDates.reduce((s, d) => {
      const p = dailySalesOverride.get(d);
      if (p != null) return s + p;
      const share = (dow || []).find((r: any) => r.day_of_week === dowFromDate(d));
      return s + Number(share?.avg_net_sales ?? 0);
    }, 0);
    const typicalCoverageTotal = coverageDates.reduce((s, d) => {
      const share = (dow || []).find((r: any) => r.day_of_week === dowFromDate(d));
      return s + Number(share?.avg_net_sales ?? 0);
    }, 0);
    trend =
      typicalCoverageTotal > 0
        ? clamp(projectedWeekTotal / typicalCoverageTotal, 0.85, 1.25)
        : 1;
    const out = forecastSalesLinked(
      Number(rate.weekly_usage_level),
      coverageDates,
      (dow || []).map((r: any) => ({
        day_of_week: r.day_of_week,
        share_of_week: Number(r.share_of_week),
        avg_net_sales: Number(r.avg_net_sales),
      })),
      trend,
      dailySalesOverride.size > 0 ? dailySalesOverride : null,
      typicalWeekSales,
    );
    forecastQty = out.total;
    perDay = out.perDay;
    shapeSource = dailySalesOverride.size > 0 ? "daily_projection" : "sales_linked_dow";
  } else if (rate?.weekly_usage_level) {
    forecastQty = (Number(rate.weekly_usage_level) / 7) * coverageDates.length;
    shapeSource = "time_based";
  }

  const residual = Number(rate?.residual_stddev ?? 0);
  const safety = 1.65 * residual * Math.sqrt(coverageDates.length / 7);
  const raw = forecastQty - (projectedOnHand ?? 0) + safety;
  const recommendedQty = Math.max(0, raw);
  const cases = unitsPerCase > 1 ? applyRounding(recommendedQty / unitsPerCase, rounding) : 0;

  const periodsUsed = Number(rate?.periods_used ?? 0);
  const confidence: "green" | "amber" | "red" =
    periodsUsed >= 8 ? "green" : periodsUsed >= 4 ? "amber" : "red";

  const row = {
    item_id: itemId,
    location_id: item.location_id,
    generated_at: new Date().toISOString(),
    as_of_date: asOfDate,
    coverage_start: coverageDates[0],
    coverage_end: coverageDates[coverageDates.length - 1],
    forecast_qty: Number(forecastQty.toFixed(4)),
    projected_on_hand: projectedOnHand != null ? Number(projectedOnHand.toFixed(4)) : null,
    safety_stock: Number(safety.toFixed(4)),
    recommended_qty: Number(recommendedQty.toFixed(4)),
    recommended_cases: cases,
    level_used: rate?.weekly_usage_level != null ? Number(rate.weekly_usage_level) : null,
    shape_source: shapeSource,
    trend_factor: Number(trend.toFixed(4)),
  };
  await supabase.from("order_recommendations").insert(row);

  return {
    ...row,
    per_day: perDay,
    confidence,
    periods_used: periodsUsed,
    low_confidence: periodsUsed < 4,
    units_per_case: unitsPerCase,
  };
}

async function recommendBatchOptimized(
  supabase: any,
  itemIds: string[],
  asOfDate: string,
) {
  const ids = Array.from(new Set(itemIds.filter(Boolean)));
  if (ids.length === 0) return { results: {} };

  const { data: itemsData, error: itemsError } = await supabase
    .from("lite_inventory_items")
    .select(
      "id, location_id, name, common_label, unit, vendor_name_normalized, usage_model, par_level, units_per_case, case_qty, rounding_policy, lead_time_days, delivery_dows",
    )
    .in("id", ids);
  if (itemsError) throw itemsError;

  const items = ((itemsData as any[]) || []).filter((item) => item?.id && item?.location_id);
  const foundIds = new Set(items.map((item) => item.id as string));
  const results: Record<string, any> = {};
  ids.forEach((id) => {
    if (!foundIds.has(id)) results[id] = { error: "item not found" };
  });
  if (items.length === 0) return { results };

  const locationIds = Array.from(new Set(items.map((item) => item.location_id as string)));

  const [{ data: ratesData }, { data: dowData }] = await Promise.all([
    supabase
      .from("item_usage_rates")
      .select("item_id, weekly_usage_level, residual_stddev, r2_usage_vs_sales, periods_used")
      .in("item_id", ids),
    supabase
      .from("dow_sales_profile")
      .select("location_id, day_of_week, share_of_week, avg_net_sales")
      .in("location_id", locationIds),
  ]);

  const ratesById = new Map<string, any>();
  ((ratesData as any[]) || []).forEach((rate) => ratesById.set(rate.item_id, rate));

  const dowByLocation = new Map<string, any[]>();
  ((dowData as any[]) || []).forEach((row) => {
    const locationRows = dowByLocation.get(row.location_id) || [];
    locationRows.push(row);
    dowByLocation.set(row.location_id, locationRows);
  });

  const lastCountPairs = await Promise.all(
    locationIds.map(async (locationId) => {
      const { data } = await supabase
        .from("lite_inventory_counts")
        .select("id, location_id, period_end")
        .eq("location_id", locationId)
        .eq("status", "submitted")
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [locationId, data] as const;
    }),
  );
  const lastCountByLocation = new Map<string, any>();
  lastCountPairs.forEach(([locationId, count]) => {
    if (count?.id) lastCountByLocation.set(locationId, count);
  });

  const lastCountIds = Array.from(lastCountByLocation.values()).map((count) => count.id as string);
  const countQtyByItem = new Map<string, number>();
  if (lastCountIds.length > 0) {
    const { data: countItems } = await supabase
      .from("lite_inventory_count_items")
      .select("count_id, item_id, quantity, case_quantity, inner_quantity, case_qty_at_count")
      .in("count_id", lastCountIds)
      .in("item_id", ids);
    ((countItems as any[]) || []).forEach((row) => {
      const item = items.find((candidate) => candidate.id === row.item_id);
      const fallbackUnits = Number(item?.units_per_case ?? item?.case_qty ?? 1) || 1;
      const qty =
        Number(row.quantity ?? 0) +
        Number(row.case_quantity ?? 0) * Number(row.case_qty_at_count ?? fallbackUnits) +
        Number(row.inner_quantity ?? 0);
      countQtyByItem.set(row.item_id, qty);
    });
  }

  const invoiceDateById = new Map<string, string>();
  const invoiceLocationById = new Map<string, string>();
  await Promise.all(
    locationIds.map(async (locationId) => {
      const lastCount = lastCountByLocation.get(locationId);
      if (!lastCount?.period_end) return;
      const { data: invoices } = await supabase
        .from("lite_vendor_invoices")
        .select("id, location_id, invoice_date, delivery_date")
        .eq("location_id", locationId)
        .or(`delivery_date.gte.${lastCount.period_end},invoice_date.gte.${lastCount.period_end}`);
      ((invoices as any[]) || []).forEach((invoice) => {
        const date = invoice.delivery_date || invoice.invoice_date;
        if (!invoice.id || !date) return;
        invoiceDateById.set(invoice.id, date);
        invoiceLocationById.set(invoice.id, invoice.location_id || locationId);
      });
    }),
  );

  const receivedByItem = new Map<string, { date: string; qty: number }[]>();
  const invoiceIds = Array.from(invoiceDateById.keys());
  const IN_CHUNK = 500;
  for (let i = 0; i < invoiceIds.length; i += IN_CHUNK) {
    const chunk = invoiceIds.slice(i, i + IN_CHUNK);
    const { data: lines } = await supabase
      .from("lite_vendor_invoice_items")
      .select("invoice_id, matched_item_id, quantity")
      .in("invoice_id", chunk)
      .in("matched_item_id", ids);
    ((lines as any[]) || []).forEach((line) => {
      const item = items.find((candidate) => candidate.id === line.matched_item_id);
      if (!item) return;
      const invoiceLocation = invoiceLocationById.get(line.invoice_id);
      if (invoiceLocation && invoiceLocation !== item.location_id) return;
      const date = invoiceDateById.get(line.invoice_id);
      if (!date) return;
      const unitsPerCase = Number(item.units_per_case ?? item.case_qty ?? 1) || 1;
      const rows = receivedByItem.get(line.matched_item_id) || [];
      rows.push({ date, qty: Number(line.quantity ?? 0) * unitsPerCase });
      receivedByItem.set(line.matched_item_id, rows);
    });
  }

  const coverageDatesByItem = new Map<string, string[]>();
  const projectionDatesByLocation = new Map<string, Set<string>>();
  const asOf = DateTime.fromFormat(asOfDate, "yyyy-MM-dd");

  items.forEach((item) => {
    const leadDays = Number(item.lead_time_days ?? 0);
    const deliveryDows: number[] =
      Array.isArray(item.delivery_dows) && item.delivery_dows.length > 0
        ? item.delivery_dows
        : [];
    let nextDelivery = asOf.plus({ days: 1 });
    if (deliveryDows.length > 0) {
      let best = Infinity;
      for (const dow of deliveryDows) {
        const todayDow = asOf.weekday % 7;
        let diff = Number(dow) - todayDow;
        if (diff <= 0) diff += 7;
        if (diff < best) best = diff;
      }
      nextDelivery = asOf.plus({ days: best });
    }
    const coverageEnd = nextDelivery.plus({ days: leadDays });
    const dates = eachDate(asOf.toFormat("yyyy-MM-dd"), coverageEnd.toFormat("yyyy-MM-dd"));
    coverageDatesByItem.set(item.id, dates);
    const locationDates = projectionDatesByLocation.get(item.location_id) || new Set<string>();
    dates.forEach((date) => locationDates.add(date));
    projectionDatesByLocation.set(item.location_id, locationDates);
  });

  const projectionByLocationDate = new Map<string, number>();
  await Promise.all(
    Array.from(projectionDatesByLocation.entries()).map(async ([locationId, dates]) => {
      const dateList = Array.from(dates);
      if (dateList.length === 0) return;
      const { data: rows } = await supabase
        .from("sales_cache")
        .select("sale_date, override_projection, living_projection, initial_projection")
        .eq("location_id", locationId)
        .in("sale_date", dateList);
      ((rows as any[]) || []).forEach((row) => {
        const value = row.override_projection ?? row.living_projection ?? row.initial_projection;
        if (row.sale_date && value != null) {
          projectionByLocationDate.set(`${locationId}:${row.sale_date}`, Number(value));
        }
      });
    }),
  );

  const recommendationRows: any[] = [];

  for (const item of items) {
    const itemId = item.id as string;
    const locationId = item.location_id as string;
    const unitsPerCase = Number(item.units_per_case ?? item.case_qty ?? 1) || 1;
    const rounding = (item.rounding_policy as RoundingPolicy) || "up";
    const rate = ratesById.get(itemId);
    const dowRows = dowByLocation.get(locationId) || [];
    const typicalWeekSales = dowRows.reduce(
      (sum, row) => sum + Number(row.avg_net_sales || 0),
      0,
    );
    const coverageDates = coverageDatesByItem.get(itemId) || [asOfDate];
    const dailySalesOverride = new Map<string, number>();
    coverageDates.forEach((date) => {
      const value = projectionByLocationDate.get(`${locationId}:${date}`);
      if (value != null) dailySalesOverride.set(date, value);
    });

    let projectedOnHand: number | null = null;
    const lastCount = lastCountByLocation.get(locationId);
    if (lastCount?.period_end) {
      const lastQty = countQtyByItem.get(itemId) || 0;
      let receivedSince = 0;
      (receivedByItem.get(itemId) || []).forEach((receipt) => {
        if (receipt.date > lastCount.period_end && receipt.date <= asOfDate) {
          receivedSince += receipt.qty;
        }
      });
      const daysSince = daysBetween(lastCount.period_end, asOfDate);
      const weekly = Number(rate?.weekly_usage_level ?? 0);
      const usedSince = (weekly / 7) * daysSince;
      projectedOnHand = Math.max(0, lastQty + receivedSince - usedSince);
    }

    const usageModel = (item.usage_model as UsageModel) || "sales_linked";
    let shapeSource:
      | "sales_linked_dow"
      | "daily_projection"
      | "manager_override"
      | "time_based"
      | "par_based" = "time_based";
    let forecastQty = 0;
    let trend = 1;
    let perDay: { date: string; dow: number; forecast: number }[] = [];

    if (usageModel === "par_based" && item.par_level != null) {
      forecastQty = Number(item.par_level) - (projectedOnHand ?? 0);
      shapeSource = "par_based";
    } else if (usageModel === "sales_linked" && rate?.weekly_usage_level) {
      const projectedWeekTotal = coverageDates.reduce((sum, date) => {
        const projected = dailySalesOverride.get(date);
        if (projected != null) return sum + projected;
        const share = dowRows.find((row) => row.day_of_week === dowFromDate(date));
        return sum + Number(share?.avg_net_sales ?? 0);
      }, 0);
      const typicalCoverageTotal = coverageDates.reduce((sum, date) => {
        const share = dowRows.find((row) => row.day_of_week === dowFromDate(date));
        return sum + Number(share?.avg_net_sales ?? 0);
      }, 0);
      trend = typicalCoverageTotal > 0 ? clamp(projectedWeekTotal / typicalCoverageTotal, 0.85, 1.25) : 1;
      const forecast = forecastSalesLinked(
        Number(rate.weekly_usage_level),
        coverageDates,
        dowRows.map((row) => ({
          day_of_week: row.day_of_week,
          share_of_week: Number(row.share_of_week),
          avg_net_sales: Number(row.avg_net_sales),
        })),
        trend,
        dailySalesOverride.size > 0 ? dailySalesOverride : null,
        typicalWeekSales,
      );
      forecastQty = forecast.total;
      perDay = forecast.perDay;
      shapeSource = dailySalesOverride.size > 0 ? "daily_projection" : "sales_linked_dow";
    } else if (rate?.weekly_usage_level) {
      forecastQty = (Number(rate.weekly_usage_level) / 7) * coverageDates.length;
      shapeSource = "time_based";
    }

    const residual = Number(rate?.residual_stddev ?? 0);
    const safety = 1.65 * residual * Math.sqrt(coverageDates.length / 7);
    const raw = forecastQty - (projectedOnHand ?? 0) + safety;
    const recommendedQty = Math.max(0, raw);
    const cases = unitsPerCase > 1 ? applyRounding(recommendedQty / unitsPerCase, rounding) : 0;
    const periodsUsed = Number(rate?.periods_used ?? 0);
    const confidence: "green" | "amber" | "red" =
      periodsUsed >= 8 ? "green" : periodsUsed >= 4 ? "amber" : "red";

    const row = {
      item_id: itemId,
      location_id: locationId,
      generated_at: new Date().toISOString(),
      as_of_date: asOfDate,
      coverage_start: coverageDates[0],
      coverage_end: coverageDates[coverageDates.length - 1],
      forecast_qty: Number(forecastQty.toFixed(4)),
      projected_on_hand: projectedOnHand != null ? Number(projectedOnHand.toFixed(4)) : null,
      safety_stock: Number(safety.toFixed(4)),
      recommended_qty: Number(recommendedQty.toFixed(4)),
      recommended_cases: cases,
      level_used: rate?.weekly_usage_level != null ? Number(rate.weekly_usage_level) : null,
      shape_source: shapeSource,
      trend_factor: Number(trend.toFixed(4)),
    };

    recommendationRows.push(row);
    results[itemId] = {
      ...row,
      per_day: perDay,
      confidence,
      periods_used: periodsUsed,
      low_confidence: periodsUsed < 4,
      units_per_case: unitsPerCase,
    };
  }

  if (recommendationRows.length > 0) {
    const { error } = await supabase.from("order_recommendations").insert(recommendationRows);
    if (error) console.error("recommendBatch audit insert failed", error);
  }

  return {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      common_label: item.common_label,
      unit: item.unit,
      vendor_name_normalized: item.vendor_name_normalized,
      case_qty: item.case_qty,
      units_per_case: item.units_per_case,
      usage_model: item.usage_model,
    })),
    rates: Object.fromEntries(ratesById),
    results,
  };
}

async function recommendLocationOptimized(
  supabase: any,
  locationId: string,
  asOfDate: string,
) {
  const { data: items, error } = await supabase
    .from("lite_inventory_items")
    .select("id")
    .eq("location_id", locationId)
    .eq("is_active", true);
  if (error) throw error;

  const ids = ((items as any[]) || []).map((item) => item.id).filter(Boolean);
  return recommendBatchOptimized(supabase, ids, asOfDate);
}

// ------------------------------------------------------------
// HTTP entry
// ------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { supabase } = svc();
    const { action, item_id, item_ids, location_id, as_of_date } =
      await req.json();

    if (action === "buildUsagePeriods" && item_id) {
      const out = await buildUsagePeriods(supabase, item_id);
      return json(out);
    }
    if (action === "refreshDowProfile" && location_id) {
      const out = await refreshDowProfile(supabase, location_id);
      return json(out);
    }
    if (action === "fitUsageRate" && item_id) {
      const out = await fitUsageRate(supabase, item_id);
      return json(out);
    }
    if (action === "recommendOrder" && item_id && as_of_date) {
      const out = await recommendOrder(supabase, item_id, as_of_date);
      return json(out);
    }
    if (action === "recommendBatch" && Array.isArray(item_ids) && as_of_date) {
      const out = await recommendBatchOptimized(supabase, item_ids, as_of_date);
      return json(out);
    }
    if (action === "recommendLocation" && location_id && as_of_date) {
      const out = await recommendLocationOptimized(supabase, location_id, as_of_date);
      return json(out);
    }
    if (action === "rebuildLocation" && location_id) {
      // Long-running: kick off in background so the HTTP request returns
      // immediately (avoids the 150s edge idle-timeout).
      const task = async () => {
        try {
          await refreshDowProfile(supabase, location_id);
          const { data: items } = await supabase
            .from("lite_inventory_items")
            .select("id")
            .eq("location_id", location_id)
            .eq("is_active", true);
          const list = ((items as any[]) || []).map((r) => r.id);
          const CONCURRENCY = 4;
          for (let i = 0; i < list.length; i += CONCURRENCY) {
            const chunk = list.slice(i, i + CONCURRENCY);
            await Promise.all(
              chunk.map(async (id: string) => {
                try {
                  await buildUsagePeriods(supabase, id);
                  await fitUsageRate(supabase, id);
                } catch (e) {
                  console.error("rebuildLocation item failed", id, e);
                }
              }),
            );
          }
          console.log("rebuildLocation complete", location_id, list.length);
        } catch (e) {
          console.error("rebuildLocation task failed", e);
        }
      };
      // @ts-ignore EdgeRuntime is provided by supabase edge runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(task());
      } else {
        task();
      }
      return json({ status: "started", location_id });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("genius-usage-engine error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
