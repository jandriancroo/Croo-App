import { useRolePermissions } from '@/hooks/useRolePermissions';
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
  const { hasPermission, loading: permLoading } = useRolePermissions();

  const isTeamMember = role === 'team_member';
  const teamMemberSalesEnabled = hasPermission('view_sales');

  const canSeeSales = isShiftManager || (isTeamMember && teamMemberSalesEnabled);

  return {
    canSeeSales,
    loading: roleLoading || permLoading,
    teamMemberSalesEnabled,
  };
};
