import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ClipboardList, Settings, TrendingDown, Package, MapPin, Pencil, Eye, Trash2, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import InventoryItemsManager from "@/components/inventory/InventoryItemsManager";
import InventoryVarianceReport from "@/components/inventory/InventoryVarianceReport";
import StartCountDialog from "@/components/inventory/StartCountDialog";
import DeleteCountDialog from "@/components/inventory/DeleteCountDialog";

const Inventory = () => {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isAdmin, role } = useUserRole();
  const { hasPermission } = useRolePermissions();
  const canAccessInventory = isAdmin || hasPermission('manage_inventory');
  const [activeTab, setActiveTab] = useState("count");
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [countToDelete, setCountToDelete] = useState<{ id: string; period: string } | null>(null);

  if (!canAccessInventory) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-muted-foreground">You don't have access to inventory management.</p>
        </div>
      </Layout>
    );
  }

  // Fetch location details
  const { data: location } = useQuery({
    queryKey: ["location-details", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, store_number")
        .eq("id", locationId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

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
      setShowStartDialog(false);
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-existing-periods", locationId] });
      toast.success("Count session started");
      // Navigate to the count page
      navigate(`/inventory/${locationId}/count/${data.id}`);
    },
    onError: () => {
      toast.error("Failed to start count");
    }
  });

  // Delete count mutation
  const deleteCountMutation = useMutation({
    mutationFn: async (countId: string) => {
      // First get all count item IDs for this count
      const { data: countItems } = await supabase
        .from("inventory_count_items")
        .select("id")
        .eq("count_id", countId);
      
      const itemIds = countItems?.map(i => i.id) || [];
      
      // Delete edits referencing those count items
      if (itemIds.length > 0) {
        const { error: editsError } = await supabase
          .from("inventory_count_edits")
          .delete()
          .in("count_item_id", itemIds);
        
        if (editsError) throw editsError;
      }
      
      // Delete count items
      const { error: itemsError } = await supabase
        .from("inventory_count_items")
        .delete()
        .eq("count_id", countId);
      
      if (itemsError) throw itemsError;
      
      // Delete the count itself
      const { error: countError } = await supabase
        .from("inventory_counts")
        .delete()
        .eq("id", countId);
      
      if (countError) throw countError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-existing-periods", locationId] });
      toast.success("Inventory count deleted");
      setDeleteDialogOpen(false);
      setCountToDelete(null);
    },
    onError: () => {
      toast.error("Failed to delete count");
    }
  });

  const handleStartCount = () => {
    setShowStartDialog(true);
  };

  const handleConfirmStart = (periodType: string | null, periodEndDate: string | null) => {
    startCountMutation.mutate({ periodType, periodEndDate });
  };

  const handleDeleteClick = (count: any) => {
    const periodLabel = formatPeriodLabel(count);
    setCountToDelete({ id: count.id, period: periodLabel });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (countToDelete) {
      deleteCountMutation.mutate(countToDelete.id);
    }
  };

  // Helper to get indentation level based on period type
  const getIndentLevel = (periodType: string | null) => {
    switch (periodType) {
      case "weekly":
        return "ml-6";
      case "yearly":
        return "ml-6";
      default:
        return ""; // No indent for monthly/daily
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
        {/* Location Header */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <MapPin className="h-4 w-4" />
          <span className="font-medium text-foreground">
            {location?.name || "Loading..."}
          </span>
          {location?.store_number && (
            <Badge variant="outline" className="text-xs">
              #{location.store_number}
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Inventory</h1>
            <p className="text-muted-foreground">Fast mobile counting</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="count" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              <span className="hidden sm:inline">Count</span>
            </TabsTrigger>
            <TabsTrigger value="variance" className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              <span className="hidden sm:inline">Variance</span>
            </TabsTrigger>
            <TabsTrigger value="cogs" className="flex items-center gap-2" onClick={() => navigate(`/inventory/${locationId}/cogs`)}>
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">COGS</span>
            </TabsTrigger>
            <TabsTrigger value="items" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Setup</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="count" className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Package className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Start Inventory Count</h3>
                    <p className="text-muted-foreground text-sm">
                      Select a period and begin counting
                    </p>
                  </div>
                  <Button 
                    size="lg" 
                    onClick={handleStartCount}
                    className="w-full sm:w-auto"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Start Count
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
                        className={`p-4 flex items-center justify-between hover:bg-muted/50 ${getIndentLevel(count.period_type)}`}
                      >
                        <div 
                          className="flex items-center gap-3 flex-1 cursor-pointer min-w-0"
                          onClick={() => navigate(`/inventory/${locationId}/count/${count.id}`)}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              {formatPeriodLabel(count)}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className="text-xs capitalize">
                                {count.period_type || "Quick"}
                              </Badge>
                              <Badge variant={count.status === "completed" ? "default" : "secondary"}>
                                {count.status === "completed" ? "Complete" : "In Progress"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {count.counted_by_profile?.full_name || "Unknown"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {count.status === "completed" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/inventory/${locationId}/count/${count.id}`);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/inventory/${locationId}/count/${count.id}?edit=true`);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(count);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
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

      <DeleteCountDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        isDeleting={deleteCountMutation.isPending}
        countPeriod={countToDelete?.period || ""}
      />
    </Layout>
  );
};

export default Inventory;