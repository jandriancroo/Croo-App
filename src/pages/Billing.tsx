import { Layout } from '@/components/Layout';
import { PageHeaderDivider } from '@/components/ui/page-header-divider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { SUBSCRIPTION_TIERS, ADDONS, type TierKey } from '@/config/subscriptionTiers';
import { Check, Crown, Rocket, Zap, Star, Loader2, ExternalLink, CreditCard, MapPin } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PRODUCT_TO_TIER } from '@/config/subscriptionTiers';

const TIER_ICONS: Record<TierKey, React.ReactNode> = {
  core: <Zap className="h-5 w-5" />,
  pro: <Rocket className="h-5 w-5" />,
  ludicrous: <Star className="h-5 w-5" />,
  founder: <Crown className="h-5 w-5" />,
};

const TIER_ORDER: TierKey[] = ['core', 'pro', 'ludicrous', 'founder'];

export default function Billing() {
  const {
    subscribed, tierKey, loading, startCheckout, openPortal,
    subscriptionEnd, trialEnd, checkSubscription,
    locationSubscriptions, isLocationSubscribed, getLocationTier,
  } = useSubscription();
  const { isSuperAdmin } = useUserRole();
  const { locations } = useAppLocation();
  const [searchParams] = useSearchParams();
  const [skipTrial, setSkipTrial] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  // Filter out sandbox locations
  const billableLocations = locations.filter(l => l.store_number !== '7777');

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
      await startCheckout(priceId, skipTrial, locationId);
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
          <h1 className="text-3xl font-bold">Plans & Billing</h1>
          <p className="text-muted-foreground">Subscribe each location individually</p>
          <PageHeaderDivider />
        </div>

        {/* Super admin skip trial toggle */}
        {isSuperAdmin && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-destructive/30 bg-destructive/5">
            <Switch checked={skipTrial} onCheckedChange={setSkipTrial} id="skip-trial" />
            <label htmlFor="skip-trial" className="text-sm font-medium cursor-pointer">
              Skip 14-day trial (charge immediately)
            </label>
            {skipTrial && <Badge variant="destructive" className="text-xs">No Trial</Badge>}
          </div>
        )}

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
                <h2 className="text-lg font-semibold">
                  Choose a plan for {billableLocations.find(l => l.id === selectedLocationId)?.name}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {TIER_ORDER.map((key) => {
                    const tier = SUBSCRIPTION_TIERS[key];
                    const isPopular = key === 'pro';
                    const isFounder = key === 'founder';

                    return (
                      <div key={key} className="relative flex flex-col">
                        {isFounder && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                            <Badge className="founder-badge-label text-xs px-3 whitespace-nowrap">Exclusive</Badge>
                          </div>
                        )}
                        {(isPopular || key === 'ludicrous') && !isFounder && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                            <Badge className="bg-primary text-primary-foreground text-xs px-3 whitespace-nowrap">
                              {isPopular ? 'Most Popular' : "Industry's Best Value"}
                            </Badge>
                          </div>
                        )}
                        <Card className={`flex-1 flex flex-col transition-all ${
                          isFounder ? 'founder-card' : isPopular ? 'border-primary/50' : ''
                        }`}>
                          <CardHeader className="pb-2">
                            <div className="flex items-center gap-2">
                              <span className={isFounder ? 'founder-icon' : 'text-primary'}>{TIER_ICONS[key]}</span>
                              <CardTitle className={`text-lg ${isFounder ? 'founder-text' : ''}`}>{tier.name}</CardTitle>
                            </div>
                            <CardDescription className={`text-xs ${isFounder ? 'founder-desc' : ''}`}>
                              {tier.description}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="flex-1 flex flex-col">
                            <div className="mb-4">
                              <span className={`text-3xl font-bold ${isFounder ? 'founder-text' : ''}`}>${tier.price}</span>
                              <span className={`text-sm ${isFounder ? 'founder-desc' : 'text-muted-foreground'}`}>/mo per location</span>
                            </div>
                            <ul className="space-y-2 mb-6 flex-1">
                              {tier.features.map((f) => (
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
                              onClick={() => handleCheckout(tier.price_id, selectedLocationId)}
                            >
                              {isFounder ? 'Claim Founder Rate' : 'Start Trial'}
                              <ExternalLink className="h-3 w-3 ml-1 flex-shrink-0" />
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Hiring Add-on — only relevant for Core/Pro since Ludicrous & Founder include it */}
            {selectedLocationId && (
              <Card className="opacity-50 pointer-events-none">
                <CardContent className="flex items-center justify-between py-4 gap-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{ADDONS.hiring.name}</p>
                    <p className="text-xs text-muted-foreground">
                      +${ADDONS.hiring.price}/mo · {ADDONS.hiring.description}
                    </p>
                    <p className="text-xs text-primary mt-1">Included in Ludicrous & Founder plans</p>
                  </div>
                  <Button variant="outline" size="sm" disabled>
                    Included
                  </Button>
                </CardContent>
              </Card>
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
