import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

// Ask the same server-side hierarchy used by create_dashboard_widget.
export function useCanAddDashboardCube(): boolean {
  const { user, loading } = useAuth();
  const { data } = useQuery({
    queryKey: ['can-add-dashboard-cube', user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc('has_role_or_higher', {
        _user_id: user.id,
        _minimum_role: 'manager',
      });
      return !error && data === true;
    },
    enabled: !!user?.id && !loading,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  return !!user?.id && !loading && data === true;
}