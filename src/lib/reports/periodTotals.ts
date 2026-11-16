// Period totals shared by the Reports page and Theo's compare_metrics tool.
// One number, one path: Reports (src/lib/reports/periodTotals.ts) and the edge copy
// (supabase/functions/_shared/reports/periodTotals.ts) must stay byte-identical
// (checked by src/lib/reports/periodTotals.parity.test.ts). Pure code only: no imports.
//
// Rules (unchanged from Reports / Sales Summary / DataCube):
// - Net and guests are plain sums of sales_cache rows.
// - Gross is visibility only. It is null (shown as "—") when any day with sales in the
//   range is missing gross. It is never filled with net.
// - Average ticket: one day = that day's stored avg_ticket; a range = net ÷ guests.
// - Labor % = labor cost ÷ NET sales, never gross.

export interface PeriodSalesRow {
  sale_date?: string;
  net_sales?: number | string | null;
  guest_count?: number | string | null;
  gross_sales?: number | string | null;
  avg_ticket?: number | string | null;
}

export interface PeriodSalesTotals {
  /** Net sales (sum). */
  net: number;
  guests: number;
  /** null when any selling day is missing a gross piece. */
  gross: number | null;
  /** Selling days (net > 0) that have gross. */
  grossDays: number;
  /** Days with net > 0. */
  salesDays: number;
  /** Rows read (days with a sales_cache row). */
  rowDays: number;
}

const n = (v: unknown): number => Number(v) || 0;

/** Sales slice of the Reports loader (fetchLocationData). */
export function periodSalesTotals(rows: PeriodSalesRow[] | null | undefined): PeriodSalesTotals {
  const list = rows || [];
  const net = list.reduce((s, r) => s + n(r.net_sales), 0);
  const guests = list.reduce((s, r) => s + n(r.guest_count), 0);
  const selling = list.filter((r) => n(r.net_sales) > 0);
  const grossDays = selling.filter((r) => r.gross_sales != null && r.gross_sales !== '').length;
  const gross = selling.length > 0 && grossDays === selling.length
    ? selling.reduce((s, r) => s + n(r.gross_sales), 0)
    : null;
  return { net, guests, gross, grossDays, salesDays: selling.length, rowDays: list.length };
}

/** Same hide rule applied to a get_gross_sales_range row (gross_sales, sales_days, gross_days). */
export function grossFromRange(raw: unknown): { gross: number | null; salesDays: number; grossDays: number } | null {
  const r = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object') return null;
  const salesDays = n(r.sales_days);
  const grossDays = n(r.gross_days);
  const g = r.gross_sales;
  const gross = g == null || g === '' || salesDays === 0 || grossDays !== salesDays || !Number.isFinite(Number(g)) ? null : Number(g);
  return { gross, salesDays, grossDays };
}

/** Average ticket: a single day uses its stored avg_ticket; a range is net ÷ guests. */
export function periodAvgTicket(rows: PeriodSalesRow[] | null | undefined, singleDay: boolean): number | null {
  const list = rows || [];
  if (singleDay) {
    const t = list[0]?.avg_ticket;
    return t == null || t === '' ? null : n(t);
  }
  const t = periodSalesTotals(list);
  return t.guests > 0 && t.net > 0 ? t.net / t.guests : null;
}

/** Labor % on NET sales. null when there is no labor or no sales. */
export function laborPercentOnNet(laborCost: number | null | undefined, netSales: number | null | undefined): number | null {
  const l = Number(laborCost);
  const s = Number(netSales);
  if (!(l > 0) || !(s > 0)) return null;
  return (l / s) * 100;
}

/** Change from B to A. percent is null when B is 0 or either side is missing. */
export function periodChange(a: number | null | undefined, b: number | null | undefined): { change: number | null; percent: number | null } {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return { change: null, percent: null };
  return { change: a - b, percent: b === 0 ? null : ((a - b) / Math.abs(b)) * 100 };
}
