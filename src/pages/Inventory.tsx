import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ClipboardList, Settings, TrendingDown, Package, CalendarDays, Calendar, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import InventoryCountSession from "@/components/inventory/InventoryCountSession";
import InventoryItemsManager from "@/components/inventory/InventoryItemsManager";
import InventoryVarianceReport from "@/components/inventory/InventoryVarianceReport";
import StartCountDialog from "@/components/inventory/StartCountDialog";

const Inventory = () => {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("count");
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [showStartDialog, setShowStartDialog] = useState(false);

  // Check for in-progress count
  const { data: inProgressCount } = useQuery({
    queryKey: ["inventory-in-progress", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("*")
        .eq("location_id", locationId)
        .eq("status", "in_progress")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Fetch recent counts
  const { data: recentCounts } = useQuery({
    queryKey: ["inventory-counts", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select(`
          *,
          counted_by_profile:profiles!inventory_counts_counted_by_fkey(full_name)
        `)
        .eq("location_id", locationId)
        .order("count_date", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Start new count mutation
  const startCountMutation = useMutation({
    mutationFn: async ({ periodType, periodEndDate }: { periodType: string | null; periodEndDate: string | null }) => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .insert({
          location_id: locationId,
          counted_by: user?.id,
          count_date: new Date().toISOString().split("T")[0],
          period_type: periodType,
          period_end_date: periodEndDate,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setActiveCountId(data.id);
      setShowStartDialog(false);
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-existing-periods", locationId] });
      toast.success("Count session started");
    },
    onError: () => {
      toast.error("Failed to start count");
    }
  });

  // Set active count if there's one in progress
  if (inProgressCount && !activeCountId) {
    setActiveCountId(inProgressCount.id);
  }

  const handleStartCount = () => {
    if (inProgressCount) {
      setActiveCountId(inProgressCount.id);
    } else {
      setShowStartDialog(true);
    }
  };

  const handleConfirmStart = (periodType: string | null, periodEndDate: string | null) => {
    startCountMutation.mutate({ periodType, periodEndDate });
  };

  // Helper to get period icon
  const getPeriodIcon = (periodType: string | null) => {
    switch (periodType) {
      case "weekly":
        return <CalendarDays className="h-4 w-4" />;
      case "monthly":
        return <Calendar className="h-4 w-4" />;
      case "yearly":
        return <CalendarRange className="h-4 w-4" />;
      default:
        return null;
    }
  };

  // Helper to format period label
  const formatPeriodLabel = (count: any) => {
    if (!count.period_type || !count.period_end_date) {
      return format(new Date(count.count_date), "MMM d, yyyy");
    }
    
    const endDate = new Date(count.period_end_date);
    switch (count.period_type) {
      case "weekly":
        return `Week Ending ${format(endDate, "MMM d, yyyy")}`;
      case "monthly":
        return `${format(endDate, "MMMM yyyy")} Month End`;
      case "yearly":
        return `${format(endDate, "yyyy")} Year End`;
      default:
        return format(new Date(count.count_date), "MMM d, yyyy");
    }
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Inventory</h1>
            <p className="text-muted-foreground">Fast mobile counting</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="count" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              <span className="hidden sm:inline">Count</span>
            </TabsTrigger>
            <TabsTrigger value="variance" className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              <span className="hidden sm:inline">Variance</span>
            </TabsTrigger>
            <TabsTrigger value="items" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Setup</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="count" className="mt-4 space-y-4">
            {activeCountId ? (
              <InventoryCountSession 
                countId={activeCountId} 
                locationId={locationId!}
                onClose={() => {
                  setActiveCountId(null);
                  queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
                  queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
                }}
              />
            ) : (
              <>
                <Card>
                  <CardContent className="p-6">
                    <div className="text-center space-y-4">
                      <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <Package className="h-8 w-8 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">Start Inventory Count</h3>
                        <p className="text-muted-foreground text-sm">
                          {inProgressCount 
                            ? "Resume your in-progress count" 
                            : "Select a period and begin counting"}
                        </p>
                      </div>
                      <Button 
                        size="lg" 
                        onClick={handleStartCount}
                        className="w-full sm:w-auto"
                      >
                        <Plus className="h-5 w-5 mr-2" />
                        {inProgressCount ? "Resume Count" : "Start Count"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {recentCounts && recentCounts.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Recent Counts</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y divide-border">
                        {recentCounts.map((count) => (
                          <div 
                            key={count.id} 
                            className="p-4 flex items-center justify-between hover:bg-muted/50 cursor-pointer"
                            onClick={() => {
                              if (count.status === "in_progress") {
                                setActiveCountId(count.id);
                              } else {
                                navigate(`/inventory/${locationId}/count/${count.id}`);
                              }
                            }}
                          >
                            <div className="flex items-center gap-3">
                              {count.period_type && (
                                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                                  {getPeriodIcon(count.period_type)}
                                </div>
                              )}
                              <div>
                                <p className="font-medium">
                                  {formatPeriodLabel(count)}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {count.counted_by_profile?.full_name || "Unknown"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {count.period_type && (
                                <Badge variant="outline" className="text-xs capitalize">
                                  {count.period_type}
                                </Badge>
                              )}
                              <Badge variant={count.status === "completed" ? "default" : "secondary"}>
                                {count.status === "completed" ? "Complete" : "In Progress"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="variance" className="mt-4">
            <InventoryVarianceReport locationId={locationId!} />
          </TabsContent>

          <TabsContent value="items" className="mt-4">
            <InventoryItemsManager locationId={locationId!} />
          </TabsContent>
        </Tabs>
      </div>

      <StartCountDialog
        open={showStartDialog}
        onOpenChange={setShowStartDialog}
        locationId={locationId!}
        onStartCount={handleConfirmStart}
        isPending={startCountMutation.isPending}
      />
    </Layout>
  );
};

export default Inventory;
