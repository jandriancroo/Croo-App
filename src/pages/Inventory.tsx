import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Settings, Package, MapPin, DollarSign, Upload, Rocket } from "lucide-react";
import InventoryCountTab from "@/components/inventory/InventoryCountTab";
import { format, addDays } from "date-fns";
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

  // Group recent counts into Month → Week → Quick hierarchy
  const groupedCounts = useMemo(() => {
    if (!recentCounts || recentCounts.length === 0) return [];

    const weeklyCounts = recentCounts.filter(c => c.period_type === 'weekly');
    const quickCounts = recentCounts.filter(c => !c.period_type);
    const monthlyCounts = recentCounts.filter(c => c.period_type === 'monthly');
    const yearlyCounts = recentCounts.filter(c => c.period_type === 'yearly');

    // Collect unique months
    const monthSet = new Map<string, Date>();
    for (const c of recentCounts) {
      const d = new Date((c.period_end_date || c.count_date) + 'T12:00:00');
      const key = format(d, "yyyy-MM");
      if (!monthSet.has(key)) monthSet.set(key, new Date(d.getFullYear(), d.getMonth(), 1));
    }
    const months = [...monthSet.entries()].sort((a, b) => b[1].getTime() - a[1].getTime());

    type CountEntry = 
      | { type: 'month-header'; label: string }
      | { type: 'monthly-count'; count: any }
      | { type: 'yearly-count'; count: any }
      | { type: 'week-header'; label: string; startingInventory?: number; tag?: string }
      | { type: 'weekly-count'; count: any }
      | { type: 'quick-count'; count: any };

    // Calculate current and last week Mondays for tagging
    const now = new Date();
    const jsDay = now.getDay();
    const currentMondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
    const currentWeekMonday = new Date(now);
    currentWeekMonday.setHours(12, 0, 0, 0);
    currentWeekMonday.setDate(now.getDate() + currentMondayOffset);
    const currentWeekKey = format(currentWeekMonday, "yyyy-MM-dd");
    const lastWeekKey = format(addDays(currentWeekMonday, -7), "yyyy-MM-dd");

    const getWeekTag = (mondayKey: string): string | undefined => {
      if (mondayKey === currentWeekKey) return 'Current Week';
      if (mondayKey === lastWeekKey) return 'Last Week';
      return undefined;
    };

    const result: CountEntry[] = [];

    for (const [monthKey, monthStart] of months) {
      result.push({ type: 'month-header', label: format(monthStart, "MMMM yyyy") });

      // Monthly counts in this month
      for (const mc of monthlyCounts.filter(c => format(new Date((c.period_end_date || c.count_date) + 'T12:00:00'), "yyyy-MM") === monthKey)) {
        result.push({ type: 'monthly-count', count: mc });
      }
      for (const yc of yearlyCounts.filter(c => format(new Date((c.period_end_date || c.count_date) + 'T12:00:00'), "yyyy-MM") === monthKey)) {
        result.push({ type: 'yearly-count', count: yc });
      }

      // Build all week containers: from weekly counts + orphan quick counts
      type WeekContainer = {
        mondayKey: string;
        weekStartDate: Date;
        weekEndDate: Date;
        weeklyCount?: any;
        startingInventory?: number;
        quickCounts: any[];
      };

      const weekMap = new Map<string, WeekContainer>();

      // Add weeks from weekly counts
      const weeksInMonth = weeklyCounts
        .filter(c => format(new Date((c.period_end_date || c.count_date) + 'T12:00:00'), "yyyy-MM") === monthKey)
        .sort((a, b) => new Date(b.period_end_date).getTime() - new Date(a.period_end_date).getTime());

      for (let wi = 0; wi < weeksInMonth.length; wi++) {
        const weekCount = weeksInMonth[wi];
        const countDate = new Date(weekCount.period_end_date + 'T12:00:00');
        const wEnd = countDate;                // period_end_date is already the week end (Sunday)
        const wStart = addDays(countDate, -6); // Monday
        const mKey = format(wStart, "yyyy-MM-dd");

        // Starting inventory from prior week's ending cost
        let startingInventory: number | undefined;
        const priorWeek = weeksInMonth[wi + 1];
        if (priorWeek?.status === 'completed' && priorWeek._stats?.totalCost > 0) {
          startingInventory = priorWeek._stats.totalCost;
        } else if (!priorWeek) {
          const prior = weeklyCounts
            .filter(c => new Date(c.period_end_date) < wStart && c.status === 'completed')
            .sort((a, b) => new Date(b.period_end_date).getTime() - new Date(a.period_end_date).getTime())[0];
          if (prior?._stats?.totalCost > 0) startingInventory = prior._stats.totalCost;
        }

        const container: WeekContainer = {
          mondayKey: mKey,
          weekStartDate: wStart,
          weekEndDate: wEnd,
          weeklyCount: weekCount,
          startingInventory,
          quickCounts: [],
        };

        // Attach quick counts within this Mon-Sun range
        quickCounts
          .filter(c => {
            const d = new Date(c.count_date + 'T12:00:00');
            return d >= wStart && d <= wEnd;
          })
          .sort((a, b) => new Date(b.count_date).getTime() - new Date(a.count_date).getTime())
          .forEach(qc => container.quickCounts.push(qc));

        weekMap.set(mKey, container);
      }

      // Find orphan quick counts and create implied week containers
      const existingRanges = [...weekMap.values()];
      const orphanQuicks = quickCounts.filter(c => {
        const d = new Date(c.count_date + 'T12:00:00');
        if (format(d, "yyyy-MM") !== monthKey) return false;
        return !existingRanges.some(r => d >= r.weekStartDate && d <= r.weekEndDate);
      });

      for (const qc of orphanQuicks) {
        const d = new Date(qc.count_date + 'T12:00:00');
        const day = d.getDay();
        const monOff = day === 0 ? -6 : 1 - day;
        const mon = addDays(d, monOff);
        const mKey = format(mon, "yyyy-MM-dd");
        if (!weekMap.has(mKey)) {
          weekMap.set(mKey, {
            mondayKey: mKey,
            weekStartDate: mon,
            weekEndDate: addDays(mon, 6),
            quickCounts: [],
          });
        }
        weekMap.get(mKey)!.quickCounts.push(qc);
      }

      // Sort all weeks descending (most recent first)
      const allWeeks = [...weekMap.values()].sort((a, b) =>
        b.weekStartDate.getTime() - a.weekStartDate.getTime()
      );

      for (const week of allWeeks) {
        result.push({
          type: 'week-header',
          label: `${format(week.weekStartDate, "MMM d")} – ${format(week.weekEndDate, "MMM d, yyyy")}`,
          startingInventory: week.startingInventory,
          tag: getWeekTag(week.mondayKey),
        });
        if (week.weeklyCount) {
          result.push({ type: 'weekly-count', count: week.weeklyCount });
        }
        for (const qc of week.quickCounts) {
          result.push({ type: 'quick-count', count: qc });
        }
      }
    }

    return result;
  }, [recentCounts]);

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