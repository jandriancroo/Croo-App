import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Unified roles list (in hierarchy order, highest to lowest)
export type AppRole = 'super_admin' | 'brand_admin' | 'org_admin' | 'admin' | 'manager' | 'shift_manager' | 'shift_manager_in_training' | 'team_member';

// Display names for roles
export const ROLE_DISPLAY_NAMES: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  brand_admin: 'Brand Admin',
  org_admin: 'Org Admin',
  admin: 'Admin',
  manager: 'Manager',
  shift_manager: 'Shift Manager',
  shift_manager_in_training: 'Shift Manager in Training',
  team_member: 'Team Member',
};

// All roles for selection UIs (excluding super_admin which is system-only)
export const SELECTABLE_ROLES: AppRole[] = ['team_member', 'shift_manager_in_training', 'shift_manager', 'manager', 'admin', 'org_admin', 'brand_admin'];

export const useUserRole = () => {
  const { user, loading: authLoading } = useAuth();

  const { data: role, isLoading: roleQueryLoading } = useQuery({
    queryKey: ['user-role', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .rpc('get_user_role', { _user_id: user.id });

      if (error) {
        console.error('[useUserRole] Error fetching role for user:', user.id, error);
        return 'team_member' as AppRole;
      }
      
      return data as AppRole;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes — picks up role changes reasonably fast
    gcTime: 1 * 60 * 60 * 1000, // Keep in memory for 1 hour
    refetchOnWindowFocus: true, // Refetch when user returns to app
  });

  const loading = authLoading || roleQueryLoading;

  // Helper checks - use cached role
  const isSuperAdmin = role === 'super_admin';
  const isBrandAdmin = role === 'brand_admin' || isSuperAdmin;
  const isOrgAdmin = role === 'org_admin' || isBrandAdmin;
  const isAdmin = role === 'admin' || isOrgAdmin;
  const isManager = role === 'manager' || isAdmin;
  // Shift Manager in Training defaults to the same access as Shift Manager
  const isShiftManagerInTraining = role === 'shift_manager_in_training';
  const isShiftManager = role === 'shift_manager' || isShiftManagerInTraining || isManager;
  
  // Permission checks
  // Shift managers can SEE schedule/sales/labor but CANNOT edit schedule, manage templates, or view wages
  const canManageSchedule = isAdmin || isManager; // Edit/create shifts
  const canViewAllWages = isAdmin || isManager; // Shift managers cannot see pay info
  const canApproveRequests = isAdmin || isManager; // Manage availability requests
  const canEditChecklists = isAdmin || isManager;
  const canManageTemplates = isAdmin || isManager; // Shift/schedule templates
  const canCreateTasks = isAdmin || isManager; // Create and assign tasks
  const canViewTimecards = isAdmin || isManager; // View timecards/punch history
  const canViewSalesAndLabor = isShiftManager; // Shift managers and above can see sales/labor
  const canViewAllProfiles = isShiftManager; // Shift managers and above can see all user profiles

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
    isShiftManagerInTraining,
    isManager,
    canManageSchedule,
    canViewAllWages,
    canApproveRequests,
    canEditChecklists,
    canManageTemplates,
    canCreateTasks,
    canViewTimecards,
    canViewSalesAndLabor,
    canViewAllProfiles
  };
};
