import { useState, Suspense } from "react";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { getTodayInTimezone } from "@/utils/timezoneUtils";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Settings, Package, MapPin, ArrowLeft, DollarSign, ArrowRightLeft, Plus, FileText, Sparkles } from "lucide-react";
import TransferDialog from "@/components/inventory/TransferDialog";
import { useInventoryTransfers } from "@/hooks/useInventoryTransfers";
import MenuPricingCard from "@/components/inventory/menu-pricing/MenuPricingCard";
import RecipeGeniusCard from "@/components/inventory/menu-pricing/RecipeGeniusCard";
import InventoryCountTab from "@/components/inventory/InventoryCountTab";

import { formatPeriodLabel } from "@/utils/periodLabelUtils";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { useInventoryPermissions } from "@/hooks/useInventoryPermissions";
import InventoryItemsManager from "@/components/inventory/InventoryItemsManager";
import LiteInventoryItemsList from "@/components/inventory/LiteInventoryItemsList";
import LiteInvoicesList from "@/components/inventory/LiteInvoicesList";
import LiteCountTab from "@/components/inventory/LiteCountTab";
import LiteStorageLocationsManager from "@/components/inventory/LiteStorageLocationsManager";
import LiteVendorOrderDaysManager from "@/components/inventory/LiteVendorOrderDaysManager";
import InventoryScheduleSettings from "@/components/inventory/InventoryScheduleSettings";
import GeniusOrderCoachPanel from "@/components/inventory/GeniusOrderCoachPanel";

import SandboxCountsPanel from "@/components/inventory/SandboxCountsPanel";
import { SandboxPostDeployBanner } from "@/components/inventory/SandboxPostDeployBanner";
import { useBrandConversions } from "@/hooks/useBrandConversions";
import { useInventoryMode } from "@/hooks/useInventoryMode";

const StartCountDialog = lazyWithRetry(() => import("@/components/inventory/StartCountDialog"));
import DeleteCountDialog from "@/components/inventory/DeleteCountDialog";


import DailySpotCount from "@/components/inventory/DailySpotCount";



