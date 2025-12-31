import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';

/**
 * Hook to determine if the current user can view sales data.
 * 
 * Sales visibility rules:
 * - Shift managers and above can ALWAYS see sales
 * - Team members can only see sales if the org-level role permission 'view_sales' is enabled
 * 
 * The setting is checked in real-time, so changes take effect immediately.
 */
export const useTeamSalesVisibility = () => {
  const { role, isShiftManager, loading: roleLoading } = useUserRole();

  // Fetch the org-level role permission for team member sales visibility
  const { data: permissionData, isLoading: permissionLoading } = useQuery({
    queryKey: ['team-sales-permission'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('enabled')
        .eq('role', 'team_member')
        .eq('permission_key', 'view_sales')
        .maybeSingle();

      if (error) {
        console.error('Error fetching team sales permission:', error);
        return { enabled: false };
      }

      return data || { enabled: false };
    },
    staleTime: 30 * 1000, // 30 seconds - changes should reflect quickly
    refetchInterval: 30 * 1000, // Refetch every 30 seconds to pick up changes
  });

  // Determine if the user can see sales
  // - Shift managers and above: always yes (based on role hierarchy)
  // - Team members: only if org-level permission is enabled
  const isTeamMember = role === 'team_member';
  const teamMemberSalesEnabled = permissionData?.enabled ?? false;

  // If user is shift manager or above, they can see sales regardless of setting
  // If user is team member, they need the permission to be enabled
  const canSeeSales = isShiftManager || (isTeamMember && teamMemberSalesEnabled);

  return {
    canSeeSales,
    loading: roleLoading || permissionLoading,
    teamMemberSalesEnabled,
  };
};
