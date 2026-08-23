import { useState, useEffect, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { toast } from "sonner";
import { Loader2, Save, TestTube, Check, X, Eye, EyeOff, Plug, RefreshCw, Settings2, ChevronDown, AlertTriangle, Store } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import pfgLogo from "@/assets/pfg-logo.png";
import paLogo from "@/assets/pa-logo.png";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DeliveryScheduleEditor, DeliverySlot } from "./DeliveryScheduleEditor";
import { InventoryAccessCard } from "./InventoryAccessCard";
import AlohaIntegrationCard from "@/components/location/AlohaIntegrationCard";

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id?: string;
  pull_labor?: boolean;
}

interface IntegrationsSectionProps {
  locationId: string | undefined;
}

// Integration card shell — clean minimal design
function IntegrationCard({
  title,
  description,
  connected,
  status,
  logo,
  onEdit,
  isLoading,
}: {
  title: string;
  description: string;
  connected: boolean;
  status?: 'ok' | 'warning' | 'off';
  logo?: string;
  onEdit: () => void;
  isLoading?: boolean;
}) {
  const state = status || (connected ? 'ok' : 'off');
  const trackClass = {
    ok: 'bg-green-500/20 justify-end',
    warning: 'bg-amber-500/20 justify-end',
    off: 'bg-muted justify-start',
  }[state];
  const knobClass = {
    ok: 'bg-green-500',
    warning: 'bg-amber-500',
    off: 'bg-muted-foreground/30',
  }[state];

  return (
    <button
      onClick={onEdit}
      className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 hover:border-border hover:shadow-sm transition-all text-left w-full"
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted/60 shrink-0">
        {logo ? (
          <img src={logo} alt={title} className="h-5 w-auto object-contain" />
        ) : (
          <Plug className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold leading-tight truncate">{title}</h4>
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">{description}</p>
      </div>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
      ) : (
        <div className={`w-8 h-[18px] rounded-full flex items-center px-[3px] transition-colors shrink-0 ${trackClass}`}>
          <div className={`w-3 h-3 rounded-full transition-colors ${knobClass}`} />
        </div>
      )}
    </button>
  );
}

