// One browser entry point; shared pure math keeps browser and server identical.
export { resolveGoalWithSource, resolveGoal, periodGoal } from '../../supabase/functions/_shared/cubeMetrics';
export type { GoalRow, GoalSource } from '../../supabase/functions/_shared/cubeMetrics';

const MANAGER_ROLES = ['manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin'];
export function canEditDailyGoal(role: string | null | undefined, date: string, localToday: string): boolean {
  return MANAGER_ROLES.includes(role ?? '') && date >= localToday;
}