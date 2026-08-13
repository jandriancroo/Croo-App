/**
 * Org admin UI for pairing an Apple Watch as a location device.
 *
 * The watch gets its own read-only, location-scoped token so it can show Cubes,
 * Schedule and Sales without the iPhone app being open. Additive only — this
 * does not change any dashboard, sales or schedule behaviour.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Watch, RefreshCw, Trash2, Copy, Plus, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { WatchBridge, isWatchBridgeAvailable } from '@/lib/watchBridge';

interface Location {
  id: string;
  name: string;
  store_number?: string | null;
}

interface WatchDevice {
  id: string;
  label: string;
  location_id: string;
  token_hint?: string | null;
  locations?: { name: string; store_number?: string | null } | null;
  created_at: string;
  last_active_at: string | null;
  revoked_at: string | null;
}

interface Props {
  organizationId: string;
  locations: Location[];
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/watch-device-service`;

export const WatchDeviceManager = ({ organizationId, locations }: Props) => {
  const [devices, setDevices] = useState<WatchDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [freshToken, setFreshToken] = useState<{
    token: string;
    locationId: string;
    locationName: string;
    locationsJson?: string;
    locationCount?: number;
  } | null>(null);
  const [pairState, setPairState] = useState<'idle' | 'pairing' | 'paired' | 'unreachable'>('idle');

  const loadDevices = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('watch-device-service', {
      body: { action: 'list', organizationId },
    });
    if (error) toast.error('Failed to load watch devices');
    else setDevices(data?.devices || []);
    setLoading(false);
  };

  useEffect(() => {
    if (organizationId) loadDevices();
  }, [organizationId]);

  const issueToken = async () => {
    if (!selectedLocation) {
      toast.error('Select a location first');
      return;
    }
    setIssuing(true);
    const { data, error } = await supabase.functions.invoke('watch-device-service', {
      body: { action: 'issue', locationId: selectedLocation, label: labelDraft.trim() },
    });
    setIssuing(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Failed to create watch device');
      return;
    }
    // The token covers every location the pairing user can access — hand that
    // list to the watch so it can offer its location switcher right away.
    const scoped: { id: string; name: string }[] = Array.isArray(data.locations) && data.locations.length
      ? data.locations
      : locations.map(l => ({ id: l.id, name: l.name }));
    const payload = {
      token: data.token as string,
      locationId: selectedLocation,
      locationName: data.locationName || locations.find(l => l.id === selectedLocation)?.name || '',
      locationsJson: JSON.stringify(scoped),
      locationCount: scoped.length,
    };
    setFreshToken(payload);
    setLabelDraft('');
    loadDevices();

    // Hand the token straight to the watch when we're inside the iOS app.
    if (isWatchBridgeAvailable()) {
      setPairState('pairing');
      const { locationCount: _c, ...bridgePayload } = payload;
      const res = await WatchBridge.pairWatch({ ...bridgePayload, apiUrl: FUNCTION_URL });
      if (res.delivered) {
        setPairState('paired');
        toast.success('Sent to your Apple Watch');
      } else {
        setPairState('unreachable');
        toast.message('Token created — open the watch app to finish pairing');
      }
    }
  };

  const sendToWatch = async () => {
    if (!freshToken) return;
    setPairState('pairing');
    const { locationCount: _c, ...bridgePayload } = freshToken;
    const res = await WatchBridge.pairWatch({ ...bridgePayload, apiUrl: FUNCTION_URL });
    if (res.delivered) {
      setPairState('paired');
      toast.success('Sent to your Apple Watch');
    } else {
      setPairState('unreachable');
      toast.error('Could not reach the watch — open the CrooHQ watch app and try again');
    }
  };

  const pairStatusLabel =
    pairState === 'pairing' ? 'Pairing…'
    : pairState === 'paired' ? 'Paired — watch received the token'
    : pairState === 'unreachable' ? 'Watch not reachable — open the CrooHQ watch app and tap Send to Watch'
    : null;

  const revokeDevice = async (device: WatchDevice) => {
    if (!confirm(`Revoke "${device.label}"? That watch will stop receiving data.`)) return;
    const { data, error } = await supabase.functions.invoke('watch-device-service', {
      body: { action: 'revoke', deviceId: device.id },
    });
    if (error || data?.error) {
      toast.error(data?.error || 'Failed to revoke watch');
      return;
    }
    toast.success('Watch revoked');
    loadDevices();
  };

  const activeDevices = devices.filter(d => !d.revoked_at);

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Watch className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <CardTitle>Apple Watch Devices</CardTitle>
            <CardDescription>
              Pair a watch to a location so it can show Cubes, Schedule and Sales on its own — no iPhone needed.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={loadDevices} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/30">
          <div className="text-sm font-medium">Pair a watch</div>
          <div className="grid gap-3 md:grid-cols-[1fr,1fr,auto]">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Location</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map(loc => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}{loc.store_number ? ` (#${loc.store_number})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Watch name (optional)</Label>
              <Input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                placeholder="e.g. GM Apple Watch"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={issueToken} disabled={!selectedLocation || issuing} className="w-full md:w-auto">
                <Plus className="h-4 w-4 mr-1" />Pair
              </Button>
            </div>
          </div>

          {freshToken && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                {freshToken.locationName} · this token is shown once
                {freshToken.locationCount && freshToken.locationCount > 1
                  ? ` · covers ${freshToken.locationCount} locations`
                  : ''}
              </div>
              <div className="font-mono text-xs break-all text-primary">{freshToken.token}</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { navigator.clipboard.writeText(freshToken.token); toast.success('Token copied'); }}
                >
                  <Copy className="h-4 w-4 mr-1" />Copy
                </Button>
                {isWatchBridgeAvailable() && (
                  <Button size="sm" onClick={sendToWatch}>
                    <Send className="h-4 w-4 mr-1" />Send to Watch
                  </Button>
                )}
              </div>
              {pairStatusLabel && (
                <div className={`text-xs ${pairState === 'unreachable' ? 'text-destructive' : pairState === 'paired' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {pairStatusLabel}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Paired watches ({activeDevices.length})</div>
          {loading ? (
            <div className="text-sm text-muted-foreground py-4">Loading…</div>
          ) : activeDevices.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-xl">
              No watches paired yet.
            </div>
          ) : (
            <div className="space-y-2">
              {activeDevices.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border p-3 bg-card">
                  <Watch className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.locations?.name}
                      {' · '}
                      {d.last_active_at
                        ? `last synced ${formatDistanceToNow(new Date(d.last_active_at), { addSuffix: true })}`
                        : 'never synced'}
                    </div>
                  </div>
                  <Badge variant="secondary" className="hidden sm:inline-flex">Active</Badge>
                  <Button size="sm" variant="ghost" onClick={() => revokeDevice(d)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
