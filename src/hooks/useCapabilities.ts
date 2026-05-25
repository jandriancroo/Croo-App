import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { useLocation as useAppLocation } from '@/hooks/useLocation';

/**
 * Resolves the active plan for the current location and exposes a
 * `hasCapability(key)` checker driven by `plan_capability_grants`.
 *
 * Safety: if anything is unresolved (no subscription record, no matching
 * plan in the DB, query failed), we return `true` for every capability so
 * existing paying customers never lose access during rollout.
 */
export function useCapabilities() {
  const { currentLocation } = useAppLocation();
  const { locationSubscriptions, loading: subLoading } = useSubscription();

  const locationId = currentLocation?.id ?? null;
  const productId = locationId ? locationSubscriptions[locationId]?.product_id ?? null : null;

  const { data: grants, isLoading: grantsLoading } = useQuery({
    queryKey: ['capabilities-for-product', productId],
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: plan, error: planErr } = await supabase
        .from('plans')
        .select('id')
        .eq('stripe_product_id', productId!)
        .maybeSingle();
      if (planErr || !plan) return null;
      const { data: rows, error: grantsErr } = await supabase
        .from('plan_capability_grants')
        .select('capability_key')
        .eq('plan_id', plan.id);
      if (grantsErr) return null;
      return new Set(rows.map((r) => r.capability_key));
    },
  });

  const capabilities = useMemo(() => grants ?? null, [grants]);

  const hasCapability = (key: string): boolean => {
    // Permissive fallback during rollout — never block a paying customer.
    if (!capabilities) return true;
    return capabilities.has(key);
  };

  return {
    hasCapability,
    capabilities,
    loading: subLoading || grantsLoading,
  };
}
