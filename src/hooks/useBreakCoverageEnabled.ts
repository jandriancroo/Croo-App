import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';

/**
 * Reads location_settings.break_coverage_enabled. Cached per location.
 * Gates all break-coverage UI everywhere in the app.
 */
export function useBreakCoverageEnabled(locationIdOverride?: string | null) {
  const { currentLocation } = useLocation();
  const locationId = locationIdOverride ?? currentLocation?.id ?? null;

  const { data } = useQuery({
    queryKey: ['break-coverage-enabled', locationId],
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_settings')
        .select('break_coverage_enabled')
        .eq('location_id', locationId!)
        .maybeSingle();
      if (error) throw error;
      return !!(data as any)?.break_coverage_enabled;
    },
  });

  return !!data;
}