export function IntegrationsSection({ locationId }: IntegrationsSectionProps) {
  const queryClient = useQueryClient();

  // Dialog state
  const [editingIntegration, setEditingIntegration] = useState<'qubeyond' | 'pfg' | 'pa' | 'kds' | 'ovation' | 'opus' | 'clover' | 'aloha' | null>(null);

  // Clover state
  const [cloverApiToken, setCloverApiToken] = useState('');
  const [cloverMerchantId, setCloverMerchantId] = useState('');
  const [cloverEnvironment, setCloverEnvironment] = useState<'production' | 'sandbox'>('production');
  const [cloverIsActive, setCloverIsActive] = useState(true);
  const [cloverShowToken, setCloverShowToken] = useState(false);
  const [cloverIsTesting, setCloverIsTesting] = useState(false);
  const [cloverTestResult, setCloverTestResult] = useState<'success' | 'error' | null>(null);
  const [cloverTestMessage, setCloverTestMessage] = useState<string | null>(null);
  const [cloverIsSaving, setCloverIsSaving] = useState(false);
  const [cloverIsSyncing, setCloverIsSyncing] = useState(false);
  const [cloverSyncResult, setCloverSyncResult] = useState<string | null>(null);

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
  const [pfgDeliverLocations, setPfgDeliverLocations] = useState<{ number: string; name: string; orderCount: number }[]>([]);
  const [pfgIsFetchingStores, setPfgIsFetchingStores] = useState(false);
  const [pfgDeliverTo, setPfgDeliverTo] = useState('');
  const [pfgIsSavingStore, setPfgIsSavingStore] = useState(false);
  const [paDeliverySchedule, setPaDeliverySchedule] = useState<DeliverySlot[]>([]);

  // Fresh KDS state
  const [kdsLocationId, setKdsLocationId] = useState('');
  const [kdsIsActive, setKdsIsActive] = useState(true);
  const [kdsIsSaving, setKdsIsSaving] = useState(false);
  const [kdsIsSyncing, setKdsIsSyncing] = useState(false);

  // OPUS LMS state
  const [opusSessionId, setOpusSessionId] = useState('');
  const [opusIsActive, setOpusIsActive] = useState(true);
  const [opusIsSaving, setOpusIsSaving] = useState(false);
  const [opusIsTesting, setOpusIsTesting] = useState(false);
  const [opusTestResult, setOpusTestResult] = useState<'success' | 'error' | null>(null);
  const [opusIsSyncing, setOpusIsSyncing] = useState(false);
  const [opusShowSession, setOpusShowSession] = useState(false);
  const [opusMappings, setOpusMappings] = useState<Array<{ opus_id: number; name: string; croo_user_id: string }>>([]);
  const [opusIsFetchingEmployees, setOpusIsFetchingEmployees] = useState(false);
  const [opusNewId, setOpusNewId] = useState('');

  // OvationUp state
  const [ovationEmail, setOvationEmail] = useState('');
  const [ovationPassword, setOvationPassword] = useState('');
  const [ovationCompanyId, setOvationCompanyId] = useState('');
  const [ovationLocationId, setOvationLocationId] = useState('');
  const [ovationShowPassword, setOvationShowPassword] = useState(false);
  const [ovationIsActive, setOvationIsActive] = useState(true);
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
      const { data, error } = await supabase.from('locations').select('fresh_kds_location_id, fresh_kds_active').eq('id', locationId).single();
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

  const { data: cloverIntegration, isLoading: cloverIsLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'clover'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('location_integrations').select('*').eq('location_id', locationId).eq('integration_type', 'clover').maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  const { data: alohaIntegration, isLoading: alohaIsLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'aloha'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('location_integrations').select('*').eq('location_id', locationId).eq('integration_type', 'aloha').maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  const { data: opusIntegration } = useQuery({
    queryKey: ['location-integration', locationId, 'opus'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase.from('location_integrations').select('*').eq('location_id', locationId).eq('integration_type', 'opus').maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // OvationUp — prefer locations.brand_id, fall back to org chain
  const { data: ovationBrandId } = useQuery({
    queryKey: ['location-brand-id', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data: loc } = await supabase.from('locations').select('brand_id, organization_id').eq('id', locationId).single();
      if ((loc as any)?.brand_id) return (loc as any).brand_id as string;
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
      setPfgDeliverTo(creds?.deliver_to_customer_number || '');
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
    if (locationKdsData) {
      setKdsLocationId(locationKdsData.fresh_kds_location_id || '');
      setKdsIsActive((locationKdsData as any).fresh_kds_active ?? true);
    }
  }, [locationKdsData]);

  useEffect(() => {
    // Load credentials from per-location mapping first, fall back to brand integration
    if (ovationMapping) {
      setOvationLocationId(ovationMapping.ovation_location_id || '');
      if ((ovationMapping as any).cognito_username) {
        setOvationEmail((ovationMapping as any).cognito_username || '');
        setOvationPassword((ovationMapping as any).cognito_password || '');
        setOvationCompanyId((ovationMapping as any).company_id || '');
      } else if (ovationIntegration) {
        setOvationEmail((ovationIntegration as any).cognito_username || '');
        setOvationPassword((ovationIntegration as any).cognito_password || '');
        setOvationCompanyId(ovationIntegration.company_id || '');
      }
    } else if (ovationIntegration) {
      setOvationEmail((ovationIntegration as any).cognito_username || '');
      setOvationPassword((ovationIntegration as any).cognito_password || '');
      setOvationCompanyId(ovationIntegration.company_id || '');
    }
  }, [ovationMapping, ovationIntegration]);

  // Load OPUS session + mappings from integration
  useEffect(() => {
    if (opusIntegration) {
      const creds = opusIntegration.credentials as any;
      setOpusSessionId(creds?.sessionid || '');
      setOpusMappings(creds?.employee_mappings || []);
      setOpusIsActive(opusIntegration.is_active ?? true);
    }
  }, [opusIntegration]);

  // Load Clover state from integration
  useEffect(() => {
    if (cloverIntegration) {
      const creds = cloverIntegration.credentials as any;
      setCloverApiToken(creds?.api_token || '');
      setCloverMerchantId(creds?.merchant_id || '');
      setCloverEnvironment(creds?.environment || 'production');
      setCloverIsActive(cloverIntegration.is_active ?? true);
    }
  }, [cloverIntegration]);

  const testCloverConnection = async () => {
    if (!cloverApiToken || !cloverMerchantId) {
      toast.error('Enter API token and Merchant ID');
      return;
    }
    setCloverIsTesting(true);
    setCloverTestResult(null);
    setCloverTestMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('clover-service', {
        body: {
          action: 'test',
          apiToken: cloverApiToken.trim(),
          merchantId: cloverMerchantId.trim(),
          environment: cloverEnvironment,
        },
      });
      if (error) throw error;
      if (data?.success) {
        setCloverTestResult('success');
        setCloverTestMessage(`Connected: ${data.merchant?.name || cloverMerchantId}`);
        toast.success(`Clover connected: ${data.merchant?.name || cloverMerchantId}`);
      } else {
        setCloverTestResult('error');
        setCloverTestMessage(data?.error || 'Authentication failed');
        toast.error('Clover test failed: ' + (data?.error || 'invalid credentials'));
      }
    } catch (e) {
      setCloverTestResult('error');
      toast.error('Test failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setCloverIsTesting(false);
    }
  };

  const saveCloverCredentials = async () => {
    if (!locationId || !cloverApiToken || !cloverMerchantId) {
      toast.error('Enter API token and Merchant ID');
      return;
    }
    setCloverIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('clover-service', {
        body: {
          action: 'save',
          locationId,
          apiToken: cloverApiToken.trim(),
          merchantId: cloverMerchantId.trim(),
          environment: cloverEnvironment,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success('Clover credentials saved');
        queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'clover'] });
      } else {
        toast.error(data?.error || 'Failed to save');
      }
    } catch (e) {
      toast.error('Save failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally {
      setCloverIsSaving(false);
    }
  };

  const runCloverSync = async (action: 'sync_today' | 'sync_yesterday') => {
    if (!locationId) return;
    setCloverIsSyncing(true);
    setCloverSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('clover-sync', {
        body: { action, locationId },
      });
      if (error) throw error;
      if (data?.success) {
        const r = data.results?.[0];
        if (r?.error) {
          setCloverSyncResult(`Error: ${r.error}`);
          toast.error(`Clover sync failed: ${r.error}`);
        } else {
          const msg = `${r?.date}: $${(r?.net_sales ?? 0).toFixed(2)} · ${r?.orders ?? 0} orders · ${r?.payments ?? 0} payments`;
          setCloverSyncResult(msg);
          toast.success('Clover sync complete');
        }
      } else {
        setCloverSyncResult(data?.error || 'Sync failed');
        toast.error('Clover sync failed: ' + (data?.error || 'unknown'));
      }
    } catch (e) {
      setCloverSyncResult(e instanceof Error ? e.message : String(e));
      toast.error('Clover sync error: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setCloverIsSyncing(false);
    }
  };

  // Load Ovation active state from brand integration
  useEffect(() => {
    if (ovationIntegration) {
      setOvationIsActive((ovationIntegration as any).is_active ?? true);
    }
  }, [ovationIntegration]);

  // Fetch CrooHQ team members for OPUS mapping dropdown
  const { data: locationTeamMembers } = useQuery({
    queryKey: ['location-team-members', locationId],
    queryFn: async () => {
      if (!locationId) return [];
      // First get user IDs at this location
      const { data: locationUsers } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId);
      if (!locationUsers?.length) return [];
      
      const userIds = locationUsers.map((u: any) => u.user_id);
      // Then fetch their profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', userIds)
        .eq('is_active', true);
      
      return (profiles || []).map((p: any) => ({
        id: p.id,
        name: p.full_name || 'Unknown',
        photo: p.profile_photo_url,
      })).sort((a: any, b: any) => a.name.localeCompare(b.name));
    },
    enabled: !!locationId,
  });
  
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

  const callPfgAction = async (action: string, payload: Record<string, unknown>) => {
    const { data: session } = await supabase.auth.getSession();
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pfg-service?action=${action}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session?.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(payload),
      }
    );
    return await resp.json();
  };

  const fetchPfgStores = async () => {
    if (!locationId) return;
    setPfgIsFetchingStores(true);
    try {
      const result = await callPfgAction('list_delivery_locations', { locationId });
      if (result?.success) {
        setPfgDeliverLocations(result.deliveryLocations || []);
        if (result.currentDeliverTo) setPfgDeliverTo(String(result.currentDeliverTo));
        if (!result.deliveryLocations?.length) toast.info('No stores found on this PFG login yet');
      } else {
        toast.error(result?.error || 'Could not load PFG stores');
      }
    } catch (error) {
      toast.error('Could not load PFG stores');
    } finally {
      setPfgIsFetchingStores(false);
    }
  };

  const savePfgStore = async () => {
    if (!locationId || !pfgDeliverTo) return;
    setPfgIsSavingStore(true);
    try {
      const result = await callPfgAction('set_delivery_location', { locationId, deliverToCustomerNumber: pfgDeliverTo });
      if (result?.success) {
        toast.success('Store assigned to this location');
        queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] });
      } else {
        toast.error(result?.error || 'Could not save store');
      }
    } catch (error) {
      toast.error('Could not save store');
    } finally {
      setPfgIsSavingStore(false);
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
      supabase.functions.invoke('sales-service', { body: { locationId, daysBack: 365 }, headers: { 'X-Action': 'backfill' } }).then(({ data, error }) => {
        if (error) { clearInterval(pollInterval); setIsSyncing(false); toast.error("Sync failed: " + error.message); return; }
        if (data?.status === 'unprovisioned' || data?.error === 'STORE_NOT_PROVISIONED') {
          clearInterval(pollInterval); setIsSyncing(false); setSyncProgress(0);
          setSyncStatus("Store not authorized on QuBeyond's API");
          setAuthStatus({ authorized: false, error: 'STORE_NOT_PROVISIONED' });
          toast.error("QU has not authorized this store on the API client. Contact QuBeyond support.", { duration: 8000 });
        }
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

  const [authStatus, setAuthStatus] = useState<{ authorized: boolean; error: string | null } | null>(null);
  const [isProbingAuth, setIsProbingAuth] = useState(false);

  const testConnection = async () => {
    const storeId = credentials.location_id || ((integration?.credentials as any)?.location_id ?? '');
    if (!storeId) { toast.error("Enter a Store ID first"); return; }
    setIsTesting(true); setTestResult(null); setAuthStatus(null);
    try {
      // Auth uses server-side env vars (QU_USERNAME/QU_PASSWORD); we only need the store ID
      // for the operational-unit probe. Pass any form-entered creds as overrides if present.
      const { data, error } = await supabase.functions.invoke('fetch-qubeyond-sales', {
        body: {
          locationId,
          testCredentials: {
            username: credentials.username || undefined,
            password: credentials.password || undefined,
            location_id: storeId,
            pull_labor: credentials.pull_labor,
          },
        },
      });
      if (error) throw error;
      if (data?.authenticated) {
        if (data?.authorized === false) {
          setTestResult('error');
          setAuthStatus({ authorized: false, error: data.authorizationError || 'STORE_NOT_PROVISIONED' });
          toast.error(
            data.authorizationError === 'STORE_NOT_PROVISIONED'
              ? `Auth OK, but QU has NOT authorized store ${credentials.location_id || ''} on the API client.`
              : `Auth OK, but store probe failed: ${data.authorizationError}`,
            { duration: 8000 }
          );
        } else {
          setTestResult('success');
          setAuthStatus({ authorized: true, error: null });
          toast.success("Connection successful — store authorized on QU side!");
        }
      }
      else { setTestResult('error'); toast.error("Authentication failed: " + (data?.error || "Invalid credentials")); }
    } catch (error) { setTestResult('error'); toast.error("Test failed: " + (error instanceof Error ? error.message : "Unknown error")); }
    finally { setIsTesting(false); }
  };

  // Auto-probe QU authorization whenever a QuBeyond integration exists.
  // This catches stores that authenticate fine but are NOT on the QU API client's
  // operationalUnits allow-list (QU returns 403 "No operational units allowed"),
  // so the integration card can reflect the real status without opening the dialog.
  useEffect(() => {
    if (!integration) return;
    const creds = (integration.credentials as any) || {};
    const storeId = creds.location_id;
    if (!storeId) return;
    let cancelled = false;
    setIsProbingAuth(true);
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('fetch-qubeyond-sales', {
          body: {
            locationId,
            testCredentials: {
              username: creds.username,
              password: creds.password,
              location_id: storeId,
            },
          },
        });
        if (cancelled || !data?.authenticated) return;
        setAuthStatus({ authorized: data.authorized !== false, error: data.authorizationError || null });
      } catch { /* silent — leave previous status or null */ }
      finally { if (!cancelled) setIsProbingAuth(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integration?.id]);






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
  const qbStatus = integration?.is_active
    ? (authStatus?.authorized === false ? 'warning' : 'ok')
    : 'off';
  const pfgConnected = !!pfgHasToken;
  const paConnected = !!paIntegration;
  const kdsConnected = !!locationKdsData?.fresh_kds_location_id && ((locationKdsData as any)?.fresh_kds_active ?? true);

  return (
    <>
      {/* Card Grid */}
      <div className="space-y-2">
        <InventoryAccessCard locationId={locationId} />
        <IntegrationCard
          title="QuBeyond POS"
          description="Sales & labor data"
          connected={qbConnected}
          status={qbStatus as 'ok' | 'warning' | 'off'}
          isLoading={isLoading || isProbingAuth}
          onEdit={() => setEditingIntegration('qubeyond')}
        />
        <IntegrationCard
          title="PFG"
          description="Food ordering system"
          connected={pfgConnected}
          logo={pfgLogo}
          isLoading={pfgIsLoading}
          onEdit={() => setEditingIntegration('pfg')}
        />
        <IntegrationCard
          title="Produce Alliance"
          description="Produce orders & pricing"
          connected={paConnected}
          logo={paLogo}
          isLoading={paIsLoading}
          onEdit={() => setEditingIntegration('pa')}
        />
        {FEATURE_FLAGS.KDS_ENABLED && (
          <IntegrationCard
            title="Fresh KDS"
            description="Ticket times & order stats"
            connected={kdsConnected}
            onEdit={() => setEditingIntegration('kds')}
          />
        )}
        <IntegrationCard
          title="OvationUp"
          description="Guest reviews & feedback"
          connected={!!ovationIntegration && !!ovationMapping && ((ovationIntegration as any)?.is_active ?? true)}
          onEdit={() => setEditingIntegration('ovation')}
        />
        {FEATURE_FLAGS.OPUS_ENABLED && (
          <IntegrationCard
            title="OPUS LMS"
            description="Training & learning modules"
            connected={!!opusIntegration?.is_active}
            onEdit={() => setEditingIntegration('opus')}
          />
        )}
        <IntegrationCard
          title="Clover POS"
          description="Orders & payments (Playa Bowls)"
          connected={!!cloverIntegration?.is_active && !!(cloverIntegration?.credentials as any)?.api_token}
          isLoading={cloverIsLoading}
          onEdit={() => setEditingIntegration('clover')}
        />
        <IntegrationCard
          title="Aloha (BWW GO)"
          description="Sierra Food Group Insight portal — sales & labor"
          connected={!!alohaIntegration?.is_active && !!(alohaIntegration?.credentials as any)?.username}
          isLoading={alohaIsLoading}
          onEdit={() => setEditingIntegration('aloha')}
        />
      </div>

      {/* ── Aloha Dialog ── */}
      <Dialog open={editingIntegration === 'aloha'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> Aloha (BWW GO)
            </DialogTitle>
            <DialogDescription>Sierra Food Group Aloha Insight portal credentials</DialogDescription>
          </DialogHeader>
          {locationId && <AlohaIntegrationCard locationId={locationId} />}
        </DialogContent>
      </Dialog>

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
            {authStatus && !authStatus.authorized && (
              <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-amber-900 dark:text-amber-200">
                    {authStatus.error === 'STORE_NOT_PROVISIONED'
                      ? `Store ${credentials.location_id || ''} is NOT authorized on QuBeyond's API.`
                      : 'QuBeyond rejected the store probe.'}
                  </p>
                  <p className="text-amber-800 dark:text-amber-300">
                    {authStatus.error === 'STORE_NOT_PROVISIONED'
                      ? 'Credentials work, but QU returned 403 "No operational units allowed for the current user". Sync cannot complete until QuBeyond adds this Operational Unit to the API client. Email QU support with the store ID above to enable it.'
                      : authStatus.error}
                  </p>
                </div>
              </div>
            )}
            {authStatus && authStatus.authorized && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                <Check className="h-4 w-4 shrink-0" />
                Store {credentials.location_id || ''} is authorized on QuBeyond's API.
              </div>
            )}
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
              <Button variant="outline" size="sm" onClick={testConnection} disabled={isTesting || !(credentials.location_id || (integration?.credentials as any)?.location_id)}>
                {isTesting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : testResult === 'success' ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : testResult === 'error' ? <X className="h-4 w-4 mr-1.5 text-red-500" /> : <TestTube className="h-4 w-4 mr-1.5" />}
                Test
              </Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
              {integration && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (authStatus && !authStatus.authorized) {
                      toast.error("Cannot sync — store is not authorized on QuBeyond's API. Contact QU support to add this Operational Unit.");
                      return;
                    }
                    triggerBackfill(integration.id);
                  }}
                  disabled={isSyncing || (authStatus ? !authStatus.authorized : false)}
                  title={authStatus && !authStatus.authorized ? 'Blocked: QU has not authorized this store' : undefined}
                >
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
                            {pfgAvailableGuides.filter((g) => g.id).map((guide) => (
                              <SelectItem key={guide.id} value={guide.id} className="text-xs">
                                {guide.name}{guide.type ? ` (${guide.type})` : ''}
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
                        <p className="text-xs text-muted-foreground">If "Load Available Lists" returns empty, find these IDs manually:</p>
                        <p className="text-xs text-muted-foreground">• <strong>Customer ID</strong> → Log in at customerfirstsolutions.com → F12 → Application → Local Storage → copy <code className="bg-muted px-1 rounded">SELECTED_CUSTOMER_ID</code></p>
                        <p className="text-xs text-muted-foreground">• <strong>Product List Header ID</strong> → Navigate to your Order Guide → F12 → Network tab → find a <code className="bg-muted px-1 rounded">SearchProductList</code> request → copy <code className="bg-muted px-1 rounded">ProductListHeaderId</code> from the request body</p>
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

            {/* Which PFG store is this location? */}
            {pfgIntegration && (
              <div className="border-t pt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span>PFG Store</span>
                  </div>
                  {pfgDeliverTo ? (
                    <Badge variant="secondary" className="text-xs">
                      <Check className="h-3 w-3 mr-1 text-green-600" />
                      Store #{pfgDeliverTo}
                      {pfgDeliverLocations.find((s) => s.number === pfgDeliverTo)?.name
                        ? ` · ${pfgDeliverLocations.find((s) => s.number === pfgDeliverTo)!.name}`
                        : ''}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/50">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      All stores (not filtered)
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  If this login can see more than one store, pick the one that belongs to this location so only its orders and invoices come in.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={fetchPfgStores} disabled={pfgIsFetchingStores}>
                    {pfgIsFetchingStores ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                    {pfgDeliverLocations.length > 0 ? 'Refresh Stores' : 'Load Stores'}
                  </Button>
                </div>
                {pfgDeliverLocations.length > 0 && (
                  <div className="flex gap-2">
                    <Select value={pfgDeliverTo} onValueChange={setPfgDeliverTo}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Choose this location's store..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pfgDeliverLocations.map((s) => (
                          <SelectItem key={s.number} value={s.number} className="text-xs">
                            #{s.number} · {s.name} ({s.orderCount} orders)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={savePfgStore} disabled={pfgIsSavingStore || !pfgDeliverTo}>
                      {pfgIsSavingStore ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                      Save
                    </Button>
                  </div>
                )}
              </div>
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
                  <p className="text-xs text-muted-foreground">2. Press F12 → Application tab → <strong>Session Storage</strong> (not Local Storage)</p>
                  <p className="text-xs text-muted-foreground">3. Click the <code className="bg-muted px-1 rounded">customerfirstsolutions.com</code> entry</p>
                  <p className="text-xs text-muted-foreground">4. Find the key containing <code className="bg-muted px-1 rounded">refreshToken</code> and copy its value</p>
                  <p className="text-xs text-muted-foreground">5. Paste it below:</p>
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
            {/* Sync Mode Toggle — mutually exclusive */}
            {paConnected && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-sm font-medium">Sync Source</Label>
                <p className="text-xs text-muted-foreground">
                  Choose where this store's PA data comes from. Stores can't use both at once.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(['orders', 'invoices'] as const).map((mode) => {
                    const current = ((paIntegration?.credentials as any)?.sync_mode || 'orders') as 'orders' | 'invoices';
                    const active = current === mode;
                    return (
                      <Button
                        key={mode}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        onClick={async () => {
                          if (active) return;
                          try {
                            const { data, error } = await supabase.functions.invoke('produce-alliance-service', {
                              body: { action: 'set_sync_mode', locationId, syncMode: mode },
                            });
                            if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed');
                            toast.success(`Sync source set to ${mode === 'orders' ? 'Portal Orders' : 'Portal Invoices'}`);
                            queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'produce_alliance'] });
                          } catch (e: any) {
                            toast.error(e.message || 'Failed to update sync source');
                          }
                        }}
                      >
                        {mode === 'orders' ? 'Portal Orders' : 'Portal Invoices'}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  <strong>Portal Orders</strong> = the standard PA web-order flow. <strong>Portal Invoices</strong> = use when the store orders outside PA (e.g. Worldwide Produce phone/app orders) and invoices land in the PA portal.
                </p>
              </div>
            )}
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
            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch
                checked={kdsIsActive}
                disabled={!locationKdsData?.fresh_kds_location_id}
                onCheckedChange={async (checked) => {
                  if (!locationId) return;
                  setKdsIsActive(checked);
                  try {
                    const { error } = await supabase.from('locations').update({ fresh_kds_active: checked }).eq('id', locationId);
                    if (error) throw error;
                    toast.success(checked ? 'Fresh KDS enabled' : 'Fresh KDS disabled');
                    queryClient.invalidateQueries({ queryKey: ['location-kds-id', locationId] });
                  } catch {
                    toast.error('Failed to update status');
                    setKdsIsActive(!checked);
                  }
                }}
              />
            </div>
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
            <DialogDescription>Per-location login credentials for guest reviews</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {ovationIntegration && (
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={ovationIsActive}
                  onCheckedChange={async (checked) => {
                    if (!ovationIntegration) return;
                    setOvationIsActive(checked);
                    try {
                      const { error } = await supabase.from('ovation_integrations').update({ is_active: checked }).eq('id', ovationIntegration.id);
                      if (error) throw error;
                      toast.success(checked ? 'OvationUp enabled' : 'OvationUp disabled');
                      queryClient.invalidateQueries({ queryKey: ['ovation-integration', ovationBrandId] });
                    } catch {
                      toast.error('Failed to update status');
                      setOvationIsActive(!checked);
                    }
                  }}
                />
              </div>
            )}
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
                  placeholder="Auto-detected on Test" 
                  className="h-9 text-xs font-mono" 
                  readOnly={!!ovationCompanyId}
                />
                <p className="text-[11px] text-muted-foreground">Auto-discovered when you test credentials</p>
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
              <Button size="sm" disabled={ovationIsSaving || !ovationEmail || !ovationPassword} onClick={async () => {
                setOvationIsSaving(true);
                setOvationTestResult(null);
                try {
                  if (!ovationBrandId) { toast.error('Could not determine brand'); return; }

                  // Step 1: Test auth & discover company ID
                  toast.info('Authenticating with OvationUp...');
                  const { data: testData, error: testError } = await supabase.functions.invoke('ovation-service', {
                    body: { action: 'test_auth', username: ovationEmail, password: ovationPassword },
                  });
                  if (testError) throw testError;
                  if (!testData?.success) {
                    setOvationTestResult('error');
                    toast.error(testData?.error || 'Authentication failed');
                    return;
                  }
                  setOvationTestResult('success');

                  // Auto-fill company ID from discovery
                  const discoveredCompanyId = testData.companyId || ovationCompanyId;
                  if (testData.companyId) {
                    setOvationCompanyId(testData.companyId);
                    toast.success(`Connected as ${testData.companyName || testData.companyId}`);
                  }

                  // Step 2: Save credentials to per-location mapping
                  if (!locationId) { toast.error('No location selected'); return; }

                  const mappingData = {
                    cognito_username: ovationEmail,
                    cognito_password: ovationPassword,
                    company_id: discoveredCompanyId,
                    ovation_location_id: ovationLocationId.trim() || 'pending',
                  };

                  const { data: existingMapping } = await supabase
                    .from('ovation_location_mappings')
                    .select('id')
                    .eq('location_id', locationId)
                    .maybeSingle();

                  if (existingMapping) {
                    const { error } = await supabase.from('ovation_location_mappings').update(mappingData).eq('id', existingMapping.id);
                    if (error) throw error;
                  } else {
                    const { error } = await supabase.from('ovation_location_mappings').insert({ location_id: locationId, ...mappingData });
                    if (error) throw error;
                  }

                  // Also keep brand-level integration for backward compat
                  const { data: existing } = await supabase
                    .from('ovation_integrations')
                    .select('id')
                    .eq('brand_id', ovationBrandId)
                    .maybeSingle();

                  const brandData = {
                    company_id: discoveredCompanyId,
                    is_active: true,
                    updated_at: new Date().toISOString(),
                  };

                  if (existing) {
                    const { error } = await supabase.from('ovation_integrations').update(brandData).eq('id', existing.id);
                    if (error) throw error;
                  } else {
                    const { error } = await supabase.from('ovation_integrations').insert({ brand_id: ovationBrandId, ...brandData });
                    if (error) throw error;
                  }

                  // Auto-map location if no ovation location ID provided
                  if (!ovationLocationId.trim()) {
                    try {
                      toast.info('Auto-mapping location...');
                      const { data: mapResult } = await supabase.functions.invoke('ovation-service', {
                        body: { action: 'auto_map_locations', brandId: ovationBrandId },
                      });
                      if (mapResult?.mapped > 0) {
                        toast.success(`Auto-mapped ${mapResult.mapped} location${mapResult.mapped > 1 ? 's' : ''}`);
                        const { data: newMapping } = await supabase
                          .from('ovation_location_mappings')
                          .select('ovation_location_id')
                          .eq('location_id', locationId)
                          .maybeSingle();
                        if (newMapping) setOvationLocationId(newMapping.ovation_location_id);
                      }
                    } catch (e) {
                      console.warn('[ovation] Auto-map failed:', e);
                    }
                  }

                  queryClient.invalidateQueries({ queryKey: ['ovation-integration'] });
                  queryClient.invalidateQueries({ queryKey: ['ovation-mapping'] });
                  queryClient.invalidateQueries({ queryKey: ['ovation-reviews'] });
                  toast.success('OvationUp connected!');
                } catch (error: any) {
                  console.error('[ovation] Connect error:', error);
                  setOvationTestResult('error');
                  const msg = error?.message || error?.error_description || (typeof error === 'string' ? error : JSON.stringify(error));
                  toast.error('Failed: ' + msg);
                } finally {
                  setOvationIsSaving(false);
                }
              }}>
                {ovationIsSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plug className="h-4 w-4 mr-1.5" />}
                {ovationIsSaving ? 'Connecting...' : 'Connect'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── OPUS LMS Dialog ── */}
      <Dialog open={editingIntegration === 'opus'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> OPUS LMS
            </DialogTitle>
            <DialogDescription>Connect OPUS training to sync employee progress</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {opusIntegration && (
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={opusIsActive}
                  onCheckedChange={async (checked) => {
                    if (!opusIntegration) return;
                    setOpusIsActive(checked);
                    try {
                      const { error } = await supabase.from('location_integrations').update({ is_active: checked }).eq('id', opusIntegration.id);
                      if (error) throw error;

                      // When disabling, hide any lingering OPUS quick tasks on the dashboard.
                      // Credentials & mappings stay intact; re-enabling triggers a fresh sync that recreates them.
                      if (!checked && locationId) {
                        await supabase
                          .from('temporary_tasks')
                          .update({ is_active: false, show_on_dashboard: false })
                          .eq('location_id', locationId)
                          .eq('icon_name', 'opus_logo')
                          .is('completed_at', null);
                        // Clear task_id pointers so the next sync recreates fresh tasks
                        await supabase
                          .from('opus_training_modules')
                          .update({ task_id: null })
                          .eq('location_id', locationId);
                      }

                      toast.success(checked ? 'OPUS LMS enabled' : 'OPUS LMS disabled');
                      queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'opus'] });
                      queryClient.invalidateQueries({ queryKey: ['assigned-temp-tasks'] });
                    } catch {
                      toast.error('Failed to update status');
                      setOpusIsActive(!checked);
                    }
                  }}
                />
              </div>
            )}
            {/* Session Cookie Input */}
            <div className="space-y-1.5">
              <Label htmlFor="opus-session" className="text-sm">Session ID (Cookie)</Label>
              <div className="relative">
                <Input
                  id="opus-session"
                  type={opusShowSession ? "text" : "password"}
                  value={opusSessionId}
                  onChange={(e) => setOpusSessionId(e.target.value)}
                  placeholder="Paste sessionid cookie value"
                  className="h-9 pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setOpusShowSession(!opusShowSession)}
                >
                  {opusShowSession ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Log into <a href="https://dashboard.opus.so" target="_blank" rel="noopener" className="underline">dashboard.opus.so</a>, 
                open DevTools → Application → Cookies, copy the <code className="font-mono bg-muted px-1 rounded">sessionid</code> value.
              </p>
            </div>

            {opusTestResult === 'success' && (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <Check className="h-4 w-4" /> Session verified
              </div>
            )}
            {opusTestResult === 'error' && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <X className="h-4 w-4" /> Session invalid or expired
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs flex-1" disabled={!opusSessionId || opusIsTesting}
                onClick={async () => {
                  setOpusIsTesting(true); setOpusTestResult(null);
                  try {
                    const { data, error } = await supabase.functions.invoke('opus-service', {
                      body: { action: 'test_connection', sessionid: opusSessionId },
                    });
                    if (error) throw error;
                    setOpusTestResult(data?.authenticated ? 'success' : 'error');
                    if (data?.authenticated) toast.success('OPUS session verified!');
                    else toast.error('Session invalid: ' + (data?.error || 'Check cookie'));
                  } catch (_e) {
                    setOpusTestResult('error');
                    toast.error('Test failed');
                  } finally { setOpusIsTesting(false); }
                }}>
                {opusIsTesting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <TestTube className="h-3.5 w-3.5 mr-1" />}
                Test
              </Button>
              <Button size="sm" className="h-8 text-xs flex-1" disabled={!opusSessionId || opusIsSaving}
                onClick={async () => {
                  if (!locationId) { toast.error('No location selected'); return; }
                  setOpusIsSaving(true);
                  try {
                    const { data: existing } = await supabase
                      .from('location_integrations')
                      .select('id, credentials')
                      .eq('location_id', locationId)
                      .eq('integration_type', 'opus')
                      .maybeSingle();

                    // Preserve existing mappings when saving session
                    const existingCreds = (existing?.credentials as any) || {};
                    const credentials = {
                      ...existingCreds,
                      sessionid: opusSessionId,
                      employee_mappings: opusMappings.length > 0 ? opusMappings : existingCreds.employee_mappings,
                    };

                    if (existing) {
                      await supabase.from('location_integrations').update({
                        credentials,
                        is_active: true,
                        updated_at: new Date().toISOString(),
                      }).eq('id', existing.id);
                    } else {
                      await supabase.from('location_integrations').insert({
                        location_id: locationId,
                        integration_type: 'opus',
                        credentials,
                        is_active: true,
                      });
                    }

                    queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'opus'] });
                    toast.success('OPUS session saved!');
                  } catch (_e) {
                    toast.error('Save failed');
                  } finally { setOpusIsSaving(false); }
                }}>
                {opusIsSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save
              </Button>
            </div>

            {/* ── Employee Mapping Section ── */}
            {opusIntegration?.is_active && (
              <div className="space-y-3 border-t pt-3">
                <Label className="text-sm font-medium">Employee Mapping</Label>
                
                {/* Auto-Map Button */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full h-9 text-xs font-semibold"
                  disabled={opusIsFetchingEmployees}
                  onClick={async () => {
                    setOpusIsFetchingEmployees(true);
                    try {
                      const { data, error } = await supabase.functions.invoke('opus-service', {
                        body: { action: 'fetch_employees', location_id: locationId },
                      });
                      if (error) throw error;
                      if (!data?.employees?.length) {
                        toast.error('No employees found in OPUS');
                        return;
                      }
                      
                      const team = locationTeamMembers || [];
                      let autoMatched = 0;
                      const newMappings = data.employees.map((emp: any) => {
                        // Try exact name match first, then first+last
                        const match = team.find(
                          (tm: any) => tm.name.toLowerCase() === emp.name.toLowerCase()
                        ) || team.find(
                          (tm: any) => {
                            const parts = tm.name.toLowerCase().split(' ');
                            return parts[0] === emp.firstName?.toLowerCase() && 
                                   parts[parts.length - 1] === emp.lastName?.toLowerCase();
                          }
                        );
                        if (match) autoMatched++;
                        return {
                          opus_id: emp.opus_id,
                          name: emp.name,
                          croo_user_id: match?.id || '',
                        };
                      });
                      
                      setOpusMappings(newMappings);
                      toast.success(`Found ${data.employees.length} employees — ${autoMatched} auto-matched! 🎯`);
                    } catch (_e) {
                      toast.error('Failed to fetch OPUS employees');
                    } finally { setOpusIsFetchingEmployees(false); }
                  }}
                >
                  {opusIsFetchingEmployees ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  {opusMappings.length > 0 ? 'Re-fetch & Auto-Map' : 'Fetch OPUS Employees & Auto-Map'}
                </Button>

                {/* Manual add fallback */}
                <div className="flex gap-2">
                  <Input
                    value={opusNewId}
                    onChange={(e) => setOpusNewId(e.target.value)}
                    placeholder="Or add by OPUS ID"
                    className="h-7 text-[10px] flex-1 font-mono"
                    type="number"
                  />
                  <Button variant="ghost" size="sm" className="h-7 text-[10px] shrink-0" disabled={!opusNewId || opusIsFetchingEmployees}
                    onClick={async () => {
                      const id = Number(opusNewId);
                      if (!id || opusMappings.some(m => m.opus_id === id)) {
                        toast.error(opusMappings.some(m => m.opus_id === id) ? 'Already added' : 'Enter a valid ID');
                        return;
                      }
                      setOpusIsFetchingEmployees(true);
                      try {
                        const { data, error } = await supabase.functions.invoke('opus-service', {
                          body: { action: 'fetch_employees', location_id: locationId, opus_id: id },
                        });
                        if (error) throw error;
                        if (data?.employee) {
                          const match = (locationTeamMembers || []).find(
                            (tm: any) => tm.name.toLowerCase() === data.employee.name.toLowerCase()
                          );
                          setOpusMappings(prev => [...prev, {
                            opus_id: data.employee.opus_id,
                            name: data.employee.name,
                            croo_user_id: match?.id || '',
                          }]);
                          setOpusNewId('');
                          toast.success(`Found: ${data.employee.name}${match ? ' (auto-matched!)' : ''}`);
                        } else {
                          toast.error('Employee not found in OPUS');
                        }
                      } catch (_e) {
                        toast.error('Lookup failed');
                      } finally { setOpusIsFetchingEmployees(false); }
                    }}>
                    <Check className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>

                {opusMappings.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic">
                    No employees mapped yet. Hit the button above to auto-detect!
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {opusMappings.map((mapping, idx) => (
                      <div key={mapping.opus_id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => setOpusMappings(prev => prev.filter(m => m.opus_id !== mapping.opus_id))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{mapping.name}</p>
                          <p className="text-[10px] text-muted-foreground">#{mapping.opus_id}</p>
                        </div>
                        <Select
                          value={mapping.croo_user_id || '__none__'}
                          onValueChange={(val) => {
                            const updated = [...opusMappings];
                            updated[idx] = { ...mapping, croo_user_id: val === '__none__' ? '' : val };
                            setOpusMappings(updated);
                          }}
                        >
                          <SelectTrigger className="h-7 text-[11px] w-[130px]">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__" className="text-[11px]">— Not mapped —</SelectItem>
                            {(locationTeamMembers || []).map((tm: any) => (
                              <SelectItem key={tm.id} value={tm.id} className="text-[11px]">
                                {tm.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}

                {opusMappings.length > 0 && (
                  <Button size="sm" className="w-full h-8 text-xs" disabled={opusIsSaving}
                    onClick={async () => {
                      if (!locationId) return;
                      setOpusIsSaving(true);
                      try {
                        const activeMappings = opusMappings.filter(m => m.croo_user_id);
                        const { data: existing } = await supabase
                          .from('location_integrations')
                          .select('id, credentials')
                          .eq('location_id', locationId)
                          .eq('integration_type', 'opus')
                          .maybeSingle();

                        if (existing) {
                          const creds = (existing.credentials as any) || {};
                          await supabase.from('location_integrations').update({
                            credentials: { ...creds, employee_mappings: activeMappings },
                            updated_at: new Date().toISOString(),
                          }).eq('id', existing.id);
                        }

                        queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'opus'] });
                        toast.success(`Saved ${activeMappings.length} employee mapping${activeMappings.length !== 1 ? 's' : ''}`);
                      } catch (_e) {
                        toast.error('Save failed');
                      } finally { setOpusIsSaving(false); }
                    }}>
                    <Save className="h-3.5 w-3.5 mr-1" />
                    Save Mappings ({opusMappings.filter(m => m.croo_user_id).length} mapped)
                  </Button>
                )}

                {/* Sync Button */}
                <Button variant="outline" size="sm" className="w-full h-8 text-xs" disabled={opusIsSyncing || opusMappings.filter(m => m.croo_user_id).length === 0}
                  onClick={async () => {
                    setOpusIsSyncing(true);
                    try {
                      const { data, error } = await supabase.functions.invoke('opus-service', {
                        body: { action: 'sync_training', location_id: locationId },
                      });
                      if (error) throw error;
                      if (data?.success) {
                        toast.success(`Synced ${data.employees_synced} employees, created ${data.tasks_created} tasks`);
                      } else {
                        toast.error(data?.error || 'Sync failed');
                      }
                    } catch (_e) {
                      toast.error('Sync failed');
                    } finally { setOpusIsSyncing(false); }
                  }}>
                  {opusIsSyncing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                  Sync Training Now
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Clover Dialog ── */}
      <Dialog open={editingIntegration === 'clover'} onOpenChange={(open) => !open && setEditingIntegration(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> Clover POS
            </DialogTitle>
            <DialogDescription>
              Connect a Clover merchant to pull orders & payments. Create an API token in Clover under Setup → API Tokens.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={cloverIsActive} onCheckedChange={setCloverIsActive} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clover-merchant" className="text-sm">Merchant ID</Label>
              <Input
                id="clover-merchant"
                value={cloverMerchantId}
                onChange={(e) => setCloverMerchantId(e.target.value)}
                placeholder="e.g. ABC123XYZ4567"
                className="h-9 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clover-token" className="text-sm">API Token (Private)</Label>
              <div className="relative">
                <Input
                  id="clover-token"
                  type={cloverShowToken ? 'text' : 'password'}
                  value={cloverApiToken}
                  onChange={(e) => setCloverApiToken(e.target.value)}
                  placeholder="Paste the private token from Clover"
                  className="h-9 pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setCloverShowToken((s) => !s)}
                >
                  {cloverShowToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Environment</Label>
              <Select value={cloverEnvironment} onValueChange={(v) => setCloverEnvironment(v as any)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production (api.clover.com)</SelectItem>
                  <SelectItem value="sandbox">Sandbox (apisandbox.dev.clover.com)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {cloverTestMessage && (
              <div className={`text-xs rounded-md p-2 ${cloverTestResult === 'success' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                {cloverTestMessage}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={testCloverConnection}
                disabled={cloverIsTesting || !cloverApiToken || !cloverMerchantId}
              >
                {cloverIsTesting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : cloverTestResult === 'success' ? (
                  <Check className="h-4 w-4 mr-1.5 text-green-500" />
                ) : cloverTestResult === 'error' ? (
                  <X className="h-4 w-4 mr-1.5 text-red-500" />
                ) : (
                  <TestTube className="h-4 w-4 mr-1.5" />
                )}
                Test
              </Button>
              <Button
                size="sm"
                onClick={saveCloverCredentials}
                disabled={cloverIsSaving || !cloverApiToken || !cloverMerchantId}
              >
                {cloverIsSaving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Save
              </Button>
            </div>

            {cloverIntegration && (
              <div className="space-y-2 pt-3 border-t">
                <div className="text-xs font-medium text-muted-foreground">Sync sales from Clover</div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runCloverSync('sync_today')}
                    disabled={cloverIsSyncing}
                  >
                    {cloverIsSyncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                    Sync Today
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runCloverSync('sync_yesterday')}
                    disabled={cloverIsSyncing}
                  >
                    Sync Yesterday
                  </Button>
                </div>
                {cloverSyncResult && (
                  <div className="text-xs rounded-md p-2 bg-muted text-muted-foreground">
                    {cloverSyncResult}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
