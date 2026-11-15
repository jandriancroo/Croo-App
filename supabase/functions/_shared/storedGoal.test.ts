import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveStoredGoal, storedGoalBreakdown } from './storedGoal.ts';

Deno.test('stored goal order is override > living > Planning > zero, never legacy or actuals', () => {
  assertEquals(resolveStoredGoal({ override_projection: 300, living_projection: 200, initial_projection: 100 }), 300);
  assertEquals(resolveStoredGoal({ living_projection: 200, initial_projection: 100 }), 200);
  assertEquals(resolveStoredGoal({ initial_projection: 100 }), 100);
  assertEquals(resolveStoredGoal(), 0);
  assertEquals(resolveStoredGoal({ initial_projection: 0 }), 0);
});
Deno.test('week/month responses retain actuals and fill missing goals with zero', () => {
  assertEquals(storedGoalBreakdown('2026-11-09', '2026-11-10', [{ date: '2026-11-09', sales: 412.35 }],
    [{ sale_date: '2026-11-09', living_projection: 200 }]), [
    { date: '2026-11-09', sales: 412.35, projected: 200 }, { date: '2026-11-10', sales: 0, projected: 0 },
  ]);
});