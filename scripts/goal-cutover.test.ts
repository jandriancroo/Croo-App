import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { cutoverWindow } from './goal-cutover.ts';
import { goalHistoryWindow } from '../supabase/functions/_shared/goalEngine.ts';

Deno.test('Pacific Sunday evening cutover is Nov 2 through Nov 15 with today excluded from history', () => {
  const scope = cutoverWindow('2026-11-02T05:23:00Z', 'America/Los_Angeles');
  assertEquals(scope, {today:'2026-11-01',start:'2026-11-02',end:'2026-11-15'});
  assertEquals(goalHistoryWindow(scope.today), {windowStart:'2026-09-28',windowEnd:'2026-10-25'});
});
Deno.test('Eastern before 3 AM includes today but not its partial actuals', () => {
  const scope = cutoverWindow('2026-11-02T05:23:00Z', 'America/New_York');
  assertEquals(scope, {today:'2026-11-02',start:'2026-11-02',end:'2026-11-15'});
  assertEquals(goalHistoryWindow(scope.today), {windowStart:'2026-10-05',windowEnd:'2026-11-01'});
});
Deno.test('3 AM is tomorrow cutoff and scope ends following week Sunday', () => {
  assertEquals(cutoverWindow('2026-11-02T11:00:00Z','America/Los_Angeles'), {today:'2026-11-02',start:'2026-11-03',end:'2026-11-15'});
});