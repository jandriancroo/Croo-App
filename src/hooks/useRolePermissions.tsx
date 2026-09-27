import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from './useUserRole';
import { useLocation } from './useLocation';

/**
 * Hook to check specific role-based permissions from the role_permissions table.
 * Settings are per organization: read the current store's organization copy.
 */
export const useRolePermissions = () => {
  const { role, loading: roleLoading, isShiftManager } = useUserRole();
  const { currentLocation } = useLocation();
  const orgId = currentLocation?.organization_id;

  const { data: permissions, isLoading: permissionsLoading } = useQuery({
    queryKey: ['role-permissions', orgId, role],
    queryFn: async () => {
      if (!role || !orgId) return null;
      
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission_key, enabled')
        .eq('organization_id', orgId)
        .eq('role', role as any);

      if (error) {
        console.error('[useRolePermissions] Error fetching permissions:', error);
        return null;
      }

      // Convert to a map for easy lookup
      const permMap: Record<string, boolean> = {};
      data?.forEach(p => {
        permMap[p.permission_key] = p.enabled;
      });
      
      return permMap;
    },
    enabled: !!role && !!orgId,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
  });

  const loading = roleLoading || permissionsLoading;

  // Shift managers and above always have access to these features
  // Team members need explicit permission from role_permissions table
  const canViewSickTime = isShiftManager || (permissions?.view_sick_time ?? true);

  return {
    loading,
    canViewSickTime,
    // Generic permission checker — uses the DB toggle value for the user's role
    hasPermission: (key: string) => permissions?.[key] ?? false,
  };
};
