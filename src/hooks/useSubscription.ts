import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PRODUCT_TO_TIER, SUBSCRIPTION_TIERS, type TierKey } from '@/config/subscriptionTiers';

interface SubscriptionState {
  loading: boolean;
  subscribed: boolean;
  tierKey: TierKey | null;
  productIds: string[];
  subscriptionEnd: string | null;
  trialEnd: string | null;
}

export function useSubscription() {
  const [state, setState] = useState<SubscriptionState>({
    loading: true,
    subscribed: false,
    tierKey: null,
    productIds: [],
    subscriptionEnd: null,
    trialEnd: null,
  });

  const checkSubscription = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setState(s => ({ ...s, loading: false, subscribed: false, tierKey: null }));
        return;
      }

      const { data, error } = await supabase.functions.invoke('check-subscription');
      if (error) throw error;

      if (!data?.subscribed) {
        setState({ loading: false, subscribed: false, tierKey: null, productIds: [], subscriptionEnd: null, trialEnd: null });
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
      });
    } catch (err) {
      console.error('Subscription check failed:', err);
      setState(s => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    checkSubscription();
    // Re-check every 60 seconds
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

  const startCheckout = useCallback(async (priceId: string, skipTrial?: boolean) => {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { priceId, skipTrial },
    });
    if (error) throw error;
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, []);

  const openPortal = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('customer-portal');
    if (error) throw error;
    if (data?.url) {
      window.open(data.url, '_blank');
    }
  }, []);

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
