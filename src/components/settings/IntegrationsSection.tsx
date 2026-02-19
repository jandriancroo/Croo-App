import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, TestTube, Check, X, Eye, EyeOff, Plug, ChevronDown, RefreshCw } from "lucide-react";
import pfgLogo from "@/assets/pfg-logo.png";
import paLogo from "@/assets/pa-logo.png";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id?: string;
  pull_labor?: boolean;
}

interface IntegrationsSectionProps {
  locationId: string | undefined;
}

export function IntegrationsSection({ locationId }: IntegrationsSectionProps) {
  const queryClient = useQueryClient();
  
  // QuBeyond state
  const [credentials, setCredentials] = useState<QuBeyondCredentials>({
    username: "",
    password: "",
    location_id: "",
    pull_labor: false
  });
  const [isActive, setIsActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // PA (Produce Alliance) state
  const [paCredentials, setPaCredentials] = useState({ username: '', password: '', pa_location_id: '' });
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

  // Fetch existing QuBeyond integration
  const { data: integration, isLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'qubeyond'],
    queryFn: async () => {
      if (!locationId) return null;
      
      const { data, error } = await supabase
        .from('location_integrations')
        .select('*')
        .eq('location_id', locationId)
        .eq('integration_type', 'qubeyond')
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Fetch existing PFG integration
  const { data: pfgIntegration, isLoading: pfgIsLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'pfg'],
    queryFn: async () => {
      if (!locationId) return null;
      
      const { data, error } = await supabase
        .from('location_integrations')
        .select('*')
        .eq('location_id', locationId)
        .eq('integration_type', 'pfg')
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Fetch existing PA integration
  const { data: paIntegration, isLoading: paIsLoading } = useQuery({
    queryKey: ['location-integration', locationId, 'produce_alliance'],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('location_integrations')
        .select('*')
        .eq('location_id', locationId)
        .eq('integration_type', 'produce_alliance')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Update local state when QuBeyond integration data loads
  useEffect(() => {
    if (integration) {
      const creds = integration.credentials as unknown as QuBeyondCredentials;
      setCredentials({
        username: creds?.username || "",
        password: creds?.password || "",
        location_id: creds?.location_id || "",
        pull_labor: creds?.pull_labor || false
      });
      setIsActive(integration.is_active);
    }
  }, [integration]);

  // Update local state when PFG integration data loads
  useEffect(() => {
    if (pfgIntegration) {
      setPfgIsActive(pfgIntegration.is_active);
      const creds = pfgIntegration.credentials as any;
      setPfgOrderGuideId(creds?.product_list_header_id || '');
      setPfgCustomerId(creds?.customer_id || '');
    }
  }, [pfgIntegration]);

  // Update local state when PA integration data loads
  useEffect(() => {
    if (paIntegration) {
      const creds = paIntegration.credentials as any;
      setPaCredentials({
        username: creds?.username || '',
        password: creds?.password || '',
        pa_location_id: creds?.pa_location_id || '',
      });
      setPaIsActive(paIntegration.is_active);
    }
  }, [paIntegration]);

  // PA Test connection
  const testPaConnection = async () => {
    if (!paCredentials.username || !paCredentials.password) {
      toast.error('Please enter username and password');
      return;
    }
    setPaIsTesting(true);
    setPaTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('produce-alliance-service', {
        body: { action: 'test', locationId, testCredentials: paCredentials }
      });
      if (error) throw error;
      if (data?.authenticated) {
        setPaTestResult('success');
        toast.success('Produce Alliance connection successful!');
      } else {
        setPaTestResult('error');
        toast.error('Authentication failed: ' + (data?.error || 'Invalid credentials'));
      }
    } catch (error) {
      setPaTestResult('error');
      toast.error('Test failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setPaIsTesting(false);
    }
  };

  // PA Save credentials
  const savePaCredentials = async () => {
    if (!locationId || !paCredentials.username || !paCredentials.password) {
      toast.error('Please enter username and password');
      return;
    }
    setPaIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('produce-alliance-service', {
        body: { action: 'save_credentials', locationId, username: paCredentials.username, password: paCredentials.password, paLocationId: paCredentials.pa_location_id || undefined }
      });
      if (error) throw error;
      if (data?.success) {
        toast.success('Produce Alliance credentials saved!');
        queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'produce_alliance'] });
      } else {
        toast.error(data?.error || 'Failed to save credentials');
      }
    } catch (error) {
      toast.error('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setPaIsSaving(false);
    }
  };

  // PFG OAuth popup login flow
  // PFG: Save a manually-pasted refresh token
  const savePfgToken = useCallback(async () => {
    if (!locationId || !pfgPastedToken.trim()) return;
    setPfgIsConnecting(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pfg-service?action=save_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            locationId,
            refreshToken: pfgPastedToken.trim(),
          }),
        }
      );

      const data = await resp.json();
      if (data?.success) {
        toast.success('PFG connected successfully!');
        queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] });
        setPfgShowTokenInput(false);
        setPfgPastedToken('');
      } else {
        toast.error(data?.error || 'Failed to save PFG token');
      }
    } catch (error) {
      console.error('[PFG] Save token error:', error);
      toast.error('Failed to save PFG token');
    } finally {
      setPfgIsConnecting(false);
    }
  }, [locationId, pfgPastedToken, queryClient]);

  // Save PFG order guide ID and customer ID
  const savePfgGuideSettings = async () => {
    if (!pfgIntegration) return;
    setPfgIsSavingGuide(true);
    try {
      const existingCreds = (pfgIntegration.credentials as any) || {};
      const updatedCreds = {
        ...existingCreds,
        product_list_header_id: pfgOrderGuideId.trim() || null,
        customer_id: pfgCustomerId.trim() || null,
      };
      const { error } = await supabase
        .from('location_integrations')
        .update({ credentials: updatedCreds })
        .eq('id', pfgIntegration.id);
      if (error) throw error;
      toast.success('PFG order guide saved!');
      queryClient.invalidateQueries({ queryKey: ['location-integration', locationId, 'pfg'] });
    } catch (error) {
      toast.error('Failed to save: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setPfgIsSavingGuide(false);
    }
  };

  // Trigger background backfill of historical sales data
  const triggerBackfill = async (integrationId: string) => {
    try {
      console.log('[BACKFILL] Triggering backfill for integration:', integrationId);
      setIsSyncing(true);
      setSyncProgress(0);
      setSyncStatus("Starting sync...");
      
      // Start polling for progress
      const pollInterval = setInterval(async () => {
        const { data } = await supabase
          .from('location_integrations')
          .select('backfill_status, backfill_days_completed, backfill_error')
          .eq('id', integrationId)
          .single();
        
        if (data) {
          const progress = Math.min((data.backfill_days_completed || 0) / 365 * 100, 100);
          setSyncProgress(progress);
          setSyncStatus(data.backfill_error || `${data.backfill_days_completed || 0}/365 days`);
          
          if (data.backfill_status === 'completed' || data.backfill_status === 'failed') {
            clearInterval(pollInterval);
            setIsSyncing(false);
            if (data.backfill_status === 'completed') {
              toast.success("Sales data sync completed!");
            } else {
              toast.error("Sync failed: " + (data.backfill_error || "Unknown error"));
            }
            queryClient.invalidateQueries({ queryKey: ['location-integration'] });
          }
        }
      }, 2000);
      
      // Fire the backfill via unified sales-service
      supabase.functions.invoke('sales-service', {
        body: { locationId, daysBack: 365 },
        headers: { 'X-Action': 'backfill' }
      }).then(({ error }) => {
        if (error) {
          console.error('[BACKFILL] Background job error:', error);
          clearInterval(pollInterval);
          setIsSyncing(false);
          toast.error("Sync failed: " + error.message);
        }
      });
      
      toast.info("Syncing 365 days of sales data...", { duration: 5000 });
    } catch (error) {
      console.error('[BACKFILL] Failed to trigger:', error);
      setIsSyncing(false);
    }
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("No location selected");
      
      const { data: existing } = await supabase
        .from('location_integrations')
        .select('id, backfill_status')
        .eq('location_id', locationId)
        .eq('integration_type', 'qubeyond')
        .maybeSingle();
      
      let integrationId: string;
      const isNewIntegration = !existing;
      
      if (existing) {
        const { error: updateError } = await supabase
          .from('location_integrations')
          .update({
            credentials: JSON.parse(JSON.stringify(credentials)),
            is_active: isActive
          })
          .eq('id', existing.id);
        if (updateError) throw updateError;
        integrationId = existing.id;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('location_integrations')
          .insert({
            location_id: locationId,
            integration_type: 'qubeyond',
            credentials: JSON.parse(JSON.stringify(credentials)),
            is_active: isActive
          })
          .select('id')
          .single();
        if (insertError) throw insertError;
        integrationId = inserted.id;
      }
      
      // Trigger backfill for new integrations or if never completed
      if (isNewIntegration || (existing && existing.backfill_status !== 'completed')) {
        return { integrationId, shouldBackfill: true };
      }
      return { integrationId, shouldBackfill: false };
    },
    onSuccess: (result) => {
      toast.success("Integration settings saved");
      queryClient.invalidateQueries({ queryKey: ['location-integration'] });
      
      // Trigger backfill if needed
      if (result?.shouldBackfill && result.integrationId) {
        triggerBackfill(result.integrationId);
      }
    },
    onError: (error) => {
      toast.error("Failed to save: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  });

  // QuBeyond Test connection
  const testConnection = async () => {
    if (!credentials.username || !credentials.password) {
      toast.error("Please enter username and password");
      return;
    }
    
    setIsTesting(true);
    setTestResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-qubeyond-sales', {
        body: { 
          locationId: locationId,
          testCredentials: credentials
        }
      });
      
      if (error) throw error;
      
      if (data?.authenticated) {
        setTestResult('success');
        toast.success("Connection successful!");
      } else {
        setTestResult('error');
        toast.error("Authentication failed: " + (data?.error || "Invalid credentials"));
      }
    } catch (error) {
      setTestResult('error');
      toast.error("Test failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setIsTesting(false);
    }
  };

  // PFG Test connection — uses existing saved token
  const testPfgConnection = async () => {
    setPfgIsTesting(true);
    setPfgTestResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('pfg-service', {
        body: { 
          locationId,
          action: 'test'
        }
      });
      
      if (error) throw error;
      
      if (data?.authenticated) {
        setPfgTestResult('success');
        toast.success("PFG connection active!");
      } else {
        setPfgTestResult('error');
        toast.error("PFG token expired — please reconnect.");
      }
    } catch (error) {
      setPfgTestResult('error');
      toast.error("PFG test failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setPfgIsTesting(false);
    }
  };

  const pfgHasToken = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.refresh_token;
  const pfgUsername = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.username;
  const pfgRefreshAge = pfgIntegration?.credentials && (pfgIntegration.credentials as any)?.refresh_token_updated_at
    ? Math.round((Date.now() - new Date((pfgIntegration.credentials as any).refresh_token_updated_at).getTime()) / 3600000)
    : null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plug className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-base">Integrations</CardTitle>
                  <CardDescription className="text-sm">
                    Connect external services like QuBeyond POS, PFG & Produce Alliance
                  </CardDescription>
                </div>
              </div>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-6 pt-0">
            {/* QuBeyond Section */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">QuBeyond POS</h4>
                  <p className="text-sm text-muted-foreground">
                    Display sales data on the dashboard
                  </p>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>

              {isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="qb-username" className="text-sm">Username</Label>
                      <Input
                        id="qb-username"
                        value={credentials.username}
                        onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
                        placeholder="QuBeyond username"
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="qb-password" className="text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="qb-password"
                          type={showPassword ? "text" : "password"}
                          value={credentials.password}
                          onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                          placeholder="QuBeyond password"
                          className="h-9 pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="qb-location" className="text-sm">Store ID (optional)</Label>
                    <Input
                      id="qb-location"
                      value={credentials.location_id || ""}
                      onChange={(e) => setCredentials(prev => ({ ...prev, location_id: e.target.value }))}
                      placeholder="Auto-detected if empty"
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to auto-detect from your account
                    </p>
                  </div>

                  <div className="flex items-center justify-between py-2">
                    <div>
                      <Label className="text-sm">Pull Qu Labor %</Label>
                      <p className="text-xs text-muted-foreground">
                        Fetch labor data from Real Time Summary
                      </p>
                    </div>
                    <Switch
                      checked={credentials.pull_labor || false}
                      onCheckedChange={(checked) => setCredentials(prev => ({ ...prev, pull_labor: checked }))}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testConnection}
                      disabled={isTesting || !credentials.username || !credentials.password}
                    >
                      {isTesting ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : testResult === 'success' ? (
                        <Check className="h-4 w-4 mr-1.5 text-green-500" />
                      ) : testResult === 'error' ? (
                        <X className="h-4 w-4 mr-1.5 text-red-500" />
                      ) : (
                        <TestTube className="h-4 w-4 mr-1.5" />
                      )}
                      Test
                    </Button>
                    
                    <Button
                      size="sm"
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending}
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-1.5" />
                      )}
                      Save
                    </Button>
                    
                    {integration && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => triggerBackfill(integration.id)}
                        disabled={isSyncing}
                      >
                        {isSyncing ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-1.5" />
                        )}
                        Sync Sales
                      </Button>
                    )}
                  </div>
                  
                  {isSyncing && (
                    <div className="space-y-2">
                      <Progress value={syncProgress} className="h-2" />
                      <p className="text-xs text-muted-foreground text-center">
                        {syncStatus}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* PFG Section */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={pfgLogo} alt="PFG" className="h-8 w-auto" />
                  <div>
                    <h4 className="font-medium">PFG (Performance Food Group)</h4>
                    <p className="text-sm text-muted-foreground">
                      Connect to PFG ordering system
                    </p>
                  </div>
                </div>
                <Switch
                  checked={pfgIsActive}
                  onCheckedChange={setPfgIsActive}
                />
              </div>

              {pfgIsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {pfgHasToken ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-muted-foreground">
                          Connected{pfgUsername ? <> as <span className="font-medium text-foreground">{pfgUsername}</span></> : null}
                        </span>
                      </div>
                      {pfgRefreshAge !== null && (
                        <p className="text-xs text-muted-foreground">
                          Token refreshed {pfgRefreshAge < 1 ? 'just now' : `${pfgRefreshAge}h ago`}
                          {pfgRefreshAge > 18 && (
                            <span className="text-yellow-500 ml-1">⚠ Getting old</span>
                          )}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={testPfgConnection}
                          disabled={pfgIsTesting}
                        >
                          {pfgIsTesting ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                          ) : pfgTestResult === 'success' ? (
                            <Check className="h-4 w-4 mr-1.5 text-primary" />
                          ) : pfgTestResult === 'error' ? (
                            <X className="h-4 w-4 mr-1.5 text-destructive" />
                          ) : (
                            <TestTube className="h-4 w-4 mr-1.5" />
                          )}
                          Test Connection
                        </Button>
                      </div>
                      {pfgTestResult === 'error' && (
                        <p className="text-xs text-destructive">
                          Token expired — reconnect below.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {/* Order Guide Settings - only show when connected */}
                  {pfgHasToken && (
                    <div className="border-t pt-3 space-y-3">
                      <h5 className="text-sm font-medium">Order Guide</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="pfg-guide-id" className="text-sm">Product List Header ID</Label>
                          <Input
                            id="pfg-guide-id"
                            value={pfgOrderGuideId}
                            onChange={(e) => setPfgOrderGuideId(e.target.value)}
                            placeholder="e.g., b4680e1a-4815-..."
                            className="h-9 text-xs font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="pfg-customer-id" className="text-sm">Customer ID</Label>
                          <Input
                            id="pfg-customer-id"
                            value={pfgCustomerId}
                            onChange={(e) => setPfgCustomerId(e.target.value)}
                            placeholder="e.g., 73094123-ab82-..."
                            className="h-9 text-xs font-mono"
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={savePfgGuideSettings}
                        disabled={pfgIsSavingGuide}
                      >
                        {pfgIsSavingGuide ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-1.5" />
                        )}
                        Save Guide
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Find these in your PFG portal URL or browser DevTools when viewing an order guide
                      </p>
                    </div>
                  )}

                   <div className={pfgHasToken ? "border-t pt-3" : ""}>
                    {pfgShowTokenInput ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-foreground">Use a desktop computer for this step:</p>
                        <p className="text-xs text-muted-foreground">
                          1. On a laptop/desktop, log in at{' '}
                          <a href="https://www.customerfirstsolutions.com" target="_blank" rel="noopener noreferrer" className="underline text-primary">
                            customerfirstsolutions.com
                          </a>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          2. Press F12 → Application tab → Local Storage
                        </p>
                        <p className="text-xs text-muted-foreground">
                          3. Copy the value from the key containing "refreshToken"
                        </p>
                        <p className="text-xs text-muted-foreground">
                          4. Paste it below (you can do this step from your phone):
                        </p>
                        <Input
                          placeholder="Paste refresh token here..."
                          value={pfgPastedToken}
                          onChange={(e) => setPfgPastedToken(e.target.value)}
                          className="text-xs font-mono"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={savePfgToken}
                            disabled={!pfgPastedToken.trim() || pfgIsConnecting}
                            className="flex-1"
                          >
                            {pfgIsConnecting ? (
                              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4 mr-1.5" />
                            )}
                            Save Token
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setPfgShowTokenInput(false); setPfgPastedToken(''); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => setPfgShowTokenInput(true)}
                          className="w-full"
                        >
                          <Plug className="h-4 w-4 mr-1.5" />
                          {pfgHasToken ? 'Reconnect to PFG' : 'Connect PFG'}
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          One-time setup — paste your PFG refresh token
                        </p>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Produce Alliance Section */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={paLogo} alt="Produce Alliance" className="h-8 w-auto" />
                  <div>
                    <h4 className="font-medium">Produce Alliance</h4>
                    <p className="text-sm text-muted-foreground">
                      Sync produce orders & pricing into inventory
                    </p>
                  </div>
                </div>
                <Switch
                  checked={paIsActive}
                  onCheckedChange={async (checked) => {
                    setPaIsActive(checked);
                    if (paIntegration) {
                      try {
                        await supabase
                          .from('location_integrations')
                          .update({ is_active: checked })
                          .eq('id', paIntegration.id);
                        toast.success(checked ? 'Produce Alliance enabled' : 'Produce Alliance disabled');
                      } catch (err) {
                        toast.error('Failed to update status');
                        setPaIsActive(!checked);
                      }
                    }
                  }}
                />
              </div>

              {paIsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {paIntegration ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-muted-foreground">
                          Connected as <span className="font-medium text-foreground">{(paIntegration.credentials as any)?.username || 'Unknown'}</span>
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pa-username" className="text-sm">Username</Label>
                      <Input
                        id="pa-username"
                        value={paCredentials.username}
                        onChange={(e) => setPaCredentials(prev => ({ ...prev, username: e.target.value }))}
                        placeholder="PA portal username"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pa-password" className="text-sm">Password</Label>
                      <div className="relative">
                        <Input
                          id="pa-password"
                          type={paShowPassword ? "text" : "password"}
                          value={paCredentials.password}
                          onChange={(e) => setPaCredentials(prev => ({ ...prev, password: e.target.value }))}
                          placeholder="PA portal password"
                          className="h-9 pr-10"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setPaShowPassword(!paShowPassword)}
                        >
                          {paShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="pa-location-id" className="text-sm">PA Location ID</Label>
                    <Input
                      id="pa-location-id"
                      value={paCredentials.pa_location_id}
                      onChange={(e) => setPaCredentials(prev => ({ ...prev, pa_location_id: e.target.value }))}
                      placeholder="e.g., 18046"
                      className="h-9"
                    />
                    <p className="text-xs text-muted-foreground">
                      Your Produce Alliance location/store ID (check your PA portal URL)
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testPaConnection}
                      disabled={paIsTesting || !paCredentials.username || !paCredentials.password}
                    >
                      {paIsTesting ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : paTestResult === 'success' ? (
                        <Check className="h-4 w-4 mr-1.5 text-primary" />
                      ) : paTestResult === 'error' ? (
                        <X className="h-4 w-4 mr-1.5 text-destructive" />
                      ) : (
                        <TestTube className="h-4 w-4 mr-1.5" />
                      )}
                      Test
                    </Button>

                    <Button
                      size="sm"
                      onClick={savePaCredentials}
                      disabled={paIsSaving || !paCredentials.username || !paCredentials.password}
                    >
                      {paIsSaving ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-1.5" />
                      )}
                      Save
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Enter your Produce Alliance portal credentials to enable automatic inventory sync
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
