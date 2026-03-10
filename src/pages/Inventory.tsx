import { useState } from "react";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { getTodayInTimezone } from "@/utils/timezoneUtils";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Settings, Package, MapPin, DollarSign, Upload, Rocket } from "lucide-react";
import InventoryCountTab from "@/components/inventory/InventoryCountTab";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useInventoryPermissions } from "@/hooks/useInventoryPermissions";
import InventoryItemsManager from "@/components/inventory/InventoryItemsManager";
import InventoryVarianceReport from "@/components/inventory/InventoryVarianceReport";
import { COGSReportContent } from "@/pages/COGSReport";
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
  const { timezone } = useLocationTimezone();
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

      // Fetch stats for all counts from count_items (source of truth)
      const countIds = data.map(c => c.id);
      const { data: countItems } = await supabase
        .from("inventory_count_items")
        .select("count_id, quantity, item_id")
        .in("count_id", countIds);

      // Get unique item IDs for cost lookup (include pack_quantity_override and is_recipe)
      const itemIds = [...new Set((countItems || []).map(ci => ci.item_id))];
      let costMap: Record<string, number> = {};
      let recipeIds = new Set<string>();
      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from("inventory_items")
          .select("id, cost_per_unit, pack_quantity, pack_quantity_override, is_recipe")
          .in("id", itemIds);
        for (const i of (items || [])) {
          if (i.is_recipe) {
            recipeIds.add(i.id);
          }
          const packQty = i.pack_quantity_override ?? (i.pack_quantity || 1);
          costMap[i.id] = (i.cost_per_unit || 0) / Math.max(packQty, 1);
        }
      }

      // Fetch recipe costs if any recipes exist
      let recipeCostMap: Map<string, number> | null = null;
      if (recipeIds.size > 0 && locationId) {
        const { fetchRecipeCosts } = await import("@/utils/recipeCostCalculation");
        recipeCostMap = await fetchRecipeCosts(locationId);
      }

      // Aggregate stats per count — totalItems = actual count items, not current active items
      const statsMap: Record<string, { totalItems: number; countedItems: number; totalCost: number }> = {};
      for (const ci of (countItems || [])) {
        if (!statsMap[ci.count_id]) statsMap[ci.count_id] = { totalItems: 0, countedItems: 0, totalCost: 0 };
        statsMap[ci.count_id].totalItems++;
        if (ci.quantity > 0) {
          statsMap[ci.count_id].countedItems++;
          // Use recipe batch cost if available, otherwise use normalized unit cost
          const batchCost = recipeCostMap?.get(ci.item_id);
          if (recipeIds.has(ci.item_id) && batchCost && batchCost > 0) {
            statsMap[ci.count_id].totalCost += ci.quantity * batchCost;
          } else {
            statsMap[ci.count_id].totalCost += ci.quantity * (costMap[ci.item_id] || 0);
          }
        }
      }

      // Ensure all counts have stats even if no count items yet
      return data.map(c => ({ ...c, _stats: statsMap[c.id] || { totalItems: 0, countedItems: 0, totalCost: 0 } }));
    },
    enabled: !!locationId
  });

  // Start new count mutation — resumes existing in-progress count for the same period if one exists
  const startCountMutation = useMutation({
    mutationFn: async ({ periodType, periodEndDate, isLateClose, lateCloseNotes }: { periodType: string | null; periodEndDate: string | null; isLateClose?: boolean; lateCloseNotes?: string }) => {
      // Check for existing in-progress count with the same period
      let query = supabase
        .from("inventory_counts")
        .select("*")
        .eq("location_id", locationId)
        .eq("status", "in_progress");

      if (periodType && periodEndDate) {
        query = query.eq("period_type", periodType).eq("period_end_date", periodEndDate);
      } else {
        const todayDate = getTodayInTimezone(timezone);
        query = query.is("period_type", null).eq("count_date", todayDate);
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
          count_date: getTodayInTimezone(timezone),
          period_type: periodType,
          period_end_date: periodEndDate,
          is_late_close: isLateClose || false,
          late_close_notes: lateCloseNotes || null,
        } as any)
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

  const handleConfirmStart = (periodType: string | null, periodEndDate: string | null, isLateClose?: boolean, lateCloseNotes?: string) => {
    startCountMutation.mutate({ periodType, periodEndDate, isLateClose, lateCloseNotes });
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

  // Helper to format period label
  const formatPeriodLabel = (count: any) => {
    if (!count.period_type || !count.period_end_date) {
      return format(new Date(count.count_date + 'T12:00:00'), "MMM d, yyyy");
    }
    
    const endDate = new Date(count.period_end_date + 'T12:00:00');
    switch (count.period_type) {
      case "weekly":
        // period_end_date is already the week-ending date (e.g. Sunday)
        return `Week Ending ${format(endDate, "MMM d, yyyy")}`;
      case "monthly":
        return `${format(endDate, "MMMM yyyy")} Month End`;
      case "yearly":
        return `${format(endDate, "yyyy")} Year End`;
      default:
        return format(new Date(count.count_date + 'T12:00:00'), "MMM d, yyyy");
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
            <TabsTrigger value="cogs-variance" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">COGS</span>
            </TabsTrigger>
            <TabsTrigger value="items" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Items</span>
            </TabsTrigger>
            <TabsTrigger value="setup" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Setup</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="count" className="mt-4">
            <InventoryCountTab
              locationId={locationId!}
              inProgressCount={inProgressCount}
              recentCounts={recentCounts}
              onStartCount={handleStartCount}
              onDeleteCount={handleDeleteClick}
            />
          </TabsContent>

          <TabsContent value="cogs-variance" className="mt-4 space-y-6">
            <COGSReportContent locationId={locationId!} />
            <InventoryVarianceReport locationId={locationId!} />
          </TabsContent>

          <TabsContent value="items" className="mt-4">
            <InventoryItemsManager locationId={locationId!} mode="items" />
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            <InventoryItemsManager locationId={locationId!} mode="setup" />
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