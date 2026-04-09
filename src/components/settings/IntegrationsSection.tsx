import { useState, useEffect, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, TestTube, Check, X, Eye, EyeOff, Plug, RefreshCw, Settings2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import pfgLogo from "@/assets/pfg-logo.png";
import paLogo from "@/assets/pa-logo.png";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DeliveryScheduleEditor, DeliverySlot } from "./DeliveryScheduleEditor";

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id?: string;
  pull_labor?: boolean;
}

interface IntegrationsSectionProps {
  locationId: string | undefined;
}

// Status dot component
function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${
        connected ? 'bg-green-500' : 'bg-muted-foreground/30'
      }`}
      style={connected ? {
        animation: 'statusGlow 4s ease-in-out infinite',
      } : undefined}
    />
  );
}

// Integration card shell
function IntegrationCard({
  title,
  description,
  connected,
  connectedLabel,
  setupLabel,
  logo,
  onEdit,
  isLoading,
}: {
  title: string;
  description: string;
  connected: boolean;
  connectedLabel?: string;
  setupLabel?: string;
  logo?: string;
  onEdit: () => void;
  isLoading?: boolean;
}) {
  return (
    <Card className="p-4 flex flex-col justify-between gap-3 min-h-[120px]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {logo ? (
            <img src={logo} alt={title} className="h-7 w-auto shrink-0" />
          ) : (
            <Plug className="h-5 w-5 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <h4 className="text-sm font-semibold leading-tight truncate">{title}</h4>
            <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{description}</p>
          </div>
        </div>
        <StatusDot connected={connected} />
      </div>

      <div className="flex items-center justify-between gap-2">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : connected ? (
          <span className="text-xs text-muted-foreground truncate">
            {connectedLabel || 'Connected'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">
            {setupLabel || `Setup ${title}`}
          </span>
        )}
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs shrink-0" onClick={onEdit}>
          <Settings2 className="h-3.5 w-3.5 mr-1" />
          {connected ? 'Edit' : 'Setup'}
        </Button>
      </div>
    </Card>
  );
}

export function IntegrationsSection({ locationId }: IntegrationsSectionProps) {
  const queryClient = useQueryClient();

  // Dialog state
  const [editingIntegration, setEditingIntegration] = useState<'qubeyond' | 'pfg' | 'pa' | 'kds' | 'ovation' | null>(null);

  // QuBeyond state
  const [credentials, setCredentials] = useState<QuBeyondCredentials>({ username: "", password: "", location_id: "", pull_labor: false });
  const [isActive, setIsActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // PA state
  const [paCredentials, setPaCredentials] = useState({ username: '', password: '', restaurant_id: '' });
  const [paIsDiscovering, setPaIsDiscovering] = useState(false);
  const [paIsActive, setPaIsActive] = useState(true);
  const [paShowPassword, setPaShowPassword] = useState(false);
  const [paIsTesting, setPaIsTesting] = useState(false);
  const [paTestResult, setPaTestResult] = useState<'success' | 'error' | null>(null);
  const [paIsSaving, setPaIsSaving] = useState(false);

  // PFG state
  const [pfgIsActive, setPfgIsActive] = useState(true);
  const [pfgIsTesting, setPfgIsTesting] = useState(false);
  const [pfgTestResult, setPfgTestResult] = useState<'success' | 'error' | null>(null);
  const [pfgIsConnecting, setPfgIsConnecting] = useState(false);
  const [pfgShowTokenInput, setPfgShowTokenInput] = useState(false);
  const [pfgPastedToken, setPfgPastedToken] = useState('');
  const [pfgOrderGuideId, setPfgOrderGuideId] = useState('');
  const [pfgCustomerId, setPfgCustomerId] = useState('');
  const [pfgIsSavingGuide, setPfgIsSavingGuide] = useState(false);
  const [pfgLoginUsername, setPfgLoginUsername] = useState('');
  const [pfgLoginPassword, setPfgLoginPassword] = useState('');
  const [pfgShowLoginPassword, setPfgShowLoginPassword] = useState(false);
  const [pfgIsSavingCreds, setPfgIsSavingCreds] = useState(false);
  const [pfgIsTestingRopc, setPfgIsTestingRopc] = useState(false);
  const [pfgRopcResult, setPfgRopcResult] = useState<'success' | 'error' | null>(null);
  const [pfgDeliverySchedule, setPfgDeliverySchedule] = useState<DeliverySlot[]>([]);
  const [pfgAvailableGuides, setPfgAvailableGuides] = useState<{ id: string; name: string; type: string }[]>([]);
  const [pfgIsFetchingGuides, setPfgIsFetchingGuides] = useState(false);
  const [paDeliverySchedule, setPaDeliverySchedule] = useState<DeliverySlot[]>([]);

  // Fresh KDS state
  const [kdsLocationId, setKdsLocationId] = useState('');
  const [kdsIsSaving, setKdsIsSaving] = useState(false);
  const [kdsIsSyncing, setKdsIsSyncing] = useState(false);

  // OvationUp state
  const [ovationEmail, setOvationEmail] = useState('');
  const [ovationPassword, setOvationPassword] = useState('');
  const [ovationCompanyId, setOvationCompanyId] = useState('');
  const [ovationLocationId, setOvationLocationId] = useState('');
  const [ovationShowPassword, setOvationShowPassword] = useState(false);
  const [ovationIsSaving, setOvationIsSaving] = useState(false);
  const [ovationIsTesting, setOvationIsTesting] = useState(false);
  const [ovationTestResult, setOvationTestResult] = useState<'success' | 'error' | null>(null);
  const { data: integration, isLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'qubeyond'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('location_integrations').select('*').eq('location_id', locationId).eq('integration_type', 'qubeyond').maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  const { data: pfgIntegration, isLoading: pfgIsLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'pfg'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('location_integrations').select('*').eq('location_id', locationId).eq('integration_type', 'pfg').maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  const { data: locationKdsData } = useQuery({
    queryKey: ['location-kds-id', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('locations').select('fresh_kds_location_id').eq('id', locationId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  const { data: paIntegration, isLoading: paIsLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'produce_alliance'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('location_integrations').select('*').eq('location_id', locationId).eq('integration_type', 'produce_alliance').maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // OvationUp — get brand_id from location's organization, then fetch integration
  const { data: ovationBrandId } = useQuery({
    queryKey: ['location-brand-id', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data: loc } = await supabase.from('locations').select('organization_id').eq('id', locationId).single();
      if (!loc?.organization_id) return null;
      const { data: org } = await supabase.from('organizations').select('brand_id').eq('id', loc.organization_id).single();
      return org?.brand_id || null;
    },
    enabled: !!locationId,
    staleTime: 60 * 60 * 1000,
  });

  const { data: ovationIntegration, isLoading: ovationIsLoading } = useQuery({
    queryKey: ['ovation-integration', ovationBrandId],
    queryFn: async () => {
      if (!ovationBrandId) return null;
      const { data } = await supabase.from('ovation_integrations').select('*').eq('brand_id', ovationBrandId).maybeSingle();
      return data;
    },
    enabled: !!ovationBrandId,
  });

  const { data: ovationMapping } = useQuery({
    queryKey: ['ovation-mapping', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data } = await supabase.from('ovation_location_mappings').select('*').eq('location_id', locationId).maybeSingle();
      return data;
    },
    enabled: !!locationId,
  });

  // ── Sync state from queries ──
  useEffect(() => {
    if (integration) {
      const creds = integration.credentials as unknown as QuBeyondCredentials;
      setCredentials({ username: creds?.username || "", password: creds?.password || "", location_id: creds?.location_id || "", pull_labor: creds?.pull_labor || false });
      setIsActive(integration.is_active);
    }
  }, [integration]);

  useEffect(() => {
    if (pfgIntegration) {
      setPfgIsActive(pfgIntegration.is_active);
      const creds = pfgIntegration.credentials as any;
      setPfgOrderGuideId(creds?.product_list_header_id || '');
      setPfgCustomerId(creds?.customer_id || '');
      setPfgLoginUsername(creds?.pfg_username || '');
      setPfgLoginPassword(creds?.pfg_password || '');
      setPfgDeliverySchedule(creds?.delivery_schedule || []);
    }
  }, [pfgIntegration]);

  useEffect(() => {
    if (paIntegration) {
      const creds = paIntegration.credentials as any;
      setPaCredentials({ username: creds?.username || '', password: creds?.password || '', restaurant_id: creds?.restaurant_id || '' });
      setPaIsActive(paIntegration.is_active);
      setPaDeliverySchedule(creds?.delivery_schedule || []);
    }
  }, [paIntegration]);

  useEffect(() => {
    if (locationKdsData) setKdsLocationId(locationKdsData.fresh_kds_location_id || '');
  }, [locationKdsData]);

  useEffect(() => {
    if (ovationIntegration) {
      setOvationEmail((ovationIntegration as any).cognito_username || '');
      setOvationPassword((ovationIntegration as any).cognito_password || '');
      setOvationCompanyId(ovationIntegration.company_id || '');
    }
  }, [ovationIntegration]);

  useEffect(() => {
    if (ovationMapping) {
      setOvationLocationId(ovationMapping.ovation_location_id || '');
    }
  }, [ovationMapping]);
  // ── Handlers (unchanged logic) ──

  const testPaConnection = async () => {
    if (!paCredentials.username || !paCredentials.password) { toast.error('Please enter username and password'); return; }
    setPaIsTesting(true); setPaTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('produce-alliance-service', { body: { action: 'test', locationId, testCredentials: paCredentials } });
      if (error) throw error;
      if (data?.authenticated) { setPaTestResult('success'); toast.success('Produce Alliance connection successful!'); }
      else { setPaTestResult('error'); toast.error('Authentication failed: ' + (data?.error || 'Invalid credentials')); }
    } catch (error) { setPaTestResult('error'); toast.error('Test failed: ' + (error instanceof Error ? error.message : 'Unknown error')); }
    finally { setPaIsTesting(false); }
  };

  const savePaCredentials = async () => {
    if (!locationId || !paCredentials.username || !paCredentials.password) { toast.error('Please enter username and password'); return; }
    setPaIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('produce-alliance-service', { body: { action: 'save_credentials', locationId, username: paCredentials.username, password: paCredentials.password, restaurantId: paCredentials.restaurant_id || undefined } });
      if (error) throw error;
      if (data?.success) { toast.success('Produce Alliance credentials saved!'); queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'produce_alliance'] }); }
      else { toast.error(data?.error || 'Failed to save credentials'); }
    } catch (error) { toast.error('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error')); }
    finally { setPaIsSaving(false); }
  };

  const savePfgToken = useCallback(async () => {
    if (!locationId || !pfgPastedToken.trim()) return;
    setPfgIsConnecting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pfg-service?action=save_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ locationId, refreshToken: pfgPastedToken.trim() }),
      });
      const data = await resp.json();
      if (data?.success) { toast.success('PFG connected successfully!'); queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] }); setPfgShowTokenInput(false); setPfgPastedToken(''); }
      else { toast.error(data?.error || 'Failed to save PFG token'); }
    } catch (error) { console.error('[PFG] Save token error:', error); toast.error('Failed to save PFG token'); }
    finally { setPfgIsConnecting(false); }
  }, [locationId, pfgPastedToken, queryClient]);

  const savePfgGuideSettings = async () => {
    if (!pfgIntegration) return;
    setPfgIsSavingGuide(true);
    try {
      const existingCreds = (pfgIntegration.credentials as any) || {};
      const updatedCreds = { ...existingCreds, product_list_header_id: pfgOrderGuideId.trim() || null, customer_id: pfgCustomerId.trim() || null };
      const { error } = await supabase.from('location_integrations').update({ credentials: updatedCreds }).eq('id', pfgIntegration.id);
      if (error) throw error;
      toast.success('PFG order guide saved!'); queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] });
    } catch (error) { toast.error('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error')); }
    finally { setPfgIsSavingGuide(false); }
  };

  const fetchPfgGuides = async () => {
    if (!pfgIntegration || !locationId) return;
    setPfgIsFetchingGuides(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pfg-service?action=list_guides`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ locationId }),
        }
      );
      const result = await resp.json();
      if (result?.data?.guides) {
        const guides = result.data.guides.map((g: any) => ({
          id: g.ProductListHeaderId || g.Id || g.id || '',
          name: g.ProductListTitle || g.ProductListName || g.Name || g.ListName || g.Description || 'Unnamed List',
          type: g.ListType || g.ProductListType || g.Type || '',
        }));
        setPfgAvailableGuides(guides);
        // Auto-select the Blaze Bid list
        const blazeBid = guides.find((g: any) => {
          const n = (g.name || '').toUpperCase();
          return n.includes('BLAZE') && n.includes('BID');
        });
        if (blazeBid && !pfgOrderGuideId) {
          setPfgOrderGuideId(blazeBid.id);
          toast.success(`Auto-selected: ${blazeBid.name}`);
        }
        // Auto-set customer ID if returned
        if (result.data.customerId && !pfgCustomerId) {
          setPfgCustomerId(result.data.customerId);
        }
        if (guides.length === 0) toast.info('No product lists found for this account');
      } else {
        toast.error(result?.error || 'Failed to fetch PFG lists');
      }
    } catch (error) {
      toast.error('Failed to fetch lists: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setPfgIsFetchingGuides(false);
    }
  };

  const triggerBackfill = async (integrationId: string) => {
    try {
      setIsSyncing(true); setSyncProgress(0); setSyncStatus("Starting sync...");
      const pollInterval = setInterval(async () => {
        const { data } = await supabase.from('location_integrations').select('backfill_status, backfill_days_completed, backfill_error').eq('id', integrationId).single();
        if (data) {
          const progress = Math.min((data.backfill_days_completed || 0) / 365 * 100, 100);
          setSyncProgress(progress); setSyncStatus(data.backfill_error || `${data.backfill_days_completed || 0}/365 days`);
          if (data.backfill_status === 'completed' || data.backfill_status === 'failed') {
            clearInterval(pollInterval); setIsSyncing(false);
            if (data.backfill_status === 'completed') toast.success("Sales data sync completed!");
            else toast.error("Sync failed: " + (data.backfill_error || "Unknown error"));
            queryClient.invalidateQueries({ queryKey: ['location-integration'] });
          }
        }
      }, 2000);
      supabase.functions.invoke('sales-service', { body: { locationId, daysBack: 365 }, headers: { 'X-Action': 'backfill' } }).then(({ error }) => {
        if (error) { clearInterval(pollInterval); setIsSyncing(false); toast.error("Sync failed: " + error.message); }
      });
      toast.info("Syncing 365 days of sales data...", { duration: 5000 });
    } catch (error) { console.error('[BACKFILL] Failed to trigger:', error); setIsSyncing(false); }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("No location selected");
      const { data: existing } = await supabase.from('location_integrations').select('id, backfill_status').eq('location_id', locationId).eq('integration_type', 'qubeyond').maybeSingle();
      let integrationId: string;
      const isNewIntegration = !existing;
      if (existing) {
        const { error: updateError } = await supabase.from('location_integrations').update({ credentials: JSON.parse(JSON.stringify(credentials)), is_active: isActive }).eq('id', existing.id);
        if (updateError) throw updateError;
        integrationId = existing.id;
      } else {
        const { data: inserted, error: insertError } = await supabase.from('location_integrations').insert({ location_id: locationId, integration_type: 'qubeyond', credentials: JSON.parse(JSON.stringify(credentials)), is_active: isActive }).select('id').single();
        if (insertError) throw insertError;
        integrationId = inserted.id;
      }
      if (isNewIntegration || (existing && existing.backfill_status !== 'completed')) return { integrationId, shouldBackfill: true };
      return { integrationId, shouldBackfill: false };
    },
    onSuccess: (result) => {
      toast.success("Integration settings saved"); queryClient.invalidateQueries({ queryKey: ['location-integration'] });
      if (result?.shouldBackfill && result.integrationId) triggerBackfill(result.integrationId);
    },
    onError: (error) => { toast.error("Failed to save: " + (error instanceof Error ? error.message : "Unknown error")); }
  });

  const testConnection = async () => {
    if (!credentials.username || !credentials.password) { toast.error("Please enter username and password"); return; }
    setIsTesting(true); setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-qubeyond-sales', { body: { locationId, testCredentials: credentials } });
      if (error) throw error;
      if (data?.authenticated) { setTestResult('success'); toast.success("Connection successful!"); }
      else { setTestResult('error'); toast.error("Authentication failed: " + (data?.error || "Invalid credentials")); }
    } catch (error) { setTestResult('error'); toast.error("Test failed: " + (error instanceof Error ? error.message : "Unknown error")); }
    finally { setIsTesting(false); }
  };

  const testPfgConnection = async () => {
    setPfgIsTesting(true); setPfgTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('pfg-service', { body: { locationId, action: 'test' } });
      if (error) throw error;
      if (data?.authenticated) { setPfgTestResult('success'); toast.success("PFG connection active!"); }
      else { setPfgTestResult('error'); toast.error("PFG token expired — please reconnect."); }
    } catch (error) { setPfgTestResult('error'); toast.error("PFG test failed: " + (error instanceof Error ? error.message : "Unknown error")); }
    finally { setPfgIsTesting(false); }
  };

  const savePfgCredentials = async () => {
    if (!locationId || !pfgLoginUsername || !pfgLoginPassword) return;
    setPfgIsSavingCreds(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pfg-service?action=save_pfg_credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ locationId, pfg_username: pfgLoginUsername, pfg_password: pfgLoginPassword }),
      });
      const result = await res.json();
      if (result.success) { toast.success('PFG credentials saved for auto-reconnect!'); queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] }); }
      else { toast.error(result.error || 'Failed to save credentials'); }
    } catch { toast.error('Failed to save PFG credentials'); }
    finally { setPfgIsSavingCreds(false); }
  };

  const testPfgRopc = async () => {
    if (!locationId) return;
    setPfgIsTestingRopc(true); setPfgRopcResult(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pfg-service?action=test_ropc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`, 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ locationId }),
      });
      const result = await res.json();
      if (result.success) { setPfgRopcResult('success'); toast.success('ROPC works! PFG will auto-reconnect when tokens expire.'); queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] }); }
      else { setPfgRopcResult('error'); toast.error(result.message || 'ROPC test failed'); }
    } catch { setPfgRopcResult('error'); toast.error('ROPC test failed'); }
    finally { setPfgIsTestingRopc(false); }
  };

  // ── Derived state ──
  const pfgHasToken = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.refresh_token;
  const pfgUsername = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.username;
  const pfgHasRopcCreds = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.pfg_username;
  const pfgRopcLastSuccess = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.ropc_last_success;
  const pfgRefreshAge = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.refresh_token_updated_at
    ? Math.round((Date.now() - new Date((pfgIntegration.credentials as any).refresh_token_updated_at).getTime()) / 3600000)
    : null;

  const qbConnected = !!integration;
  const pfgConnected = !!pfgHasToken;
  const paConnected = !!paIntegration;
  const kdsConnected = !!locationKdsData?.fresh_kds_location_id;

  return (
    <>
      {/* Card Grid */}
      <div className="grid grid-cols-2 gap-3">
        <IntegrationCard
          title="QuBeyond POS"
          description="Sales & labor data"
          connected={qbConnected}
          connectedLabel={credentials.username ? `${credentials.username}` : 'Connected'}
          isLoading={isLoading}
          onEdit={() => setEditingIntegration('qubeyond')}
        />
        <IntegrationCard
          title="PFG"
          description="Food ordering system"
          connected={pfgConnected}
          connectedLabel={pfgUsername ? `${pfgUsername}` : 'Connected'}
          logo={pfgLogo}
          isLoading={pfgIsLoading}
          onEdit={() => setEditingIntegration('pfg')}
        />
        <IntegrationCard
          title="Produce Alliance"
          description="Produce orders & pricing"
          connected={paConnected}
          connectedLabel={(paIntegration?.credentials as any)?.username || 'Connected'}
          logo={paLogo}
          isLoading={paIsLoading}
          onEdit={() => setEditingIntegration('pa')}
        />
        <IntegrationCard
          title="Fresh KDS"
          description="Ticket times & order stats"
          connected={kdsConnected}
          connectedLabel="Location mapped"
          onEdit={() => setEditingIntegration('kds')}
        />
        <IntegrationCard
          title="OvationUp"
          description="Guest reviews & feedback"
          connected={!!ovationIntegration && !!ovationMapping}
          connectedLabel={ovationEmail || 'Connected'}
          setupLabel="Setup OvationUp"
          onEdit={() => setEditingIntegration('ovation')}
        />
      </div>

      {/* ── QuBeyond Dialog ── */}
      <Dialog open={editingIntegration === 'qubeyond'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> QuBeyond POS
            </DialogTitle>
            <DialogDescription>Configure QuBeyond POS credentials for sales data</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qb-username" className="text-sm">Username</Label>
                <Input id="qb-username" value={credentials.username} onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))} placeholder="QuBeyond username" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qb-password" className="text-sm">Password</Label>
                <div className="relative">
                  <Input id="qb-password" type={showPassword ? "text" : "password"} value={credentials.password} onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))} placeholder="Password" className="h-9 pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qb-location" className="text-sm">Store ID (optional)</Label>
              <Input id="qb-location" value={credentials.location_id || ""} onChange={(e) => setCredentials(prev => ({ ...prev, location_id: e.target.value }))} placeholder="Auto-detected if empty" className="h-9" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Pull Qu Labor %</Label>
                <p className="text-xs text-muted-foreground">Fetch labor data from Real Time Summary</p>
              </div>
              <Switch checked={credentials.pull_labor || false} onCheckedChange={(checked) => setCredentials(prev => ({ ...prev, pull_labor: checked }))} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={testConnection} disabled={isTesting || !credentials.username || !credentials.password}>
                {isTesting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : testResult === 'success' ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : testResult === 'error' ? <X className="h-4 w-4 mr-1.5 text-red-500" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                Test
              </Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
              {integration && (
                <Button size="sm" variant="outline" onClick={() => triggerBackfill(integration.id)} disabled={isSyncing}>
                  {isSyncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                  Sync Sales
                </Button>
              )}
            </div>
            {isSyncing && (
              <div className="space-y-2">
                <Progress value={syncProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">{syncStatus}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PFG Dialog ── */}
      <Dialog open={editingIntegration === 'pfg'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img src={pfgLogo} alt="PFG" className="h-6 w-auto" /> PFG
            </DialogTitle>
            <DialogDescription>Connect to PFG ordering system</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={pfgIsActive} onCheckedChange={setPfgIsActive} />
            </div>

            {pfgHasToken && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-muted-foreground">
                    Connected{pfgUsername ? <> as <span className="font-medium text-foreground">{pfgUsername}</span></> : null}
                  </span>
                </div>
                {pfgRefreshAge !== null && (
                  <p className="text-xs text-muted-foreground">
                    Token refreshed {pfgRefreshAge < 1 ? 'just now' : `${pfgRefreshAge}h ago`}
                    {pfgRefreshAge > 18 && <span className="text-yellow-500 ml-1">⚠ Getting old</span>}
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={testPfgConnection} disabled={pfgIsTesting}>
                  {pfgIsTesting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : pfgTestResult === 'success' ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : pfgTestResult === 'error' ? <X className="h-4 w-4 mr-1.5 text-destructive" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                  Test Connection
                </Button>
              </>
            )}

            {/* Auto-Reconnect Credentials */}
            {pfgHasToken && (
              <div className="border-t pt-3 space-y-3">
                <h5 className="text-sm font-medium">Auto-Reconnect (ROPC)</h5>
                <p className="text-xs text-muted-foreground">Store your PFG login so the system can auto-reconnect when the session expires (~24h).</p>
                {pfgHasRopcCreds && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span>Credentials saved{pfgRopcLastSuccess ? ` · Last ROPC: ${new Date(pfgRopcLastSuccess).toLocaleDateString()}` : ''}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pfg-login-user" className="text-sm">PFG Username</Label>
                    <Input id="pfg-login-user" value={pfgLoginUsername} onChange={(e) => setPfgLoginUsername(e.target.value)} placeholder="your@email.com" className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pfg-login-pass" className="text-sm">PFG Password</Label>
                    <div className="relative">
                      <Input id="pfg-login-pass" type={pfgShowLoginPassword ? "text" : "password"} value={pfgLoginPassword} onChange={(e) => setPfgLoginPassword(e.target.value)} placeholder="••••••••" className="h-9 text-sm pr-10" />
                      <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3" onClick={() => setPfgShowLoginPassword(!pfgShowLoginPassword)}>
                        {pfgShowLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={savePfgCredentials} disabled={pfgIsSavingCreds || !pfgLoginUsername || !pfgLoginPassword}>
                    {pfgIsSavingCreds ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                    Save Credentials
                  </Button>
                  {pfgHasRopcCreds && (
                    <Button size="sm" variant="outline" onClick={testPfgRopc} disabled={pfgIsTestingRopc}>
                      {pfgIsTestingRopc ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : pfgRopcResult === 'success' ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : pfgRopcResult === 'error' ? <X className="h-4 w-4 mr-1.5 text-destructive" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                      Test ROPC
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Order Guide Settings */}
            {pfgHasToken && (
              <Collapsible>
                <div className="border-t pt-3">
                  <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
                    <ChevronDown className="h-4 w-4 transition-transform [&[data-state=open]]:rotate-180" />
                    <span>Bid List / Order Guide</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    {/* Fetch available lists */}
                    <Button size="sm" variant="outline" onClick={fetchPfgGuides} disabled={pfgIsFetchingGuides} className="w-full">
                      {pfgIsFetchingGuides ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                      {pfgAvailableGuides.length > 0 ? 'Refresh Lists' : 'Load Available Lists'}
                    </Button>

                    {/* Dropdown when guides are loaded */}
                    {pfgAvailableGuides.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-sm">Select Product List</Label>
                        <Select
                          value={pfgOrderGuideId}
                          onValueChange={(val) => setPfgOrderGuideId(val)}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Choose a list..." />
                          </SelectTrigger>
                          <SelectContent>
                            {pfgAvailableGuides.map((guide) => (
                              <SelectItem key={guide.id} value={guide.id} className="text-xs">
                                {guide.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Fallback manual entry */}
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <Settings2 className="h-3 w-3" />
                        <span>Manual IDs</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="pfg-guide-id" className="text-xs text-muted-foreground">Product List Header ID</Label>
                            <Input id="pfg-guide-id" value={pfgOrderGuideId} onChange={(e) => setPfgOrderGuideId(e.target.value)} placeholder="e.g., b4680e1a-4815-..." className="h-8 text-xs font-mono" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="pfg-customer-id" className="text-xs text-muted-foreground">Customer ID</Label>
                            <Input id="pfg-customer-id" value={pfgCustomerId} onChange={(e) => setPfgCustomerId(e.target.value)} placeholder="e.g., 73094123-ab82-..." className="h-8 text-xs font-mono" />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <Button size="sm" onClick={savePfgGuideSettings} disabled={pfgIsSavingGuide || !pfgOrderGuideId.trim()}>
                      {pfgIsSavingGuide ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                      Save Guide
                    </Button>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}
            {/* Delivery Schedule */}
            {pfgHasToken && (
              <DeliveryScheduleEditor
                integrationId={pfgIntegration?.id}
                existingCredentials={(pfgIntegration?.credentials as any) || {}}
                schedule={pfgDeliverySchedule}
                onScheduleChange={setPfgDeliverySchedule}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] })}
              />
            )}

            {/* Connect / Reconnect PFG */}
            <div className={pfgHasToken ? "border-t pt-3" : ""}>
              {pfgShowTokenInput ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Use a desktop computer for this step:</p>
                  <p className="text-xs text-muted-foreground">1. Log in at <a href="https://www.customerfirstsolutions.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">customerfirstsolutions.com</a></p>
                  <p className="text-xs text-muted-foreground">2. Press F12 → Application tab → Local Storage</p>
                  <p className="text-xs text-muted-foreground">3. Copy the value from the key containing "refreshToken"</p>
                  <p className="text-xs text-muted-foreground">4. Paste it below:</p>
                  <Input placeholder="Paste refresh token here..." value={pfgPastedToken} onChange={(e) => setPfgPastedToken(e.target.value)} className="text-xs font-mono" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={savePfgToken} disabled={!pfgPastedToken.trim() || pfgIsConnecting} className="flex-1">
                      {pfgIsConnecting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                      Save Token
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setPfgShowTokenInput(false); setPfgPastedToken(''); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button size="sm" onClick={() => setPfgShowTokenInput(true)} className="w-full">
                    <Plug className="h-4 w-4 mr-1.5" />
                    {pfgHasToken ? 'Reconnect to PFG' : 'Connect PFG'}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2 text-center">One-time setup — paste your PFG refresh token</p>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Produce Alliance Dialog ── */}
      <Dialog open={editingIntegration === 'pa'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <img src={paLogo} alt="PA" className="h-6 w-auto" /> Produce Alliance
            </DialogTitle>
            <DialogDescription>Sync produce orders & pricing into inventory</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={paIsActive} onCheckedChange={async (checked) => {
                setPaIsActive(checked);
                if (paIntegration) {
                  try {
                    await supabase.from('location_integrations').update({ is_active: checked }).eq('id', paIntegration.id);
                    toast.success(checked ? 'Produce Alliance enabled' : 'Produce Alliance disabled');
                  } catch { toast.error('Failed to update status'); setPaIsActive(!checked); }
                }
              }} />
            </div>
            {paConnected && (
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-muted-foreground">Connected as <span className="font-medium text-foreground">{(paIntegration?.credentials as any)?.username || 'Unknown'}</span></span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pa-username" className="text-sm">Username</Label>
                <Input id="pa-username" value={paCredentials.username} onChange={(e) => setPaCredentials(prev => ({ ...prev, username: e.target.value }))} placeholder="PA portal username" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pa-password" className="text-sm">Password</Label>
                <div className="relative">
                  <Input id="pa-password" type={paShowPassword ? "text" : "password"} value={paCredentials.password} onChange={(e) => setPaCredentials(prev => ({ ...prev, password: e.target.value }))} placeholder="PA portal password" className="h-9 pr-10" />
                  <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3" onClick={() => setPaShowPassword(!paShowPassword)}>
                    {paShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pa-restaurant-id" className="text-sm">Restaurant ID</Label>
              <div className="flex gap-2">
                <Input id="pa-restaurant-id" value={paCredentials.restaurant_id} readOnly disabled placeholder="Auto-discovered" className="h-9 bg-muted/50" />
                <Button type="button" variant="outline" size="sm" className="h-9 whitespace-nowrap" disabled={paIsDiscovering || !paCredentials.username || !paCredentials.password} onClick={async () => {
                  setPaIsDiscovering(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('produce-alliance-service', { body: { action: 'discover_restaurant_id', username: paCredentials.username, password: paCredentials.password } });
                    if (error) throw error;
                    if (data?.restaurantId) {
                      setPaCredentials(prev => ({ ...prev, restaurant_id: String(data.restaurantId) }));
                      toast.success(`Discovered Restaurant ID: ${data.restaurantId}`);
                    } else {
                      toast.error('Could not discover Restaurant ID');
                    }
                  } catch (e) { toast.error('Discovery failed: ' + (e instanceof Error ? e.message : 'Unknown error')); }
                  finally { setPaIsDiscovering(false); }
                }}>
                  {paIsDiscovering ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Discover'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Auto-discovered from PA portal login</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={testPaConnection} disabled={paIsTesting || !paCredentials.username || !paCredentials.password}>
                {paIsTesting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : paTestResult === 'success' ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : paTestResult === 'error' ? <X className="h-4 w-4 mr-1.5 text-destructive" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                Test
              </Button>
              <Button size="sm" onClick={savePaCredentials} disabled={paIsSaving || !paCredentials.username || !paCredentials.password}>
                {paIsSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
            </div>
            {/* Delivery Schedule */}
            {paConnected && (
              <DeliveryScheduleEditor
                integrationId={paIntegration?.id}
                existingCredentials={(paIntegration?.credentials as any) || {}}
                schedule={paDeliverySchedule}
                onScheduleChange={setPaDeliverySchedule}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pa'] })}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Fresh KDS Dialog ── */}
      <Dialog open={editingIntegration === 'kds'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fresh KDS</DialogTitle>
            <DialogDescription>Display average ticket times on the dashboard</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kds-location-id" className="text-sm">Fresh KDS Location ID</Label>
              <Input id="kds-location-id" value={kdsLocationId} onChange={(e) => setKdsLocationId(e.target.value)} placeholder="e.g., abc123-def456-..." className="h-9" />
              <p className="text-xs text-muted-foreground">The location UUID from your Fresh KDS dashboard</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={async () => {
                if (!locationId || !kdsLocationId.trim()) { toast.error('Please enter a KDS location ID'); return; }
                setKdsIsSaving(true);
                try {
                  const { error } = await supabase.from('locations').update({ fresh_kds_location_id: kdsLocationId.trim() }).eq('id', locationId);
                  if (error) throw error;
                  toast.success('Fresh KDS location ID saved!'); queryClient.invalidateQueries({ queryKey: ['location-kds-id', locationId] });
                } catch (error) { toast.error('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error')); }
                finally { setKdsIsSaving(false); }
              }} disabled={kdsIsSaving || !kdsLocationId.trim()}>
                {kdsIsSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={async () => {
                if (!locationId) return;
                setKdsIsSyncing(true);
                try {
                  const { data, error } = await supabase.functions.invoke('fresh-kds-service', { body: { action: 'sync-ticket-times', locationId } });
                  if (error) throw error;
                  if (data?.needsSetup) toast.error('Please save a KDS location ID first');
                  else if (data?.success) toast.success(`Synced ${data.synced} days of ticket time data`);
                  else toast.error(data?.error || 'Sync failed');
                } catch (error) { toast.error('Sync failed: ' + (error instanceof Error ? error.message : 'Unknown error')); }
                finally { setKdsIsSyncing(false); }
              }} disabled={kdsIsSyncing || !kdsLocationId.trim()}>
                {kdsIsSyncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Sync Now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── OvationUp Dialog ── */}
      <Dialog open={editingIntegration === 'ovation'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> OvationUp
            </DialogTitle>
            <DialogDescription>Login credentials & location mapping for guest reviews</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Brand-level credentials */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Credentials</p>
              <div className="space-y-1.5">
                <Label className="text-sm">Email</Label>
                <Input 
                  value={ovationEmail} 
                  onChange={(e) => setOvationEmail(e.target.value)} 
                  placeholder="jordan@example.com" 
                  className="h-9 text-xs" 
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Password</Label>
                <div className="relative">
                  <Input 
                    value={ovationPassword} 
                    onChange={(e) => setOvationPassword(e.target.value)} 
                    type={ovationShowPassword ? 'text' : 'password'}
                    placeholder="••••••••" 
                    className="h-9 text-xs pr-10" 
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setOvationShowPassword(!ovationShowPassword)}
                  >
                    {ovationShowPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Company ID</Label>
                <Input 
                  value={ovationCompanyId} 
                  onChange={(e) => setOvationCompanyId(e.target.value)} 
                  placeholder="e.g., 6777260a7637ed5bfedb1f2e" 
                  className="h-9 text-xs font-mono" 
                />
                <p className="text-[11px] text-muted-foreground">From the OvationUp leaderboard API request</p>
              </div>
            </div>

            {/* Location mapping */}
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Location Mapping</p>
              <div className="space-y-1.5">
                <Label className="text-sm">OvationUp Location ID</Label>
                <Input 
                  value={ovationLocationId} 
                  onChange={(e) => setOvationLocationId(e.target.value)} 
                  placeholder="e.g., 68f7d2e7e4235de56f8f92fd" 
                  className="h-9 text-xs font-mono" 
                />
                <p className="text-[11px] text-muted-foreground">The location _id from the leaderboard response</p>
              </div>
            </div>

            {/* Test result indicator */}
            {ovationTestResult && (
              <div className={`flex items-center gap-2 text-xs ${ovationTestResult === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                {ovationTestResult === 'success' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                {ovationTestResult === 'success' ? 'Connection verified!' : 'Authentication failed'}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button size="sm" disabled={ovationIsSaving || !ovationEmail || !ovationPassword || !ovationCompanyId} onClick={async () => {
                setOvationIsSaving(true);
                try {
                  if (!ovationBrandId) { toast.error('Could not determine brand'); return; }
                  
                  // Save brand-level credentials
                  const { data: existing } = await supabase
                    .from('ovation_integrations')
                    .select('id')
                    .eq('brand_id', ovationBrandId)
                    .maybeSingle();

                  const updateData = {
                    cognito_username: ovationEmail,
                    cognito_password: ovationPassword,
                    company_id: ovationCompanyId,
                    is_active: true,
                    updated_at: new Date().toISOString(),
                  };

                  if (existing) {
                    const { error } = await supabase.from('ovation_integrations').update(updateData).eq('id', existing.id);
                    if (error) throw error;
                  } else {
                    const { error } = await supabase.from('ovation_integrations').insert({ brand_id: ovationBrandId, ...updateData });
                    if (error) throw error;
                  }

                  // Save location mapping
                  if (ovationLocationId.trim() && locationId) {
                    const { data: existingMapping } = await supabase
                      .from('ovation_location_mappings')
                      .select('id')
                      .eq('location_id', locationId)
                      .maybeSingle();

                    if (existingMapping) {
                      await supabase.from('ovation_location_mappings').update({ ovation_location_id: ovationLocationId }).eq('id', existingMapping.id);
                    } else {
                      await supabase.from('ovation_location_mappings').insert({ location_id: locationId, ovation_location_id: ovationLocationId });
                    }
                  }

                  queryClient.invalidateQueries({ queryKey: ['ovation-integration'] });
                  queryClient.invalidateQueries({ queryKey: ['ovation-mapping'] });
                  queryClient.invalidateQueries({ queryKey: ['ovation-reviews'] });
                  toast.success('OvationUp configuration saved!');
                } catch (error) {
                  toast.error('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error'));
                } finally {
                  setOvationIsSaving(false);
                }
              }}>
                {ovationIsSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
              <Button size="sm" variant="outline" disabled={ovationIsTesting || !ovationEmail || !ovationPassword} onClick={async () => {
                setOvationIsTesting(true);
                setOvationTestResult(null);
                try {
                  const { data, error } = await supabase.functions.invoke('ovation-service', {
                    body: { action: 'test_auth', username: ovationEmail, password: ovationPassword },
                  });
                  if (error) throw error;
                  if (data?.success) { setOvationTestResult('success'); toast.success('OvationUp authentication successful!'); }
                  else { setOvationTestResult('error'); toast.error(data?.error || 'Auth test failed'); }
                } catch (error) {
                  setOvationTestResult('error');
                  toast.error('Test failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
                } finally {
                  setOvationIsTesting(false);
                }
              }}>
                {ovationIsTesting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                Test
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
