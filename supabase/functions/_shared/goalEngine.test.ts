import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { goalHistoryWindow, currentWeekAdjustment, livingGoal, goalForDate, goalDates, defaultGoalHorizon } from './goalEngine.ts';
import { calculateDailyGoal, getSeededRandomFactor } from './projections.ts';

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
