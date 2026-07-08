import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, PlugZap, AlertTriangle, Rocket } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AlohaIntegrationCardProps {
  locationId: string;
}

const DEFAULT_PORTAL_URL = 'https://sierrafoodgroup.alohaenterprise.com';
const DEFAULT_COMPANY_ID = 'sfg07';

// Aloha (NCR / BWW GO portal) credentials card.
export default function AlohaIntegrationCard({ locationId }: AlohaIntegrationCardProps) {
  const [portalUrl, setPortalUrl] = useState(DEFAULT_PORTAL_URL);
  const [companyId, setCompanyId] = useState(DEFAULT_COMPANY_ID);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [storeId, setStoreId] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('location_integrations')
        .select('credentials, is_active')
        .eq('location_id', locationId)
        .eq('integration_type', 'aloha')
        .maybeSingle();
      if (data?.credentials) {
        const c = data.credentials as any;
        setPortalUrl(c.portal_url ?? DEFAULT_PORTAL_URL);
        setCompanyId(c.company_id ?? DEFAULT_COMPANY_ID);
        setUsername(c.username ?? '');
        setPassword(c.password ?? '');
        setStoreId(c.store_id ?? '');
        setIsActive(!!data.is_active);
      }
      setLoading(false);
    })();
  }, [locationId]);

  const save = async () => {
    if (!username || !password) {
      toast.error('Username and password are required');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('aloha-service', {
        body: { action: 'save', locationId, portalUrl, companyId, username, password, storeId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Save failed');
      toast.success('Aloha credentials saved');
      setIsActive(true);
    } catch (e: any) {
      toast.error(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await supabase.functions.invoke('aloha-service', {
        body: { action: 'test', portalUrl, companyId, username, password },
      });
      if (data?.success) {
        toast.success(`Aloha login verified (user ${data.userId || '?'})`);
      } else {
        toast.error(data?.error ?? 'Login failed');
      }
    } catch (e: any) {
      toast.error(`Test failed: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const syncYesterday = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('aloha-sync', {
        body: { action: 'sync_yesterday', locationId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Sync failed');
      const r = data?.results?.[0];
      if (r?.error) throw new Error(r.error);
      toast.success(`Aloha yesterday: $${Math.round(r?.net_sales ?? 0)} · ${r?.guest_count ?? 0} guests`);
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlugZap className="h-4 w-4" />
            Aloha (BWW GO)
          </CardTitle>
          {isActive ? (
            <Badge variant="secondary" className="text-[10px]">Connected</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2">
          <AlertTriangle className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
          <span>
            BWW GO Aloha Insight portal. Test to verify login, Save to store credentials,
            then Sync Yesterday to pull the first day of data.
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <Label htmlFor="aloha-portal" className="text-xs">Portal URL</Label>
              <Input
                id="aloha-portal"
                value={portalUrl}
                onChange={(e) => setPortalUrl(e.target.value)}
                disabled={loading}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="aloha-company" className="text-xs">Company ID</Label>
              <Input
                id="aloha-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={loading}
                className="h-8 text-sm"
                placeholder={DEFAULT_COMPANY_ID}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="aloha-user" className="text-xs">Username</Label>
              <Input
                id="aloha-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                className="h-8 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="aloha-pass" className="text-xs">Password</Label>
              <Input
                id="aloha-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="h-8 text-sm"
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="aloha-store" className="text-xs">Store name / ID (for row matching)</Label>
            <Input
              id="aloha-store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={loading}
              className="h-8 text-sm"
              placeholder="Leave blank to match by location name"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={test} disabled={testing || loading || !username || !password}>
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <PlugZap className="h-3.5 w-3.5 mr-1.5" />}
            Test login
          </Button>
          <Button size="sm" variant="outline" onClick={syncYesterday} disabled={syncing || !isActive}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Rocket className="h-3.5 w-3.5 mr-1.5" />}
            Sync yesterday
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
