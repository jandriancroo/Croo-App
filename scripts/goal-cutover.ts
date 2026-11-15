// One-off, offline planner. Database input must come from approved read_query.
// This script writes a typed SQL invocation; it never connects to the database.
import { DateTime } from 'npm:luxon@3.7.2';
import { goalDates, goalForDate, goalHistoryWindow } from '../supabase/functions/_shared/goalEngine.ts';

export function cutoverWindow(at: string, timezone: string) {
  const now = DateTime.fromISO(at, { setZone: true }).setZone(timezone);
  if (!now.isValid) throw new Error('Invalid cutover time or timezone');
  const today = now.toFormat('yyyy-MM-dd');
  const start = (now.hour < 3 ? now : now.plus({ days: 1 })).startOf('day');
  return { today, start: start.toFormat('yyyy-MM-dd'), end: start.startOf('week').plus({ days: 13 }).toFormat('yyyy-MM-dd') };
}
if (import.meta.main) {
  const [inputPath, outputPath] = Deno.args;
  if (!inputPath || !outputPath) throw new Error('Input and output paths required');
  const input = JSON.parse(await Deno.readTextFile(inputPath));
  const plans = input.locations.map((location: any) => {
    const scope = cutoverWindow(input.at, location.timezone);
    const window = goalHistoryWindow(scope.today);
    const sales = new Map<string, number>(input.sales.filter((r: any) => r.location_id === location.id).map((r: any) => [r.sale_date, Number(r.net_sales) || 0]));
    const goals = goalDates(scope.start, scope.end).map(date => ({ date, goal: goalForDate(date, location.id, { ...window, sales }) }));
    return { ...location, ...scope, ...window, goals };
  });
  const sql = plans.map((p: any) => `SELECT public.replan_goal_cutover_20261101('${p.id}'::uuid, '${p.today}'::date, '${p.start}'::date, '${p.end}'::date, '${JSON.stringify(p.goals).replaceAll("'", "''")}'::jsonb);`).join('\n');
  await Deno.writeTextFile(outputPath, sql);
  await Deno.writeTextFile(`${outputPath}.json`, JSON.stringify(plans, null, 2));
  console.log(`Prepared ${plans.length} locations, ${plans.reduce((s: number, p: any) => s + p.goals.length, 0)} days; no database writes.`);
}