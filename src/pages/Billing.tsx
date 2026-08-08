import { Layout } from '@/components/Layout';
import { PageTitle } from '@/components/PageTitle';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { toast } from '@/components/ui/sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { usePlans, type PlanRow } from '@/hooks/usePlans';

import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { SUBSCRIPTION_TIERS } from '@/config/subscriptionTiers';
import { Check, Crown, Rocket, Zap, Star, Loader2, ExternalLink, CreditCard, MapPin } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import poweredByStripe from '@/assets/powered-by-stripe.svg.asset.json';



const ICONS_BY_KEY: Record<string, React.ReactNode> = {
  zap: <Zap className="h-5 w-5" />,
  rocket: <Rocket className="h-5 w-5" />,
  star: <Star className="h-5 w-5" />,
  crown: <Crown className="h-5 w-5" />,
};

function renderIcon(key: string | null | undefined) {
  if (key && ICONS_BY_KEY[key]) return ICONS_BY_KEY[key];
  return <Zap className="h-5 w-5" />;
}

export default function Billing() {
  const {
    subscribed, loading, startCheckout, openPortal,
    trialEnd, checkSubscription,
    locationSubscriptions, isLocationSubscribed, getLocationTier,
  } = useSubscription();
  const { locations, organizationId: currentOrgId } = useAppLocation();
  const { plans } = usePlans();
  const { isSuperAdmin } = useUserRole();
  const visiblePlans: PlanRow[] = plans.filter((p) => p.is_visible);
  const [searchParams] = useSearchParams();
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [skipTrial, setSkipTrial] = useState(false);
  const [savingSkipTrial, setSavingSkipTrial] = useState(false);

  // Filter to current org's locations, exclude sandbox
  const billableLocations = locations.filter(l => 
    l.store_number !== '7777' && 
    (!currentOrgId || l.organization_id === currentOrgId)
  );

  // Load the saved skip-trial setting for the selected location
  useEffect(() => {
    if (!selectedLocationId) {
      setSkipTrial(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('location_plan_overrides')
        .select('skip_trial')
        .eq('location_id', selectedLocationId)
        .maybeSingle();
      if (!cancelled) setSkipTrial(!!data?.skip_trial);
    })();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  const handleSkipTrialChange = async (next: boolean) => {
    if (!selectedLocationId || !isSuperAdmin) return;
    setSkipTrial(next);
    setSavingSkipTrial(true);
    const { error } = await supabase
      .from('location_plan_overrides')
      .upsert(
        { location_id: selectedLocationId, skip_trial: next },
        { onConflict: 'location_id' }
      );
    setSavingSkipTrial(false);
    if (error) {
      setSkipTrial(!next);
      toast.error('Could not save trial setting');
    } else {
      toast.success(next ? 'Trial will be skipped for this location' : 'Free trial enabled for this location');
    }
  };

  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      toast.success('Subscription started! Refreshing…');
      checkSubscription();
    } else if (checkout === 'canceled') {
      toast.info('Checkout canceled');
    }
  }, [searchParams, checkSubscription]);

  const handleCheckout = async (priceId: string, locationId: string) => {
    try {
      toast.info('Opening checkout…');
      await startCheckout(priceId, undefined, locationId);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start checkout');
    }
  };


  const handlePortal = async () => {
    try {
      toast.info('Opening billing portal…');
      await openPortal();
    } catch (err: any) {
      toast.error(err.message || 'Failed to open portal');
    }
  };

  const isOnTrial = !!trialEnd && new Date(trialEnd) > new Date();

  return (
    <Layout>
      <div className="space-y-6 w-full max-w-4xl mx-auto">
        <div>
          <PageTitle color="emerald">Plans & Billing</PageTitle>
          <p className="text-muted-foreground">Subscribe each location individually</p>
        </div>


        {/* Manage billing if subscribed */}
        {subscribed && (
          <Card className="border-primary bg-primary/5">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">Active Subscriptions</p>
                  <p className="text-xs text-muted-foreground">
                    {Object.keys(locationSubscriptions).length} location(s) subscribed
                    {isOnTrial && trialEnd && ` · Trial ends ${new Date(trialEnd).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handlePortal}>
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                Manage Billing
              </Button>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Location list with subscription status */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Your Locations</h2>
              {billableLocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No billable locations found.</p>
              ) : (
                billableLocations.map((loc) => {
                  const locSubscribed = isLocationSubscribed(loc.id);
                  const locTier = getLocationTier(loc.id);
                  const locSub = locationSubscriptions[loc.id];
                  const isSelected = selectedLocationId === loc.id;
                  const locIsOnTrial = locSub?.trial_end && new Date(locSub.trial_end) > new Date();

                  return (
                    <Card
                      key={loc.id}
                      className={`cursor-pointer transition-all ${
                        isSelected ? 'border-primary ring-2 ring-primary/20' : ''
                      } ${locSubscribed ? 'bg-primary/5' : ''}`}
                      onClick={() => !locSubscribed && setSelectedLocationId(isSelected ? null : loc.id)}
                    >
                      <CardContent className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <MapPin className={`h-4 w-4 ${locSubscribed ? 'text-primary' : 'text-muted-foreground'}`} />
                          <div>
                            <p className="font-medium text-sm">{loc.name}</p>
                            {loc.store_number && (
                              <p className="text-xs text-muted-foreground">Store #{loc.store_number}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {locSubscribed ? (
                            <>
                              {locIsOnTrial && <Badge variant="secondary" className="text-xs">Trial</Badge>}
                              <Badge className={`text-xs ${locTier === 'founder' ? 'founder-badge-active' : 'bg-primary text-primary-foreground'}`}>
                                {locTier ? SUBSCRIPTION_TIERS[locTier].name : 'Active'}
                              </Badge>
                            </>
                          ) : (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              No plan
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            {/* Pricing cards — show when a location is selected */}
            {selectedLocationId && (
              <div className="space-y-3">
                {isSuperAdmin && (
                  <div className="flex items-center justify-between rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-3">
                    <div>
                      <Label htmlFor="skip-trial" className="text-sm font-medium">Skip free trial (Super Admin)</Label>
                      <p className="text-xs text-muted-foreground">
                        Saved on this location. When on, whoever subscribes is billed immediately instead of starting a trial.
                      </p>
                    </div>
                    <Switch id="skip-trial" checked={skipTrial} disabled={savingSkipTrial} onCheckedChange={handleSkipTrialChange} />

                  </div>
                )}
                <h2 className="text-lg font-semibold">
                  Choose a plan for {billableLocations.find(l => l.id === selectedLocationId)?.name}
                </h2>
                <div
                  className={`grid gap-4 justify-center mx-auto ${
                    visiblePlans.length === 1
                      ? 'grid-cols-1 max-w-sm'
                      : visiblePlans.length === 2
                      ? 'grid-cols-1 md:grid-cols-2 max-w-2xl'
                      : visiblePlans.length === 3
                      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-4xl'
                      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
                  }`}
                >
                  {visiblePlans.map((plan) => {
                    const isFounder = plan.badge_style === 'founder';
                    const isPopular = plan.badge_style === 'primary' && plan.key === 'pro';
                    const isHighlighted = plan.badge_style === 'primary';
                    const priceDollars = Math.round(plan.price_cents / 100);

                    return (
                      <div key={plan.id} className="relative flex flex-col">
                        {plan.badge_label && isFounder && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                            <Badge className="founder-badge-label text-xs px-3 whitespace-nowrap">{plan.badge_label}</Badge>
                          </div>
                        )}
                        {plan.badge_label && !isFounder && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                            <Badge className="bg-primary text-primary-foreground text-xs px-3 whitespace-nowrap">
                              {plan.badge_label}
                            </Badge>
                          </div>
                        )}
                        <Card className={`flex-1 flex flex-col transition-all ${
                          isFounder ? 'founder-card' : isHighlighted ? 'border-primary/50' : ''
                        }`}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                              <span className={isFounder ? 'founder-icon' : 'text-primary'}>{renderIcon(plan.icon_key)}</span>
                              <CardTitle className={`text-lg ${isFounder ? 'founder-text' : ''}`}>{plan.display_name}</CardTitle>
                            </div>
                            <CardDescription className={`text-xs ${isFounder ? 'founder-desc' : ''}`}>
                              {plan.description}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex-1 flex flex-col">
                            <div className="mb-4">
                              <span className={`text-3xl font-bold ${isFounder ? 'founder-text' : ''}`}>${priceDollars}</span>
                              <span className={`text-sm ${isFounder ? 'founder-desc' : 'text-muted-foreground'}`}>/mo per location</span>
                            </div>
                            <ul className="space-y-2 mb-6 flex-1">
                              {plan.feature_bullets.map((f) => (
                                <li key={f} className="flex items-start gap-2 text-sm">
                                  <Check className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isFounder ? 'founder-icon' : 'text-primary'}`} />
                                  <span className={isFounder ? 'founder-feature' : ''}>{f}</span>
                                </li>
                              ))}
                            </ul>
                            <Button
                              className={`w-full h-auto min-h-[2.5rem] py-2 text-xs font-semibold whitespace-nowrap ${
                                isFounder ? 'founder-btn' : !isPopular ? 'text-foreground border-border' : ''
                              }`}
                              variant={isPopular ? 'default' : 'outline'}
                              disabled={!plan.stripe_price_id}
                              onClick={() => plan.stripe_price_id && handleCheckout(plan.stripe_price_id, selectedLocationId)}
                            >
                              {skipTrial ? 'Subscribe Now' : 'Start Trial'}
                              <ExternalLink className="h-3 w-3 ml-1 flex-shrink-0" />
                            </Button>
                            <div className="mt-2 flex justify-center">
                              <img
                                src={poweredByStripe.url}
                                alt="Powered by Stripe"
                                className="h-6 w-auto opacity-70"
                                loading="lazy"
                              />
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>

            )}


            {/* Prompt to select location if none selected */}
            {!selectedLocationId && !subscribed && billableLocations.length > 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                👆 Select a location above to choose a plan
              </p>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
