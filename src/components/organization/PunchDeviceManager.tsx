/**
 * Org admin UI for managing paired punch clock devices.
 *
 * - Generate pairing codes (per location, single-use, expire in 1h)
 * - View active paired devices with last-seen heartbeat
 * - Revoke a device (kills its session and forces re-pair)
 *
 * Additive only — this does NOT touch punch clock functionality.
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
import { MonitorSmartphone, RefreshCw, Trash2, Copy, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Location {
  id: string;
  name: string;
  store_number?: string | null;
}

interface Device {
  id: string;
  device_name: string;
  location_id: string;
  locations?: { name: string; store_number?: string | null } | null;
  paired_at: string;
  last_active_at: string | null;
  revoked_at: string | null;
}

interface PairingCode {
  code: string;
  location_name: string;
  expiresAt: string;
}

interface Props {
  organizationId: string;
  locations: Location[];
}

export const PunchDeviceManager = ({ organizationId, locations }: Props) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingFor, setGeneratingFor] = useState<string>('');
  const [deviceNameDraft, setDeviceNameDraft] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [freshCode, setFreshCode] = useState<PairingCode | null>(null);

  const loadDevices = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('punch-device-service', {
      body: { action: 'list', organizationId },
    });
    if (error) {
      toast.error('Failed to load devices');
    } else {
      setDevices(data?.devices || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (organizationId) loadDevices();
  }, [organizationId]);

  const runGenerate = async (mode?: 'replace' | 'add', replaceDeviceId?: string) => {
    if (!selectedLocation) {
      toast.error('Select a location first');
      return;
    }
    const name = deviceNameDraft.trim() || 'Kiosk';
    setGeneratingFor(selectedLocation);
    const { data, error } = await supabase.functions.invoke('punch-device-service', {
      body: {
        action: 'generate',
        locationId: selectedLocation,
        deviceName: name,
        mode,
        replaceDeviceId,
      },
    });
    setGeneratingFor('');

    // A tablet with this exact name is already paired here. Never silently
    // create "Front iPad 2" — ask the manager what they mean.
    if (data?.duplicate) {
      setDupPrompt({ deviceName: name, existingDevices: data.existingDevices || [] });
      return;
    }
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Failed to generate code');
      return;
    }
    setDupPrompt(null);
    setFreshCode({
      code: data.code,
      location_name: locations.find((l) => l.id === selectedLocation)?.name || '',
      expiresAt: data.expiresAt,
    });
    if (data.replaced) {
      toast.success(`Replaced "${name}" — the old tablet is unpaired.`);
      loadDevices();
    }
    setDeviceNameDraft('');
  };

  const generateCode = () => runGenerate();


  const revokeDevice = async (device: Device) => {
    if (!confirm(`Revoke "${device.device_name}"? This tablet will drop back to the pairing screen.`)) return;
    const { error, data } = await supabase.functions.invoke('punch-device-service', {
      body: { action: 'revoke', deviceId: device.id },
    });
    if (error || data?.error) {
      toast.error(data?.error || 'Failed to revoke device');
      return;
    }
    toast.success('Device revoked');
    loadDevices();
  };

  const copyCode = () => {
    if (!freshCode) return;
    navigator.clipboard.writeText(freshCode.code);
    toast.success('Code copied');
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <CardTitle>Punch Clock Devices</CardTitle>
            <CardDescription>
              Pair tablets to isolate the punch clock from manager accounts. Codes expire in 1 hour and are single-use.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={loadDevices} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Generate code */}
        <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/30">
          <div className="text-sm font-medium">Generate a pairing code</div>
          <div className="grid gap-3 md:grid-cols-[1fr,1fr,auto]">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Location</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}{loc.store_number ? ` (#${loc.store_number})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Device name (optional)</Label>
              <Input
                value={deviceNameDraft}
                onChange={(e) => setDeviceNameDraft(e.target.value)}
                placeholder="e.g. Front Counter iPad"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={generateCode} disabled={!selectedLocation || !!generatingFor} className="w-full md:w-auto">
                <Plus className="h-4 w-4 mr-1" />Generate
              </Button>
            </div>
          </div>

          {freshCode && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">
                  {freshCode.location_name} · expires {formatDistanceToNow(new Date(freshCode.expiresAt), { addSuffix: true })}
                </div>
                <div className="text-3xl font-mono font-bold tracking-widest text-primary mt-1">
                  {freshCode.code}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={copyCode}>
                <Copy className="h-4 w-4 mr-1" />Copy
              </Button>
            </div>
          )}
        </div>

        {/* Paired devices */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Paired devices ({devices.filter(d => !d.revoked_at).length})</div>
          {loading ? (
            <div className="text-sm text-muted-foreground py-4">Loading…</div>
          ) : devices.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-xl">
              No devices paired yet.
            </div>
          ) : (
            <div className="space-y-2">
              {devices.filter(d => !d.revoked_at).map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border p-3 bg-card">
                  <MonitorSmartphone className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.device_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.locations?.name}
                      {' · '}
                      {d.last_active_at
                        ? `last seen ${formatDistanceToNow(new Date(d.last_active_at), { addSuffix: true })}`
                        : 'never checked in'}
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
