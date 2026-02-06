import { useState, useEffect } from "react";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id?: string;
  pull_labor?: boolean;
}

interface PFGCredentials {
  username: string; // For display purposes only
  refresh_token: string;
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

  // PFG state
  const [pfgCredentials, setPfgCredentials] = useState<PFGCredentials>({
    username: "",
    refresh_token: "",
  });
  const [pfgIsActive, setPfgIsActive] = useState(true);
  const [pfgShowToken, setPfgShowToken] = useState(false);
  const [pfgIsTesting, setPfgIsTesting] = useState(false);
  const [pfgTestResult, setPfgTestResult] = useState<'success' | 'error' | null>(null);

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
      const creds = pfgIntegration.credentials as unknown as PFGCredentials;
      setPfgCredentials({
        username: creds?.username || "",
        refresh_token: creds?.refresh_token || "",
      });
      setPfgIsActive(pfgIntegration.is_active);
    }
  }, [pfgIntegration]);

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

  // PFG Save mutation
  const pfgSaveMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("No location selected");
      
      const { data: existing } = await supabase
        .from('location_integrations')
        .select('id')
        .eq('location_id', locationId)
        .eq('integration_type', 'pfg')
        .maybeSingle();
      
      if (existing) {
        const { error: updateError } = await supabase
          .from('location_integrations')
          .update({
            credentials: JSON.parse(JSON.stringify(pfgCredentials)),
            is_active: pfgIsActive
          })
          .eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('location_integrations')
          .insert({
            location_id: locationId,
            integration_type: 'pfg',
            credentials: JSON.parse(JSON.stringify(pfgCredentials)),
            is_active: pfgIsActive
          });
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      toast.success("PFG settings saved");
      queryClient.invalidateQueries({ queryKey: ['location-integration'] });
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

  // PFG Test connection
  const testPfgConnection = async () => {
    if (!pfgCredentials.refresh_token) {
      toast.error("Please enter PFG refresh token");
      return;
    }
    
    setPfgIsTesting(true);
    setPfgTestResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-pfg-orders', {
        body: { 
          locationId: locationId,
          testCredentials: pfgCredentials,
          action: 'test'
        }
      });
      
      if (error) throw error;
      
      if (data?.authenticated) {
        setPfgTestResult('success');
        toast.success("PFG connection successful!");
      } else {
        setPfgTestResult('error');
        toast.error("PFG authentication failed: " + (data?.error || "Invalid credentials"));
      }
    } catch (error) {
      setPfgTestResult('error');
      toast.error("PFG test failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setPfgIsTesting(false);
    }
  };

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
                    Connect external services like QuBeyond POS and PFG
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
                <div>
                  <h4 className="font-medium">PFG (Performance Food Group)</h4>
                  <p className="text-sm text-muted-foreground">
                    Connect to PFG ordering system
                  </p>
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
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pfg-username" className="text-sm">PFG Account (optional)</Label>
                      <Input
                        id="pfg-username"
                        type="email"
                        value={pfgCredentials.username}
                        onChange={(e) => setPfgCredentials(prev => ({ ...prev, username: e.target.value }))}
                        placeholder="your@email.com (for reference only)"
                        className="h-9"
                      />
                      <p className="text-xs text-muted-foreground">
                        Just for your reference - not used for authentication
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pfg-token" className="text-sm">Refresh Token</Label>
                      <div className="relative">
                        <Input
                          id="pfg-token"
                          type={pfgShowToken ? "text" : "password"}
                          value={pfgCredentials.refresh_token}
                          onChange={(e) => setPfgCredentials(prev => ({ ...prev, refresh_token: e.target.value }))}
                          placeholder="Paste refresh_token from browser DevTools"
                          className="h-9 pr-10 font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3"
                          onClick={() => setPfgShowToken(!pfgShowToken)}
                        >
                          {pfgShowToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Get this from DevTools: Log in to customerfirstsolutions.com → Network tab → find token request → copy refresh_token from response
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testPfgConnection}
                      disabled={pfgIsTesting || !pfgCredentials.refresh_token}
                    >
                      {pfgIsTesting ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : pfgTestResult === 'success' ? (
                        <Check className="h-4 w-4 mr-1.5 text-green-500" />
                      ) : pfgTestResult === 'error' ? (
                        <X className="h-4 w-4 mr-1.5 text-red-500" />
                      ) : (
                        <TestTube className="h-4 w-4 mr-1.5" />
                      )}
                      Test
                    </Button>
                    
                    <Button
                      size="sm"
                      onClick={() => pfgSaveMutation.mutate()}
                      disabled={pfgSaveMutation.isPending}
                    >
                      {pfgSaveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-1.5" />
                      )}
                      Save
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}