import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Save, TestTube, Check, X, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface QuBeyondCredentials {
  username: string;
  password: string;
  location_id: string; // QuBeyond's internal location ID (e.g., "5448")
}

export default function Integrations() {
  const { currentLocation } = useLocation();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  
  const [credentials, setCredentials] = useState<QuBeyondCredentials>({
    username: "",
    password: "",
    location_id: ""
  });
  const [isActive, setIsActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  // Fetch existing integration
  const { data: integration, isLoading } = useQuery({
    queryKey: ['location-integration', currentLocation?.id, 'qubeyond'],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      
      const { data, error } = await supabase
        .from('location_integrations')
        .select('*')
        .eq('location_id', currentLocation.id)
        .eq('integration_type', 'qubeyond')
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation?.id && isAdmin
  });

  // Update local state when integration data loads
  useEffect(() => {
    if (integration) {
      const creds = integration.credentials as unknown as QuBeyondCredentials;
      setCredentials({
        username: creds?.username || "",
        password: creds?.password || "",
        location_id: creds?.location_id || ""
      });
      setIsActive(integration.is_active);
    }
  }, [integration]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!currentLocation?.id) throw new Error("No location selected");
      
      // Check if integration exists
      const { data: existing } = await supabase
        .from('location_integrations')
        .select('id')
        .eq('location_id', currentLocation.id)
        .eq('integration_type', 'qubeyond')
        .maybeSingle();
      
      if (existing) {
        // Update existing
        const { error: updateError } = await supabase
          .from('location_integrations')
          .update({
            credentials: JSON.parse(JSON.stringify(credentials)),
            is_active: isActive
          })
          .eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        // Insert new
        const { error: insertError } = await supabase
          .from('location_integrations')
          .insert({
            location_id: currentLocation.id,
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
          locationId: currentLocation?.id,
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

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container max-w-2xl py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-muted-foreground">
            Configure external API integrations for {currentLocation?.name}
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>QuBeyond POS</CardTitle>
                <CardDescription>
                  Connect to QuBeyond to display sales data on your dashboard
                </CardDescription>
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
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={credentials.username}
                    onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
                    placeholder="QuBeyond username"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
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

                <div className="space-y-2">
                  <Label htmlFor="location_id">QuBeyond Location ID</Label>
                  <Input
                    id="location_id"
                    value={credentials.location_id}
                    onChange={(e) => setCredentials(prev => ({ ...prev, location_id: e.target.value }))}
                    placeholder="e.g., 5448"
                  />
                  <p className="text-xs text-muted-foreground">
                    The numeric location ID from QuBeyond (found in your QuBeyond dashboard URL)
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
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
      </div>
    </Layout>
  );
}