// compare_metrics: Theo Dashboards (Phase 1). One read tool that compares period A with
// period B for the CURRENT store and returns a structured card (TheoCompareCard) plus a
// spoken_summary for voice. Read only: it saves nothing and never goes through the action wizard.
//
// Security (Andy's guardrails):
// - The caller is the user from the request JWT (passed in as userId); nothing about the
//   user or store is trusted from tool args or the client body without a server check.
// - Current store only. Any other location the model names is refused, and the one store
//   used is checked with has_location_access(user, store) before anything is read.
// - Every loader runs on the signed-in user's client (anon key + their Authorization header),
//   so RLS and the RPCs' own role checks apply. The only service-role use is the existing
//   Scheduling Manager blended-labor path, which runs after the access check above.
// - Labor dollars never leave this module: only labor hours and labor % (on net).
// Math is never new: sales/gross/ticket/labor % come from ../_shared/reports/periodTotals.ts
// (byte-identical to the Reports copy), labor from get_store_labor, gross from
// get_gross_sales_range, checklists from Tasks > History (runQueryTaskHistory).
import { DateTime } from "npm:luxon@3";
import { periodBounds } from "../_shared/salesPeriodSnapshot.ts";
import { periodSalesTotals, grossFromRange, periodAvgTicket, laborPercentOnNet, periodChange } from "../_shared/reports/periodTotals.ts";
import { runQueryTaskHistory, MAX_HISTORY_DAYS } from "./taskHistoryTool.ts";

export const COMPARE_METRIC_KEYS = ["net_sales", "gross_sales", "labor_hours", "labor_pct", "guest_count", "avg_ticket", "product_mix", "checklist_completion"] as const;
export type CompareMetric = typeof COMPARE_METRIC_KEYS[number];
export const MAX_SALES_DAYS = 400;
export const MAX_PRODUCT_MIX_DAYS = 31;
export const MAX_CHECKLIST_DAYS = MAX_HISTORY_DAYS; // 14, same cap as Tasks > History
export const GROSS_FOOTNOTE = "Gross = net + discounts, comps, promos and refunds. Tax and tips excluded.";
/** Metrics Theo must refuse on the card (labor dollars stay off; inventory stays parked). */
const REFUSED: Record<string, string> = {
  labor_cost: "Labor dollars aren't shown on the comparison card. Ask for labor hours or labor %.",
  labor_dollars: "Labor dollars aren't shown on the comparison card. Ask for labor hours or labor %.",
  wages: "Labor dollars aren't shown on the comparison card. Ask for labor hours or labor %.",
  inventory: "Inventory and food cost aren't available in Theo yet.",
  cogs: "Inventory and food cost aren't available in Theo yet.",
  food_cost: "Inventory and food cost aren't available in Theo yet.",
};
const ALIASES: Record<string, CompareMetric> = {
  sales: "net_sales", net: "net_sales", gross: "gross_sales", labor: "labor_pct", labor_percent: "labor_pct", labor_percentage: "labor_pct",
  hours: "labor_hours", guests: "guest_count", guest_counts: "guest_count", ticket: "avg_ticket", average_ticket: "avg_ticket",
  pmix: "product_mix", items: "product_mix", checklists: "checklist_completion", checklist: "checklist_completion",
};

const LABELS: Record<string, { label: string; unit: "usd" | "pct" | "hours" | "count" }> = {
  net_sales: { label: "Net sales", unit: "usd" },
  gross_sales: { label: "Gross sales", unit: "usd" },
  labor_hours: { label: "Labor hours", unit: "hours" },
  labor_pct: { label: "Labor %", unit: "pct" },
  guest_count: { label: "Guests", unit: "count" },
  avg_ticket: { label: "Avg ticket", unit: "usd" },
};

