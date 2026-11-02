import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { goalHistoryWindow, currentWeekAdjustment, livingGoal, goalForDate, goalDates, defaultGoalHorizon, runGoalEngine } from './goalEngine.ts';
import { calculateDailyGoal, getSeededRandomFactor, generateProjections } from './projections.ts';

for (const [T, start, end] of [
  ['2026-11-02', '2026-10-05', '2026-11-01'],
  ['2026-11-04', '2026-10-05', '2026-11-01'],
  ['2026-11-08', '2026-10-05', '2026-11-01'],
]) Deno.test(`four completed weeks for ${T}`, () => {
  assertEquals(goalHistoryWindow(T), { windowStart: start, windowEnd: end });
  assertEquals(goalDates(start, end).length, 28);
});
Deno.test('Living adjustment clamps at 0.8 and 1.2', () => {
  const goals = new Map([['2026-11-02', 100]]);
  assertEquals(currentWeekAdjustment('2026-11-04', [{ sale_date: '2026-11-02', net_sales: 50 }], goals), 0.8);
  assertEquals(currentWeekAdjustment('2026-11-04', [{ sale_date: '2026-11-02', net_sales: 200 }], goals), 1.2);
});
Deno.test('Monday adjustment is one', () => {
  assertEquals(currentWeekAdjustment('2026-11-02', [{ sale_date: '2026-11-01', net_sales: 500 }], new Map([['2026-11-01', 100]])), 1);
});
Deno.test('today and zero sales are excluded from adjustment', () => {
  const goals = new Map([['2026-11-02', 100], ['2026-11-03', 100], ['2026-11-04', 100]]);
  assertEquals(currentWeekAdjustment('2026-11-04', [
    { sale_date: '2026-11-02', net_sales: 110 }, { sale_date: '2026-11-03', net_sales: 0 },
    { sale_date: '2026-11-04', net_sales: 10000 },
  ], goals), 1.1);
});
Deno.test('daily goal rounds whole dollars and keeps exact jitter seed', () => {
  const value = calculateDailyGoal('2026-11-04', 'store', 412.5, 612.5);
  assertEquals(value, Math.round(512.5 * getSeededRandomFactor('2026-11-04-store')));
  assert(Number.isInteger(value));
});
Deno.test('later-week Living and Planning are unadjusted', () => {
  assertEquals(livingGoal('2026-11-05', '2026-11-04', 100, 1.2), 120);
  assertEquals(livingGoal('2026-11-09', '2026-11-04', 100, 1.2), 100);
});
Deno.test('window excludes current week and future target-week sales', () => {
  const window = goalHistoryWindow('2026-11-04');
  const sales = new Map(goalDates(window.windowStart, window.windowEnd).map(date => [date, 100]));
  const before = goalForDate('2026-11-11', 'store', { ...window, sales });
  sales.set('2026-11-04', 100000); sales.set('2026-11-11', 100000);
  assertEquals(goalForDate('2026-11-11', 'store', { ...window, sales }), before);
  assertEquals(goalForDate('2026-11-11', 'store', { ...window, sales: new Map() }), 0);
});
Deno.test('horizon covers month end or next Sunday, whichever is later', () => {
  assertEquals(defaultGoalHorizon('2026-11-04'), '2026-11-30');
  assertEquals(defaultGoalHorizon('2026-11-30'), '2026-12-13');
});

Deno.test('daily goal never falls back to current actual sales', () => {
  const result = generateProjections(9000, 9000, 9000,
    [{ date: '2026-11-02', sales: 9000 }], [], 3, 0, 10, 22, '2026-11-04', 'store', []);
  assertEquals(result.todayProjected, 0);
});

Deno.test('runner preserves actuals, overrides, and non-null Planning; ensure only fills null Living', async () => {
  const rows = new Map<string, Record<string, unknown>>([
    ['2026-11-09', { sale_date: '2026-11-09', net_sales: 412, initial_projection: 0, living_projection: 999, override_projection: 700 }],
    ['2026-11-10', { sale_date: '2026-11-10', net_sales: 10, initial_projection: 555, living_projection: null }],
  ]);
  const writes: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const fake = { from(table: string) {
    let operation = 'read'; let payload: Record<string, unknown> = {}; let ignore = false;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      gte: (key: string, value: string) => { filters.push(row => String(row[key]) >= value); return query; },
      lt: (key: string, value: string) => { filters.push(row => String(row[key]) < value); return query; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; },
      upsert: (value: Record<string, unknown>, opts: { ignoreDuplicates?: boolean }) => { operation = 'upsert'; payload = value; ignore = opts.ignoreDuplicates === true; return query; },
      update: (value: Record<string, unknown>) => { operation = 'update'; payload = value; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'location_integrations') return Promise.resolve(resolve({ data: [{ integration_type: 'clover' }] }));
        if (table === 'goal_engine_runs') { logs.push(payload); return Promise.resolve(resolve({ data: [] })); }
        if (operation === 'read') return Promise.resolve(resolve({ data: [...rows.values()].filter(row => filters.every(test => test(row))) }));
        const changed: Record<string, unknown>[] = [];
        if (operation === 'upsert') {
          const key = String(payload.sale_date); const old = rows.get(key);
          if (!old || !ignore) { rows.set(key, { ...old, ...payload }); writes.push(payload); changed.push({ sale_date: key }); }
        } else {
          for (const [key, row] of rows) if (filters.every(test => test(row))) {
            rows.set(key, { ...row, ...payload }); writes.push(payload); changed.push({ sale_date: key });
          }
        }
        return Promise.resolve(resolve({ data: changed }));
      },
    };
    // Location scope is implicit in this single-location fixture.
    const eq = query.eq; query.eq = (key: string, value: unknown) => key === 'location_id' ? query : eq(key, value);
    return query;
  } };
  await runGoalEngine(fake, 'store', { T: '2026-11-02', tz: 'America/Los_Angeles', source: 'ensure',
    writePlanning: false, onlyNullLiving: true, livingStart: '2026-11-09', horizonEnd: '2026-11-15' });
  assertEquals(rows.get('2026-11-09')?.living_projection, 999);
  assertEquals(rows.get('2026-11-10')?.living_projection, 0);
  assertEquals(rows.get('2026-11-09')?.initial_projection, 0);
  assertEquals(rows.get('2026-11-10')?.initial_projection, 555);
  assertEquals(rows.get('2026-11-09')?.net_sales, 412);
  assertEquals(rows.get('2026-11-09')?.override_projection, 700);
  assert(writes.every(row => !('net_sales' in row) && !('initial_projection' in row) && !('override_projection' in row)));
  assertEquals(logs[0].wrote_planning, false);
});
