import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Rocket, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { useNavigate } from 'react-router-dom';

interface LocationActivationListProps {
  locations: any[];
  locationActivationMap: Map<string, { active: number; total: number }>;
  liveCount: number;
  brandId: string;
  onNavigate: (locationId: string) => void;
}

type IntegrationStatus = {
  pfg: boolean;
  pa: boolean;
  ok: boolean;
};

export default function LocationActivationList({
  locations,
  locationActivationMap,
  liveCount,
  brandId,
  onNavigate,
}: LocationActivationListProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deployingLocId, setDeployingLocId] = useState<string | null>(null);

  // Fetch vendor integration status for ALL locations on this list at once.
  // Deploy is hard-blocked unless both PFG and Produce Alliance are connected,
  // because the structure-only deploy depends on those syncs to fill in costs/SKUs.
  const locationIds = locations.map((l) => l.id);
  const { data: integrationMap } = useQuery({
    queryKey: ['location-integrations-status', locationIds.sort().join(',')],
    enabled: locationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_integrations')
        .select('location_id, integration_type, is_active')
        .in('location_id', locationIds)
        .in('integration_type', ['pfg', 'produce_alliance'])
        .eq('is_active', true);
      if (error) throw error;
      const map = new Map<string, IntegrationStatus>();
      for (const id of locationIds) {
        map.set(id, { pfg: false, pa: false, ok: false });
      }
      for (const row of data || []) {
        const status = map.get(row.location_id) || { pfg: false, pa: false, ok: false };
        if (row.integration_type === 'pfg') status.pfg = true;
        if (row.integration_type === 'produce_alliance') status.pa = true;
        status.ok = status.pfg && status.pa;
        map.set(row.location_id, status);
      }
      return map;
    },
    staleTime: 30_000,
  });

  const handleDeploy = async (locationId: string) => {
    setDeployingLocId(locationId);
    try {
      // STEP 1: Structure deploy — creates inventory_items but vendor SKUs are blank,
      // so recipe ingredient linking will fail to match on item_number / pa_item_id.
      const toastId = toast.loading('Deploying inventory structure…');
      const { data: deployData, error: deployErr } = await supabase.functions.invoke(
        'deploy-location-inventory',
        { body: { locationId, brandId } },
      );
      if (deployErr) throw deployErr;

      // STEP 2: Run vendor syncs in parallel — these populate item_number (PFG)
      // and pa_item_id (PA) on the freshly-deployed structure rows.
      toast.loading('Syncing PFG + Produce Alliance…', { id: toastId });
      const [pfgRes, paRes] = await Promise.allSettled([
        supabase.functions.invoke('pfg-service', { body: { action: 'sync', locationId } }),
        supabase.functions.invoke('produce-alliance-service', { body: { action: 'sync_items', locationId } }),
      ]);
      if (pfgRes.status === 'rejected') console.warn('[Deploy] PFG sync failed:', pfgRes.reason);
      if (paRes.status === 'rejected') console.warn('[Deploy] PA sync failed:', paRes.reason);

      // STEP 3: Re-run deploy — items already exist (skip path), but the recipe
      // ingredient linker now finds matches because vendor SKUs are populated.
      // Step 6 in deploy-location-inventory is idempotent (deletes then re-inserts).
      toast.loading('Linking recipe ingredients…', { id: toastId });
      await supabase.functions.invoke('deploy-location-inventory', {
        body: { locationId, brandId },
      });

      toast.success(
        `Deployed ${deployData?.deployed || 0} items (${deployData?.skipped || 0} existed). Vendors synced. Recipes linked.`,
        { id: toastId },
      );
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
        const integrationStatus = integrationMap?.get(loc.id);
        const vendorsReady = integrationStatus?.ok ?? true; // optimistic until query resolves
        const missingVendors: string[] = [];
        if (integrationStatus) {
          if (!integrationStatus.pfg) missingVendors.push('PFG');
          if (!integrationStatus.pa) missingVendors.push('Produce Alliance');
        }

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
              {needsDeploy && integrationStatus && !vendorsReady && (
                <p className="text-[10px] text-destructive mt-1 pl-0.5 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {missingVendors.join(' + ')} not connected
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {needsDeploy && (
                vendorsReady ? (
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
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={() => navigate(`/location/${loc.id}#integrations`)}
                  >
                    Connect Vendors
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )
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
