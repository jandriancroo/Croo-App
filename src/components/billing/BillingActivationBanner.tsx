import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CreditCard } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import { useState } from 'react';

export function BillingActivationBanner() {
  const navigate = useNavigate();
  const { locationSubscriptions, loading } = useSubscription();
  const [dismissed, setDismissed] = useState(false);

  const { data: pendingLocs = [] } = useQuery({
    queryKey: ['billing-banner-locations'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      // Get all locations user can access that have billing initiated
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, billing_initiated_at')
        .not('billing_initiated_at', 'is', null);
      if (error) {
        console.error('[billing-banner]', error);
        return [];
      }
      return data || [];
    },
    staleTime: 60_000,
  });

  if (loading || dismissed) return null;

  const unsubscribed = pendingLocs.filter((l) => !locationSubscriptions[l.id]?.subscribed);
  if (unsubscribed.length === 0) return null;

  const primary = unsubscribed[0];

  return (
    <Alert className="border-orange-300 bg-orange-50 dark:bg-orange-950/20">
      <CreditCard className="h-4 w-4 text-orange-600" />
      <AlertTitle className="text-orange-900 dark:text-orange-200">
        Activate your subscription{unsubscribed.length > 1 ? ` (${unsubscribed.length} locations)` : ''}
      </AlertTitle>
      <AlertDescription className="text-orange-900/80 dark:text-orange-200/80">
        <div className="flex items-center justify-between gap-3 flex-wrap mt-1">
          <span>
            {unsubscribed.length === 1
              ? `${primary.name} is ready to convert from demo to a paid plan.`
              : `${unsubscribed.length} locations are ready to convert from demo to paid plans.`}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              Later
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(`/billing?location=${primary.id}`)}
            >
              Choose a plan
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