const Inventory = () => {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { hasPermission, loading: permsLoading } = useRolePermissions();
  const { isBrandLevel } = useInventoryPermissions();
  const { timezone } = useLocationTimezone();
  const permissionsLoading = roleLoading || permsLoading;
  const canAccessInventory = isAdmin || hasPermission('manage_inventory');
  const { isLite } = useInventoryMode(locationId);
  const [activeTab, setActiveTab] = useState("count");
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [preselectedPeriod, setPreselectedPeriod] = useState<{ type: string; endDate: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [countToDelete, setCountToDelete] = useState<{ id: string; period: string } | null>(null);
  
  
  
  const [showDailyCount, setShowDailyCount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const { pendingIncoming } = useInventoryTransfers(locationId || "");

  // Fetch location details
  const { data: location } = useQuery({
    queryKey: ["location-details", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, store_number, inventory_enabled")
        .eq("id", locationId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Get brand ID for this location — prefer locations.brand_id, fall back to org chain
  const { data: brandInfo } = useQuery({
    queryKey: ["location-brand", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("brand_id, organization_id, organizations(brand_id)")
        .eq("id", locationId)
        .single();
      if (error) throw error;
      return ((data as any)?.brand_id ?? (data?.organizations as any)?.brand_id ?? null) as string | null;
    },
    enabled: !!locationId,
  });


  const brandId = brandInfo ?? null;
  const { conversionMap } = useBrandConversions(brandId);

  // Check for in-progress count
  const { data: inProgressCount } = useQuery({
    queryKey: ["inventory-in-progress", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("*")
        .eq("location_id", locationId)
        .eq("is_sandbox", false)
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
    queryKey: ["inventory-counts", locationId, conversionMap.size],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select(`
          *,
          counted_by_profile:profiles!inventory_counts_counted_by_fkey(full_name)
        `)
        .eq("location_id", locationId)
        .eq("is_sandbox", false)
        .order("count_date", { ascending: false })
        .limit(500);
      
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Fetch stats for all counts from count_items (source of truth).
      // Paginated to bypass Supabase/PostgREST default 1000-row cap — without this,
      // locations with >~5 counts silently drop rows and counts appear "not started".
      const countIds = data.map(c => c.id);
      const PAGE_SIZE = 1000;
      const countItems: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: pageErr } = await supabase
          .from("inventory_count_items")
          .select("id, count_id, item_id, quantity, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, entered_cases, entered_units, entered_inner_packs")
          .in("count_id", countIds)
          .order("count_id")
          .range(from, from + PAGE_SIZE - 1);
        if (pageErr) throw pageErr;
        if (!page || page.length === 0) break;
        countItems.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      // Get unique item IDs for cost lookup (include inner_pack_quantity + is_recipe)
      const itemIds = [...new Set((countItems || []).map(ci => ci.item_id))];
      const itemMap = new Map<string, any>();
      const recipeIds = new Set<string>();
      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from("inventory_items")
          .select("id, cost_per_unit, pack_quantity, pack_quantity_override, inner_pack_quantity, brand_item_id, is_recipe, unit, recipe_yield_qty, recipe_yield_unit")
          .in("id", itemIds);
        for (const i of (items || [])) {
          if (i.is_recipe) recipeIds.add(i.id);
          itemMap.set(i.id, i);
        }
      }

      // Fetch recipe costs if any recipes exist
      let recipeCostMap: Map<string, number> | null = null;
      if (recipeIds.size > 0 && locationId) {
        const { fetchRecipeCosts } = await import("@/utils/recipeCostCalculation");
        recipeCostMap = await fetchRecipeCosts(locationId);
      }

      const { calculateCountItemValue } = await import("@/utils/countItemValue");
      const { fetchLegsValuationContext, makeGetItemValueWithLegs } = await import("@/hooks/useLegsValuation");

      // Leg context shared with Review / Session / Export — one fetch covers
      // every count in the summary. When legs are off at this location the
      // helper returns empty maps and getItemValueWithLegs cleanly falls
      // through to the canonical parent-row path (no regression).
      const legsCtx = await fetchLegsValuationContext({ locationId: locationId!, countIds });
      const getItemValueWithLegs = makeGetItemValueWithLegs(legsCtx);

      // Aggregate stats per count using the canonical valuation calculator so
      // inner-pack items value identically to PeriodDetailPanel / COGSReport,
      // and multi-config items value identically to the Review screen.
      const statsMap: Record<string, { totalItems: number; countedItems: number; totalCost: number }> = {};
      // Status-by-count map so the recipe live-cost override only fires for
      // in_progress counts; completed counts honor cost_at_count snapshots.
      const statusByCount = new Map<string, string>(
        (data || []).map((c: any) => [c.id, c.status]),
      );
      for (const ci of (countItems || [])) {
        if (!statsMap[ci.count_id]) statsMap[ci.count_id] = { totalItems: 0, countedItems: 0, totalCost: 0 };
        statsMap[ci.count_id].totalItems++;
        if (ci.quantity > 0) {
          statsMap[ci.count_id].countedItems++;
          const item = itemMap.get(ci.item_id);
          // Mirror PeriodDetailPanel exactly: snapshot-honoring + brand conversion.
          // Without the conversion arg, items with a brand_item_id whose
          // canonical_qty_per_inner differs from the local pack chain value
          // differently, drifting the rail vs the COGS card (was ~$302 on
          // Palm Desert May 2026). See PeriodDetailPanel.tsx:435 / :450.
          const conversion = item?.brand_item_id
            ? conversionMap.get(item.brand_item_id) ?? null
            : null;
          // Recipe live-cost fallback — mirrors InventoryCountView.tsx:263.
          // Only override when: count is in_progress AND item is a recipe AND
          // cost_per_unit is null/0. Completed counts read cost_at_count.
          const isInProgress = statusByCount.get(ci.count_id) === 'in_progress';
          const isRecipe = item?.is_recipe === true;
          const needsLive = isRecipe && (item?.cost_per_unit == null || item?.cost_per_unit === 0);
          const liveCpu = (isInProgress && needsLive) ? recipeCostMap?.get(ci.item_id) : undefined;
          const itemForValue = liveCpu != null ? { ...item, cost_per_unit: liveCpu } : item;
          statsMap[ci.count_id].totalCost += getItemValueWithLegs(
            ci as any,
            itemForValue,
            conversion,
            { forceLiveData: false },
          );
        }
      }

      // ─── Enrich with purchasesTotal + cogsPct for list-row preview ──────
      // Lightweight 4-query bulk: pfg/pa/vendor_invoices by delivery_date and
      // sales_cache by sale_date scoped to the earliest period start. Bucket
      // into each count by [period_start, period_end] window. This is a
      // glanceable preview — the expanded PeriodDetailPanel still owns the
      // authoritative value (uses inventory_order_assignments junction).
      const periodWindow = (c: any): { start: string; end: string } | null => {
        const end = c.period_end_date as string | null;
        if (!end) return null;
        if (c.period_start_date) return { start: c.period_start_date, end };
        if (c.period_type === "weekly") {
          const d = new Date(end + "T12:00:00");
          d.setDate(d.getDate() - 6);
          return { start: d.toISOString().slice(0, 10), end };
        }
        if (c.period_type === "monthly") {
          return { start: end.slice(0, 7) + "-01", end };
        }
        return null;
      };

      const completedWithWindow = data
        .filter(c => (c.status === "completed" || c.status === "in_progress") && periodWindow(c))
        .map(c => ({ c, win: periodWindow(c)! }));

      const enrichMap: Record<string, { purchasesTotal: number; cogsPct: number | null }> = {};

      if (completedWithWindow.length > 0) {
        const earliestStart = completedWithWindow.reduce(
          (min, x) => (x.win.start < min ? x.win.start : min),
          completedWithWindow[0].win.start,
        );
        const latestEnd = completedWithWindow.reduce(
          (max, x) => (x.win.end > max ? x.win.end : max),
          completedWithWindow[0].win.end,
        );

        const [pfgRes, paRes, invRes, salesRes] = await Promise.all([
          supabase.from("pfg_orders").select("delivery_date,total_amount").eq("location_id", locationId).gte("delivery_date", earliestStart).lte("delivery_date", latestEnd),
          supabase.from("pa_orders").select("delivery_date,total_amount").eq("location_id", locationId).gte("delivery_date", earliestStart).lte("delivery_date", latestEnd),
          supabase.from("vendor_invoices").select("delivery_date,total_amount").eq("location_id", locationId).gte("delivery_date", earliestStart).lte("delivery_date", latestEnd),
          supabase.from("sales_cache").select("sale_date,net_sales").eq("location_id", locationId).gte("sale_date", earliestStart).lte("sale_date", latestEnd),
        ]);

        const allOrders: { delivery_date: string | null; total_amount: number | null }[] = [
          ...((pfgRes.data as any[]) || []),
          ...((paRes.data as any[]) || []),
          ...((invRes.data as any[]) || []),
        ];
        const salesRows = (salesRes.data as any[]) || [];

        // ─── Manual assignments win over the date window ────────────────────
        // Managers check which deliveries belong to a count (a Monday-morning
        // PFG drop can legitimately belong to the prior month-end). The
        // expanded panel / Report Builder read those checkboxes, so the list
        // pill must too — otherwise the same period shows two numbers.
        // Dedupe defensively: duplicate assignment rows exist in the wild.
        const { data: assignRows } = await supabase
          .from("inventory_order_assignments" as any)
          .select("count_id, source_type, source_row_id")
          .eq("location_id", locationId)
          .in("count_id", completedWithWindow.map(x => x.c.id));

        const assignedByCount: Record<string, Set<string>> = {};
        const idsByType: Record<string, Set<string>> = { pfg: new Set(), pa: new Set(), invoice: new Set() };
        for (const r of ((assignRows as any[]) || [])) {
          const key = `${r.source_type}_${r.source_row_id}`;
          (assignedByCount[r.count_id] ||= new Set()).add(key);
          if (idsByType[r.source_type]) idsByType[r.source_type].add(r.source_row_id);
        }

        const amountByKey: Record<string, number> = {};
        if (Object.values(idsByType).some(s => s.size > 0)) {
          const byIds = async (table: string, type: string) => {
            const ids = [...idsByType[type]];
            if (ids.length === 0) return;
            const { data } = await supabase.from(table as any).select("id,total_amount").in("id", ids);
            for (const row of ((data as any[]) || [])) {
              amountByKey[`${type}_${row.id}`] = Number(row.total_amount) || 0;
            }
          };
          await Promise.all([
            byIds("pfg_orders", "pfg"),
            byIds("pa_orders", "pa"),
            byIds("vendor_invoices", "invoice"),
          ]);
        }


        // Previous completed count's totalCost = this count's beginning.
        // Prefer same period_type chain (weekly→weekly, monthly→monthly), but
        // fall back to "most recent completed count of ANY type before this
        // period's start" when no same-type prior exists. This handles the
        // edge case where the only prior count is a different cadence — e.g.
        // a location's first weekly after a month-end that doubled as the
        // week-end (May 31 = Sat & month close). Without the fallback,
        // beginValue=0 produces a nonsense negative COGS% in the list pill
        // even though the expanded PeriodDetailPanel resolves it correctly.
        const sortedByType = (type: string) =>
          completedWithWindow
            .filter(x => x.c.period_type === type && x.c.status === "completed")
            .sort((a, b) => (a.win.end > b.win.end ? 1 : -1));
        const prevEndingMap: Record<string, number> = {};
        for (const type of ["weekly", "monthly", "yearly"]) {
          const chain = sortedByType(type);
          for (let i = 1; i < chain.length; i++) {
            const prev = chain[i - 1];
            const cur = chain[i];
            prevEndingMap[cur.c.id] = statsMap[prev.c.id]?.totalCost ?? 0;
          }
        }

        // Cross-type fallback: any completed count strictly before this
        // period's start, most recent by period_end.
        const allCompleted = completedWithWindow
          .filter(x => x.c.status === "completed")
          .sort((a, b) => (a.win.end > b.win.end ? 1 : -1));

        for (const { c, win } of completedWithWindow) {
          const purchasesTotal = allOrders.reduce((s, o) => {
            if (!o.delivery_date) return s;
            if (o.delivery_date < win.start || o.delivery_date > win.end) return s;
            return s + (Number(o.total_amount) || 0);
          }, 0);
          const netSales = salesRows.reduce((s, r) => {
            if (!r.sale_date) return s;
            if (r.sale_date < win.start || r.sale_date > win.end) return s;
            return s + (Number(r.net_sales) || 0);
          }, 0);
          let beginValue = prevEndingMap[c.id];
          if (beginValue === undefined) {
            // No same-type prior — find most recent completed of any type
            // whose period_end is strictly before this window's start.
            let fallback: typeof allCompleted[number] | null = null;
            for (const x of allCompleted) {
              if (x.c.id === c.id) continue;
              if (x.win.end < win.start) fallback = x; // sorted asc, keep latest match
            }
            beginValue = fallback ? (statsMap[fallback.c.id]?.totalCost ?? 0) : 0;
          }
          const ending = statsMap[c.id]?.totalCost ?? 0;
          const cogsTotal = beginValue + purchasesTotal - ending;
          const cogsPct = netSales > 0 ? (cogsTotal / netSales) * 100 : null;
          enrichMap[c.id] = { purchasesTotal, cogsPct };
        }
      }

      // Ensure all counts have stats even if no count items yet
      return data.map(c => ({
        ...c,
        _stats: {
          ...(statsMap[c.id] || { totalItems: 0, countedItems: 0, totalCost: 0 }),
          purchasesTotal: enrichMap[c.id]?.purchasesTotal ?? null,
          cogsPct: enrichMap[c.id]?.cogsPct ?? null,
        },
      }));
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
        .eq("is_sandbox", false)
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




  // While permissions are still loading (or transiently errored on a flaky
  // preview network), do NOT redirect — otherwise the page bounces to
  // /dashboard every render before isAdmin/hasPermission resolve, which
  // makes Sandbox unreachable on slow connections.
  if (permissionsLoading) {
    return null;
  }
  if (!canAccessInventory) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  // Gate: inventory not enabled for this location
  if (location && (location as any).inventory_enabled === false) {
    return (
      <Layout>
        <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <div className="rounded-lg border bg-muted/40 p-8 text-center space-y-3">
            <Package className="h-10 w-10 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">Inventory not enabled</h2>
            <p className="text-sm text-muted-foreground">
              {location?.name ?? "This location"} hasn't been onboarded to inventory yet.
              Contact your admin to enable inventory for this store.
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* Page header */}
        <div className="flex items-start justify-between gap-3 pt-4">
          <div className="min-w-0">
            <PageTitle color="green">Inventory</PageTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              {location?.name || "Loading..."}
              {location?.store_number && <> · #{location.store_number}</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl relative"
              onClick={() => setShowTransferDialog(true)}
              title="Transfer"
            >
              <ArrowRightLeft className="h-5 w-5" />
              {pendingIncoming.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {pendingIncoming.length}
                </span>
              )}
            </Button>
            {!isLite && (
              <Button
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={handleStartCount}
                title="New count"
              >
                <Plus className="h-5 w-5" />
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl"
              onClick={() => setShowSettings(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>


        <TransferDialog open={showTransferDialog} onClose={() => setShowTransferDialog(false)} locationId={locationId!} />

        <SandboxPostDeployBanner />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={`grid w-full ${isLite ? "grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="count" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              <span>Count</span>
            </TabsTrigger>
            <TabsTrigger value="items" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              <span>Items</span>
            </TabsTrigger>
            {isLite ? (
              <>
                <TabsTrigger value="invoices" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>Invoices</span>
                </TabsTrigger>
                <TabsTrigger value="genius" className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  <span>Genius</span>
                </TabsTrigger>
              </>
            ) : (
              <TabsTrigger value="pricing" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                <span>Genius</span>
              </TabsTrigger>
            )}
          </TabsList>


          <TabsContent value="count" className="mt-4 space-y-4">
            {isLite ? (
              <LiteCountTab locationId={locationId!} timezone={timezone} locationName={location?.name} />
            ) : (
              <>
                <SandboxCountsPanel locationId={locationId!} />
                <InventoryCountTab
                  locationId={locationId!}
                  inProgressCount={inProgressCount}
                  recentCounts={recentCounts}
                  onStartCount={handleStartCount}
                  onDeleteCount={handleDeleteClick}
                  onCreateCountForPeriod={(periodType, periodEndDate) => {
                    setPreselectedPeriod({ type: periodType, endDate: periodEndDate });
                    setShowStartDialog(true);
                  }}
                  onStartDailyCount={() => setShowDailyCount(true)}
                />
              </>
            )}
          </TabsContent>



          <TabsContent value="items" className="mt-4 space-y-4">
            {isLite ? (
              <LiteInventoryItemsList locationId={locationId!} />
            ) : (
              <InventoryItemsManager locationId={locationId!} mode="items" />
            )}
          </TabsContent>

          {isLite ? (
            <>
              <TabsContent value="invoices" className="mt-4 space-y-4">
                <LiteInvoicesList locationId={locationId!} />
              </TabsContent>
              <TabsContent value="genius" className="mt-4 space-y-4">
                <GeniusOrderCoachPanel locationId={locationId!} timezone={timezone} />
              </TabsContent>
            </>
          ) : (
            <TabsContent value="pricing" className="mt-4 space-y-4">
              <MenuPricingCard locationId={locationId!} />
              <RecipeGeniusCard locationId={locationId!} />
            </TabsContent>
          )}

        </Tabs>

      </div>

      {/* Settings Slide-over */}
      <Sheet open={showSettings} onOpenChange={setShowSettings}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 overflow-y-auto">
          <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowSettings(false)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>
          <div className="p-4 space-y-4">
            {isLite ? (
              <>
                <InventoryScheduleSettings locationId={locationId!} />
                <LiteVendorOrderDaysManager locationId={locationId!} />
                <LiteStorageLocationsManager locationId={locationId!} />
              </>
            ) : (
              <InventoryItemsManager locationId={locationId!} mode="setup" />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {showStartDialog && (
        <Suspense fallback={null}>
          <StartCountDialog
            open={showStartDialog}
            onOpenChange={(open) => {
              setShowStartDialog(open);
              if (!open) setPreselectedPeriod(null);
            }}
            locationId={locationId!}
            onStartCount={handleConfirmStart}
            onStartDailyCount={() => setShowDailyCount(true)}
            isPending={startCountMutation.isPending}
            preselectedPeriodType={preselectedPeriod?.type}
            preselectedPeriodEndDate={preselectedPeriod?.endDate}
          />
        </Suspense>
      )}

      <DeleteCountDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        isDeleting={deleteCountMutation.isPending}
        countPeriod={countToDelete?.period || ""}
      />





      <Sheet open={showDailyCount} onOpenChange={setShowDailyCount}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl pb-safe overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Daily Count</SheetTitle>
          </SheetHeader>
          <div className="pt-2">
            <DailySpotCount locationId={locationId!} />
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
};

export default Inventory;