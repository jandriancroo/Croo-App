import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type AppRole = 'admin' | 'general_manager' | 'shift_manager' | 'manager' | 'team_member';

export const useUserRole = () => {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRole = async () => {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .rpc('get_user_role', { _user_id: user.id });

        if (error) throw error;
        setRole(data as AppRole);
      } catch (error) {
        console.error('Error fetching user role:', error);
        setRole('team_member'); // Default fallback
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user]);

  // Helper checks - general_manager has similar permissions to admin for most things
  const isAdmin = role === 'admin';
  const isGeneralManager = role === 'general_manager';
  const isShiftManager = role === 'shift_manager' || role === 'manager';
  const isManager = isGeneralManager || isShiftManager; // Any manager level
  const canManageSchedule = isAdmin || isGeneralManager;
  const canViewAllWages = isAdmin || isGeneralManager;
  const canApproveRequests = isAdmin || isGeneralManager;
  const canEditChecklists = isAdmin || isGeneralManager;

  return { 
    role, 
    loading, 
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
