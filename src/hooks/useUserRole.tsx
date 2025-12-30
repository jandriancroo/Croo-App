import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Unified roles list (in hierarchy order, highest to lowest)
export type AppRole = 'super_admin' | 'brand_admin' | 'org_admin' | 'admin' | 'manager' | 'shift_manager' | 'team_member';

// Display names for roles
export const ROLE_DISPLAY_NAMES: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  brand_admin: 'Brand Admin',
  org_admin: 'Org Admin',
  admin: 'Admin',
  manager: 'Manager',
  shift_manager: 'Shift Manager',
  team_member: 'Team Member',
};

// All roles for selection UIs (excluding super_admin which is system-only)
export const SELECTABLE_ROLES: AppRole[] = ['team_member', 'shift_manager', 'manager', 'admin', 'org_admin', 'brand_admin'];

export const useUserRole = () => {
  const { user } = useAuth();

  const { data: role, isLoading: loading } = useQuery({
    queryKey: ['user-role', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .rpc('get_user_role', { _user_id: user.id });

      if (error) {
        console.error('Error fetching user role:', error);
        return 'team_member' as AppRole;
      }
      return data as AppRole;
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Helper checks - use cached role
  const isSuperAdmin = role === 'super_admin';
  const isBrandAdmin = role === 'brand_admin' || isSuperAdmin;
  const isOrgAdmin = role === 'org_admin' || isBrandAdmin;
  const isAdmin = role === 'admin' || isOrgAdmin;
  const isManager = role === 'manager' || isAdmin;
  const isShiftManager = role === 'shift_manager' || isManager;
  const canManageSchedule = isAdmin || isManager;
  const canViewAllWages = isAdmin || isManager || isShiftManager;
  const canApproveRequests = isAdmin || isManager;
  const canEditChecklists = isAdmin || isManager;

  // Legacy alias for isManager (was isGeneralManager)
  const isGeneralManager = isManager;

  return { 
    role: role ?? null, 
    loading, 
    isSuperAdmin,
    isBrandAdmin,
    isOrgAdmin,
    isAdmin, 
    isGeneralManager, // kept for backwards compatibility
    isShiftManager,
    isManager,
    canManageSchedule,
    canViewAllWages,
    canApproveRequests,
    canEditChecklists
  };
};
