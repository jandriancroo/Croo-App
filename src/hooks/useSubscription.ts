import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PRODUCT_TO_TIER, SUBSCRIPTION_TIERS, type TierKey } from '@/config/subscriptionTiers';
import { useLocation as useAppLocation } from '@/hooks/useLocation';

interface SubscriptionState {
  loading: boolean;
  subscribed: boolean;
  tierKey: TierKey | null;
  productIds: string[];
  subscriptionEnd: string | null;
  trialEnd: string | null;
  locationCount: number;
  organizationId: string | null;
}

export function useSubscription() {
  const { organizationId } = useAppLocation();

  const [state, setState] = useState<SubscriptionState>({
    loading: true,
    subscribed: false,
    tierKey: null,
    productIds: [],
    subscriptionEnd: null,
    trialEnd: null,
    locationCount: 0,
    organizationId: null,
  });

  const checkSubscription = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setState(s => ({ ...s, loading: false, subscribed: false, tierKey: null }));
        return;
      }

      const { data, error } = await supabase.functions.invoke('check-subscription', {
        body: { organization_id: organizationId },
      });
      if (error) throw error;

      if (!data?.subscribed) {
        setState({
          loading: false, subscribed: false, tierKey: null, productIds: [],
          subscriptionEnd: null, trialEnd: null, locationCount: 0, organizationId: null,
        });
        return;
      }

      // Determine the highest tier from the product IDs
      const tierPriority: TierKey[] = ['founder', 'ludicrous', 'pro', 'core'];
      let resolvedTier: TierKey | null = null;
      for (const t of tierPriority) {
        if (data.product_ids?.includes(SUBSCRIPTION_TIERS[t].product_id)) {
          resolvedTier = t;
          break;
        }
      }

      setState({
        loading: false,
        subscribed: true,
        tierKey: resolvedTier,
        productIds: data.product_ids || [],
        subscriptionEnd: data.subscription_end,
        trialEnd: data.trial_end,
        locationCount: data.location_count || 0,
        organizationId: data.organization_id || null,
      });
    } catch (err) {
      console.error('Subscription check failed:', err);
      setState(s => ({ ...s, loading: false }));
    }
  }, [organizationId]);

  useEffect(() => {
    checkSubscription();
    const interval = setInterval(checkSubscription, 60_000);
    return () => clearInterval(interval);
  }, [checkSubscription]);

  // Listen for auth changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkSubscription();
    });
    return () => subscription.unsubscribe();
  }, [checkSubscription]);

  // Detect PWA standalone mode where popups are blocked/broken
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );

  const openUrl = useCallback((url: string) => {
    if (isStandalone) {
      // In PWA mode, navigate in same tab to avoid blocked popups
      window.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  }, [isStandalone]);

  const startCheckout = useCallback(async (priceId: string, skipTrial?: boolean) => {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { priceId, skipTrial, organizationId },
    });
    if (error) throw error;
    if (data?.url) {
      openUrl(data.url);
    }
  }, [organizationId, openUrl]);

  const openPortal = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('customer-portal');
    if (error) throw error;
    if (data?.url) {
      openUrl(data.url);
    }
  }, [openUrl]);

  const hasFeature = useCallback((requiredTier: TierKey): boolean => {
    if (!state.subscribed || !state.tierKey) return false;
    const tierPriority: TierKey[] = ['core', 'pro', 'ludicrous', 'founder'];
    const userLevel = state.tierKey === 'founder' ? tierPriority.indexOf('ludicrous') : tierPriority.indexOf(state.tierKey);
    const requiredLevel = tierPriority.indexOf(requiredTier);
    return userLevel >= requiredLevel;
  }, [state.subscribed, state.tierKey]);

  return {
    ...state,
    checkSubscription,
    startCheckout,
    openPortal,
    hasFeature,
  };
}
