import { useRolePermissions } from '@/hooks/useRolePermissions';
import { useUserRole } from '@/hooks/useUserRole';

/**
 * Hook to determine if the current user can view the full team schedule.
 * 
 * Schedule visibility rules:
 * - Shift managers and above can ALWAYS see the full schedule
 * - Team members can only see the full schedule if the org-level role permission 'view_full_schedule' is enabled
 *   Otherwise, team members only see their own shifts
 * 
 * The setting is checked in real-time, so changes take effect immediately.
 */
export const useTeamScheduleVisibility = () => {
  const { role, isShiftManager, loading: roleLoading } = useUserRole();
  const { hasPermission, loading: permLoading } = useRolePermissions();

  const effectiveRoleLoading = roleLoading || role === null || role === undefined;

  const isTeamMember = role === 'team_member';
  const teamMemberFullScheduleEnabled = hasPermission('view_full_schedule');

  const canSeeFullSchedule = isShiftManager || (isTeamMember && teamMemberFullScheduleEnabled);

  return {
    canSeeFullSchedule,
    loading: effectiveRoleLoading || permLoading,
    teamMemberFullScheduleEnabled,
  };
};
