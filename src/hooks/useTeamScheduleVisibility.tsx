import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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

  // Fetch the org-level role permission for team member schedule visibility
  const { data: permissionData, isLoading: permissionLoading, error: permissionError } = useQuery({
    queryKey: ['role-permission', 'team_member', 'view_full_schedule'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('enabled')
        .eq('role', 'team_member')
        .eq('permission_key', 'view_full_schedule')
        .maybeSingle();

      if (error) {
        console.error('[useTeamScheduleVisibility] Error fetching team schedule permission:', error);
        return { enabled: false };
      }

      return data || { enabled: false };
    },
    staleTime: 30 * 1000, // 30 seconds - changes should reflect quickly
    refetchInterval: 30 * 1000, // Refetch every 30 seconds to pick up changes
  });

  // IMPORTANT: Consider role "loading" if role is null/undefined (query disabled or not yet resolved)
  // This prevents false negatives when auth is still initializing
  const effectiveRoleLoading = roleLoading || role === null || role === undefined;

  if (import.meta.env.DEV) {
    console.info('[useTeamScheduleVisibility]', {
      role,
      isShiftManager,
      permissionEnabled: permissionData?.enabled,
      permissionLoading,
      permissionError,
      effectiveRoleLoading,
    });
  }

  // Determine if the user can see the full schedule
  // - Shift managers and above: always yes (based on role hierarchy)
  // - Team members: only if org-level permission is enabled
  const isTeamMember = role === 'team_member';
  const teamMemberFullScheduleEnabled = permissionData?.enabled ?? false;

  // If user is shift manager or above, they can see full schedule regardless of setting
  // If user is team member, they need the permission to be enabled
  const canSeeFullSchedule = isShiftManager || (isTeamMember && teamMemberFullScheduleEnabled);

  return {
    canSeeFullSchedule,
    loading: effectiveRoleLoading || permissionLoading,
    teamMemberFullScheduleEnabled,
  };
};
