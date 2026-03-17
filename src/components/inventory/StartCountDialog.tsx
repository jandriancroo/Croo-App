import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { getTodayInTimezone } from "@/utils/timezoneUtils";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useInventoryPeriodSettings } from "@/hooks/useInventoryPeriodSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  CalendarDays, 
  Calendar, 
  Loader2, 
  Check, 
  RefreshCw, 
  ArrowRight,
  ArrowLeft,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  Sun
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subDays, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import OrderReconciliationPicker from "./OrderReconciliationPicker";

interface StartCountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  onStartCount: (periodType: string | null, periodEndDate: string | null, isLateClose?: boolean, lateCloseNotes?: string) => void;
  onStartDailyCount?: () => void;
  isPending: boolean;
}

interface PeriodOption {
  id: string;
  type: "weekly" | "monthly" | "yearly" | "adhoc";
  label: string;
  description: string;
  periodEndDate: string | null;
  periodStartDate?: string | null;
  icon: React.ReactNode;
  isConfigured: boolean;
  isLateClose?: boolean;
}

interface SyncProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}

const StartCountDialog = ({
  open,
  onOpenChange,
  locationId,
  onStartCount,
  onStartDailyCount,
  isPending,
}: StartCountDialogProps) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { timezone } = useLocationTimezone();
  const { config: periodConfig } = useInventoryPeriodSettings(locationId);
  const [step, setStep] = useState<"period" | "flex-period" | "sync" | "orders">("period");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [flexSelectedPeriod, setFlexSelectedPeriod] = useState<PeriodOption | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingPA, setIsSyncingPA] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncComplete, setSyncComplete] = useState(false);
  const [paSyncComplete, setPaSyncComplete] = useState(false);
  const [lastSyncErrors, setLastSyncErrors] = useState<string[]>([]);
  const [autoSyncTriggered, setAutoSyncTriggered] = useState(false);
  // Temp count ID for order binding (created before counting starts)
  const [tempCountId, setTempCountId] = useState<string | null>(null);
  const [lateCloseNotes, setLateCloseNotes] = useState("");

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setStep("period");
      setSelectedPeriod(null);
      setFlexSelectedPeriod(null);
      setSyncComplete(false);
      setPaSyncComplete(false);
      setSyncProgress(null);
      setLastSyncErrors([]);
      setAutoSyncTriggered(false);
      setTempCountId(null);
      setLateCloseNotes("");
    }
  }, [open]);

  // Fetch schedule settings
  const { data: scheduleSettings, isLoading } = useQuery({
    queryKey: ["inventory-schedule-settings", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_schedule_settings")
        .select("*")
        .eq("location_id", locationId)
        .eq("is_active", true);
      
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch existing counts to check which periods are already counted
  const { data: existingCounts } = useQuery({
    queryKey: ["inventory-existing-periods", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("period_type, period_end_date, status")
        .eq("location_id", locationId)
        .not("period_end_date", "is", null);
      
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch PFG integration status
  const { data: pfgIntegration } = useQuery({
    queryKey: ["pfg-integration", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("location_integrations")
        .select("*")
        .eq("location_id", locationId)
        .eq("integration_type", "pfg")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });

  // Fetch PA integration status
  const { data: paIntegration } = useQuery({
    queryKey: ["pa-integration", locationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("location_integrations")
        .select("*")
        .eq("location_id", locationId)
        .eq("integration_type", "produce_alliance")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: open,
  });

  // Fetch last sync time from inventory items
  const { data: lastSyncInfo, refetch: refetchSyncInfo } = useQuery({
    queryKey: ["inventory-last-sync", locationId],
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("inventory_items")
        .select("updated_at, cost_per_unit")
        .eq("location_id", locationId)
        .order("updated_at", { ascending: false })
        .limit(1);
      
      if (error) throw error;
      
      const { count } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true);
      
      const { count: itemsWithPrices } = await supabase
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId)
        .eq("is_active", true)
        .not("cost_per_unit", "is", null);
      
      return {
        lastUpdated: items?.[0]?.updated_at || null,
        totalItems: count || 0,
        itemsWithPrices: itemsWithPrices || 0,
      };
    },
    enabled: open && (step === "sync" || step === "orders"),
  });

  // Fetch last PA sync log
  const { data: lastPaSyncLog } = useQuery({
    queryKey: ["inventory-last-pa-sync", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_sync_logs")
        .select("*")
        .eq("location_id", locationId)
        .eq("sync_source", "produce_alliance")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: open && step === "sync",
  });

  // Generate period options based on schedule settings
  // Sorted chronologically descending, monthly periods above their child weeks
  const periodOptions = useMemo(() => {
    const scheduledOptions: PeriodOption[] = [];
    const todayStr = getTodayInTimezone(timezone);
    const today = new Date(todayStr + "T12:00:00");

    const isPeriodCounted = (type: string, endDate: string) => {
      return existingCounts?.some(
        (c) => c.period_type === type && c.period_end_date === endDate && c.status === "completed"
      );
    };

    // Weekly periods
    const weeklySetting = scheduleSettings?.find((s) => s.frequency === "weekly");
    if (weeklySetting) {
      const weekEndDay = periodConfig.periodEndDay;
      const todayDay = today.getDay();
      let daysUntilEnd = weekEndDay - todayDay;
      if (daysUntilEnd < 0) daysUntilEnd += 7;
      
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() + daysUntilEnd);
      const weekEndStr = format(weekEnd, "yyyy-MM-dd");
      const weekStart = subDays(weekEnd, 6);
      
      if (!isPeriodCounted("weekly", weekEndStr)) {
        scheduledOptions.push({
          id: `weekly-current`,
          type: "weekly",
          label: `Week Ending ${format(weekEnd, "MMM d")}`,
          description: `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`,
          periodEndDate: weekEndStr,
          periodStartDate: format(weekStart, "yyyy-MM-dd"),
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
        });
      }

      const prevWeekEnd = subDays(weekEnd, 7);
      const prevWeekStart = subDays(prevWeekEnd, 6);
      const prevWeekEndStr = format(prevWeekEnd, "yyyy-MM-dd");
      const isLateClose = todayStr > prevWeekEndStr;
      
      if (!isPeriodCounted("weekly", prevWeekEndStr)) {
        scheduledOptions.push({
          id: `weekly-prev`,
          type: "weekly",
          label: `Week Ending ${format(prevWeekEnd, "MMM d")}`,
          description: isLateClose 
            ? `Flex period — period ended ${format(prevWeekEnd, "MMM d")}` 
            : `${format(prevWeekStart, "MMM d")} - ${format(prevWeekEnd, "MMM d, yyyy")}`,
          periodEndDate: prevWeekEndStr,
          periodStartDate: format(prevWeekStart, "yyyy-MM-dd"),
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
          isLateClose,
        });
      }
    }

    // Monthly periods
    const monthlySetting = scheduleSettings?.find((s) => s.frequency === "monthly");
    if (monthlySetting) {
      const monthEnd = endOfMonth(today);
      const monthEndStr = format(monthEnd, "yyyy-MM-dd");
      const monthStart = startOfMonth(today);
      
      if (!isPeriodCounted("monthly", monthEndStr)) {
        scheduledOptions.push({
          id: `monthly-current`,
          type: "monthly",
          label: `${format(today, "MMMM")} Month End`,
          description: `${format(monthStart, "MMM d")} - ${format(monthEnd, "MMM d, yyyy")}`,
          periodEndDate: monthEndStr,
          periodStartDate: format(monthStart, "yyyy-MM-dd"),
          icon: <Calendar className="h-5 w-5" />,
          isConfigured: true,
        });
      }

      const prevMonth = subDays(startOfMonth(today), 1);
      const prevMonthEnd = endOfMonth(prevMonth);
      const prevMonthEndStr = format(prevMonthEnd, "yyyy-MM-dd");
      const prevMonthStart = startOfMonth(prevMonth);
      
      if (!isPeriodCounted("monthly", prevMonthEndStr)) {
        scheduledOptions.push({
          id: `monthly-prev`,
          type: "monthly",
          label: `${format(prevMonth, "MMMM")} Month End`,
          description: `${format(prevMonthStart, "MMM d")} - ${format(prevMonthEnd, "MMM d, yyyy")}`,
          periodEndDate: prevMonthEndStr,
          periodStartDate: format(prevMonthStart, "yyyy-MM-dd"),
          icon: <Calendar className="h-5 w-5" />,
          isConfigured: true,
        });
      }
    }

    // Sort: chronologically descending by periodEndDate, with monthly periods
    // appearing above any weekly periods that fall within that month
    scheduledOptions.sort((a, b) => {
      if (!a.periodEndDate || !b.periodEndDate) return 0;
      
      const aEnd = new Date(a.periodEndDate + "T12:00:00");
      const bEnd = new Date(b.periodEndDate + "T12:00:00");
      
      // Check if they're in the same month
      const aMonth = aEnd.getMonth();
      const aYear = aEnd.getFullYear();
      const bMonth = bEnd.getMonth();
      const bYear = bEnd.getFullYear();
      
      // Different month/year — sort by end date descending
      if (aYear !== bYear || aMonth !== bMonth) {
        return bEnd.getTime() - aEnd.getTime();
      }
      
      // Same month — monthly always comes first (above weekly)
      if (a.type === "monthly" && b.type !== "monthly") return -1;
      if (b.type === "monthly" && a.type !== "monthly") return 1;
      
      // Same type, same month — sort by end date descending
      return bEnd.getTime() - aEnd.getTime();
    });

    // Append Flex Count and Quick Count at the bottom
    const finalOptions: PeriodOption[] = [
      ...scheduledOptions,
      {
        id: "flex",
        type: "adhoc",
        label: "Flex Count",
        description: "Count for a period on a different day",
        periodEndDate: null,
        periodStartDate: null,
        icon: <RefreshCw className="h-5 w-5" />,
        isConfigured: false,
      },
      {
        id: "adhoc",
        type: "adhoc",
        label: "Quick Count",
        description: "Count without a specific period",
        periodEndDate: null,
        periodStartDate: null,
        icon: <Check className="h-5 w-5" />,
        isConfigured: false,
      },
    ];

    return finalOptions;
  }, [scheduleSettings, existingCounts, periodConfig, timezone]);

  // Auto-sync when entering sync step
  useEffect(() => {
    if (step === "sync" && !autoSyncTriggered) {
      setAutoSyncTriggered(true);
      // Auto-trigger syncs
      if (pfgIntegration) {
        syncFromPFG();
      }
      if (paIntegration && !pfgIntegration) {
        syncFromPA();
      }
    }
  }, [step, autoSyncTriggered, pfgIntegration, paIntegration]);

  // Auto-trigger PA after PFG completes
  useEffect(() => {
    if (syncComplete && paIntegration && !paSyncComplete && !isSyncingPA) {
      syncFromPA();
    }
  }, [syncComplete, paIntegration, paSyncComplete, isSyncingPA]);

  // Sync from PFG
  const syncFromPFG = async () => {
    if (!pfgIntegration) return;
    
    setIsSyncing(true);
    setSyncProgress({ phase: "Connecting to PFG...", current: 0, total: 100 });
    
    try {
      const productListHeaderId = (pfgIntegration?.credentials as any)?.product_list_header_id;
      const customerId = (pfgIntegration?.credentials as any)?.customer_id;
      
      if (!productListHeaderId || !customerId) {
        toast.error('PFG Order Guide not configured — go to Location Settings → Integrations to set it up');
        setIsSyncing(false);
        return;
      }
      
      setSyncProgress({ phase: "Fetching products from PFG...", current: 15, total: 100 });
      
      const { data, error } = await supabase.functions.invoke("pfg-service", {
        body: { locationId, action: "categories", productListHeaderId, customerId }
      });

      if (error) throw error;
      if (!data?.authenticated) {
        throw new Error("PFG authentication failed");
      }

      const categories = data?.data?.categories || [];
      
      if (categories.length === 0) {
        setSyncProgress({ phase: "No items found", current: 100, total: 100 });
        setSyncComplete(true);
        return;
      }

      let totalProducts = 0;
      for (const cat of categories) {
        totalProducts += (cat.products || []).length;
      }

      setSyncProgress({ phase: "Mapping storage locations...", current: 25, total: 100 });

      const locationMap = new Map<string, string>();
      const { data: existingLocations } = await supabase
        .from("inventory_locations")
        .select("id, name")
        .eq("location_id", locationId);
      
      for (const loc of existingLocations || []) {
        locationMap.set(loc.name.toLowerCase(), loc.id);
      }

      setSyncProgress({ phase: "Updating items & prices...", current: 35, total: 100, detail: `0 / ${totalProducts}` });

      let processedItems = 0;
      
      for (const cat of categories) {
        const storageLocationId = locationMap.get(cat.name.toLowerCase()) || null;

        for (const product of cat.products || []) {
          processedItems++;
          
          if (processedItems % 5 === 0 || processedItems === totalProducts) {
            const progressPct = 35 + Math.floor((processedItems / totalProducts) * 55);
            setSyncProgress({ 
              phase: "Updating items & prices...", 
              current: progressPct, 
              total: 100, 
              detail: `${processedItems} / ${totalProducts}` 
            });
          }
          
          // Primary match: qubeyond_item_id
          let existing: { id: string; image_url: string | null; storage_location_id: string | null } | null = null;
          
          if (product.id) {
            const { data } = await supabase
              .from("inventory_items")
              .select("id, image_url, storage_location_id")
              .eq("location_id", locationId)
              .eq("qubeyond_item_id", product.id)
              .limit(1)
              .maybeSingle();
            existing = data;
          }
          
          // Fallback match: item_number (prevents duplicates when qubeyond_item_id doesn't match)
          if (!existing && product.itemNumber) {
            const { data } = await supabase
              .from("inventory_items")
              .select("id, image_url, storage_location_id")
              .eq("location_id", locationId)
              .eq("item_number", product.itemNumber)
              .limit(1)
              .maybeSingle();
            existing = data;
          }
          
          const price = product.price ? Number(product.price) : null;
          const packQuantity = product.packQuantity ? Number(product.packQuantity) : null;
          let imageUrl = existing?.image_url || product.imageUrl || null;
          
          if (!imageUrl && product.itemNumber) {
            const { data: crossLocationItem } = await supabase
              .from("inventory_items")
              .select("image_url")
              .eq("item_number", product.itemNumber)
              .not("image_url", "is", null)
              .neq("location_id", locationId)
              .limit(1)
              .maybeSingle();
            if (crossLocationItem?.image_url) {
              imageUrl = crossLocationItem.image_url;
            }
          }
          
          const itemData = {
            name: product.name,
            unit: product.unit?.toLowerCase() || "case",
            storage_location_id: existing?.storage_location_id || storageLocationId,
            cost_per_unit: price,
            pack_size: product.packSize || null,
            pack_quantity: packQuantity,
            brand: product.brand || null,
            item_number: product.itemNumber || null,
            image_url: imageUrl,
            is_active: true
          };
          
          if (existing) {
            await supabase
              .from("inventory_items")
              .update(itemData)
              .eq("id", existing.id);
          } else {
            await supabase
              .from("inventory_items")
              .insert({
                location_id: locationId,
                qubeyond_item_id: product.id,
                display_order: processedItems,
                ...itemData
              });
          }
        }
      }

      // Also sync PFG orders in background
      supabase.functions.invoke("pfg-service?action=sync_orders", {
        body: { locationId }
      }).catch(console.warn);

      setSyncProgress({ phase: "Sync complete!", current: 100, total: 100 });
      setSyncComplete(true);
      
      // Write sync log so Setup page shows this sync
      await supabase.from("inventory_sync_logs").insert({
        location_id: locationId,
        sync_source: "pfg",
        sync_type: "count_start",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: "completed",
        items_synced: processedItems,
        orders_processed: 0,
        triggered_by: user?.id || null,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["last-pfg-sync", locationId] });
      });

      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      refetchSyncInfo();
      
    } catch (err) {
      console.error("PFG sync error:", err);
      setSyncProgress({ phase: "Sync failed", current: 0, total: 100 });
      setSyncComplete(true); // Allow progression even on failure
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync from Produce Alliance
  const syncFromPA = async () => {
    if (!paIntegration) return;
    
    setIsSyncingPA(true);
    setLastSyncErrors([]);
    setSyncProgress({ phase: "Connecting to Produce Alliance...", current: 0, total: 100 });
    
    try {
      setSyncProgress({ phase: "Fetching orders & extracting items via AI...", current: 20, total: 100 });
      
      const { data, error } = await supabase.functions.invoke("produce-alliance-service", {
        body: { locationId, action: "sync_items", maxOrders: 3, triggeredBy: user?.id }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "PA sync failed");

      const syncErrors = data.errors || [];
      setLastSyncErrors(syncErrors);

      setSyncProgress({ 
        phase: `Synced ${data.synced} items from ${data.ordersProcessed} orders${syncErrors.length > 0 ? ` (${syncErrors.length} warnings)` : ''}`, 
        current: 100, 
        total: 100 
      });
      setPaSyncComplete(true);
      
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-last-pa-sync", locationId] });
      queryClient.invalidateQueries({ queryKey: ["last-pa-sync", locationId] });
      refetchSyncInfo();
      
    } catch (err) {
      console.error("PA sync error:", err);
      setSyncProgress({ phase: "PA sync failed", current: 0, total: 100 });
      setPaSyncComplete(true); // Allow progression
    } finally {
      setIsSyncingPA(false);
    }
  };

  const handleContinueToSync = () => {
    if (selectedPeriod === "flex") {
      setStep("flex-period");
      return;
    }
    setStep("sync");
  };

  const handleFlexContinueToSync = () => {
    if (!flexSelectedPeriod) return;
    setStep("sync");
  };

  const handleContinueToOrders = async () => {
    const selected = effectivePeriod;
    if (!selected || (selected.type === "adhoc" && !flexSelectedPeriod)) {
      // Skip order picker for ad-hoc counts (but not flex counts)
      handleStart();
      return;
    }

    // Create or resume the count to get a count ID for binding orders
    try {
      let query = supabase
        .from("inventory_counts")
        .select("*")
        .eq("location_id", locationId)
        .eq("status", "in_progress");

      if (selected.periodEndDate) {
        query = query
          .eq("period_type", selected.type)
          .eq("period_end_date", selected.periodEndDate);
      }

      const { data: existing } = await query.order("started_at", { ascending: false }).limit(1).maybeSingle();

      if (existing) {
        // If user selected flex but existing count isn't marked as flex, update it
        const isFlexCount = !!flexSelectedPeriod;
        if (isFlexCount && !existing.is_late_close) {
          await supabase
            .from("inventory_counts")
            .update({
              is_late_close: true,
              late_close_notes: lateCloseNotes || 'Flex count',
            })
            .eq("id", existing.id);
        }
        setTempCountId(existing.id);
      } else {
        const isFlexCount = !!flexSelectedPeriod;
        const { data: newCount, error } = await supabase
          .from("inventory_counts")
          .insert({
            location_id: locationId,
            counted_by: user?.id,
            count_date: getTodayInTimezone(timezone),
            period_type: selected.type,
            period_end_date: selected.periodEndDate,
            is_late_close: isFlexCount || selected.isLateClose || false,
            late_close_notes: isFlexCount 
              ? lateCloseNotes || `Flex count` 
              : selected.isLateClose ? lateCloseNotes || null : null,
          } as any)
          .select()
          .single();

        if (error) throw error;
        setTempCountId(newCount.id);
      }

      setStep("orders");
    } catch (err) {
      console.error("Failed to create count for order binding:", err);
      toast.error("Failed to prepare count");
    }
  };

  const handleBack = () => {
    if (step === "orders") {
      setStep("sync");
    } else if (step === "sync") {
      // If we came from flex-period, go back there
      if (flexSelectedPeriod) {
        setStep("flex-period");
      } else {
        setStep("period");
      }
      setSyncComplete(false);
      setPaSyncComplete(false);
      setSyncProgress(null);
      setAutoSyncTriggered(false);
    } else if (step === "flex-period") {
      setFlexSelectedPeriod(null);
      setLateCloseNotes("");
      setStep("period");
    } else {
      setStep("period");
      setSyncComplete(false);
      setPaSyncComplete(false);
      setSyncProgress(null);
      setAutoSyncTriggered(false);
    }
  };

  const handleStart = () => {
    // For flex counts, use the flex-selected period
    if (flexSelectedPeriod) {
      const todayStr = getTodayInTimezone(timezone);
      const isLate = flexSelectedPeriod.periodEndDate ? todayStr > flexSelectedPeriod.periodEndDate : false;
      onStartCount(
        flexSelectedPeriod.type === "adhoc" ? null : flexSelectedPeriod.type,
        flexSelectedPeriod.periodEndDate,
        true, // flex counts are always "late close" / flex
        lateCloseNotes || (isLate ? "Flex count (late)" : "Flex count (early)")
      );
      return;
    }
    
    const selected = periodOptions.find((p) => p.id === selectedPeriod);
    if (selected) {
      onStartCount(
        selected.type === "adhoc" ? null : selected.type,
        selected.periodEndDate,
        selected.isLateClose || false,
        selected.isLateClose ? lateCloseNotes || undefined : undefined
      );
    }
  };

  const handleOrdersSaved = () => {
    // Orders are saved, now start counting
    handleStart();
  };

  // The "effective" selected period — either the normal selection or the flex-selected period
  const effectivePeriod = flexSelectedPeriod || periodOptions.find((p) => p.id === selectedPeriod);
  const selectedPeriodData = effectivePeriod;
  const _hasVendorIntegration = !!pfgIntegration || !!paIntegration;
  const allSyncsDone = (!pfgIntegration || syncComplete) && (!paIntegration || paSyncComplete);
  const noSyncsNeeded = !pfgIntegration && !paIntegration;

  // Generate flex period options — all past/current periods including already-counted ones
  const flexPeriodOptions = useMemo(() => {
    const options: PeriodOption[] = [];
    const todayStr = getTodayInTimezone(timezone);
    const today = new Date(todayStr + "T12:00:00");

    const weeklySetting = scheduleSettings?.find((s) => s.frequency === "weekly");
    const monthlySetting = scheduleSettings?.find((s) => s.frequency === "monthly");

    // Generate past 4 weekly periods + current
    if (weeklySetting) {
      const weekEndDay = periodConfig.periodEndDay;
      const todayDay = today.getDay();
      let daysUntilEnd = weekEndDay - todayDay;
      if (daysUntilEnd < 0) daysUntilEnd += 7;
      
      const currentWeekEnd = new Date(today);
      currentWeekEnd.setDate(today.getDate() + daysUntilEnd);

      for (let i = 0; i < 4; i++) {
        const weekEnd = subDays(currentWeekEnd, i * 7);
        const weekStart = subDays(weekEnd, 6);
        const weekEndStr = format(weekEnd, "yyyy-MM-dd");
        const _isEarly = todayStr < weekEndStr;
        const isLate = todayStr > weekEndStr;
        const isSameDay = todayStr === weekEndStr;
        
        // Check if already counted
        const existingCount = existingCounts?.find(
          (c) => c.period_type === "weekly" && c.period_end_date === weekEndStr
        );

        options.push({
          id: `flex-weekly-${i}`,
          type: "weekly",
          label: `Week Ending ${format(weekEnd, "MMM d")}`,
          description: existingCount?.status === "completed" 
            ? `Already counted — re-count as flex`
            : isSameDay 
            ? `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`
            : isLate 
            ? `Late — period ended ${format(weekEnd, "MMM d")}`
            : `Early — period ends ${format(weekEnd, "MMM d")}`,
          periodEndDate: weekEndStr,
          periodStartDate: format(weekStart, "yyyy-MM-dd"),
          icon: <CalendarDays className="h-5 w-5" />,
          isConfigured: true,
          isLateClose: isLate,
        });
      }
    }

    // Generate current + previous month
    if (monthlySetting) {
      const monthEnd = endOfMonth(today);
      const monthEndStr = format(monthEnd, "yyyy-MM-dd");
      const monthStart = startOfMonth(today);
      const isEarlyMonth = todayStr < monthEndStr;

      const existingMonthCount = existingCounts?.find(
        (c) => c.period_type === "monthly" && c.period_end_date === monthEndStr
      );

      options.push({
        id: `flex-monthly-current`,
        type: "monthly",
        label: `${format(today, "MMMM")} Month End`,
        description: existingMonthCount?.status === "completed"
          ? `Already counted — re-count as flex`
          : isEarlyMonth 
          ? `Early — period ends ${format(monthEnd, "MMM d")}`
          : `${format(monthStart, "MMM d")} - ${format(monthEnd, "MMM d, yyyy")}`,
        periodEndDate: monthEndStr,
        periodStartDate: format(monthStart, "yyyy-MM-dd"),
        icon: <Calendar className="h-5 w-5" />,
        isConfigured: true,
        isLateClose: false,
      });

      const prevMonth = subDays(monthStart, 1);
      const prevMonthEnd = endOfMonth(prevMonth);
      const prevMonthEndStr = format(prevMonthEnd, "yyyy-MM-dd");
      const prevMonthStart = startOfMonth(prevMonth);

      const existingPrevMonthCount = existingCounts?.find(
        (c) => c.period_type === "monthly" && c.period_end_date === prevMonthEndStr
      );

      options.push({
        id: `flex-monthly-prev`,
        type: "monthly",
        label: `${format(prevMonth, "MMMM")} Month End`,
        description: existingPrevMonthCount?.status === "completed"
          ? `Already counted — re-count as flex`
          : `Late — period ended ${format(prevMonthEnd, "MMM d")}`,
        periodEndDate: prevMonthEndStr,
        periodStartDate: format(prevMonthStart, "yyyy-MM-dd"),
        icon: <Calendar className="h-5 w-5" />,
        isConfigured: true,
        isLateClose: true,
      });
    }

    // Sort: monthly above weekly within same month, descending by date
    options.sort((a, b) => {
      if (!a.periodEndDate || !b.periodEndDate) return 0;
      const aEnd = new Date(a.periodEndDate + "T12:00:00");
      const bEnd = new Date(b.periodEndDate + "T12:00:00");
      const aMonth = aEnd.getMonth() + aEnd.getFullYear() * 12;
      const bMonth = bEnd.getMonth() + bEnd.getFullYear() * 12;
      if (aMonth !== bMonth) return bMonth - aMonth;
      if (a.type === "monthly" && b.type !== "monthly") return -1;
      if (b.type === "monthly" && a.type !== "monthly") return 1;
      return bEnd.getTime() - aEnd.getTime();
    });

    return options;
  }, [scheduleSettings, existingCounts, periodConfig, timezone]);

  // Compute flex reconciliation info
  const flexReconciliationInfo = useMemo(() => {
    if (!flexSelectedPeriod?.periodEndDate) return null;
    const todayStr = getTodayInTimezone(timezone);
    const periodEnd = flexSelectedPeriod.periodEndDate;
    const isLate = todayStr > periodEnd;
    const isEarly = todayStr < periodEnd;
    
    if (isLate) {
      // Count extra days between period end and today
      const endDate = new Date(periodEnd + "T12:00:00");
      const todayDate = new Date(todayStr + "T12:00:00");
      const extraDays = Math.round((todayDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        type: "late" as const,
        extraDays,
        message: `${extraDays} extra sales day${extraDays !== 1 ? 's' : ''} will be included (${format(endDate, "MMM d")} → ${format(todayDate, "MMM d")})`,
      };
    } else if (isEarly) {
      const endDate = new Date(periodEnd + "T12:00:00");
      const todayDate = new Date(todayStr + "T12:00:00");
      const missingDays = Math.round((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        type: "early" as const,
        extraDays: 0,
        message: `Counting ${missingDays} day${missingDays !== 1 ? 's' : ''} early — remaining sales won't be captured until period ends`,
      };
    }
    return null;
  }, [flexSelectedPeriod, timezone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "period" 
              ? "Select Count Period" 
              : step === "flex-period" 
              ? "Flex Count" 
              : step === "sync" 
              ? "Syncing Items & Prices" 
              : "Apply Vendor Orders"}
          </DialogTitle>
          <DialogDescription>
            {step === "period" 
              ? "Choose the period you're counting for"
              : step === "flex-period"
              ? "Select the period to flex into"
              : step === "sync"
              ? "Updating your inventory data automatically"
              : "Select which deliveries to include in this period"
            }
          </DialogDescription>
        </DialogHeader>

        {step === "period" && (
          <>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {periodOptions.map((option, index) => {
                  // Add a subtle separator before Flex Count / Quick Count
                  const isBottomOption = option.id === "flex" || option.id === "adhoc";
                  const prevOption = index > 0 ? periodOptions[index - 1] : null;
                  const showSeparator = isBottomOption && prevOption && prevOption.id !== "flex" && prevOption.id !== "adhoc";
                  
                  return (
                    <div key={option.id}>
                      {showSeparator && (
                        <div className="border-t border-border/50 my-1" />
                      )}
                      <Card
                        className={cn(
                          "cursor-pointer transition-all",
                          selectedPeriod === option.id
                            ? "border-primary ring-2 ring-primary/20"
                            : "hover:border-primary/50"
                        )}
                        onClick={() => setSelectedPeriod(option.id)}
                      >
                        <CardContent className="p-4 flex items-center gap-4">
                          <div
                            className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center",
                              selectedPeriod === option.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {option.icon}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{option.label}</p>
                              {option.isConfigured && !option.isLateClose && (
                                <Badge variant="secondary" className="text-xs">
                                  Scheduled
                                </Badge>
                              )}
                              {option.isLateClose && (
                                <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600">
                                  Flex Period
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {option.description}
                            </p>
                          </div>
                          {selectedPeriod === option.id && (
                            <Check className="h-5 w-5 text-primary" />
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}

                {/* Flex period notes field */}
                {selectedPeriodData?.isLateClose && (
                  <div className="space-y-2 pt-1">
                    <label className="text-sm font-medium text-muted-foreground">
                      Flex period reason (optional)
                    </label>
                    <Textarea
                      value={lateCloseNotes}
                      onChange={(e) => setLateCloseNotes(e.target.value)}
                      placeholder="e.g., Received PFG order today, reconciling into last period..."
                      className="text-sm min-h-[60px]"
                    />
                  </div>
                )}

                {periodOptions.length === 1 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No scheduled periods configured.{" "}
                    <span className="text-primary">Set up in the Setup tab.</span>
                  </p>
                )}

                <Button
                  className="w-full mt-4"
                  size="lg"
                  disabled={!selectedPeriod}
                  onClick={handleContinueToSync}
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </>
        )}

        {step === "flex-period" && (
          <div className="space-y-3">
            {/* Flex period list */}
            <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
              {flexPeriodOptions.map((option) => (
                <Card
                  key={option.id}
                  className={cn(
                    "cursor-pointer transition-all",
                    flexSelectedPeriod?.id === option.id
                      ? "border-primary ring-2 ring-primary/20"
                      : "hover:border-primary/50"
                  )}
                  onClick={() => setFlexSelectedPeriod(option)}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center",
                        flexSelectedPeriod?.id === option.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {option.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{option.label}</p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {option.description}
                      </p>
                    </div>
                    {flexSelectedPeriod?.id === option.id && (
                      <Check className="h-5 w-5 text-primary" />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Flex reconciliation info */}
            {flexSelectedPeriod && flexReconciliationInfo && (
              <Card className={cn(
                "border",
                flexReconciliationInfo.type === "late" 
                  ? "border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20" 
                  : "border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20"
              )}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                    flexReconciliationInfo.type === "late" 
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-900/50" 
                      : "bg-blue-100 text-blue-600 dark:bg-blue-900/50"
                  )}>
                    {flexReconciliationInfo.type === "late" ? (
                      <Clock className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {flexReconciliationInfo.type === "late" ? "Late Flex" : "Early Flex"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {flexReconciliationInfo.message}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Flex reason */}
            {flexSelectedPeriod && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Reason for flex count (optional)
                </label>
                <Textarea
                  value={lateCloseNotes}
                  onChange={(e) => setLateCloseNotes(e.target.value)}
                  placeholder="e.g., Counted Monday after close, late PFG delivery..."
                  className="text-sm min-h-[60px]"
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleBack}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                className="flex-1"
                size="lg"
                disabled={!flexSelectedPeriod}
                onClick={handleFlexContinueToSync}
              >
                Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {step === "sync" && (
          <div className="space-y-4">
            {/* Selected Period Summary */}
            {selectedPeriodData && (
              <Card className="bg-muted/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    {selectedPeriodData.icon}
                  </div>
                  <div>
                    <p className="font-medium">{selectedPeriodData.label}</p>
                    <p className="text-sm text-muted-foreground">{selectedPeriodData.description}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Sync Status Card */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">Inventory Items</span>
                  </div>
                  <Badge variant="outline">
                    {lastSyncInfo?.totalItems || 0} items
                  </Badge>
                </div>

                {/* Last Sync Info */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Last synced</span>
                  </div>
                  <span>
                    {lastSyncInfo?.lastUpdated 
                      ? formatDistanceToNow(new Date(lastSyncInfo.lastUpdated), { addSuffix: true })
                      : "Never"
                    }
                  </span>
                </div>

                {/* Prices Status */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {lastSyncInfo && lastSyncInfo.itemsWithPrices === lastSyncInfo.totalItems ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                    )}
                    <span>Items with prices</span>
                  </div>
                  <span>
                    {lastSyncInfo?.itemsWithPrices || 0} / {lastSyncInfo?.totalItems || 0}
                  </span>
                </div>

                {/* Sync Progress */}
                {syncProgress && (
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{syncProgress.phase}</span>
                      <span className="text-muted-foreground">{syncProgress.current}%</span>
                    </div>
                    <Progress value={syncProgress.current} className="h-2" />
                    {syncProgress.detail && (
                      <p className="text-xs text-muted-foreground text-center">{syncProgress.detail}</p>
                    )}
                  </div>
                )}

                {/* Manual re-sync buttons (only if auto-sync already ran) */}
                {autoSyncTriggered && !isSyncing && !isSyncingPA && (
                  <div className="flex gap-2">
                    {pfgIntegration && (
                      <Button 
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={syncFromPFG}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Re-sync PFG
                      </Button>
                    )}
                    {paIntegration && (
                      <Button 
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={syncFromPA}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Re-sync PA
                      </Button>
                    )}
                  </div>
                )}

                {(allSyncsDone || noSyncsNeeded) && (
                  <div className="flex items-center justify-center gap-2 text-green-600 py-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-medium">{noSyncsNeeded ? "No vendor sync needed" : "Sync complete"}</span>
                  </div>
                )}

                {/* Sync warnings/errors */}
                {lastSyncErrors.length > 0 && (
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-amber-600 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {lastSyncErrors.length} warning{lastSyncErrors.length > 1 ? 's' : ''}
                    </p>
                    {lastSyncErrors.map((err, i) => (
                      <p key={i} className="text-muted-foreground text-xs pl-5">{err}</p>
                    ))}
                  </div>
                )}

                {/* Last PA sync log */}
                {lastPaSyncLog && !paSyncComplete && (
                  <div className="text-xs text-muted-foreground border-t pt-2 space-y-1">
                    <p>
                      Last PA sync: {formatDistanceToNow(new Date(lastPaSyncLog.started_at), { addSuffix: true })}
                      {' — '}
                      <span className={lastPaSyncLog.status === 'failed' ? 'text-destructive' : ''}>
                        {lastPaSyncLog.status === 'completed' 
                          ? `${lastPaSyncLog.items_synced} items synced` 
                          : lastPaSyncLog.status}
                      </span>
                    </p>
                    {(lastPaSyncLog.errors as string[])?.length > 0 && (
                      <p className="text-destructive">
                        {(lastPaSyncLog.errors as string[]).length} error{(lastPaSyncLog.errors as string[]).length > 1 ? 's' : ''} last run
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isSyncing || isSyncingPA || isPending}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                className="flex-1"
                size="lg"
                disabled={isSyncing || isSyncingPA || isPending}
                onClick={handleContinueToOrders}
              >
                {(isSyncing || isSyncingPA) ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {selectedPeriodData?.type === "adhoc" ? "Start Counting" : "Select Orders"}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {step === "orders" && tempCountId && selectedPeriodData && (() => {
          // For late flex counts, extend the order date range to today
          const isFlexLate = !!flexSelectedPeriod && flexReconciliationInfo?.type === "late";
          const effectiveOrderEndDate = isFlexLate 
            ? getTodayInTimezone(timezone) 
            : (selectedPeriodData.periodEndDate || undefined);
          
          return (
            <div className="space-y-4">
              {/* Selected Period Summary */}
              <Card className="bg-muted/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Truck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{selectedPeriodData.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {isFlexLate
                        ? `Includes orders through today (${flexReconciliationInfo.extraDays} extra day${flexReconciliationInfo.extraDays !== 1 ? 's' : ''})`
                        : "Select which vendor orders to include in COGS for this period"
                      }
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Flex reconciliation context */}
              {isFlexLate && flexReconciliationInfo && (
                <Card className="border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-amber-100 text-amber-600 dark:bg-amber-900/50">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Reconcile Extra Days</p>
                      <p className="text-xs text-muted-foreground">
                        {flexReconciliationInfo.message}. Review orders below to confirm which deliveries belong in this period.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              <OrderReconciliationPicker
                locationId={locationId}
                countId={tempCountId}
                periodStartDate={selectedPeriodData.periodStartDate || undefined}
                periodEndDate={effectiveOrderEndDate}
                editable
                compact
                onSaved={handleOrdersSaved}
              />

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleBack} disabled={isPending}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={handleStart}
                  disabled={isPending}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Skip & Start Counting
                </Button>
              </div>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
};

export default StartCountDialog;
