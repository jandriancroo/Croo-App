import { Layout } from '@/components/Layout';
import { PageHeaderDivider } from '@/components/ui/page-header-divider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useSubscription } from '@/hooks/useSubscription';
import { SUBSCRIPTION_TIERS, ADDONS, type TierKey } from '@/config/subscriptionTiers';
import { Check, Crown, Rocket, Zap, Star, Loader2, ExternalLink, CreditCard } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

const TIER_ICONS: Record<TierKey, React.ReactNode> = {
  core: <Zap className="h-5 w-5" />,
  pro: <Rocket className="h-5 w-5" />,
  ludicrous: <Star className="h-5 w-5" />,
  founder: <Crown className="h-5 w-5" />,
};

const TIER_ORDER: TierKey[] = ['core', 'pro', 'ludicrous'];

export default function Billing() {
  const { subscribed, tierKey, loading, startCheckout, openPortal, subscriptionEnd, trialEnd, checkSubscription } = useSubscription();
  const { userRole } = useAuth();
  const [searchParams] = useSearchParams();
  const [skipTrial, setSkipTrial] = useState(false);
  const isSuperAdmin = userRole === 'super_admin';
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      toast.success('Subscription started! Refreshing…');
      checkSubscription();
    } else if (checkout === 'canceled') {
      toast.info('Checkout canceled');
    }
  }, [searchParams, checkSubscription]);

  const handleCheckout = async (priceId: string) => {
    try {
      toast.info('Opening checkout…');
      await startCheckout(priceId, skipTrial);
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

  const isCurrentTier = (key: TierKey) => tierKey === key;
  const isOnTrial = !!trialEnd && new Date(trialEnd) > new Date();

  return (
    <Layout>
      <div className="space-y-6 w-full max-w-4xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold">Plans & Billing</h1>
          <p className="text-muted-foreground">Choose the plan that fits your operation</p>
          <PageHeaderDivider />
        </div>

        {/* Current plan banner */}
        {subscribed && tierKey && (
          <Card className="border-primary bg-primary/5">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  {TIER_ICONS[tierKey]}
                </div>
                <div>
                  <p className="font-semibold">
                    {SUBSCRIPTION_TIERS[tierKey].name} Plan
                    {isOnTrial && <Badge variant="secondary" className="ml-2 text-xs">Trial</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subscriptionEnd && `Renews ${new Date(subscriptionEnd).toLocaleDateString()}`}
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
            {/* Pricing cards */}
            <div className="grid gap-4 md:grid-cols-3 pt-4">
              {TIER_ORDER.map((key) => {
                const tier = SUBSCRIPTION_TIERS[key];
                const isCurrent = isCurrentTier(key);
                const isPopular = key === 'pro';

                return (
                  <div key={key} className="relative flex flex-col">
                    {(isPopular || key === 'ludicrous') && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <Badge className="bg-primary text-primary-foreground text-xs px-3 whitespace-nowrap">
                          {isPopular ? 'Most Popular' : "Industry's Best Value"}
                        </Badge>
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <Badge className="bg-accent text-accent-foreground text-xs px-3">Your Plan</Badge>
                      </div>
                    )}
                  <Card
                    className={`flex-1 flex flex-col transition-all ${
                      isCurrent
                        ? 'border-primary ring-2 ring-primary/20'
                        : isPopular
                        ? 'border-primary/50'
                        : ''
                    }`}
                  >


                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-primary">{TIER_ICONS[key]}</span>
                        <CardTitle className="text-lg">{tier.name}</CardTitle>
                      </div>
                      <CardDescription className="text-xs">{tier.description}</CardDescription>
                    </CardHeader>

                    <CardContent className="flex-1 flex flex-col">
                      <div className="mb-4">
                        <span className="text-3xl font-bold">${tier.price}</span>
                        <span className="text-muted-foreground text-sm">/mo per location</span>
                      </div>

                      <ul className="space-y-2 mb-6 flex-1">
                        {tier.features.map((f) => (
                          <li key={f} className="flex items-start gap-2 text-sm">
                            <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>

                      {isCurrent ? (
                        <Button variant="outline" className="w-full" disabled>
                          Current Plan
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          variant={isPopular ? 'default' : 'outline'}
                          onClick={() => handleCheckout(tier.price_id)}
                        >
                          {subscribed ? 'Switch Plan' : 'Start 14-day Trial'}
                          <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                        </Button>
                      )}
                    </CardContent>
                   </Card>
                  </div>
                );
              })}
            </div>

            {/* Founder tier — special callout */}
            <Card className="border-dashed border-accent/50 bg-accent/5">
              <CardContent className="flex items-center justify-between py-4 gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-accent/10 text-accent">
                    <Crown className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold flex items-center gap-2">
                      Founder Plan
                      {isCurrentTier('founder') && <Badge className="bg-accent text-accent-foreground text-xs">Active</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      All Ludicrous features locked at $99/mo forever · Early adopter exclusive
                    </p>
                  </div>
                </div>
                {isCurrentTier('founder') ? (
                  <Button variant="outline" size="sm" disabled>Current Plan</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => handleCheckout(SUBSCRIPTION_TIERS.founder.price_id)}>
                    {subscribed ? 'Switch' : 'Claim Founder Rate'}
                    <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Hiring Add-on */}
            <Card>
              <CardContent className="flex items-center justify-between py-4 gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">{ADDONS.hiring.name}</p>
                  <p className="text-xs text-muted-foreground">
                    +${ADDONS.hiring.price}/mo · {ADDONS.hiring.description}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleCheckout(ADDONS.hiring.price_id)}>
                  Add Hiring · ${ADDONS.hiring.price}/mo
                  <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
