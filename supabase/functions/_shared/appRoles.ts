// SERVER MIRROR of the app's role list in src/hooks/useUserRole.tsx (highest -> lowest) and its
// display names. src/lib/coverCandidates.test.ts fails if this ever drifts from the app's list.
export const APP_ROLE_ORDER = ['super_admin', 'brand_admin', 'org_admin', 'admin', 'manager', 'shift_manager', 'shift_manager_in_training', 'team_member'];
export const APP_ROLE_NAMES: Record<string, string> = {
  super_admin: 'Super Admin', brand_admin: 'Brand Admin', org_admin: 'Org Admin', admin: 'Admin', manager: 'Manager',
  shift_manager: 'Shift Manager', shift_manager_in_training: 'Shift Manager in Training', team_member: 'Team Member',
};
