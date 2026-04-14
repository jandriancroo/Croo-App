import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Rocket, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

interface LocationActivationListProps {
  locations: any[];
  locationActivationMap: Map<string, { active: number; total: number }>;
  liveCount: number;
  brandId: string;
  onNavigate: (locationId: string) => void;
}

export default function LocationActivationList({
  locations,
  locationActivationMap,
  liveCount,
  brandId,
  onNavigate,
}: LocationActivationListProps) {
  const queryClient = useQueryClient();
  const [deployingLocId, setDeployingLocId] = useState<string | null>(null);

  const handleDeploy = async (locationId: string) => {
    setDeployingLocId(locationId);
    try {
      const { data, error } = await supabase.functions.invoke('deploy-location-inventory', {
        body: { locationId, brandId },
      });
      if (error) throw error;
      toast.success(`Deployed ${data?.deployed || 0} items (${data?.skipped || 0} already existed)`);
      queryClient.invalidateQueries({ queryKey: ['brand-location-activation'] });
      queryClient.invalidateQueries({ queryKey: ['brand-locations'] });
    } catch (err: any) {
      console.error('Deploy error:', err);
      toast.error('Deploy failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDeployingLocId(null);
    }
  };

  const formatDeployDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const zoned = toZonedTime(new Date(dateStr), 'America/Los_Angeles');
    return format(zoned, 'MMM d, yyyy h:mm a');
  };

  return (
    <div className="divide-y divide-border">
      {locations.map((loc: any) => {
        const stats = locationActivationMap.get(loc.id);
        const active = stats?.active || 0;
        const pct = liveCount > 0 ? Math.round((active / liveCount) * 100) : 0;
        const isDeploying = deployingLocId === loc.id;
        const needsDeploy = liveCount > 0;
        const lastDeployed = formatDeployDate(loc.last_deployed_at);

        return (
          <div key={loc.id} className="flex items-center justify-between py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{loc.name}</span>
                {loc.store_number && (
                  <Badge variant="outline" className="text-[10px]">#{loc.store_number}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {active}/{liveCount} active
                </span>
              </div>
              {lastDeployed && (
                <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                  Last deployed {lastDeployed}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {needsDeploy && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5"
                  disabled={isDeploying}
                  onClick={() => handleDeploy(loc.id)}
                >
                  {isDeploying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="h-3.5 w-3.5" />
                  )}
                  {active === 0 ? 'Deploy' : 'Sync'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => onNavigate(loc.id)}
              >
                View
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
