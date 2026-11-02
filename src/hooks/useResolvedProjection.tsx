/**
 * Projection Resolution Utility
 * 
 * Resolution Priority: override_projection > living_projection > initial_projection
 * 
 * - initial_projection: Insert-once Planning for next week on Monday
 * - living_projection: Updated at 3 AM store-local time for today/future
 * - override_projection: Manager manual override (highest priority)
 */
import { resolveGoalWithSource, type GoalSource } from '@/lib/goalResolver';

export interface ProjectionData {
  initial_projection?: number | null;
  living_projection?: number | null;
  override_projection?: number | null;
  override_at?: string | null;
  override_by?: string | null;
}

export type ProjectionSource = GoalSource;

export interface ResolvedProjection {
  value: number | null;
  source: ProjectionSource;
  isOverride: boolean;
  isLiving: boolean;
  isInitial: boolean;
  overrideAt?: Date | null;
  overrideBy?: string | null;
}

/**
 * Resolves which projection value to use based on priority:
 * Positive Override > Living > Planning > zero (no sales fallback)
 */
export function resolveProjection(data: ProjectionData | null | undefined): ResolvedProjection {
  const { value, source } = resolveGoalWithSource(data);
  const isOverride = source === 'override';
  return {
    value,
    source,
    isOverride,
    isLiving: source === 'living',
    isInitial: source === 'planning',
    ...(isOverride ? { overrideAt: data?.override_at ? new Date(data.override_at) : null, overrideBy: data?.override_by ?? null } : {}),
  };
}

/**
 * Resolves projections for an array of daily data (e.g., weekly breakdown)
 */
export function resolveWeeklyProjections(
  dailyData: (ProjectionData & { date: string; sales?: number })[] | undefined
): { date: string; sales: number; resolved: ResolvedProjection }[] {
  if (!dailyData) return [];
  
  return dailyData.map(day => ({
    date: day.date,
    sales: day.sales ?? 0,
    resolved: resolveProjection(day),
  }));
}

/**
 * Calculate pace-adjusted projection for a period (week/month)
 * Past days: use actuals
 * Today: use MAX(actual, projection)
 * Future: use resolved projection
 */
export function calculatePaceAdjustedTotal(
  dailyData: { date: string; sales: number; resolved: ResolvedProjection }[],
  todayStr: string
): number {
  return dailyData.reduce((sum, day) => {
    const projValue = day.resolved.value ?? 0;
    
    if (day.date < todayStr) {
      // Past day: use actual sales
      return sum + day.sales;
    } else if (day.date === todayStr) {
      // Today: use MAX(actual, projection)
      return sum + Math.max(day.sales, projValue);
    } else {
      // Future day: use resolved projection
      return sum + projValue;
    }
  }, 0);
}

/** Saved goal for display/prefill; an actual-sales grid value is never a goal fallback. */
export function projectionGoalValue(
  row: ProjectionData | null | undefined,
  currentValue: number,
  currentIsActual: boolean,
): number | null {
  return resolveProjection(row).value;
}
