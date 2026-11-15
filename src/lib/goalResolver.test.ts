import { describe, expect, it } from 'vitest';
import { resolveGoal, resolveGoalWithSource, periodGoal, canEditDailyGoal } from './goalResolver';

describe('Daily Goal Consistency', () => {
  it('uses a positive override first', () => {
    expect(resolveGoalWithSource({ override_projection: 1200, living_projection: 1100, initial_projection: 1000 })).toEqual({ value: 1200, source: 'override' });
  });
  it('ignores non-positive overrides but preserves a saved Living zero', () => {
    expect(resolveGoalWithSource({ override_projection: -1, living_projection: 0, initial_projection: 1000 })).toEqual({ value: 0, source: 'living' });
  });
  it('uses Planning only when Living is empty', () => {
    expect(resolveGoalWithSource({ initial_projection: 1000 })).toEqual({ value: 1000, source: 'planning' });
  });
  it('does not use actual, legacy, schedule or generated goals', () => {
    const row = { net_sales: 9000, projected_sales: 8000, schedule_projected_sales: 7000, todayProjected: 6000 };
    expect(resolveGoal(row as Record<string, number>)).toBe(0);
  });
  it('sums daily resolved goals for any period, including empty days', () => {
    expect(periodGoal([{ override_projection: 1200 }, { living_projection: 1100 }, { initial_projection: 1000 }, null])).toBe(3300);
  });
  it.each(['manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin'])('%s can edit today and future', role => {
    expect(canEditDailyGoal(role, '2026-11-02', '2026-11-02')).toBe(true);
    expect(canEditDailyGoal(role, '2026-11-03', '2026-11-02')).toBe(true);
  });
  it.each(['scheduling_manager', 'shift_manager', 'shift_manager_in_training', 'team_member'])('%s cannot override goals', role => {
    expect(canEditDailyGoal(role, '2026-11-02', '2026-11-02')).toBe(false);
  });
  it('locks yesterday when the local date reaches midnight', () => {
    expect(canEditDailyGoal('super_admin', '2026-11-01', '2026-11-02')).toBe(false);
  });
});