import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { SalesDataForCubes } from '@/components/dashboard/DataCube';

export function useSalesDataForCubes() {
  const { currentLocation } = useAppLocation();

  const { data: salesData, isLoading } = useQuery({
    queryKey: ['sales-data-for-cubes', currentLocation?.id],
    queryFn: async (): Promise<SalesDataForCubes | null> => {
      if (!currentLocation?.id) return null;

      // First check if location has QuBeyond integration
      const { data: hasIntegration } = await supabase.rpc('has_active_location_integration', {
        _location_id: currentLocation.id,
        _integration_type: 'qubeyond',
      });

      if (!hasIntegration) return null;

      // Fetch live sales data from edge function
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
        body: { 
          locationId: currentLocation.id,
          targetDate: dateStr,
          fastMode: true // Get quick data for cubes
        }
      });

      if (error || !data) {
        console.error("Error fetching sales data for cubes:", error);
        return null;
      }

      // Transform to cube-compatible format
      return {
        daily: data.daily || 0,
        weekly: data.weekly || 0,
        monthly: data.monthly || 0,
        guestCount: data.guestCount || { daily: 0, weekly: 0, monthly: 0 },
        pizzaCount: data.pizzaCount || 0,
        avgTicket: data.avgTicket,
        comparison: data.comparison,
        projections: data.projections,
        labor: data.labor || null,
      };
    },
    enabled: !!currentLocation?.id,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refresh every minute
  });

  return { salesData, isLoading };
}
