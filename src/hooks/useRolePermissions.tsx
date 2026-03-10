import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from './useUserRole';

/**
 * Hook to check specific role-based permissions from the role_permissions table.
 * Used for feature visibility like wallet, sick time, etc.
 */
export const useRolePermissions = () => {
  const { role, loading: roleLoading, isShiftManager } = useUserRole();

  const { data: permissions, isLoading: permissionsLoading } = useQuery({
    queryKey: ['role-permissions', role],
    queryFn: async () => {
      if (!role) return null;
      
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission_key, enabled')
        .eq('role', role);

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
    enabled: !!role,
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
