import { useState, useMemo } from "react";
import { formatPeriodLabel, getEffectivePeriodEndDate } from "@/utils/periodLabelUtils";
import { useInventoryTransfers, getTransferTotalsForPeriod } from "@/hooks/useInventoryTransfers";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Eye, ClipboardCheck,
  Crosshair, Loader2,
  Settings2, UtensilsCrossed, Carrot, ChevronDown,
  Play, Plus, CheckCircle2, Upload,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import OrderReconciliationPicker from "./OrderReconciliationPicker";
import VarianceReport from "./VarianceReport";
import InvoiceUploadDialog from "./InvoiceUploadDialog";
import SalesDateEditor from "./SalesDateEditor";

interface PeriodDetailPanelProps {
  count: any;
  locationId: string;
  onDeleteCount?: (count: any) => void;
  onCreateCountForPeriod?: (periodType: string, periodEndDate: string) => void;
  onStartDailyCount?: () => void;
}

export default function PeriodDetailPanel({ count, locationId, onDeleteCount, onCreateCountForPeriod, onStartDailyCount }: PeriodDetailPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const _stats = count._stats || { totalItems: 0, countedItems: 0, totalCost: 0 };
  const { isManager, isAdmin } = useUserRole();
  const canManageOrders = isManager || isAdmin;
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [realCountId, setRealCountId] = useState<string | null>(null);
  const [creatingCount, setCreatingCount] = useState(false);
  const hasCountedItems = (_stats.countedItems || 0) > 0;
  const isUpcoming = !!count._isUpcoming || (count.status === "in_progress" && !hasCountedItems);
  const [showPurchases, setShowPurchases] = useState(false);
  const { getTodayInTimezone, timezone } = useLocationTimezone();
  const todayStr = getTodayInTimezone();
  const { transfers } = useInventoryTransfers(locationId);
  

  // Fetch previous count to check if it was flex (affects current period start)
  const { data: prevCountData } = useQuery({
    queryKey: ["prev-count-flex", locationId, count.period_end_date],
    queryFn: async () => {
      if (!count.period_end_date) return null;
      const { data } = await supabase
        .from("inventory_counts")
        .select("id, period_end_date, is_late_close, counted_at")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .lt("period_end_date", count.period_end_date)
        .order("period_end_date", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
    enabled: !!count.period_end_date && !!locationId,
    staleTime: 10 * 60 * 1000,
  });

  // Determine period date range for this count
  // For flex/late counts, extend sales end date to counted_at date
  // If PREVIOUS count was flex, current period starts the day after prev counted_at
  const periodRange = useMemo(() => {
    if (!count.period_end_date) return null;
    const endDate = count.period_end_date;
    let effectivePeriodEndDate = endDate;

    // Monthly close safeguard: when a monthly count is completed right at month rollover
    // (often before open on day 1), treat it as prior-month close for reporting windows.
    if (count.period_type === "monthly" && count.status === "completed" && count.counted_at) {
      const countedAtDate = new Date(count.counted_at);
      const localDateStr = formatInTimeZone(countedAtDate, timezone, "yyyy-MM-dd");
      const localDay = parseInt(formatInTimeZone(countedAtDate, timezone, "d"), 10);
      const localHour = parseInt(formatInTimeZone(countedAtDate, timezone, "HH"), 10);

      if (localDay <= 2) {
        let inferredEnd = localDateStr;
        if (localHour < 10) {
          inferredEnd = format(subDays(new Date(localDateStr + "T12:00:00"), 1), "yyyy-MM-dd");
        }

        if (inferredEnd < endDate) {
          effectivePeriodEndDate = inferredEnd;
        }
      }
    }
    
    let salesEndDate = effectivePeriodEndDate;
    // Priority: manual override > flex auto-calc > period end date
    if (count.sales_end_override) {
      salesEndDate = count.sales_end_override;
    } else if (count.is_late_close) {
      if (count.counted_at) {
        const countedAtDate = new Date(count.counted_at);
        const localDateStr = formatInTimeZone(countedAtDate, timezone, 'yyyy-MM-dd');
        const localHour = parseInt(formatInTimeZone(countedAtDate, timezone, 'HH'), 10);
        
        // If counted before 10 AM, store wasn't open yet — sales thru previous day
        if (localHour < 10) {
          const prevDay = subDays(new Date(localDateStr + 'T12:00:00'), 1);
          salesEndDate = format(prevDay, 'yyyy-MM-dd');
        } else {
          salesEndDate = localDateStr;
        }
      } else {
        const yesterday = subDays(new Date(), 1);
        const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
        if (yesterdayStr > effectivePeriodEndDate) {
          salesEndDate = yesterdayStr;
        }
      }
    }

    // Calculate standard start date
    let standardStart: string;
    if (count.period_type === "weekly") {
      const end = new Date(effectivePeriodEndDate + "T12:00:00");
      const start = subDays(end, 6);
      standardStart = format(start, "yyyy-MM-dd");
    } else if (count.period_type === "monthly") {
      const end = new Date(effectivePeriodEndDate + "T12:00:00");
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      standardStart = format(start, "yyyy-MM-dd");
    } else {
      return null;
    }

    // If previous count was flex/late close, adjust start to day after its counted_at
    let adjustedStart = standardStart;
    let isFlexAdjusted = false;
    if (prevCountData?.is_late_close && prevCountData?.counted_at) {
      const prevCountedDate = formatInTimeZone(new Date(prevCountData.counted_at), timezone, 'yyyy-MM-dd');
      const dayAfterPrevCount = format(
        new Date(new Date(prevCountedDate + "T12:00:00").getTime() + 86400000),
        "yyyy-MM-dd"
      );
      // Only adjust if the day after prev count is later than standard start
      if (dayAfterPrevCount > standardStart) {
        adjustedStart = dayAfterPrevCount;
        isFlexAdjusted = true;
      }
    }

    // Calculate active days — use salesEndDate for flex counts (extended window)
    const startMs = new Date(adjustedStart + "T12:00:00").getTime();
    const effectiveEnd = salesEndDate > effectivePeriodEndDate ? salesEndDate : effectivePeriodEndDate;
    const endMs = new Date(effectiveEnd + "T12:00:00").getTime();
    const activeDays = Math.round((endMs - startMs) / 86400000) + 1;
    const isNonStandard = activeDays !== 7 && count.period_type === "weekly";

    return {
      startStr: adjustedStart,
      endStr: effectivePeriodEndDate,
      salesEndStr: salesEndDate,
      isFlexAdjusted,
      activeDays,
      isNonStandard,
    };
  }, [count.period_end_date, count.period_type, count.is_late_close, count.counted_at, count.sales_end_override, prevCountData, timezone]);

  // Compute transfer totals for this period
  const transferTotals = useMemo(() => {
    if (!periodRange || !transfers.length) return { transfersIn: 0, transfersOut: 0, transfersInItems: [], transfersOutItems: [] };
    return getTransferTotalsForPeriod(transfers, locationId, periodRange.startStr, periodRange.endStr);
  }, [transfers, locationId, periodRange]);

  // Fetch COGS data — now uses bound orders instead of date-range
  const { data: cogsData, isLoading: cogsLoading } = useQuery({
    queryKey: ["period-cogs", locationId, count.id, periodRange?.startStr, periodRange?.endStr],
    queryFn: async () => {
      if (!periodRange) return null;

      // For upcoming periods, only fetch purchases (no count items exist yet)
      if (isUpcoming) {
        // For monthly/yearly upcoming periods, also grab orders bound to child weekly counts
        const isAggregatingUpcoming = count.period_type === "monthly" || count.period_type === "yearly";
        let childCountIds: string[] = [];
        if (isAggregatingUpcoming) {
          const { data: childCounts } = await supabase
            .from("inventory_counts")
            .select("id")
            .eq("location_id", locationId)
            .eq("period_type", "weekly")
            .gte("period_end_date", periodRange.startStr)
            .lte("period_end_date", periodRange.endStr);
          childCountIds = (childCounts || []).map(c => c.id);
        }
        const allUpcomingCountIds = [realCountId, ...childCountIds].filter(Boolean) as string[];

        const [pfgDateRange, paDateRange, vendorInvoicesRange] = await Promise.all([
          supabase
            .from("pfg_orders")
            .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
            .eq("location_id", locationId)
            .is("bound_to_count_id", null)
            .gte("delivery_date", periodRange.startStr)
            .lte("delivery_date", periodRange.endStr)
            .order("delivery_date", { ascending: true }),
          supabase
            .from("pa_orders")
            .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
            .eq("location_id", locationId)
            .is("bound_to_count_id", null)
            .gte("delivery_date", periodRange.startStr)
            .lte("delivery_date", periodRange.endStr)
            .order("delivery_date", { ascending: true }),
          supabase
            .from("vendor_invoices")
            .select("id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status, inventory_count_id")
            .eq("location_id", locationId)
            .eq("status", "parsed")
            .is("inventory_count_id", null)
            .or(`delivery_date.gte.${periodRange.startStr},invoice_date.gte.${periodRange.startStr}`)
            .or(`delivery_date.lte.${periodRange.endStr},invoice_date.lte.${periodRange.endStr}`)
            .order("delivery_date", { ascending: true }),
        ]);

        // Also check for orders bound to this count or child weekly counts
        let pfgBound: any[] = [];
        let paBound: any[] = [];
        let vendorBound: any[] = [];
        if (allUpcomingCountIds.length > 0) {
          const [pfgB, paB, vendorB] = await Promise.all([
            supabase
              .from("pfg_orders")
              .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
              .eq("location_id", locationId)
              .in("bound_to_count_id", allUpcomingCountIds)
              .order("delivery_date", { ascending: true }),
            supabase
              .from("pa_orders")
              .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
              .eq("location_id", locationId)
              .in("bound_to_count_id", allUpcomingCountIds)
              .order("delivery_date", { ascending: true }),
            supabase
              .from("vendor_invoices")
              .select("id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status, inventory_count_id")
              .eq("location_id", locationId)
              .eq("status", "parsed")
              .in("inventory_count_id", allUpcomingCountIds)
              .order("delivery_date", { ascending: true }),
          ]);
          pfgBound = pfgB.data || [];
          paBound = paB.data || [];
          vendorBound = vendorB.data || [];
        }

        // Deduplicate and merge
        const dedup = (arr: any[]) => {
          const seen = new Set<string>();
          return arr.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
        };
        const hasBoundOrders = pfgBound.length + paBound.length + vendorBound.length > 0;
        const pfg = hasBoundOrders ? dedup(pfgBound) : (pfgDateRange.data || []);
        const pa = hasBoundOrders ? dedup(paBound) : (paDateRange.data || []);
        const vendorInv = hasBoundOrders ? dedup(vendorBound) : (vendorInvoicesRange.data || []).filter((vi: any) => {
          const d = vi.delivery_date || vi.invoice_date;
          return d && d >= periodRange.startStr && d <= periodRange.endStr;
        });
        const purchasesTotal = [...pfg, ...pa, ...vendorInv].reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

        return {
          beginValue: 0,
          endValue: 0,
          purchasesTotal,
          cogsTotal: 0,
          netSales: 0,
          cogsPct: 0,
          hasBeginning: false,
          hasBoundOrders,
          isUpcoming: true,
          purchases: [
            ...pfg.map((o: any) => {
              const rawId = o.pfg_order_id || '';
              const cleanId = o.order_number || (rawId.includes('_') ? rawId.split('_').pop() : rawId) || o.id.slice(0, 8);
              const deliveryDateLabel = o.delivery_date ? format(new Date(o.delivery_date + "T12:00:00"), "EEEE, MMM d") : null;
              return { vendor: "PFG", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel };
            }),
            ...pa.map((o: any) => {
              const cleanId = o.order_number || o.pa_order_id || o.id.slice(0, 8);
              const deliveryDateLabel = o.delivery_date ? format(new Date(o.delivery_date + "T12:00:00"), "EEEE, MMM d") : null;
              return { vendor: "PA", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel };
            }),
            ...vendorInv.map((o: any) => {
              const d = o.delivery_date || o.invoice_date;
              const cleanId = o.invoice_number || o.id.slice(0, 8);
              const deliveryDateLabel = d ? format(new Date(d + "T12:00:00"), "EEEE, MMM d") : null;
              return { vendor: o.vendor_name || "Invoice", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: d ? format(new Date(d + "T12:00:00"), "MMM d") : "—", deliveryDate: deliveryDateLabel };
            }),
          ],
        };
      }

      // Beginning: most recent completed count before this period
      const { data: beginCounts } = await supabase
        .from("inventory_counts")
        .select("id, period_end_date, count_date")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .lt("period_end_date", periodRange.startStr)
        .order("period_end_date", { ascending: false })
        .limit(1);

      const beginCount = beginCounts?.[0] || null;

      const [beginItems, endItems] = await Promise.all([
        beginCount
          ? supabase.from("inventory_count_items").select("item_id, quantity").eq("count_id", beginCount.id)
          : { data: [] },
        supabase.from("inventory_count_items").select("item_id, quantity").eq("count_id", count.id),
      ]);

      // Collect all item_ids referenced in both counts to include inactive items
      const referencedIds = new Set<string>();
      for (const ci of (beginItems.data as any[]) || []) referencedIds.add(ci.item_id);
      for (const ci of (endItems.data as any[]) || []) referencedIds.add(ci.item_id);

      // Fetch costs for ALL referenced items (active + inactive) so deactivating
      // an item after counting doesn't silently drop its value from COGS
      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, cost_per_unit, pack_quantity, pack_quantity_override, count_units_per_case, is_recipe")
        .in("id", Array.from(referencedIds));

      const costMap = new Map<string, number>();
      for (const i of items || []) {
        const packQty = (i as any).pack_quantity_override ?? (i.pack_quantity || 1);
        costMap.set(i.id, (Number(i.cost_per_unit) || 0) / Math.max(packQty, 1));
      }

      let beginValue = 0;
      for (const ci of (beginItems.data as any[]) || []) {
        beginValue += Number(ci.quantity) * (costMap.get(ci.item_id) || 0);
      }

      let endValue = 0;
      for (const ci of (endItems.data as any[]) || []) {
        endValue += Number(ci.quantity) * (costMap.get(ci.item_id) || 0);
      }

      // Purchases: Manage Orders is the single source of truth.
      // Weekly: only orders with bound_to_count_id = this count's ID
      // Monthly: this count's ID + orders bound to child weekly counts in the period
      const isAggregatingPeriod = count.period_type === "monthly" || count.period_type === "yearly";
      const allCountIds = [count.id];
      if (isAggregatingPeriod) {
        const { data: childCounts } = await supabase
          .from("inventory_counts")
          .select("id")
          .eq("location_id", locationId)
          .eq("period_type", "weekly")
          .gte("period_end_date", periodRange.startStr)
          .lte("period_end_date", periodRange.endStr);
        for (const c of childCounts || []) allCountIds.push(c.id);
      }

      // Fetch ONLY orders bound to these count IDs — no date-range fallback
      const [pfgResult, paResult, vendorResult] = await Promise.all([
        supabase
          .from("pfg_orders")
          .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
          .eq("location_id", locationId)
          .in("bound_to_count_id", allCountIds)
          .order("delivery_date", { ascending: true }),
        supabase
          .from("pa_orders")
          .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
          .eq("location_id", locationId)
          .in("bound_to_count_id", allCountIds)
          .order("delivery_date", { ascending: true }),
        supabase
          .from("vendor_invoices")
          .select("id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status, inventory_count_id")
          .eq("location_id", locationId)
          .eq("status", "parsed")
          .in("inventory_count_id", allCountIds)
          .order("delivery_date", { ascending: true }),
      ]);

      const pfg = pfgResult.data || [];
      const pa = paResult.data || [];
      const vendorInv = vendorResult.data || [];

      
      const purchasesTotal = [...pfg, ...pa, ...vendorInv].reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

      const { data: salesRows } = await supabase
        .from("sales_cache")
        .select("net_sales")
        .eq("location_id", locationId)
        .gte("sale_date", periodRange.startStr)
        .lte("sale_date", periodRange.salesEndStr);

      const netSales = (salesRows || []).reduce((s, d) => s + (Number(d.net_sales) || 0), 0);
      
      // Transfers will be calculated separately and merged at render time
      const cogsTotal = beginValue + purchasesTotal - endValue;
      const cogsPct = netSales > 0 ? (cogsTotal / netSales) * 100 : 0;

      return {
        beginValue,
        endValue,
        purchasesTotal,
        cogsTotal,
        netSales,
        cogsPct,
        hasBeginning: !!beginCount,
        hasBoundOrders: pfg.length + pa.length + vendorInv.length > 0,
        purchases: [
          ...pfg.map((o: any) => {
            const rawId = o.pfg_order_id || '';
            const cleanId = o.order_number || (rawId.includes('_') ? rawId.split('_').pop() : rawId) || o.id.slice(0, 8);
            const deliveryDateLabel = o.delivery_date ? format(new Date(o.delivery_date + "T12:00:00"), "EEEE, MMM d") : null;
            return { vendor: "PFG", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel };
          }),
          ...pa.map((o: any) => {
            const cleanId = o.order_number || o.pa_order_id || o.id.slice(0, 8);
            const deliveryDateLabel = o.delivery_date ? format(new Date(o.delivery_date + "T12:00:00"), "EEEE, MMM d") : null;
            return { vendor: "PA", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel };
          }),
          ...vendorInv.map((o: any) => {
            const d = o.delivery_date || o.invoice_date;
            const cleanId = o.invoice_number || o.id.slice(0, 8);
            const deliveryDateLabel = d ? format(new Date(d + "T12:00:00"), "EEEE, MMM d") : null;
            return { vendor: o.vendor_name || "Invoice", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: d ? format(new Date(d + "T12:00:00"), "MMM d") : "—", deliveryDate: deliveryDateLabel };
          }),
        ],
      };
    },
    enabled: !!periodRange && (count.status === "completed" || count.status === "in_progress" || isUpcoming),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch spot checks
  const { data: spotChecks } = useQuery({
    queryKey: ["period-spot-checks", locationId, periodRange?.startStr, periodRange?.endStr],
    queryFn: async () => {
      if (!periodRange) return [];
      const { data, error } = await supabase
        .from("daily_spot_counts")
        .select("*, items:daily_spot_count_items(*, inventory_item:inventory_items(name))")
        .eq("location_id", locationId)
        .gte("count_date", periodRange.startStr)
        .lte("count_date", periodRange.endStr)
        .order("started_at", { ascending: false });
      if (error) return [];
      return data || [];
    },
    enabled: !!periodRange,
    staleTime: 5 * 60 * 1000,
  });

  

  return (
    <motion.div
      key={count.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="space-y-4"
    >
      {/* COGS Summary Card */}
      {cogsLoading ? (
        <Card>
          <CardContent className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : isUpcoming ? (
        /* Upcoming period: no count started */
        <Card className="border-primary/20">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <p className="text-base font-bold leading-tight">{formatPeriodLabel(count)}</p>
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[18px] uppercase border-primary/40 text-primary">
                  Current
                </Badge>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <div className="text-right">
                  <p className="text-2xl font-bold leading-none text-muted-foreground/40">--.--%</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">COGS</p>
                </div>
                <Button
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={() => onCreateCountForPeriod?.(count.period_type, count.period_end_date)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mb-4">
              {periodRange && (
                <p className="text-xs font-medium text-primary/80">
                  {format(new Date(periodRange.startStr + "T12:00:00"), "EEE, MMM d")} – {format(new Date(periodRange.endStr + "T12:00:00"), "EEE, MMM d, yyyy")}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                Count not started yet
              </p>
            </div>
            {cogsData && cogsData.purchases.length > 0 && (
              <div className="p-3 rounded-xl bg-muted/40">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Purchases this period</span>
                  <span className="text-lg font-bold">${Math.round(cogsData.purchasesTotal).toLocaleString()}</span>
                </div>
              </div>
            )}
            {count.period_type === "weekly" && (
              <DailySpotChecksGrid periodRange={periodRange} spotChecks={spotChecks} locationId={locationId} todayStr={todayStr} onStartDailyCount={onStartDailyCount} />
            )}
          </CardContent>
        </Card>
      ) : cogsData ? (
        <Card className="relative">
          <CardContent className="p-4 sm:p-5">
            {/* Top row: COGS % pinned right */}
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <p className="text-base font-bold leading-tight">{formatPeriodLabel(count)}</p>
                {count.status === "completed" && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[18px] uppercase border-emerald-500/50 text-emerald-600">
                    Submitted
                  </Badge>
                )}
                {count.status === "in_progress" && hasCountedItems && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[18px] uppercase border-amber-500/50 text-amber-600">
                    In Progress
                  </Badge>
                )}
                {count.is_late_close && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[18px] uppercase border-amber-500/50 text-amber-600">
                    Flex
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <div className="text-right">
                  {(() => {
                    const adjCogs = cogsData.cogsTotal + transferTotals.transfersIn - transferTotals.transfersOut;
                    const adjPct = cogsData.netSales > 0 ? (adjCogs / cogsData.netSales) * 100 : 0;
                    return (
                      <>
                        <p className={`text-2xl font-bold leading-none ${
                          count.status === "completed"
                            ? (adjPct > 22 ? "text-destructive" : "")
                            : "text-muted-foreground"
                        }`}>
                          {adjPct.toFixed(1)}%
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">COGS</p>
                      </>
                    );
                  })()}
                </div>
                {count.status === "in_progress" && hasCountedItems && (
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    onClick={() => navigate(`/inventory/${locationId}/count/${count.id}?continue=true`)}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            {/* Sub-details */}
            <div className="mb-4">
              {periodRange && (
                <div className="flex items-center gap-0.5 flex-wrap">
                  <p className="text-xs font-medium text-primary/80">
                    {format(new Date(periodRange.startStr + "T12:00:00"), "EEE, MMM d")} – {format(new Date(periodRange.endStr + "T12:00:00"), "EEE, MMM d, yyyy")}
                    {periodRange.salesEndStr !== periodRange.endStr && (
                      <span className="text-amber-600 ml-1">(sales thru {format(new Date(periodRange.salesEndStr + "T12:00:00"), "MMM d")})</span>
                    )}
                  </p>
                  {canManageOrders && count.status === "completed" && (
                    <SalesDateEditor
                      countId={count.id}
                      locationId={locationId}
                      startStr={periodRange.startStr}
                      endStr={periodRange.endStr}
                      salesEndStr={periodRange.salesEndStr}
                      canEdit={canManageOrders}
                      currentOverride={count.sales_end_override || null}
                    />
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {count.counted_by_profile?.full_name || "Unknown"}
                {count.completed_at &&
                  ` • ${format(new Date(count.completed_at), "MMM d 'at' h:mm a")}`}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SummaryMetric label="BEGINNING" value={`$${Math.round(cogsData.beginValue).toLocaleString()}`} />
              {/* PURCHASES box — tappable to expand purchases list */}
              <button 
                className="text-center p-2 rounded-xl bg-primary/10 hover:bg-primary/20 active:scale-[0.97] transition-all cursor-pointer ring-1 ring-primary/25"
                onClick={() => setShowPurchases(!showPurchases)}
              >
                <p className="text-base font-bold">${Math.round(cogsData.purchasesTotal).toLocaleString()}</p>
                <div className="flex items-center justify-center gap-1.5 mt-0.5">
                  <p className="text-[11px] text-primary uppercase tracking-wide font-medium">PURCHASES</p>
                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <ChevronDown className={`h-2.5 w-2.5 text-primary transition-transform ${showPurchases ? "rotate-180" : ""}`} />
                  </div>
                </div>
              </button>
              {/* ENDING box — tappable, navigates to review screen */}
              <button
                className="text-center p-2 rounded-xl bg-primary/10 hover:bg-primary/20 active:scale-[0.97] transition-all cursor-pointer ring-1 ring-primary/25"
                onClick={() => navigate(`/inventory/${locationId}/count/${count.id}`)}
              >
                <p className="text-base font-bold">${Math.round(cogsData.endValue).toLocaleString()}</p>
                <div className="flex items-center justify-center gap-1.5 mt-0.5">
                  <p className="text-[11px] text-primary uppercase tracking-wide font-medium">REVIEW</p>
                  <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Eye className="h-2.5 w-2.5 text-primary" />
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-muted/40 space-y-1.5">
              <FormulaRow label="Beginning Inventory" value={cogsData.beginValue} />
              
              {/* Expandable Purchases row */}
              <button 
                className="flex items-center justify-between w-full group"
                onClick={() => setShowPurchases(!showPurchases)}
              >
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">+ Purchases</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">${Math.round(cogsData.purchasesTotal).toLocaleString()}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showPurchases ? "rotate-180" : ""}`} />
                </div>
              </button>
              
              {/* Inline purchases list */}
              {showPurchases && (
                <div className="pl-3 border-l-2 border-border/60 ml-1 space-y-2 pt-1.5 pb-1">
                  {cogsData.purchases && cogsData.purchases.length > 0 ? (
                    <>
                      {cogsData.purchases.map((po: any, i: number) => (
                        <div key={i} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-md flex items-center justify-center ${
                              po.vendor === "PFG" ? "bg-red-500/15 text-red-600" : "bg-green-500/15 text-green-600"
                            }`}>
                              {po.vendor === "PFG" ? <UtensilsCrossed className="h-3 w-3" /> : <Carrot className="h-3 w-3" />}
                            </div>
                            <div>
                              <p className="text-xs font-medium font-mono">{po.vendor} #{po.id}</p>
                              <p className="text-[10px] text-muted-foreground">Delivered {po.deliveryDate || po.date}</p>
                            </div>
                          </div>
                          <p className="text-xs font-semibold">${po.amount.toLocaleString()}</p>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No orders found</p>
                  )}
                  {canManageOrders && periodRange && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs mt-1"
                      disabled={creatingCount}
                      onClick={async () => {
                        if (isUpcoming && !realCountId) {
                          setCreatingCount(true);
                          try {
                            const { data, error } = await supabase
                              .from("inventory_counts")
                              .insert({
                                location_id: locationId,
                                counted_by: user?.id,
                                count_date: new Date().toISOString().split("T")[0],
                                period_type: count.period_type,
                                period_end_date: count.period_end_date,
                                status: "in_progress",
                              })
                              .select()
                              .single();
                            if (error) throw error;
                            setRealCountId(data.id);
                            queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
                            queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
                            toast.success("Period created — you can now bind orders");
                            setShowOrderDialog(true);
                          } catch (err) {
                            console.error("Failed to create count:", err);
                            toast.error("Failed to create period");
                          } finally {
                            setCreatingCount(false);
                          }
                        } else {
                          setShowOrderDialog(true);
                        }
                      }}
                    >
                      {creatingCount ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Settings2 className="h-3 w-3 mr-1" />
                      )}
                      Manage Orders
                    </Button>
                  )}
                  {canManageOrders && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs mt-1"
                      onClick={() => setShowInvoiceUpload(true)}
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      Upload Invoice
                    </Button>
                  )}
                </div>
              )}

              {/* Transfer rows */}
              {transferTotals.transfersIn > 0 && (
                <FormulaRow label="+ Transfers In" value={transferTotals.transfersIn} />
              )}
              {transferTotals.transfersOut > 0 && (
                <FormulaRow label="− Transfers Out" value={transferTotals.transfersOut} />
              )}
              <FormulaRow label="− Ending Inventory" value={cogsData.endValue} />
              <div className="border-t border-border/60 pt-1.5 mt-1.5">
                <FormulaRow 
                  label="= Cost of Goods Sold" 
                  value={cogsData.cogsTotal + transferTotals.transfersIn - transferTotals.transfersOut} 
                  bold 
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Net Sales</span>
                <span className="text-sm font-medium">${Math.round(cogsData.netSales).toLocaleString()}</span>
              </div>
            </div>

            {count.period_type === "weekly" && (
              <DailySpotChecksGrid periodRange={periodRange} spotChecks={spotChecks} locationId={locationId} todayStr={todayStr} onStartDailyCount={onStartDailyCount} />
            )}

          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{formatPeriodLabel(count)}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {count.counted_by_profile?.full_name || "Unknown"}
                  {count.completed_at &&
                    ` • ${format(new Date(count.completed_at), "MMM d 'at' h:mm a")}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={count.status === "completed" ? "default" : "secondary"}>
                  {count.status === "completed" ? "Submitted" : hasCountedItems ? "In Progress" : "Not Started"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actual vs Theoretical Section */}
      {!isUpcoming && count.status === "completed" && count.period_end_date && cogsData && !cogsData.isUpcoming && (
        <VarianceReport
          countId={count.id}
          locationId={locationId}
          periodEndDate={count.period_end_date}
          provenCogs={{
            beginningValue: cogsData.beginValue,
            purchaseValue: cogsData.purchasesTotal,
            endingValue: cogsData.endValue,
            cogsTotal: cogsData.cogsTotal,
            netSales: cogsData.netSales,
          }}
        />
      )}




      {/* Manage Orders Dialog */}
      <Dialog open={showOrderDialog} onOpenChange={setShowOrderDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Orders for Period</DialogTitle>
            <DialogDescription>
              Select which vendor orders to include in this period's COGS calculation.
            </DialogDescription>
          </DialogHeader>
          <OrderReconciliationPicker
            locationId={locationId}
            countId={realCountId || count.id}
            periodStartDate={periodRange?.startStr}
            periodEndDate={periodRange?.endStr}
            editable
            onSaved={() => {
              setShowOrderDialog(false);
              queryClient.invalidateQueries({ queryKey: ["period-cogs", locationId, count.id] });
            }}
          />
        </DialogContent>
      </Dialog>

      <InvoiceUploadDialog
        open={showInvoiceUpload}
        onOpenChange={setShowInvoiceUpload}
        locationId={locationId}
        countId={realCountId || count.id}
      />
    </motion.div>
  );
}

// ——— Sub-components ———

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 rounded-xl bg-muted/40">
      <p className="text-base font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function FormulaRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${bold ? "font-bold text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm ${bold ? "font-bold" : "font-medium"}`}>${Math.round(value).toLocaleString()}</span>
    </div>
  );
}


// ——— Daily Spot Checks Grid ———
const DAY_INITIALS: Record<number, string> = { 0: "Su", 1: "M", 2: "T", 3: "W", 4: "Th", 5: "F", 6: "S" };

function DailySpotChecksGrid({
  periodRange,
  spotChecks,
  todayStr,
  onStartDailyCount,
}: {
  periodRange: { startStr: string; endStr: string } | null;
  spotChecks: any[] | undefined;
  locationId: string;
  todayStr: string;
  onStartDailyCount?: () => void;
}) {
  const [previewCheck, setPreviewCheck] = useState<any | null>(null);

  if (!periodRange) return null;

  const startDate = new Date(periodRange.startStr + "T12:00:00");
  const endDate = new Date(periodRange.endStr + "T12:00:00");
  const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const days = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d, key: format(d, "yyyy-MM-dd"), label: DAY_INITIALS[d.getDay()] };
  });

  const completedMap = new Map<string, any>();
  for (const sc of (spotChecks || [])) {
    if (sc.completed_at) completedMap.set(sc.count_date, sc);
  }
  const completedCount = days.filter((d) => completedMap.has(d.key)).length;

  return (
    <>
      <div className="mt-4 pt-3 border-t border-border/20">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Daily Spot Checks</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-medium">{completedCount}/{dayCount}</span>
        </div>

        <div className={`grid gap-1.5 ${dayCount <= 7 ? "grid-cols-7" : dayCount === 8 ? "grid-cols-8" : "grid-cols-7"}`}>
          {days.map((day) => {
            const isToday = day.key === todayStr;
            const isFuture = day.key > todayStr;
            const isCompleted = completedMap.has(day.key);
            const isPast = day.key < todayStr && !isCompleted;

            return (
              <div key={day.key} className="flex flex-col items-center">
                {isToday && !isCompleted ? (
                  <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-primary mb-0.5" />
                ) : (
                  <div className="h-[7px]" />
                )}
                <button
                  disabled={isFuture || isPast}
                  onClick={() => {
                    if (isCompleted) {
                      setPreviewCheck(completedMap.get(day.key));
                    } else if (isToday && onStartDailyCount) {
                      onStartDailyCount();
                    }
                  }}
                  className={`
                    w-full flex flex-col items-center gap-1 py-2 rounded-xl transition-all
                    ${isCompleted
                      ? "bg-emerald-500/10 border border-emerald-500/30 cursor-pointer"
                      : isToday
                        ? "bg-primary/8 border-2 border-primary/50 shadow-sm"
                        : isFuture
                          ? "bg-muted/20 border border-transparent opacity-35 cursor-not-allowed"
                          : "bg-muted/30 border border-border/20 opacity-50 cursor-not-allowed"
                    }
                  `}
                >
                  <span className={`text-[10px] font-bold leading-none tracking-wide ${
                    isToday ? "text-primary" : isCompleted ? "text-emerald-700" : "text-muted-foreground"
                  }`}>
                    {day.label}
                  </span>
                  <div className="h-5 w-5 flex items-center justify-center">
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : isToday ? (
                      <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                        <Play className="h-2.5 w-2.5 text-primary-foreground ml-[1px]" />
                      </div>
                    ) : (
                      <div className={`h-1.5 w-1.5 rounded-full ${isFuture ? "bg-muted-foreground/20" : "bg-muted-foreground/30"}`} />
                    )}
                  </div>
                  {isToday && !isCompleted && (
                    <span className="text-[7px] font-bold text-primary uppercase leading-none tracking-wider">Start</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spot Check Preview Dialog */}
      <Dialog open={!!previewCheck} onOpenChange={(open) => !open && setPreviewCheck(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-primary" />
              Spot Check — {previewCheck?.count_date ? format(new Date(previewCheck.count_date + "T12:00:00"), "EEE, MMM d") : ""}
            </DialogTitle>
            <DialogDescription>
              {previewCheck?.completed_at
                ? `Completed ${formatInTimeZone(new Date(previewCheck.completed_at), "America/Los_Angeles", "h:mm a")}`
                : "In progress"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto -mx-2 px-2 space-y-1.5">
            {previewCheck?.items?.length > 0 ? (
              previewCheck.items.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40">
                  <span className="text-sm font-medium truncate mr-2">
                    {item.inventory_item?.name || "Unknown"}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.previous_quantity != null && item.previous_quantity !== item.quantity && (
                      <span className="text-xs text-muted-foreground line-through">{item.previous_quantity}</span>
                    )}
                    <Badge variant="secondary" className="text-sm font-bold min-w-[2rem] justify-center">
                      {item.quantity}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No items recorded.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

