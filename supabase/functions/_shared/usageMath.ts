// Pure math helpers for the Genius usage forecasting engine.
// Kept dependency-free so it can be unit-tested and reused by adapters.

export type UsageModel = "sales_linked" | "time_based" | "par_based";
export type RoundingPolicy = "up" | "down" | "nearest";

export interface PeriodInput {
  period_start_date: string; // yyyy-MM-dd
  period_end_date: string;
  days_in_period: number;
  qty_start: number;
  qty_received: number;
  qty_end: number;
  usage: number;
  net_sales: number | null;
  usage_per_dollar: number | null;
  is_excluded: boolean;
}

export interface DowShare {
  day_of_week: number; // 0=Sun
  share_of_week: number;
  avg_net_sales: number;
}

export interface FitResult {
  weekly_usage_level: number | null;
  alpha: number;
  residual_stddev: number | null;
  r2_usage_vs_sales: number | null;
  periods_used: number;
  auto_class: UsageModel | null;
}

/** Median absolute deviation. Returns [median, mad]. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mad(values: number[]): { median: number; mad: number } {
  const m = median(values);
  const dev = values.map((v) => Math.abs(v - m));
  return { median: m, mad: median(dev) };
}

/**
 * Flag periods whose usage_per_dollar sits > 2.5 MAD from the item median.
 * Only considers non-excluded periods with a valid usage_per_dollar.
 */
export function markOutliers<T extends PeriodInput>(periods: T[]): T[] {
  const upd = periods
    .filter((p) => !p.is_excluded && p.usage_per_dollar != null && Number.isFinite(p.usage_per_dollar))
    .map((p) => p.usage_per_dollar as number);
  if (upd.length < 4) return periods;
  const { median: m, mad: d } = mad(upd);
  if (d === 0) return periods;
  const lo = m - 2.5 * d;
  const hi = m + 2.5 * d;
  return periods.map((p) => {
    if (p.is_excluded) return p;
    const u = p.usage_per_dollar;
    if (u == null) return p;
    if (u < lo || u > hi) return { ...p, is_excluded: true } as T;
    return p;
  });
}

/**
 * Exponentially weighted mean of per-period weekly-normalised usage rates.
 * Newest first. α=0.35 → recent periods dominate but older ones still shape it.
 */
export function fitWeeklyUsage(
  periods: PeriodInput[],
  alpha = 0.35,
): FitResult {
  const valid = periods.filter(
    (p) => !p.is_excluded && p.days_in_period > 0 && p.usage >= 0,
  );
  const periods_used = valid.length;
  if (periods_used === 0) {
    return {
      weekly_usage_level: null,
      alpha,
      residual_stddev: null,
      r2_usage_vs_sales: null,
      periods_used: 0,
      auto_class: null,
    };
  }

  // Sort newest first
  const sorted = [...valid].sort((a, b) =>
    b.period_end_date.localeCompare(a.period_end_date),
  );

  // Per-period weekly usage = (usage / days) * 7
  const weeklyRates = sorted.map((p) => (p.usage / p.days_in_period) * 7);

  // EWMA (newest first): S_0 = r_0; S_i = α r_i + (1-α) S_{i-1} — but with newest-first
  // we walk from oldest to newest to reflect recency emphasis.
  const oldestFirst = [...weeklyRates].reverse();
  let level = oldestFirst[0];
  for (let i = 1; i < oldestFirst.length; i++) {
    level = alpha * oldestFirst[i] + (1 - alpha) * level;
  }

  // Residual stddev vs the fitted level
  const residuals = weeklyRates.map((r) => r - level);
  const variance =
    residuals.reduce((s, x) => s + x * x, 0) / Math.max(1, residuals.length - 1);
  const residual_stddev = Math.sqrt(variance);

  // R² of usage vs net_sales
  let r2: number | null = null;
  const withSales = sorted.filter(
    (p) => p.net_sales != null && (p.net_sales as number) > 0,
  );
  if (withSales.length >= 3) {
    const xs = withSales.map((p) => p.net_sales as number);
    const ys = withSales.map((p) => p.usage);
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      denX += (xs[i] - meanX) ** 2;
      denY += (ys[i] - meanY) ** 2;
    }
    const denom = Math.sqrt(denX * denY);
    if (denom > 0) {
      const r = num / denom;
      r2 = r * r;
    }
  }

  let auto_class: UsageModel | null = null;
  if (r2 != null && r2 >= 0.6) auto_class = "sales_linked";
  else auto_class = "time_based"; // caller can override to par_based when par is set

  return {
    weekly_usage_level: level,
    alpha,
    residual_stddev,
    r2_usage_vs_sales: r2,
    periods_used,
    auto_class,
  };
}

export function applyRounding(x: number, policy: RoundingPolicy): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= 0) return 0;
  if (policy === "up") return Math.ceil(x);
  if (policy === "down") return Math.floor(x);
  return Math.round(x);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Days between yyyy-MM-dd strings (calendar-day count, min 1). */
export function daysBetween(a: string, b: string): number {
  const aD = new Date(a + "T00:00:00Z").getTime();
  const bD = new Date(b + "T00:00:00Z").getTime();
  return Math.max(1, Math.round((bD - aD) / 86400000));
}

/** Enumerate yyyy-MM-dd business dates (calendar dates, inclusive). */
export function eachDate(startInclusive: string, endInclusive: string): string[] {
  const out: string[] = [];
  const start = new Date(startInclusive + "T00:00:00Z");
  const end = new Date(endInclusive + "T00:00:00Z");
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** 0..6 (Sun..Sat) for a yyyy-MM-dd business date. */
export function dowFromDate(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getUTCDay();
}

/**
 * Forecast per-day usage across a coverage window using DOW shape.
 * Returns { total, perDay: [{ date, dow, forecast }] }.
 */
export function forecastSalesLinked(
  weeklyLevel: number,
  coverageDates: string[],
  dowShares: DowShare[],
  trend: number,
  dailySalesOverride: Map<string, number> | null,
  typicalWeekSales: number,
): { total: number; perDay: { date: string; dow: number; forecast: number }[] } {
  const shareByDow = new Map<number, number>();
  dowShares.forEach((d) => shareByDow.set(d.day_of_week, d.share_of_week));
  const perDay = coverageDates.map((date) => {
    const dow = dowFromDate(date);
    const share = shareByDow.get(dow) ?? 1 / 7;
    let forecast = weeklyLevel * share * trend;
    // If we have a specific projection for that date, scale proportionally.
    if (dailySalesOverride && typicalWeekSales > 0) {
      const proj = dailySalesOverride.get(date);
      if (proj != null && proj > 0) {
        const dowAvg = (dowShares.find((d) => d.day_of_week === dow)?.avg_net_sales) ?? 0;
        if (dowAvg > 0) {
          forecast = weeklyLevel * share * (proj / dowAvg);
        }
      }
    }
    return { date, dow, forecast: Math.max(0, forecast) };
  });
  return {
    total: perDay.reduce((s, p) => s + p.forecast, 0),
    perDay,
  };
}
