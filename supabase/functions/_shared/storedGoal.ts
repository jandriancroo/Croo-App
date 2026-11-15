import { DateTime } from 'npm:luxon@3.7.2';
import { resolveGoal } from './cubeMetrics.ts';

export interface StoredGoalRow {
  sale_date?: string;
  override_projection?: number | string | null;
  living_projection?: number | string | null;
  initial_projection?: number | string | null;
}

// No history, current actuals, or legacy projected_sales fallback.
export function resolveStoredGoal(row?: StoredGoalRow | null): number {
  return resolveGoal(row);
}

export function storedGoalBreakdown(
  start: string, end: string, actuals: { date: string; sales: number }[], rows: StoredGoalRow[],
): { date: string; sales: number; projected: number }[] {
  const goals = new Map(rows.map(row => [row.sale_date, row]));
  const sales = new Map(actuals.map(row => [row.date, row.sales]));
  const result = [];
  for (let day = DateTime.fromFormat(start, 'yyyy-MM-dd', { zone: 'America/Los_Angeles' });
    day.toFormat('yyyy-MM-dd') <= end; day = day.plus({ days: 1 })) {
    const date = day.toFormat('yyyy-MM-dd');
    result.push({ date, sales: sales.get(date) ?? 0, projected: resolveStoredGoal(goals.get(date)) });
  }
  return result;
}