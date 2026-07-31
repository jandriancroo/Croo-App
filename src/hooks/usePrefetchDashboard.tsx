import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, endOfWeek, startOfMonth } from 'date-fns';

/**
 * Prefetches critical dashboard data in the background.
 * Call this during splash screen to have data ready when dashboard mounts.
 */
export function usePrefetchDashboard(userId: string | undefined, locationId: string | undefined, timezone: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId || !locationId) return;

    // Calculate timezone-aware dates
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value || '2025';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const todayStr = `${year}-${month}-${day}`;

    // Dashboard widgets are fetched by useDashboardWidgets on mount.
    // We skip prefetching here to keep the cache shape consistent with the hook's queryFn.

    // Prefetch checklists using the SAME key + result shape the Dashboard reads,
    // otherwise the splash prefetch lands in a drawer nobody opens.
    queryClient.prefetchQuery({
      queryKey: ['dashboard-checklists', locationId, timezone],
      queryFn: async () => {
        const { data } = await supabase
          .from('checklists')
          .select('*, checklist_items(id, days_of_week)')
          .eq('is_active', true)
          .eq('location_id', locationId)
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: false });
        return { checklists: data || [] };
      },
      staleTime: 2 * 60 * 1000,
    });


    // Prefetch location hours
    const weekdayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const weekdayName = weekdayFormatter.format(new Date());
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
        if (!data || data.is_closed) return null;
        // Map to same format as Dashboard's queryFn
        return {
          hours_open: data.open_time,
          hours_close: data.close_time
        };
      },
      staleTime: 10 * 60 * 1000,
    });

    // Prefetch org logo (for header) — prefer locations.brand_id, fall back to org chain
    queryClient.prefetchQuery({
      queryKey: ['org-logo', locationId],
      queryFn: async () => {
        const { data: locationData } = await supabase
          .from('locations')
          .select('brand_id, organization_id')
          .eq('id', locationId)
          .single();

        if (!locationData?.organization_id) return null;

        const { data: orgData } = await supabase
          .from('organizations')
          .select('logo_url, name, brand_name, brand_id')
          .eq('id', locationData.organization_id)
          .single();

        if (!orgData) return null;

        const effectiveBrandId = (locationData as any)?.brand_id ?? orgData.brand_id ?? null;
        if (effectiveBrandId) {
          const { data: brandData } = await supabase
            .from('brands')
            .select('logo_url, name')
            .eq('id', effectiveBrandId)
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

    // Prefetch today's sales from cache (fast DB query, not edge function)
    // This gives dashboard instant sales data without waiting for QuBeyond API
    queryClient.prefetchQuery({
      queryKey: ['sales-cache-today', locationId, todayStr],
      queryFn: async () => {
        const { data } = await supabase
          .from('sales_cache')
          .select('*')
          .eq('location_id', locationId)
          .eq('sale_date', todayStr)
          .maybeSingle();
        return data;
      },
      staleTime: 60 * 1000, // 1 min - today's data changes
    });

    // Prefetch labor data — shared key with CompactDashboard + ManagerDashboard
    queryClient.prefetchQuery({
      queryKey: ['labor-cache-today', locationId, todayStr],
      queryFn: async () => {
        const { data } = await supabase
          .from('labor_cache')
          .select('labor_hours, labor_cost')
          .eq('location_id', locationId)
          .eq('labor_date', todayStr);
        if (!data || data.length === 0) return null;
        const totalCost = data.reduce((sum, row) => sum + (row.labor_cost || 0), 0);
        const totalHours = data.reduce((sum, row) => sum + (row.labor_hours || 0), 0);
        return { labor_cost: totalCost, labor_hours: totalHours };
      },
      staleTime: 60 * 1000,
    });

    // Prefetch WTD sales from cache (Monday through yesterday)
    const [y, m, d] = todayStr.split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    const weekStart = startOfWeek(localDate, { weekStartsOn: 1 });
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    
    queryClient.prefetchQuery({
      queryKey: ['sales-cache-wtd', locationId, weekStartStr, todayStr],
      queryFn: async () => {
        const { data } = await supabase
          .from('sales_cache')
          .select('sale_date, net_sales, guest_count')
          .eq('location_id', locationId)
          .gte('sale_date', weekStartStr)
          .lte('sale_date', todayStr)
          .order('sale_date');
        return data || [];
      },
      staleTime: 2 * 60 * 1000, // 2 min
    });

    // Prefetch schedule stable data (profiles, templates) - shared across all weeks
    queryClient.prefetchQuery({
      queryKey: ['schedule-stable', locationId],
      queryFn: async () => {
        const [userLocationsResult, allProfilesResult, rolesResult, templatesResult] = await Promise.all([
          supabase
            .from("user_locations")
            .select("user_id, show_on_schedule")
            .eq("location_id", locationId),
          supabase
            .from("profiles")
            .select(`id, full_name, profile_photo_url, display_order, appears_on_schedule, weekly_availability`)
            .eq("is_active", true)
            .eq("appears_on_schedule", true),
          supabase.from("user_roles").select("user_id, role"),
          supabase
            .from("shift_templates")
            .select("*")
            .eq("location_id", locationId)
            .order("start_time", { ascending: true }),
        ]);

        if (userLocationsResult.error || allProfilesResult.error || rolesResult.error || templatesResult.error) {
          return null;
        }

        const locationUserIds = new Set((userLocationsResult.data || []).filter(ul => ul.show_on_schedule !== false).map((ul) => ul.user_id));
        const locationProfiles = (allProfilesResult.data || []).filter((p) => locationUserIds.has(p.id));
        
        const { data: wageRows } = await supabase.rpc('get_current_wages_batch', {
          p_user_ids: locationProfiles.map((p) => p.id),
        });
        const wageMap = new Map<string, number>(((wageRows || []) as any[]).map((w) => [w.user_id, Number(w.hourly_wage)]));

        const profilesWithRoles = locationProfiles.map(profile => {
          const userRole = rolesResult.data?.find(r => r.user_id === profile.id);
          return {
            ...profile,
            hourly_wage: wageMap.get(profile.id) ?? 15,
            role: userRole?.role || 'team_member',
            display_order: profile.display_order ?? 0
          };
        });
        
        const roleOrder: Record<string, number> = { 
          super_admin: 0, brand_admin: 1, org_admin: 2, admin: 3, 
          manager: 4, shift_manager: 5, team_member: 6 
        };
        profilesWithRoles.sort((a, b) => {
          const aRoleOrder = roleOrder[a.role as string] ?? 5;
          const bRoleOrder = roleOrder[b.role as string] ?? 5;
          if (aRoleOrder === bRoleOrder) {
            return (a.display_order ?? 0) - (b.display_order ?? 0);
          }
          return aRoleOrder - bRoleOrder;
        });

        return {
          profiles: profilesWithRoles,
          templates: templatesResult.data || [],
          locationUserIds: Array.from(locationUserIds),
        };
      },
      staleTime: 5 * 60 * 1000,
    });

  }, [queryClient, userId, locationId, timezone]);
}
