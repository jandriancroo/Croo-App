import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type AppRole = 'super_admin' | 'org_admin' | 'admin' | 'general_manager' | 'shift_manager' | 'manager' | 'team_member';

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
        return 'team_member' as AppRole; // Default fallback
      }
      return data as AppRole;
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000, // 10 minutes - role rarely changes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });

  // Helper checks - use cached role, don't flash to false during refetch
  const isSuperAdmin = role === 'super_admin';
  const isOrgAdmin = role === 'org_admin' || isSuperAdmin;
  const isAdmin = role === 'admin' || isOrgAdmin;
  const isGeneralManager = role === 'general_manager';
  const isShiftManager = role === 'shift_manager' || role === 'manager';
  const isManager = isGeneralManager || isShiftManager;
  const canManageSchedule = isAdmin || isGeneralManager;
  const canViewAllWages = isAdmin || isGeneralManager;
  const canApproveRequests = isAdmin || isGeneralManager;
  const canEditChecklists = isAdmin || isGeneralManager;

  return { 
    role: role ?? null, 
    loading, 
    isSuperAdmin,
    isOrgAdmin,
    isAdmin, 
    isGeneralManager,
    isShiftManager,
    isManager,
    canManageSchedule,
    canViewAllWages,
    canApproveRequests,
    canEditChecklists
  };
};
