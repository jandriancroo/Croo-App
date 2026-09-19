// _shared/weekProjections.ts
// POS-neutral week projection seeder.
//
// Every POS (QuBeyond, Clover, Aloha, future vendors) writes normalized daily
// sales into sales_cache. This module reads that shared history and fills in
// forward-looking daily projections for a requested week, using the exact same
// math as _shared/projections.ts. No adapter reimplements projection logic and
// no vendor-specific field is read here.
//
// Protection rules (never violated):
//   • Never writes net_sales, guest_count, product_mix, payments or any actual.
//   • Never overwrites a manager override (override_projection).
//   • Never overwrites an existing initial_projection ("first projection wins").
//   • Never touches a day that already has actual sales.
//   • Never touches labor_cache or any inventory data.

import {
  fetchHistoricalDataFromCache,
  generateHourlyProjections,
  generateProjections,
} from "./projections.ts";

export interface SeededDay {
  sale_date: string;
  projection: number;
  action: "created" | "filled" | "refreshed" | "skipped";
  reason?: string;
}

export interface SeedWeekResult {
  locationId: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  days: SeededDay[];
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function todayInTimezone(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Monday-anchored week start for a yyyy-MM-dd business date.
export function weekStartFor(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  return addDaysStr(dateStr, -diff);
}

export async function getLocationTimezone(supabase: any, locationId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("location_settings")
      .select("timezone")
      .eq("location_id", locationId)
      .maybeSingle();
    return (data?.timezone as string) || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

// Which sales system this store actually runs on, so a newly created
// forecast row is never mislabeled with another vendor's name.
async function getActivePosSource(supabase: any, locationId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("location_integrations")
      .select("integration_type")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .in("integration_type", ["qubeyond", "clover", "aloha"]);
    const found = (data ?? []).map((r: any) => r.integration_type as string);
    for (const key of ["qubeyond", "clover", "aloha"]) {
      if (found.includes(key)) return key;
    }
  } catch {
    // fall through
  }
  return null;
}

async function getStoreHours(supabase: any, locationId: string): Promise<{ open: number; close: number }> {
  let open = 10;
  let close = 22;
  try {
    const { data } = await supabase
      .from("location_settings")
      .select("hours_open, hours_close")
      .eq("location_id", locationId)
      .maybeSingle();
    const parseHour = (v: unknown): number | null => {
      if (v == null) return null;
      const h = parseInt(String(v).split(":")[0], 10);
      return Number.isFinite(h) ? h : null;
    };
    const o = parseHour(data?.hours_open);
    const c = parseHour(data?.hours_close);
    if (o != null) open = o;
    if (c != null) close = c;
  } catch {
    // defaults stand
  }
  return { open, close };
}

/**
 * Fill forward-looking daily projections for one location and one week.
 * Works identically for every POS because it only reads normalized sales_cache.
 */
export async function seedWeekProjections(
  supabase: any,
  locationId: string,
  weekStartInput?: string,
  timezoneInput?: string,
): Promise<SeedWeekResult> {
  const timezone = timezoneInput || (await getLocationTimezone(supabase, locationId));
  const today = todayInTimezone(timezone);
  const weekStart = weekStartInput || weekStartFor(today);
  const weekEnd = addDaysStr(weekStart, 6);

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) weekDates.push(addDaysStr(weekStart, i));

  const { data: existingRows, error: readErr } = await supabase
    .from("sales_cache")
    .select("sale_date, net_sales, initial_projection, living_projection, override_projection, projected_sales, pos_source")
    .eq("location_id", locationId)
    .in("sale_date", weekDates);
  if (readErr) throw new Error(`sales_cache read failed: ${readErr.message}`);

  const existing = new Map<string, any>();
  for (const row of existingRows ?? []) existing.set(row.sale_date, row);

  const { open: hoursOpen, close: hoursClose } = await getStoreHours(supabase, locationId);
  const posSource = await getActivePosSource(supabase, locationId);
  const days: SeededDay[] = [];

  for (const date of weekDates) {
    const row = existing.get(date);

    // Past days and today keep their own actuals + live pace flow untouched.
    if (date <= today) {
      days.push({ sale_date: date, projection: Number(row?.living_projection ?? row?.initial_projection ?? 0), action: "skipped", reason: date === today ? "today handled by live pace" : "past day uses actual sales" });
      continue;
    }

    // Manager override always wins.
    if (row && Number(row.override_projection ?? 0) > 0) {
      days.push({ sale_date: date, projection: Number(row.override_projection), action: "skipped", reason: "manager override" });
      continue;
    }

    // A day that already has a usable forecast is left alone, so each POS keeps
    // ownership of its own living projection. This service only fills gaps.
    if (row && (Number(row.living_projection ?? 0) > 0 || Number(row.projected_sales ?? 0) > 0)) {
      days.push({ sale_date: date, projection: Number(row.living_projection ?? row.projected_sales), action: "skipped", reason: "forecast already present" });
      continue;
    }

    // A future day that already carries actual sales is left alone.
    if (row && Number(row.net_sales ?? 0) > 0) {
      days.push({ sale_date: date, projection: Number(row.living_projection ?? row.initial_projection ?? 0), action: "skipped", reason: "actual sales already present" });
      continue;
    }

    const hist = await fetchHistoricalDataFromCache(supabase, locationId, date);

    const [{ data: weekRows }, { data: monthRows }] = await Promise.all([
      supabase
        .from("sales_cache")
        .select("sale_date, net_sales")
        .eq("location_id", locationId)
        .gte("sale_date", weekStartFor(date))
        .lte("sale_date", date),
      supabase
        .from("sales_cache")
        .select("sale_date, net_sales")
        .eq("location_id", locationId)
        .gte("sale_date", `${date.slice(0, 7)}-01`)
        .lte("sale_date", date),
    ]);

    const weeklyBreakdown = (weekRows ?? []).map((r: any) => ({ date: r.sale_date, sales: Number(r.net_sales) || 0 }));
    const monthlyBreakdown = (monthRows ?? []).map((r: any) => ({ date: r.sale_date, sales: Number(r.net_sales) || 0 }));
    const weeklySales = weeklyBreakdown.reduce((s: number, r: { sales: number }) => s + r.sales, 0);
    const monthlySales = monthlyBreakdown.reduce((s: number, r: { sales: number }) => s + r.sales, 0);

    const provisionalDaily =
      hist.fourWeekAverage?.avgDailyByDayOfWeek.find(
        (d) => d.dayOfWeek === new Date(date + "T12:00:00").getDay(),
      )?.avgSales ||
      hist.lastYearData?.sameDay ||
      0;

    // Future day: no actual hourly sales exist yet, so the hourly curve is
    // purely the shared projected pattern.
    const hourlyProjections = generateHourlyProjections(
      [],
      hoursOpen,
      hoursClose,
      date,
      locationId,
      provisionalDaily,
      hist.fourWeekHourlyPattern,
      hist.lastYearData?.hourlyData,
    );

    // Hours outside the operating window keep the pace engine neutral for a
    // future date (pace only applies to a day in progress).
    const projections = generateProjections(
      0,
      weeklySales,
      monthlySales,
      weeklyBreakdown,
      monthlyBreakdown,
      hoursClose,
      0,
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

    const projected = Math.round((projections.todayProjected || 0) * 100) / 100;
    if (!(projected > 0)) {
      days.push({ sale_date: date, projection: 0, action: "skipped", reason: "not enough history for this day" });
      continue;
    }

    if (!row) {
      const { error: insertErr } = await supabase.from("sales_cache").insert({
        location_id: locationId,
        sale_date: date,
        net_sales: 0,
        guest_count: 0,
        initial_projection: projected,
        living_projection: projected,
        ...(posSource ? { pos_source: posSource } : {}),
      });
      if (insertErr) throw new Error(`sales_cache insert failed for ${date}: ${insertErr.message}`);
      days.push({ sale_date: date, projection: projected, action: "created" });
      continue;
    }

    // Refresh the living projection; seed initial only when it is still empty.
    const update: Record<string, any> = { living_projection: projected };
    const hadInitial = Number(row.initial_projection ?? 0) > 0;
    if (!hadInitial) update.initial_projection = projected;

    const { error: updateErr } = await supabase
      .from("sales_cache")
      .update(update)
      .eq("location_id", locationId)
      .eq("sale_date", date);
    if (updateErr) throw new Error(`sales_cache update failed for ${date}: ${updateErr.message}`);

    days.push({ sale_date: date, projection: projected, action: hadInitial ? "refreshed" : "filled" });
  }

  return { locationId, weekStart, weekEnd, timezone, days };
}
