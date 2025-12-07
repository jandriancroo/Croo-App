import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, TestTube, Check, X, Eye, EyeOff, Plug } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id: string;
  cid: string;
  sid: string;
}

interface IntegrationsSectionProps {
  locationId: string | undefined;
}

export function IntegrationsSection({ locationId }: IntegrationsSectionProps) {
  const queryClient = useQueryClient();
  
  const [credentials, setCredentials] = useState<QuBeyondCredentials>({
    username: "",
    password: "",
    location_id: "",
    cid: "",
    sid: ""
  });
  const [isActive, setIsActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  // Fetch existing integration
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

  // Update local state when integration data loads
  useEffect(() => {
    if (integration) {
      const creds = integration.credentials as unknown as QuBeyondCredentials;
      setCredentials({
        username: creds?.username || "",
        password: creds?.password || "",
        location_id: creds?.location_id || "",
        cid: creds?.cid || "",
        sid: creds?.sid || ""
      });
      setIsActive(integration.is_active);
    }
  }, [integration]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error("No location selected");
      
      const { data: existing } = await supabase
        .from('location_integrations')
        .select('id')
        .eq('location_id', locationId)
        .eq('integration_type', 'qubeyond')
        .maybeSingle();
      
      if (existing) {
        const { error: updateError } = await supabase
          .from('location_integrations')
          .update({
            credentials: JSON.parse(JSON.stringify(credentials)),
            is_active: isActive
          })
          .eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('location_integrations')
          .insert({
            location_id: locationId,
            integration_type: 'qubeyond',
            credentials: JSON.parse(JSON.stringify(credentials)),
            is_active: isActive
          });
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      toast.success("Integration settings saved");
      queryClient.invalidateQueries({ queryKey: ['location-integration'] });
    },
    onError: (error) => {
      toast.error("Failed to save: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  });

  // Test connection
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>QuBeyond POS Integration</CardTitle>
              <CardDescription>
                Connect to QuBeyond to display sales data on the dashboard
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qb-username">Username</Label>
                <Input
                  id="qb-username"
                  value={credentials.username}
                  onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="QuBeyond username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="qb-password">Password</Label>
                <div className="relative">
                  <Input
                    id="qb-password"
                    type={showPassword ? "text" : "password"}
                    value={credentials.password}
                    onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="QuBeyond password"
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qb-cid">Company ID (CID)</Label>
                <Input
                  id="qb-cid"
                  value={credentials.cid}
                  onChange={(e) => setCredentials(prev => ({ ...prev, cid: e.target.value }))}
                  placeholder="e.g., 123"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="qb-sid">User ID (SID)</Label>
                <Input
                  id="qb-sid"
                  value={credentials.sid}
                  onChange={(e) => setCredentials(prev => ({ ...prev, sid: e.target.value }))}
                  placeholder="e.g., 456"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="qb-location">Location ID</Label>
                <Input
                  id="qb-location"
                  value={credentials.location_id}
                  onChange={(e) => setCredentials(prev => ({ ...prev, location_id: e.target.value }))}
                  placeholder="e.g., 5448"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              CID, SID, and Location ID can be found in your QuBeyond dashboard URL or JWT token
            </p>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={testConnection}
                disabled={isTesting || !credentials.username || !credentials.password}
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : testResult === 'success' ? (
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                ) : testResult === 'error' ? (
                  <X className="h-4 w-4 mr-2 text-red-500" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Test Connection
              </Button>
              
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}