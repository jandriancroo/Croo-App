import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checklistGroup, metricRow, mixGroup, normalizeMetrics, periodValues, resolvePeriod, resolveRelative, runCompareMetrics, spokenSummary } from "./compareTool.ts";
import { grossFromRange, laborPercentOnNet, periodSalesTotals } from "../_shared/reports/periodTotals.ts";

const LOC = "0d1477e5-791d-42f4-9245-ad8b2e75c41c";
const zone = "America/Los_Angeles";

// Fake signed-in user client: records every table/rpc so tests can prove no service-role reads.
function userDb(sales: any[], gross: any = { gross_sales: 1000, sales_days: 2, gross_days: 2 }, grossErr = false) {
  const calls: string[] = [];
  const query = (table: string) => {
    calls.push(`from:${table}`);
    const filters: Record<string, any> = {};
    const q: any = {
      select: () => q, eq: (k: string, v: any) => { filters[k] = v; return q; },
      gte: (k: string, v: any) => { filters.gte = v; return q; }, lte: (k: string, v: any) => { filters.lte = v; return q; },
      order: () => q, in: () => q,
      maybeSingle: () => Promise.resolve({ data: table === "locations" ? { name: "Hayward" } : null, error: null }),
      then: (res: any) => res({ data: table === "sales_cache" ? sales.filter((r) => r.sale_date >= filters.gte && r.sale_date <= filters.lte) : [], error: null }),
    };
    return q;
  };
  return {
    calls,
    from: query,
    rpc: (name: string, _args: any) => { calls.push(`rpc:${name}`); return Promise.resolve(name === "get_gross_sales_range" ? (grossErr ? { data: null, error: { message: "not allowed" } } : { data: [gross], error: null }) : { data: null, error: null }); },
  };
}
function adminDb(access: boolean) {
  const calls: any[] = [];
  return { calls, rpc: (name: string, args: any) => { calls.push({ name, args }); return Promise.resolve({ data: name === "has_location_access" ? access : null, error: null }); }, from: () => { throw new Error("admin table read"); } };
}
const deps = (db: any, admin: any, extra: any = {}) => ({
  userClient: db, admin, userId: "user-from-jwt", locationId: LOC, storeName: null, timezone: zone, today: "2026-11-14",
  fetchLabor: async (_l: string, s: string, e: string) => ({ rows: [{ date: s, hours: 40, cost: 800 }, { date: e, hours: 10, cost: 200 }], error: null }),
  ...extra,
});
const SALES = [
  { sale_date: "2026-11-02", net_sales: 2000, guest_count: 100, gross_sales: 2100, avg_ticket: 20 },
  { sale_date: "2026-11-03", net_sales: 3000, guest_count: 100, gross_sales: null, avg_ticket: 30 },
  { sale_date: "2026-11-09", net_sales: 2500, guest_count: 100, gross_sales: 2600, avg_ticket: 25 },
  { sale_date: "2026-11-10", net_sales: 2500, guest_count: 150, gross_sales: 2700, avg_ticket: 16.67 },
];

Deno.test("periodTotals: gross hides when a selling day is missing a piece; never filled with net", () => {
  const t = periodSalesTotals(SALES.slice(0, 2));
  assertEquals(t.net, 5000);
  assertEquals(t.gross, null);
  assertEquals(t.grossDays, 1);
  assertEquals(periodSalesTotals(SALES.slice(2)).gross, 5300);
  assertEquals(grossFromRange([{ gross_sales: null, sales_days: 3, gross_days: 2 }])?.gross, null);
  assertEquals(grossFromRange([{ gross_sales: 900, sales_days: 2, gross_days: 2 }])?.gross, 900);
});

Deno.test("periodTotals: labor % is on net, not gross", () => {
  assertEquals(laborPercentOnNet(250, 1000), 25);
  assertEquals(laborPercentOnNet(0, 1000), null);
  assertEquals(laborPercentOnNet(100, 0), null);
  const v = periodValues(SALES.slice(2), [{ gross_sales: 5300, sales_days: 2, gross_days: 2 }], false, [{ hours: 50, cost: 1000 }], false);
  assertEquals(v.labor_pct, 20); // 1000 / 5000 net
  assertEquals(v.labor_hours, 50);
  assert(!("labor_cost" in v));
  assertEquals(v.avg_ticket, 5000 / 250);
});

Deno.test("resolvePeriod: in-progress week ends today; prior week cut to the same days", () => {
  const a: any = resolvePeriod({ period: "week" }, "2026-11-12", zone);
  assertEquals([a.start, a.end, a.in_progress], ["2026-11-09", "2026-11-12", true]);
  const b = resolveRelative(a, "prior", zone);
  assertEquals([b.start, b.end], ["2026-11-02", "2026-11-05"]);
  const ly = resolveRelative(a, "last_year", zone);
  assertEquals([ly.start, ly.end], ["2025-11-10", "2025-11-13"]);
  const m: any = resolvePeriod({ period: "month", date: "2026-10-05" }, "2026-11-12", zone);
  assertEquals([m.start, m.end, m.in_progress], ["2026-10-01", "2026-10-31", false]);
  assertEquals([resolveRelative(m, "prior", zone).start, resolveRelative(m, "prior", zone).end], ["2026-09-01", "2026-09-30"]);
  const c: any = resolvePeriod({ period: "custom", start_date: "2026-11-01", end_date: "2026-11-07" }, "2026-11-12", zone);
  assertEquals([c.start, c.end], ["2026-11-01", "2026-11-07"]);
  assert("error" in resolvePeriod({ period: "custom", start_date: "2026-11-07", end_date: "2026-11-01" }, "2026-11-12", zone));
});

