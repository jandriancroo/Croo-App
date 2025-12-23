import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const usePrefetchDashboard = () => {
  const queryClient = useQueryClient();

  const prefetchDashboardData = async () => {
    try {
      // Get current user first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Prefetch user profile (including location)
      const profilePromise = queryClient.prefetchQuery({
        queryKey: ['profile', user.id],
        queryFn: async () => {
          const { data } = await supabase
            .from('profiles')
            .select('*, default_location_id')
            .eq('id', user.id)
            .single();
          return data;
        },
        staleTime: 5 * 60 * 1000,
      });

      // Get user's default location
      const { data: profile } = await supabase
        .from('profiles')
        .select('default_location_id, full_name, croo_cash_balance')
        .eq('id', user.id)
        .single();

      const locationId = profile?.default_location_id;

      if (locationId) {
        // Prefetch location data
        const locationPromise = queryClient.prefetchQuery({
          queryKey: ['location', locationId],
          queryFn: async () => {
            const { data } = await supabase
              .from('locations')
              .select('*')
              .eq('id', locationId)
              .single();
            return data;
          },
          staleTime: 5 * 60 * 1000,
        });

        // Prefetch location hours for today
        const today = new Date();
        const dayOfWeek = today.getDay();
        const hoursPromise = queryClient.prefetchQuery({
          queryKey: ['location-hours-today', locationId],
          queryFn: async () => {
            const { data } = await supabase
              .from('location_hours')
              .select('open_time, close_time, is_closed')
              .eq('location_id', locationId)
              .eq('day_of_week', dayOfWeek)
              .maybeSingle();
            
            if (!data || data.is_closed) return null;
            return {
              hours_open: data.open_time,
              hours_close: data.close_time
            };
          },
          staleTime: 5 * 60 * 1000,
        });

        // Prefetch checklists
        const checklistsPromise = queryClient.prefetchQuery({
          queryKey: ['checklists', locationId],
          queryFn: async () => {
            const { data } = await supabase
              .from('checklists')
              .select('*, checklist_items(id, days_of_week)')
              .eq('is_active', true)
              .eq('location_id', locationId)
              .order('display_order', { ascending: true });
            return data;
          },
          staleTime: 2 * 60 * 1000,
        });

        // Prefetch QuBeyond integration check
        const integrationPromise = queryClient.prefetchQuery({
          queryKey: ['qubeyond-integration-check', locationId],
          queryFn: async () => {
            const { data } = await supabase.rpc('has_active_location_integration', {
              _location_id: locationId,
              _integration_type: 'qubeyond',
            });
            return !!data;
          },
          staleTime: 10 * 60 * 1000,
        });

        // Wait for all prefetch operations
        await Promise.all([
          profilePromise,
          locationPromise,
          hoursPromise,
          checklistsPromise,
          integrationPromise,
        ]);
      } else {
        await profilePromise;
      }

      console.log('Dashboard data prefetched successfully');
    } catch (error) {
      console.error('Error prefetching dashboard data:', error);
    }
  };

  return { prefetchDashboardData };
};
