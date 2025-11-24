import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type AppRole = 'admin' | 'manager' | 'team_member';

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

  return { role, loading, isAdmin: role === 'admin', isManager: role === 'manager' };
};
