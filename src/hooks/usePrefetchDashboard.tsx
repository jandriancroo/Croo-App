import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Prefetches critical dashboard data in the background.
 * Call this during splash screen to have data ready when dashboard mounts.
 */
export function usePrefetchDashboard(userId: string | undefined, locationId: string | undefined, timezone: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !locationId) return;

    // Prefetch dashboard cubes
    queryClient.prefetchQuery({
      queryKey: ['user-data-cubes', userId, locationId],
      queryFn: async () => {
        const { data } = await supabase
          .from('user_dashboard_cubes')
          .select('*')
          .eq('user_id', userId)
          .eq('location_id', locationId)
          .in('cube_type', ['data', 'data-3d', 'sales-chart'])
          .order('display_order');
        return data || [];
      },
      staleTime: 30 * 1000,
    });

    // Prefetch checklists for tasks page
    queryClient.prefetchQuery({
      queryKey: ['user-checklists', userId, true, locationId], // isAdmin = true covers all
      queryFn: async () => {
        const { data } = await supabase
          .from('checklists')
          .select('*, checklist_role_tags(role), checklist_items(id, days_of_week)')
          .eq('is_active', true)
          .eq('location_id', locationId)
          .order('display_order', { ascending: true });
        return data || [];
      },
      staleTime: 2 * 60 * 1000,
    });

    // Prefetch location hours
    const weekdayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const weekdayName = formatter.format(new Date());
    const dayOfWeek = weekdayMap[weekdayName] ?? new Date().getDay();

    queryClient.prefetchQuery({
      queryKey: ['location-hours-today', locationId, timezone],
      queryFn: async () => {
        const { data } = await supabase
          .from('location_hours')
          .select('open_time, close_time, is_closed')
          .eq('location_id', locationId)
          .eq('day_of_week', dayOfWeek)
          .maybeSingle();
        return data;
      },
      staleTime: 10 * 60 * 1000,
    });

    // Prefetch org logo (for header)
    queryClient.prefetchQuery({
      queryKey: ['org-logo', locationId],
      queryFn: async () => {
        const { data: locationData } = await supabase
          .from('locations')
          .select('organization_id')
          .eq('id', locationId)
          .single();
        
        if (!locationData?.organization_id) return null;
        
        const { data: orgData } = await supabase
          .from('organizations')
          .select('logo_url, name, brand_name, brand_id')
          .eq('id', locationData.organization_id)
          .single();
        
        if (!orgData) return null;
        
        if (orgData.brand_id) {
          const { data: brandData } = await supabase
            .from('brands')
            .select('logo_url, name')
            .eq('id', orgData.brand_id)
            .single();
          
          if (brandData?.logo_url) {
            return {
              logo_url: brandData.logo_url,
              name: orgData.name,
              brand_name: brandData.name
            };
          }
        }
        
        return orgData;
      },
      staleTime: 5 * 60 * 1000,
    });

  }, [queryClient, userId, locationId, timezone]);
}