export const COMPARE_METRICS_TOOL = {
  type: "function",
  function: {
    name: "compare_metrics",
    description: "Compare store metrics between two periods for the CURRENT store and show them as a table card on screen (chat and voice). Use for ANY comparison, side-by-side, 'X vs Y', 'this week vs last week', 'compared to last year', or 'table of' question about net sales, gross sales, labor hours, labor %, guests, average ticket, product mix (items) or checklist completion. Never compute differences yourself; this tool does the math. Labor dollars are never on the card. Checklist periods max 14 days; product mix periods max 31 days.",
    parameters: {
      type: "object",
      properties: {
        location_id: { type: "string", description: "UUID of the current location (the only store this tool compares)" },
        metrics: { type: "array", items: { type: "string", enum: [...COMPARE_METRIC_KEYS] }, description: "Which metrics to compare. Send only what the manager asked for; 'sales' = net_sales, 'labor' = labor_hours + labor_pct." },
        period_a: {
          type: "object",
          description: "First period (usually the more recent one).",
          properties: {
            period: { type: "string", enum: ["day", "week", "month", "custom"], description: "day / week (Mon–Sun) / month, or custom with start_date+end_date" },
            date: { type: "string", description: "YYYY-MM-DD inside the day/week/month (default: today's business date)" },
            start_date: { type: "string", description: "Custom start YYYY-MM-DD" },
            end_date: { type: "string", description: "Custom end YYYY-MM-DD" },
          },
          required: ["period"],
        },
        period_b: {
          type: "object",
          description: "Second period. Either the same shape as period_a, or { compare_to: 'prior' | 'last_year' } to resolve it from period_a on the server (prior = previous day-of-week last week / previous week / previous month; last_year = 364 days earlier, or the same month last year).",
          properties: {
            compare_to: { type: "string", enum: ["prior", "last_year"] },
            period: { type: "string", enum: ["day", "week", "month", "custom"] },
            date: { type: "string" },
            start_date: { type: "string" },
            end_date: { type: "string" },
          },
        },
        item: { type: "string", description: "Optional product-mix item name filter (product_mix only)" },
        checklist: { type: "string", description: "Optional checklist title filter (checklist_completion only)" },
      },
      required: ["location_id", "metrics", "period_a"],
    },
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const D = (s: string, zone: string) => DateTime.fromFormat(s, "yyyy-MM-dd", { zone });
const F = (d: any) => d.toFormat("yyyy-MM-dd");
export function daysIn(start: string, end: string): number {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  const b = Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

export interface ResolvedPeriod { kind: "day" | "week" | "month" | "custom"; start: string; end: string; label: string; in_progress: boolean }

function fmtRange(start: string, end: string, zone: string): string {
  const a = D(start, zone), b = D(end, zone);
  if (start === end) return a.toFormat("EEE MMM d");
  if (a.year !== b.year) return `${a.toFormat("MMM d, yyyy")}–${b.toFormat("MMM d, yyyy")}`;
  if (a.month === b.month) return `${a.toFormat("MMM d")}–${b.toFormat("d")}`;
  return `${a.toFormat("MMM d")}–${b.toFormat("MMM d")}`;
}

/** Period A from args, in the store time zone and business date. In-progress periods end at today. */
export function resolvePeriod(p: any, today: string, zone: string): ResolvedPeriod | { error: string } {
  const kind = p?.period;
  if (!["day", "week", "month", "custom"].includes(kind)) return { error: "Each period needs period: day, week, month or custom." };
  if (kind === "custom") {
    const s = p?.start_date, e = p?.end_date || p?.start_date;
    if (!DATE_RE.test(String(s || "")) || !DATE_RE.test(String(e || ""))) return { error: "Custom periods need start_date and end_date as YYYY-MM-DD." };
    if (e < s) return { error: "end_date is before start_date." };
    if (!D(s, zone).isValid || !D(e, zone).isValid) return { error: "Invalid date." };
    if (s > today) return { error: "That period hasn't started yet." };
    const end = e > today ? today : e;
    return { kind, start: s, end, label: fmtRange(s, end, zone), in_progress: e >= today };
  }
  const date = p?.date && DATE_RE.test(p.date) ? p.date : today;
  if (!D(date, zone).isValid) return { error: "Invalid date." };
  if (date > today) return { error: "That period hasn't started yet." };
  const b = periodBounds(date, zone);
  const [s, e] = kind === "day" ? [date, date] : kind === "week" ? [b.weekStart, b.weekEnd] : [b.monthStart, b.monthEnd];
  const inProgress = e >= today;
  const end = inProgress ? today : e;
  const label = kind === "day" ? (date === today ? "Today" : fmtRange(s, s, zone))
    : kind === "week" ? (s <= today && today <= e ? "This week" : `Week of ${D(s, zone).toFormat("MMM d")}`)
    : (s <= today && today <= e ? "This month" : D(s, zone).toFormat("MMMM yyyy"));
  return { kind, start: s, end, label: inProgress && kind !== "day" ? `${label} (to date)` : label, in_progress: inProgress };
}

/** Period B from period A: prior period or last year, cut to the same elapsed days when A is in progress. */
export function resolveRelative(a: ResolvedPeriod, compareTo: string, zone: string): ResolvedPeriod {
  const elapsed = daysIn(a.start, a.end);
  let s: any, fullEnd: any, label: string;
  const A = D(a.start, zone);
  if (compareTo === "last_year") {
    if (a.kind === "month") { s = A.minus({ years: 1 }).startOf("month"); fullEnd = s.endOf("month"); }
    else { s = A.minus({ days: 364 }); fullEnd = D(a.kind === "week" ? F(A.plus({ days: 6 })) : a.end, zone).minus({ days: 364 }); if (a.kind === "custom") fullEnd = D(a.end, zone).minus({ days: 364 }); }
    label = a.kind === "day" ? "Same day last year" : a.kind === "week" ? "Same week last year" : a.kind === "month" ? s.toFormat("MMMM yyyy") : "Last year";
  } else {
    if (a.kind === "day") { s = A.minus({ days: 7 }); fullEnd = s; label = `Last ${s.toFormat("EEEE")}`; }
    else if (a.kind === "week") { s = A.minus({ days: 7 }); fullEnd = s.plus({ days: 6 }); label = "Last week"; }
    else if (a.kind === "month") { s = A.minus({ months: 1 }).startOf("month"); fullEnd = s.endOf("month"); label = s.toFormat("MMMM yyyy"); }
    else { s = A.minus({ days: elapsed }); fullEnd = A.minus({ days: 1 }); label = "Prior period"; }
  }
  let end = fullEnd;
  if (a.in_progress && a.kind !== "custom" && a.kind !== "day") {
    const cut = s.plus({ days: elapsed - 1 });
    if (cut < end) end = cut;
  }
  const startS = F(s), endS = F(end);
  const sameDays = a.in_progress && a.kind !== "day" && endS !== F(fullEnd);
  return { kind: a.kind, start: startS, end: endS, label: sameDays ? `${label} (same days)` : label, in_progress: false };
}

export function normalizeMetrics(raw: unknown): { metrics: CompareMetric[]; refused: string[] } {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out: CompareMetric[] = [];
  const refused: string[] = [];
  for (const m of list) {
    const k = String(m || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (REFUSED[k]) { if (!refused.includes(REFUSED[k])) refused.push(REFUSED[k]); continue; }
    if (k === "labor") { for (const x of ["labor_hours", "labor_pct"] as CompareMetric[]) if (!out.includes(x)) out.push(x); continue; }
    const key = (COMPARE_METRIC_KEYS as readonly string[]).includes(k) ? k as CompareMetric : ALIASES[k];
    if (key && !out.includes(key)) out.push(key);
  }
  return { metrics: out, refused };
}

export interface PeriodValues {
  net_sales: number | null; gross_sales: number | null; gross_note?: string;
  labor_hours: number | null; labor_pct: number | null; labor_note?: string;
  guest_count: number | null; avg_ticket: number | null; sales_days: number;
}

/** Pure: build one period's values. labor = get_store_labor rows (hours + cost) or null when refused. */
export function periodValues(salesRows: any[], grossRaw: unknown, grossErr: boolean, laborRows: any[] | null, singleDay: boolean): PeriodValues {
  const t = periodSalesTotals(salesRows);
  const hasSales = t.rowDays > 0;
  const g = grossErr ? null : grossFromRange(grossRaw);
  const gross = g ? g.gross : null;
  let gross_note: string | undefined;
  if (grossErr) gross_note = "Gross isn't available for your role.";
  else if (!g || g.salesDays === 0) gross_note = "No sales in this period.";
  else if (gross == null) gross_note = `Gross is missing a piece on ${g.salesDays - g.grossDays} of ${g.salesDays} days.`;
  let labor_hours: number | null = null, labor_pct: number | null = null, labor_note: string | undefined;
  if (laborRows == null) labor_note = "Theo can't see labor for this store right now.";
  else {
    const hours = laborRows.reduce((s, r) => s + (Number(r.hours) || 0), 0);
    const cost = laborRows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    if (hours > 0 || cost > 0) { labor_hours = hours; labor_pct = laborPercentOnNet(cost, t.net); }
    else labor_note = "No labor data for this period.";
    if (labor_hours != null && labor_pct == null) labor_note = "No sales, so no labor %.";
  }
  return {
    net_sales: hasSales ? t.net : null, gross_sales: gross, ...(gross_note ? { gross_note } : {}),
    labor_hours, labor_pct, ...(labor_note ? { labor_note } : {}),
    guest_count: hasSales ? t.guests : null, avg_ticket: periodAvgTicket(salesRows, singleDay), sales_days: t.salesDays,
  };
}

export interface CompareRow { key: string; label: string; unit: "usd" | "pct" | "hours" | "count"; a: number | null; b: number | null; change: number | null; change_pct: number | null; note?: string; a_units?: number | null; b_units?: number | null }
export interface CompareGroup { key: "product_mix" | "checklist_completion"; title: string; unit: "usd" | "pct"; rows: CompareRow[]; header?: CompareRow; note?: string; hidden_reason?: string }
export interface ComparePayload {
  kind: "theo_compare"; version: 1; title: string; store_name: string;
  period_a: { label: string; start: string; end: string; range: string };
  period_b: { label: string; start: string; end: string; range: string };
  rows: CompareRow[]; groups: CompareGroup[]; notes: string[]; footnote?: string; spoken_summary: string;
}

const round = (v: number | null, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
export function metricRow(key: string, a: number | null, b: number | null, note?: string): CompareRow {
  const meta = LABELS[key] || { label: key, unit: "count" as const };
  const dp = meta.unit === "pct" || meta.unit === "hours" ? 1 : meta.unit === "count" ? 0 : 2;
  const ra = round(a, dp), rb = round(b, dp);
  const c = periodChange(ra, rb);
  // Labor % change is in points, not percent of percent.
  return { key, label: meta.label, unit: meta.unit, a: ra, b: rb, change: round(c.change, dp), change_pct: meta.unit === "pct" ? null : round(c.percent, 1), ...(note ? { note } : {}) };
}

/** Product mix: same aggregation as query_sales (names, qty, net sales; ranked by net sales). */
export function aggregateMix(rows: any[]): { items: Map<string, { quantity: number; sales: number }>; daysWithMix: number; days: number } {
  const items = new Map<string, { quantity: number; sales: number }>();
  let daysWithMix = 0;
  for (const row of rows || []) {
    if (Array.isArray(row.product_mix) && row.product_mix.length > 0) daysWithMix++;
    if (!Array.isArray(row.product_mix)) continue;
    for (const item of row.product_mix) {
      const name = String(item?.itemName || item?.name || item?.item_name || "Unknown");
      const qty = Number(item?.quantity || item?.qty || item?.count || 0);
      const sales = Number(item?.netSales || item?.sales || item?.net_sales || 0);
      const cur = items.get(name) || { quantity: 0, sales: 0 };
      cur.quantity += qty; cur.sales += sales;
      items.set(name, cur);
    }
  }
  return { items, daysWithMix, days: (rows || []).length };
}
export function mixGroup(aRows: any[], bRows: any[], filter?: string, limit = 15): CompareGroup {
  const A = aggregateMix(aRows), B = aggregateMix(bRows);
  const names = new Set([...A.items.keys(), ...B.items.keys()]);
  const q = (filter || "").trim().toLowerCase();
  let list = [...names].filter((n) => !q || n.toLowerCase().includes(q)).map((name) => {
    const a = A.items.get(name), b = B.items.get(name);
    const row = metricRow("net_sales", a ? a.sales : null, b ? b.sales : null);
    return { ...row, key: `item:${name}`, label: name, a_units: a ? a.quantity : null, b_units: b ? b.quantity : null };
  });
  // Ranked by period A net sales, then B (same order as the dashboard's Top Products by Sales).
  list.sort((x, y) => (y.a ?? -1) - (x.a ?? -1) || (y.b ?? -1) - (x.b ?? -1));
  const total = list.length;
  list = list.slice(0, limit);
  const notes: string[] = [];
  if (A.daysWithMix < A.days || B.daysWithMix < B.days) notes.push(`Item data covers ${A.daysWithMix} of ${A.days} days (A) and ${B.daysWithMix} of ${B.days} days (B).`);
  if (total > limit) notes.push(`Top ${limit} of ${total} items by net sales.`);
  if (q && !total) notes.push(`No items matched "${filter}".`);
  return { key: "product_mix", title: "Product mix", unit: "usd", rows: list, ...(notes.length ? { note: notes.join(" ") } : {}) };
}

/** Checklist completion from Tasks > History day results (runQueryTaskHistory kind=checklist). */
export function checklistPeriod(days: any[]): { avg: number | null; byTitle: Map<string, number> } {
  const daily = (days || []).map((d: any) => d.checklist_average_percent).filter((v: any) => typeof v === "number");
  const per = new Map<string, number[]>();
  for (const d of days || []) for (const c of d.checklists || []) {
    const arr = per.get(c.title) || []; arr.push(Number(c.percent) || 0); per.set(c.title, arr);
  }
  const byTitle = new Map<string, number>();
  for (const [t, arr] of per) byTitle.set(t, arr.reduce((s, v) => s + v, 0) / arr.length);
  return { avg: daily.length ? daily.reduce((s: number, v: number) => s + v, 0) / daily.length : null, byTitle };
}
export function checklistGroup(aDays: any[], bDays: any[], filter?: string): CompareGroup {
  const A = checklistPeriod(aDays), B = checklistPeriod(bDays);
  const q = (filter || "").trim().toLowerCase();
  const titles = [...new Set([...A.byTitle.keys(), ...B.byTitle.keys()])].filter((t) => !q || t.toLowerCase().includes(q)).sort();
  const pctRow = (key: string, label: string, a: number | null, b: number | null): CompareRow => {
    const ra = round(a, 0), rb = round(b, 0), c = periodChange(ra, rb);
    return { key, label, unit: "pct", a: ra, b: rb, change: round(c.change, 0), change_pct: null };
  };
  const rows = titles.map((t) => pctRow(`checklist:${t}`, t, A.byTitle.get(t) ?? null, B.byTitle.get(t) ?? null));
  return {
    key: "checklist_completion", title: "Checklist completion", unit: "pct",
    header: pctRow("checklist_average", "Average (History)", A.avg, B.avg), rows,
    ...(q && !titles.length ? { note: `No checklists matched "${filter}".` } : {}),
  };
}

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
function spokenValue(r: CompareRow, v: number): string {
  return r.unit === "usd" ? (r.key === "avg_ticket" ? `$${v.toFixed(2)}` : usd(v)) : r.unit === "pct" ? `${v.toFixed(1)}%` : r.unit === "hours" ? `${Math.round(v)} hours` : Math.round(v).toLocaleString("en-US");
}
/** Short, speakable headline + a few highlights. Numbers come only from the payload. */
export function spokenSummary(p: Omit<ComparePayload, "spoken_summary">): string {
  const out: string[] = [];
  const a = p.period_a.label.replace(/ \(to date\)$/, "").toLowerCase(), b = p.period_b.label.replace(/ \(same days\)$/, "").toLowerCase();
  const first = p.rows.filter((r) => r.a != null).slice(0, 3);
  first.forEach((r, i) => {
    const head = i === 0 ? `${r.label} ${/sales|guests/i.test(r.label) ? "were" : "was"} ${spokenValue(r, r.a!)} ${a}` : `${r.label} ${spokenValue(r, r.a!)}`;
    if (r.b == null || r.change == null) { out.push(`${head}; ${b} isn't available.`); return; }
    if (r.unit === "pct") {
      const pts = Math.abs(r.change);
      const better = r.key === "labor_pct" ? (r.change < 0 ? "better" : "higher") : (r.change > 0 ? "up" : "down");
      out.push(pts < 0.05 ? `${head}, the same as ${b}.` : `${head}, ${pts.toFixed(1)} ${pts === 1 ? "point" : "points"} ${better} than ${b}.`);
    } else if (r.change_pct == null) out.push(`${head}, compared with ${spokenValue(r, r.b)} ${b}.`);
    else {
      const pct = Math.abs(r.change_pct);
      out.push(pct < 0.5 ? `${head}, about the same as ${b}.` : `${head}, ${r.change > 0 ? "up" : "down"} ${Math.round(pct)}% from ${b}.`);
    }
  });
  const gross = p.rows.find((r) => r.key === "gross_sales");
  if (gross && (gross.a == null || gross.b == null) && gross.note) out.push("Gross isn't complete for one of these periods.");
  for (const g of p.groups) {
    if (g.hidden_reason) { out.push(g.hidden_reason); continue; }
    if (g.key === "checklist_completion" && g.header?.a != null) out.push(`Checklists averaged ${Math.round(g.header.a)}%${g.header.b != null ? ` versus ${Math.round(g.header.b)}%` : ""}.`);
    if (g.key === "product_mix" && g.rows[0]?.a != null) out.push(`Top item was ${g.rows[0].label}.`);
  }
  if (!out.length) out.push(`Here's ${a} compared with ${b}.`);
  return `${out.join(" ")} The table is on your screen.`;
}

export interface CompareDeps {
  /** Signed-in user's client (anon key + Authorization). Every data read uses this. */
  userClient: any;
  /** Service client: ONLY for has_location_access(user, store). */
  admin: any;
  /** From the request JWT (supabase.auth.getUser), never from the client body. */
  userId: string;
  /** The conversation's current store. */
  locationId: string;
  storeName?: string | null;
  timezone: string;
  today: string;
  /** Existing get_store_labor path (signed-in user; blended for Scheduling Manager). Rows with hours + cost. */
  fetchLabor: (locationId: string, start: string, end: string) => Promise<{ rows: any[] | null; error: string | null }>;
  /** Tasks > History close time for the store (location_hours), read with the user client. */
  closeTime?: string | null;
  now?: Date;
}

export async function runCompareMetrics(args: any, deps: CompareDeps): Promise<{ for_theo: any; card: ComparePayload | null }> {
  const fail = (error: string) => ({ for_theo: { error }, card: null });
  const loc = deps.locationId;
  if (!loc || !deps.userId) return fail("No store selected.");
  // Current store only: refuse any other or extra store the model asks for.
  const extraLoc = ["location_ids", "other_location_id", "compare_location_id", "second_location_id", "store_id", "store_ids"].some((k) => args?.[k] != null)
    || [args?.period_a, args?.period_b].some((p) => p && (p.location_id != null || p.location_ids != null));
  if (extraLoc || (args?.location_id && args.location_id !== loc)) return fail("Comparisons cover the current store only. Switch stores to compare another one.");
  const { data: ok, error: accErr } = await deps.admin.rpc("has_location_access", { _user_id: deps.userId, _location_id: loc });
  if (accErr || ok !== true) return fail("You don't have access to that location.");

  const { metrics, refused } = normalizeMetrics(args?.metrics);
  if (!metrics.length) return fail(refused[0] || "Pick at least one metric: net sales, gross sales, labor hours, labor %, guests, average ticket, product mix or checklist completion.");
  const zone = deps.timezone;
  const A = resolvePeriod(args?.period_a, deps.today, zone);
  if ("error" in A) return fail(A.error);
  let B: ResolvedPeriod | { error: string };
  const pb = args?.period_b;
  if (!pb || pb.compare_to || !pb.period) B = resolveRelative(A, pb?.compare_to === "last_year" ? "last_year" : "prior", zone);
  else B = resolvePeriod(pb, deps.today, zone);
  if ("error" in B) return fail(B.error);
  const lenA = daysIn(A.start, A.end), lenB = daysIn(B.start, B.end);
  if (Math.max(lenA, lenB) > MAX_SALES_DAYS) return fail(`Each period can be at most ${MAX_SALES_DAYS} days.`);

  const notes: string[] = [...refused];
  const scalar = metrics.filter((m) => m !== "product_mix" && m !== "checklist_completion");
  const wantMix = metrics.includes("product_mix"), wantCl = metrics.includes("checklist_completion");
  const needSales = scalar.some((m) => m !== "labor_hours") || wantMix;
  const needLabor = scalar.includes("labor_hours") || scalar.includes("labor_pct");
  const needGross = scalar.includes("gross_sales");
  const mixOk = Math.max(lenA, lenB) <= MAX_PRODUCT_MIX_DAYS;
  const clOk = Math.max(lenA, lenB) <= MAX_CHECKLIST_DAYS;
  const cols = "sale_date, net_sales, guest_count, gross_sales, avg_ticket" + (wantMix && mixOk ? ", product_mix" : "");
  const db = deps.userClient;
  const readSales = (p: ResolvedPeriod) => needSales || needLabor
    ? db.from("sales_cache").select(cols).eq("location_id", loc).gte("sale_date", p.start).lte("sale_date", p.end).order("sale_date")
    : Promise.resolve({ data: [], error: null });
  const readGross = (p: ResolvedPeriod) => needGross ? db.rpc("get_gross_sales_range", { _location_id: loc, _start: p.start, _end: p.end }) : Promise.resolve({ data: null, error: null });
  const readLabor = (p: ResolvedPeriod) => needLabor ? deps.fetchLabor(loc, p.start, p.end) : Promise.resolve({ rows: [], error: null });
  const readChecklists = (p: ResolvedPeriod) => wantCl && clOk
    ? runQueryTaskHistory(db, { location_id: loc, start_date: p.start, end_date: p.end, kind: "checklist" }, { timezone: zone, closeTime: deps.closeTime ?? null, today: deps.today, now: deps.now || new Date() })
    : Promise.resolve(null);
  const [sA, sB, gA, gB, lA, lB, cA, cB, storeRes] = await Promise.all([
    readSales(A), readSales(B), readGross(A), readGross(B), readLabor(A), readLabor(B), readChecklists(A), readChecklists(B),
    deps.storeName ? Promise.resolve({ data: { name: deps.storeName } }) : db.from("locations").select("name").eq("id", loc).maybeSingle(),
  ]);
  if (sA.error || sB.error) return fail("Sales for this store couldn't be loaded.");
  const vA = periodValues(sA.data || [], gA.data, !!gA.error, lA.error ? null : lA.rows, A.start === A.end);
  const vB = periodValues(sB.data || [], gB.data, !!gB.error, lB.error ? null : lB.rows, B.start === B.end);
  const rows: CompareRow[] = scalar.map((m) => {
    const note = m === "gross_sales" ? (vA.gross_note || vB.gross_note) : m.startsWith("labor") ? (vA.labor_note || vB.labor_note) : undefined;
    return metricRow(m, (vA as any)[m], (vB as any)[m], note);
  });
  const groups: CompareGroup[] = [];
  if (wantMix) {
    if (!mixOk) groups.push({ key: "product_mix", title: "Product mix", unit: "usd", rows: [], hidden_reason: `Product mix compares at most ${MAX_PRODUCT_MIX_DAYS} days per period. Try a shorter range.` });
    else groups.push(mixGroup(sA.data || [], sB.data || [], args?.item));
  }
  if (wantCl) {
    if (!clOk) groups.push({ key: "checklist_completion", title: "Checklist completion", unit: "pct", rows: [], hidden_reason: `That's too long for checklists. Checklist history covers at most ${MAX_CHECKLIST_DAYS} days per period.` });
    else if (cA?.error || cB?.error) groups.push({ key: "checklist_completion", title: "Checklist completion", unit: "pct", rows: [], hidden_reason: "Checklist history couldn't be loaded." });
    else groups.push(checklistGroup(cA?.days || [], cB?.days || [], args?.checklist));
  }
  if (A.in_progress && A.kind === "day") notes.push("Today is still in progress.");
  const storeName = String(storeRes?.data?.name || deps.storeName || "This store");
  const title = rows.length === 1 && !groups.length ? rows[0].label : groups.length === 1 && !rows.length ? groups[0].title : "Comparison";
  const base = {
    kind: "theo_compare" as const, version: 1 as const, title, store_name: storeName,
    period_a: { label: A.label, start: A.start, end: A.end, range: fmtRange(A.start, A.end, zone) },
    period_b: { label: B.label, start: B.start, end: B.end, range: fmtRange(B.start, B.end, zone) },
    rows, groups, notes, ...(scalar.includes("gross_sales") ? { footnote: GROSS_FOOTNOTE } : {}),
  };
  const card: ComparePayload = { ...base, spoken_summary: spokenSummary(base) };
  const compact = (r: CompareRow) => ({ label: r.label, a: r.a, b: r.b, change: r.change, change_pct: r.change_pct, ...(r.note ? { note: r.note } : {}), ...(r.a_units != null || r.b_units != null ? { a_units: r.a_units, b_units: r.b_units } : {}) });
  return {
    card,
    for_theo: {
      status: "card_shown",
      period_a: card.period_a, period_b: card.period_b,
      rows: rows.map(compact),
      groups: groups.map((g) => ({ title: g.title, ...(g.hidden_reason ? { hidden_reason: g.hidden_reason } : {}), ...(g.header ? { average: compact(g.header) } : {}), rows: g.rows.slice(0, 10).map(compact), ...(g.note ? { note: g.note } : {}) })),
      notes,
      spoken_summary: card.spoken_summary,
      next: "The comparison table is already on the manager's screen. Reply with spoken_summary (you may shorten it). Do NOT write a markdown table, do not repeat every row, and never compute or change any number. Labor % changes are in points.",
    },
  };
}
