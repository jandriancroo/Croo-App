import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ClipboardList, Settings, TrendingDown, Package, MapPin, Pencil, Eye, Trash2, DollarSign, Upload, Rocket } from "lucide-react";
import DailySpotCount from "@/components/inventory/DailySpotCount";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useInventoryPermissions } from "@/hooks/useInventoryPermissions";
import InventoryItemsManager from "@/components/inventory/InventoryItemsManager";
import InventoryVarianceReport from "@/components/inventory/InventoryVarianceReport";
import StartCountDialog from "@/components/inventory/StartCountDialog";
import DeleteCountDialog from "@/components/inventory/DeleteCountDialog";
import ExportToMasterDialog from "@/components/inventory/ExportToMasterDialog";
import DeployToLocationDialog from "@/components/inventory/DeployToLocationDialog";

const Inventory = () => {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isAdmin, role } = useUserRole();
  const { hasPermission } = useRolePermissions();
  const { canDeploy, isBrandLevel } = useInventoryPermissions();
  const canAccessInventory = isAdmin || hasPermission('manage_inventory');
  const [activeTab, setActiveTab] = useState("count");
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [countToDelete, setCountToDelete] = useState<{ id: string; period: string } | null>(null);
  const [showExportMaster, setShowExportMaster] = useState(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);

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

  // Get brand ID for this location
  const { data: brandInfo } = useQuery({
    queryKey: ["location-brand", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("organization_id, organizations(brand_id)")
        .eq("id", locationId)
        .single();
      if (error) throw error;
      return (data?.organizations as any)?.brand_id as string | null;
    },
    enabled: !!locationId,
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

  // Fetch recent counts with stats
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
      if (!data || data.length === 0) return [];

      // Fetch total active items for this location
      const { count: totalActiveItems } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true)
        .neq("user_hidden", true);

      const totalItems = totalActiveItems || 0;

      // Fetch stats for all counts in parallel
      const countIds = data.map(c => c.id);
      const { data: countItems } = await supabase
        .from("inventory_count_items")
        .select("count_id, quantity, item_id")
        .in("count_id", countIds);

      // Get unique item IDs for cost lookup
      const itemIds = [...new Set((countItems || []).map(ci => ci.item_id))];
      let costMap: Record<string, number> = {};
      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from("inventory_items")
          .select("id, cost_per_unit")
          .in("id", itemIds);
        costMap = Object.fromEntries((items || []).map(i => [i.id, i.cost_per_unit || 0]));
      }

      // Aggregate stats per count
      const statsMap: Record<string, { totalItems: number; countedItems: number; totalCost: number }> = {};
      for (const ci of (countItems || [])) {
        if (!statsMap[ci.count_id]) statsMap[ci.count_id] = { totalItems, countedItems: 0, totalCost: 0 };
        if (ci.quantity > 0) {
          statsMap[ci.count_id].countedItems++;
          statsMap[ci.count_id].totalCost += ci.quantity * (costMap[ci.item_id] || 0);
        }
      }

      // Ensure all counts have stats even if no count items yet
      return data.map(c => ({ ...c, _stats: statsMap[c.id] || { totalItems, countedItems: 0, totalCost: 0 } }));
    },
    enabled: !!locationId
  });

  // Start new count mutation — resumes existing in-progress count for the same period if one exists
  const startCountMutation = useMutation({
    mutationFn: async ({ periodType, periodEndDate }: { periodType: string | null; periodEndDate: string | null }) => {
      // Check for existing in-progress count with the same period
      let query = supabase
        .from("inventory_counts")
        .select("*")
        .eq("location_id", locationId)
        .eq("status", "in_progress");

      if (periodType && periodEndDate) {
        query = query.eq("period_type", periodType).eq("period_end_date", periodEndDate);
      } else {
        // Ad-hoc: match by today's date with no period
        query = query.is("period_type", null).eq("count_date", new Date().toISOString().split("T")[0]);
      }

      const { data: existing } = await query.order("started_at", { ascending: false }).limit(1).maybeSingle();

      if (existing) {
        // Resume the existing session instead of creating a duplicate
        return existing;
      }

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

  if (!canAccessInventory) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  return (
    <Layout>
      <div className="space-y-4">
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
          {brandInfo && isBrandLevel && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowExportMaster(true)}>
                <Upload className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Export</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowDeployDialog(true)}>
                <Rocket className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Deploy</span>
              </Button>
            </div>
          )}
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
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Start Inventory Count</h3>
                    <p className="text-muted-foreground text-xs">Select a period and begin counting</p>
                  </div>
                </div>
                <Button size="sm" onClick={handleStartCount}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Start Count
                </Button>
              </CardContent>
            </Card>

            {/* Daily Spot Check */}
            <DailySpotCount locationId={locationId!} />

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
                            {count._stats && count._stats.totalItems > 0 && (
                              <div className="flex items-center gap-3 mt-1.5">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Package className="h-3 w-3" />
                                  <span>{count._stats.countedItems}/{count._stats.totalItems}</span>
                                  <span className="text-muted-foreground/60">
                                    ({Math.round((count._stats.countedItems / count._stats.totalItems) * 100)}%)
                                  </span>
                                </div>
                                {count._stats.totalCost > 0 && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <DollarSign className="h-3 w-3" />
                                    <span>${count._stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  </div>
                                )}
                              </div>
                            )}
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

      {brandInfo && (
        <>
          <ExportToMasterDialog
            open={showExportMaster}
            onOpenChange={setShowExportMaster}
            locationId={locationId!}
            brandId={brandInfo}
          />
          <DeployToLocationDialog
            open={showDeployDialog}
            onOpenChange={setShowDeployDialog}
            brandId={brandInfo}
            sourceLocationId={locationId!}
          />
        </>
      )}
    </Layout>
  );
};

export default Inventory;