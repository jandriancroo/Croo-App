import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type BrandIntegrationKey = 'qubeyond' | 'clover' | 'aloha' | 'pfg' | 'produce_alliance' | 'ovation';

export function useBrandIntegrationPolicies(locationId?: string) {
  return useQuery({
    queryKey: ['location-brand-integration-policies', locationId],
    enabled: Boolean(locationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!locationId) return new Set<BrandIntegrationKey>();

      const { data: location, error: locationError } = await supabase
        .from('locations')
        .select('brand_id, organization_id')
        .eq('id', locationId)
        .single();
      if (locationError) throw locationError;

      let brandId = location.brand_id;
      if (!brandId && location.organization_id) {
        const { data: organization, error: organizationError } = await supabase
          .from('organizations')
          .select('brand_id')
          .eq('id', location.organization_id)
          .single();
        if (organizationError) throw organizationError;
        brandId = organization.brand_id;
      }

      if (!brandId) return new Set<BrandIntegrationKey>();

      const { data, error } = await supabase
        .from('brand_integration_policies')
        .select('integration_key')
        .eq('brand_id', brandId)
        .eq('is_enabled', true);
      if (error) throw error;

      return new Set((data ?? []).map((row) => row.integration_key as BrandIntegrationKey));
    },
  });
}