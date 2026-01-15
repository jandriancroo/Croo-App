/**
 * Projection Resolution Utility
 * 
 * Resolution Priority: override_projection > living_projection > initial_projection
 * 
 * - initial_projection: Generated 8-14 days out for schedule planning
 * - living_projection: Updated daily at 2 AM for days within 7-day window
 * - override_projection: Manager manual override (highest priority)
 */

export interface ProjectionData {
  initial_projection?: number | null;
  living_projection?: number | null;
  override_projection?: number | null;
  override_at?: string | null;
  override_by?: string | null;
  // Legacy field for backwards compatibility
  projected_sales?: number | null;
}

export type ProjectionSource = 'override' | 'living' | 'initial' | 'legacy' | null;

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
 * override > living > initial > legacy (projected_sales)
 */
export function resolveProjection(data: ProjectionData | null | undefined): ResolvedProjection {
  if (!data) {
    return {
      value: null,
      source: null,
      isOverride: false,
      isLiving: false,
      isInitial: false,
    };
  }

  // Check override first (highest priority)
  if (data.override_projection != null && data.override_projection > 0) {
    return {
      value: data.override_projection,
      source: 'override',
      isOverride: true,
      isLiving: false,
      isInitial: false,
      overrideAt: data.override_at ? new Date(data.override_at) : null,
      overrideBy: data.override_by ?? null,
    };
  }

  // Check living projection (updated within 7-day window)
  if (data.living_projection != null && data.living_projection > 0) {
    return {
      value: data.living_projection,
      source: 'living',
      isOverride: false,
      isLiving: true,
      isInitial: false,
    };
  }

  // Check initial projection (schedule planning)
  if (data.initial_projection != null && data.initial_projection > 0) {
    return {
      value: data.initial_projection,
      source: 'initial',
      isOverride: false,
      isLiving: false,
      isInitial: true,
    };
  }

  // Fallback to legacy projected_sales field
  if (data.projected_sales != null && data.projected_sales > 0) {
    return {
      value: data.projected_sales,
      source: 'legacy',
      isOverride: false,
      isLiving: false,
      isInitial: false,
    };
  }

  return {
    value: null,
    source: null,
    isOverride: false,
    isLiving: false,
    isInitial: false,
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