Deno.test("normalizeMetrics: labor dollars and inventory are refused; aliases map", () => {
  const r = normalizeMetrics(["sales", "labor", "labor_cost", "inventory", "pmix"]);
  assertEquals(r.metrics, ["net_sales", "labor_hours", "labor_pct", "product_mix"]);
  assertEquals(r.refused.length, 2);
});

Deno.test("metricRow: labor % change is in points; deltas computed on the server", () => {
  const r = metricRow("labor_pct", 22, 23.5);
  assertEquals(r.change, -1.5);
  assertEquals(r.change_pct, null);
  const n = metricRow("net_sales", 1100, 1000);
  assertEquals([n.change, n.change_pct], [100, 10]);
  assertEquals(metricRow("gross_sales", null, 1000).change, null);
});

Deno.test("mixGroup + checklistGroup reuse query_sales / History shapes", () => {
  const g = mixGroup([{ product_mix: [{ itemName: "Pizza", quantity: 3, netSales: 30 }] }, { product_mix: [] }], [{ product_mix: [{ itemName: "Pizza", quantity: 2, netSales: 20 }, { itemName: "Soda", quantity: 1, netSales: 2 }] }]);
  assertEquals(g.rows[0].label, "Pizza");
  assertEquals([g.rows[0].a, g.rows[0].b, g.rows[0].a_units], [30, 20, 3]);
  assert(g.note?.includes("1 of 2 days"));
  const c = checklistGroup(
    [{ checklist_average_percent: 80, checklists: [{ title: "Opening", percent: 100 }, { title: "Closing", percent: 60 }] }],
    [{ checklist_average_percent: 70, checklists: [{ title: "Opening", percent: 90 }, { title: "Closing", percent: 50 }] }],
  );
  assertEquals([c.header?.a, c.header?.b, c.header?.change], [80, 70, 10]);
  assertEquals(c.rows.map((r) => r.label), ["Closing", "Opening"]);
});

Deno.test("runCompareMetrics: access denied -> error, nothing read", async () => {
  const db = userDb(SALES), admin = adminDb(false);
  const r = await runCompareMetrics({ location_id: LOC, metrics: ["net_sales"], period_a: { period: "week" } }, deps(db, admin));
  assertEquals(r.card, null);
  assertEquals(r.for_theo.error, "You don't have access to that location.");
  assertEquals(db.calls.length, 0);
  assertEquals(admin.calls[0].args, { _user_id: "user-from-jwt", _location_id: LOC });
});

Deno.test("runCompareMetrics: other or extra stores are refused before any read", async () => {
  for (const args of [
    { location_id: "11111111-1111-1111-1111-111111111111", metrics: ["net_sales"], period_a: { period: "week" } },
    { location_id: LOC, compare_location_id: "x", metrics: ["net_sales"], period_a: { period: "week" } },
    { location_id: LOC, metrics: ["net_sales"], period_a: { period: "week" }, period_b: { period: "week", location_id: "x" } },
  ]) {
    const db = userDb(SALES), admin = adminDb(true);
    const r = await runCompareMetrics(args, deps(db, admin));
    assertEquals(r.card, null);
    assert(String(r.for_theo.error).includes("current store only"));
    assertEquals(db.calls.length + admin.calls.length, 0);
  }
});

Deno.test("runCompareMetrics: this week vs last week -> valid card, user-client reads only, no labor dollars", async () => {
  const db = userDb(SALES, { gross_sales: 5300, sales_days: 2, gross_days: 2 }), admin = adminDb(true);
  const r = await runCompareMetrics({ location_id: LOC, metrics: ["net_sales", "gross_sales", "labor_hours", "labor_pct", "guest_count", "avg_ticket", "labor_cost"], period_a: { period: "week", date: "2026-11-10" }, period_b: { compare_to: "prior" } }, deps(db, admin));
  const card = r.card!;
  assertEquals(card.kind, "theo_compare");
  assertEquals(card.store_name, "Hayward");
  assertEquals(card.rows.map((x) => x.key), ["net_sales", "gross_sales", "labor_hours", "labor_pct", "guest_count", "avg_ticket"]);
  assertEquals(card.rows[0].a, 5000);
  assertEquals(card.rows[3].a, 20); // (800+200)/5000 net
  assert(card.footnote?.startsWith("Gross ="));
  assert(card.spoken_summary.length > 10);
  assert(card.notes.some((n) => n.includes("Labor dollars")));
  const json = JSON.stringify(r);
  assert(!/labor_cost"\s*:|"cost"\s*:/.test(json), "no labor dollars in tool output");
  // only has_location_access on the admin client; every data read on the user client
  assertEquals(admin.calls.map((c: any) => c.name), ["has_location_access"]);
  assert(db.calls.includes("from:sales_cache") && db.calls.includes("rpc:get_gross_sales_range"));
});

Deno.test("runCompareMetrics: gross shows — when the RPC is refused; checklist month too long", async () => {
  const db = userDb(SALES, null, true), admin = adminDb(true);
  const r = await runCompareMetrics({ location_id: LOC, metrics: ["gross_sales", "checklist_completion"], period_a: { period: "month", date: "2026-10-10" } }, deps(db, admin));
  assertEquals(r.card!.rows[0].a, null);
  assert(r.card!.rows[0].note);
  assert(r.card!.groups[0].hidden_reason?.includes("too long"));
  assert(spokenSummary(r.card!).includes("too long"));
});
