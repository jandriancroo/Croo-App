import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from './useLocation';

interface LocationSettings {
  id: string;
  location_id: string;
  show_wallet: boolean;
  show_sick_time_balance: boolean;
  timezone: string;
  team_member_sales_view_enabled: boolean;
}

export const useLocationSettings = () => {
  const { currentLocation } = useLocation();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['location-settings', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;

      const { data, error } = await supabase
        .from('location_settings')
        .select('id, location_id, show_wallet, show_sick_time_balance, timezone, team_member_sales_view_enabled')
        .eq('location_id', currentLocation.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching location settings:', error);
        return null;
      }

      return data as LocationSettings | null;
    },
    enabled: !!currentLocation?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Default to true if settings don't exist
  return {
    showWallet: settings?.show_wallet ?? true,
    showSickTimeBalance: settings?.show_sick_time_balance ?? true,
    teamMemberSalesViewEnabled: settings?.team_member_sales_view_enabled ?? false,
    timezone: settings?.timezone ?? 'America/Los_Angeles',
    isLoading,
  };
};
