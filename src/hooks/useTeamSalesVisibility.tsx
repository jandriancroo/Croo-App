import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';

/**
 * Hook to determine if the current user can view sales data.
 * 
 * Sales visibility rules:
 * - Shift managers and above can ALWAYS see sales
 * - Team members can only see sales if the location setting 'team_member_sales_view_enabled' is true
 * 
 * The setting is checked in real-time, so changes take effect immediately.
 */
export const useTeamSalesVisibility = () => {
  const { currentLocation } = useAppLocation();
  const { role, canViewSalesAndLabor, isShiftManager, loading: roleLoading } = useUserRole();

  // Fetch the location setting for team member sales visibility
  const { data: locationSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ['team-sales-visibility', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;

      const { data, error } = await supabase
        .from('location_settings')
        .select('team_member_sales_view_enabled')
        .eq('location_id', currentLocation.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching team sales visibility setting:', error);
        return { team_member_sales_view_enabled: false };
      }

      return data || { team_member_sales_view_enabled: false };
    },
    enabled: !!currentLocation?.id,
    staleTime: 30 * 1000, // 30 seconds - changes should reflect quickly
    refetchInterval: 30 * 1000, // Refetch every 30 seconds to pick up changes
  });

  // Determine if the user can see sales
  // - Shift managers and above: always yes (based on role hierarchy)
  // - Team members: only if location setting is enabled
  const isTeamMember = role === 'team_member';
  const teamMemberSalesEnabled = locationSettings?.team_member_sales_view_enabled ?? false;

  // If user is shift manager or above, they can see sales regardless of setting
  // If user is team member, they need the location setting to be enabled
  const canSeeSales = isShiftManager || (isTeamMember && teamMemberSalesEnabled);

  return {
    canSeeSales,
    loading: roleLoading || settingsLoading,
    teamMemberSalesEnabled,
  };
};
