// Which past store-local dates the Toast runner should re-post (toast-service schedule_list).
// Pure: callers pass the rows; nothing here touches the database.

export interface RepostInput {
  businessDate: string;                 // store's current business date (yyyy-MM-dd)
  sales: { sale_date: string; net_sales: number | null; fetched_at: string | null }[];
  toastLaborDates: string[];            // labor_cache dates with source 'toast'
  openShiftDates: string[];             // toast_shifts dates with out_time IS NULL
  rawSources: { sale_date: string; data_source: string }[];
  yesterdayEndAt: string | null;        // business_day_window(yesterday).end_at
}

function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const REPOST_LOOKBACK_DAYS = 21;
export const REPOST_MAX = 10;

export function repostDates(i: RepostInput): string[] {
  const yesterday = addDays(i.businessDate, -1);
  const oldest = addDays(i.businessDate, -REPOST_LOOKBACK_DAYS);
  const inWindow = (d: string) => d >= oldest && d < i.businessDate;
  const labor = new Set(i.toastLaborDates);
  const out = new Set<string>();
  for (const s of i.sales) {
    if (!inWindow(s.sale_date)) continue;
    if (s.sale_date === yesterday && i.yesterdayEndAt && (!s.fetched_at || new Date(s.fetched_at) < new Date(i.yesterdayEndAt))) out.add(s.sale_date);
    if (Number(s.net_sales) > 0 && !labor.has(s.sale_date)) out.add(s.sale_date);
  }
  for (const d of i.openShiftDates) if (inWindow(d)) out.add(d);
  for (const r of i.rawSources) if (r.sale_date === yesterday && r.data_source === "live") out.add(r.sale_date);
  return [...out].sort().slice(0, REPOST_MAX);
}
