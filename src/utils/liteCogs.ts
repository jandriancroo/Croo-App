/**
 * Lite COGS pure helpers. All math + CSV generation lives here so the panel
 * component is view-only and the calc is trivially unit-testable.
 *
 * COGS $ = Beginning Inventory + Purchases − Ending Inventory
 * COGS %  = COGS $ ÷ manual_sales_total  (only when > 0)
 *
 * Beginning Inventory rule:
 *   - Use the most recent SUBMITTED count with period_end < this period's
 *     period_start.
 *   - If none exists (Virginia St. day-one case), Beginning = $0. Never fall
 *     back to "the earliest count" — that would trivially force COGS = $0
 *     for a location's first period.
 *
 * Purchases window rule:
 *   - Match on COALESCE(delivery_date, invoice_date) within
 *     [period_start, period_end]. Operators think in terms of "what came in
 *     the door this week," which is delivery. Vendors sometimes only stamp
 *     invoice_date, so it's the fallback.
 */

export interface LiteCountItemRow {
  quantity: number;
  unit_value_at_count: number;
  case_quantity?: number | null;
  inner_quantity?: number | null;
  count_mode_at_count?: "single" | "case_and_unit" | null;
  cost_per_inner_unit_at_count?: number | null;
  item?: { category: string | null } | null;
}

/** Snapshotted value of a single count row. Dual-mode rows use their
 *  case + inner snapshot; single-mode rows use quantity × unit_value_at_count. */
export function countItemValue(r: LiteCountItemRow): number {
  if (r.count_mode_at_count === "case_and_unit") {
    return (
      Number(r.case_quantity || 0) * Number(r.unit_value_at_count || 0) +
      Number(r.inner_quantity || 0) * Number(r.cost_per_inner_unit_at_count || 0)
    );
  }
  return Number(r.quantity || 0) * Number(r.unit_value_at_count || 0);
}

export interface LiteInvoiceRow {
  id: string;
  vendor_name: string | null;
  invoice_date: string | null;
  delivery_date: string | null;
  total_amount: number | null;
}

export interface CogsBreakdown {
  beginning: number;
  purchases: number;
  ending: number;
  cogs: number;
  cogsPct: number | null; // null when no manual sales entered
  byCategory: Array<{
    category: string;
    endingValue: number;
    pctOfEnding: number;
  }>;
  invoices: LiteInvoiceRow[];
  manualSales: number | null;
}

export function sumCountItems(rows: LiteCountItemRow[] | null | undefined): number {
  if (!rows || !rows.length) return 0;
  return rows.reduce(
    (sum, r) => sum + Number(r.quantity || 0) * Number(r.unit_value_at_count || 0),
    0,
  );
}

export function filterInvoicesInWindow(
  invoices: LiteInvoiceRow[] | null | undefined,
  periodStart: string,
  periodEnd: string,
): LiteInvoiceRow[] {
  if (!invoices) return [];
  return invoices.filter((inv) => {
    const anchor = inv.delivery_date ?? inv.invoice_date;
    if (!anchor) return false;
    return anchor >= periodStart && anchor <= periodEnd;
  });
}

export function sumInvoices(invoices: LiteInvoiceRow[] | null | undefined): number {
  if (!invoices) return 0;
  return invoices.reduce((sum, i) => sum + Number(i.total_amount || 0), 0);
}

export function categoryBreakdown(
  rows: LiteCountItemRow[] | null | undefined,
): CogsBreakdown["byCategory"] {
  if (!rows || !rows.length) return [];
  const totals = new Map<string, number>();
  for (const r of rows) {
    const cat = (r.item?.category?.trim() || "Uncategorized");
    const value = Number(r.quantity || 0) * Number(r.unit_value_at_count || 0);
    totals.set(cat, (totals.get(cat) || 0) + value);
  }
  const endingTotal = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  return Array.from(totals.entries())
    .map(([category, endingValue]) => ({
      category,
      endingValue,
      pctOfEnding: endingTotal > 0 ? (endingValue / endingTotal) * 100 : 0,
    }))
    .sort((a, b) => b.endingValue - a.endingValue);
}

export function buildCogs(input: {
  currentRows: LiteCountItemRow[] | null | undefined;
  priorEnding: number; // 0 when no prior submitted count exists
  invoicesInWindow: LiteInvoiceRow[];
  manualSales: number | null;
}): CogsBreakdown {
  const ending = sumCountItems(input.currentRows);
  const purchases = sumInvoices(input.invoicesInWindow);
  const beginning = input.priorEnding;
  const cogs = beginning + purchases - ending;
  const cogsPct =
    input.manualSales != null && input.manualSales > 0
      ? (cogs / input.manualSales) * 100
      : null;
  return {
    beginning,
    purchases,
    ending,
    cogs,
    cogsPct,
    byCategory: categoryBreakdown(input.currentRows),
    invoices: input.invoicesInWindow,
    manualSales: input.manualSales,
  };
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function cogsToCsv(
  breakdown: CogsBreakdown,
  meta: { locationName: string; periodStart: string; periodEnd: string },
): string {
  const rows: string[][] = [];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  rows.push(["Lite COGS Report"]);
  rows.push(["Location", meta.locationName]);
  rows.push(["Period Start", meta.periodStart]);
  rows.push(["Period End", meta.periodEnd]);
  rows.push([]);
  rows.push(["Summary"]);
  rows.push(["Beginning Inventory", breakdown.beginning.toFixed(2)]);
  rows.push(["+ Purchases", breakdown.purchases.toFixed(2)]);
  rows.push(["- Ending Inventory", breakdown.ending.toFixed(2)]);
  rows.push(["= COGS $", breakdown.cogs.toFixed(2)]);
  if (breakdown.manualSales != null) {
    rows.push(["Manual Sales Total", breakdown.manualSales.toFixed(2)]);
  }
  if (breakdown.cogsPct != null) {
    rows.push(["COGS %", `${breakdown.cogsPct.toFixed(2)}%`]);
  }
  rows.push([]);
  rows.push(["Purchases (Invoices in window)"]);
  rows.push(["Vendor", "Date (delivery ▸ invoice fallback)", "Total"]);
  for (const inv of breakdown.invoices) {
    rows.push([
      inv.vendor_name || "Unknown",
      inv.delivery_date ?? inv.invoice_date ?? "",
      Number(inv.total_amount || 0).toFixed(2),
    ]);
  }
  rows.push([]);
  rows.push(["Ending Inventory by Category"]);
  rows.push(["Category", "Ending Value", "% of Ending"]);
  for (const c of breakdown.byCategory) {
    rows.push([c.category, c.endingValue.toFixed(2), `${c.pctOfEnding.toFixed(2)}%`]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
