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
  Play, Plus, CheckCircle2, Upload, Trash2,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import OrderReconciliationPicker from "./OrderReconciliationPicker";
import { calculateCountItemValue } from "@/utils/countItemValue";
import { getEffectivePackQty } from "@/utils/getEffectivePackQty";
// VarianceReport moved to Review screen tabs (InventoryCountView → Actual vs Theo).
import InvoiceUploadDialog from "./InvoiceUploadDialog";
import LiteInvoiceUploadDialog from "./LiteInvoiceUploadDialog";
import { useInventoryMode } from "@/hooks/useInventoryMode";
import SalesDateEditor from "./SalesDateEditor";
import { useBrandConversions } from "@/hooks/useBrandConversions";
import { resolveBrandId } from "@/utils/resolveBrandId";
import { fetchRecipeCosts } from "@/utils/recipeCostCalculation";

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
  const { isLite } = useInventoryMode(locationId);
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

  // Resolve brand for Pipeline 1 conversion fallback (used when pack_quantity_at_count is NULL)
  const { data: brandId } = useQuery({
    queryKey: ["location-brand-id", locationId],
    queryFn: () => resolveBrandId(locationId),
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
  });
  const { conversionMap } = useBrandConversions(brandId);

  // Recipe live-cost map — used only as a fallback for in_progress counts where
  // an item.is_recipe === true and cost_per_unit is null/0. Submitted/completed
  // counts always read cost_at_count snapshots. Mirrors InventoryCountView.tsx:110.
  const { data: recipeCosts } = useQuery({
    queryKey: ["recipe-costs-for-period-panel", locationId],
    queryFn: () => fetchRecipeCosts(locationId),
    enabled: !!locationId,
    staleTime: 5 * 60 * 1000,
  });




  // Fetch previous count to check if it was flex (affects current period start)
  const { data: prevCountData } = useQuery({
    queryKey: ["prev-count-flex", locationId, count.period_end_date, count.period_type],
    queryFn: async () => {
      if (!count.period_end_date) return null;
      // Pull the latest few completed counts before this one so we can prefer a
      // same-period-type anchor when available, but fall back to the most recent
      // count of any type (e.g. a late-March weekly anchoring an April monthly
      // when no prior monthly exists).
      const { data } = await supabase
        .from("inventory_counts")
        .select("id, period_type, period_end_date, is_late_close, counted_at, sales_end_override, sales_start_override")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .eq("is_sandbox", false)
        .lt("period_end_date", count.period_end_date)
        .order("period_end_date", { ascending: false })
        .limit(5);
      if (!data || data.length === 0) return null;
      const sameType = data.find((c) => c.period_type === count.period_type);
      // Same-type takes priority; otherwise fall back to most-recent of any type.
      return sameType || data[0];
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

    // Chain this period's start off the previous count so no sales day is double-counted
    // or dropped. Two adjustments are possible:
    //   • Trim forward — when prev was flexed past its own period end (same period type),
    //     start the day after prev's extended end (existing weekly→weekly behavior).
    //   • Extend backward — when prev is a different period type and ended just before
    //     this period's standard start, pull start back to day-after-prev so the gap days
    //     are captured (e.g. a Mar 29 weekly anchoring an April monthly → start Mar 30).
    let adjustedStart = standardStart;
    let isFlexAdjusted = false;
    if (prevCountData) {
      // Resolve prev's effective sales-end with the same priority used for the current
      // count: sales_end_override > is_late_close+counted_at > period_end_date.
      let prevEffectiveEnd: string | null = null;
      if (prevCountData.sales_end_override) {
        prevEffectiveEnd = prevCountData.sales_end_override;
      } else if (prevCountData.is_late_close && prevCountData.counted_at) {
        const prevCountedAt = new Date(prevCountData.counted_at);
        const prevLocalDateStr = formatInTimeZone(prevCountedAt, timezone, 'yyyy-MM-dd');
        const prevLocalHour = parseInt(formatInTimeZone(prevCountedAt, timezone, 'HH'), 10);
        // Counted before 10 AM → store wasn't open yet → sales thru previous day
        prevEffectiveEnd = prevLocalHour < 10
          ? format(subDays(new Date(prevLocalDateStr + 'T12:00:00'), 1), 'yyyy-MM-dd')
          : prevLocalDateStr;
      } else if (prevCountData.period_end_date) {
        prevEffectiveEnd = prevCountData.period_end_date;
      }

      if (prevEffectiveEnd) {
        const dayAfterPrev = format(
          new Date(new Date(prevEffectiveEnd + "T12:00:00").getTime() + 86400000),
          "yyyy-MM-dd"
        );
        const sameType = prevCountData.period_type === count.period_type;

        if (sameType) {
          // Trim forward: only matters when prev was flexed past its period end
          if (
            prevEffectiveEnd >= (prevCountData.period_end_date || '') &&
            dayAfterPrev > standardStart
          ) {
            adjustedStart = dayAfterPrev;
            isFlexAdjusted = true;
          }
        } else {
          // Cross-type fallback: extend backward to capture gap days between the prior
          // count and this period's standard start. Never push start forward via cross-type.
          if (dayAfterPrev < standardStart) {
            adjustedStart = dayAfterPrev;
            isFlexAdjusted = true;
          }
        }
      }
    }

    // Manual start override always wins (set by user via SalesDateEditor)
    if (count.sales_start_override) {
      adjustedStart = count.sales_start_override;
      isFlexAdjusted = adjustedStart !== standardStart;
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
  }, [count.period_end_date, count.period_type, count.status, count.is_late_close, count.counted_at, count.sales_end_override, count.sales_start_override, prevCountData?.id, prevCountData?.period_type, prevCountData?.is_late_close, prevCountData?.counted_at, prevCountData?.sales_end_override, prevCountData?.period_end_date, timezone]);

  // Compute transfer totals for this period
  const transferTotals = useMemo(() => {
    if (!periodRange || !transfers.length) return { transfersIn: 0, transfersOut: 0, transfersInItems: [], transfersOutItems: [] };
    return getTransferTotalsForPeriod(transfers, locationId, periodRange.startStr, periodRange.endStr);
  }, [transfers, locationId, periodRange]);

  // Fetch COGS data — now uses bound orders instead of date-range
  const { data: cogsData, isLoading: cogsLoading } = useQuery({
    queryKey: ["period-cogs", locationId, count.id, realCountId, periodRange?.startStr, periodRange?.endStr, conversionMap.size],
    queryFn: async () => {
      if (!periodRange) return null;
      const effectiveCountId = realCountId || count.id;

      // Flag manually-assigned deliveries that fall outside this period's
      // calendar window. They still count toward COGS (the manager's checkbox
      // is the source of truth) — the flag exists so a mis-check is visible.
      const isOutsideWindow = (d: string | null | undefined) =>
        !!d && (d < periodRange.startStr || d > periodRange.endStr);

      // Resolve assigned + inherited orders for THIS count via the new
      // inventory_order_assignments / inventory_order_exclusions tables. This is
      // the single source of truth — weekly and monthly assignments are decoupled
      // by period_type, so editing one no longer drifts the other.
      const periodType = count.period_type as "weekly" | "monthly" | "yearly";
      const isAggregating = periodType === "monthly" || periodType === "yearly";

      // Child weekly counts (for monthly/yearly inheritance)
      let childWeeklyCountIds: string[] = [];
      if (isAggregating) {
        const { data: childCounts } = await supabase
          .from("inventory_counts")
          .select("id")
          .eq("location_id", locationId)
          .eq("is_sandbox", false)
          .eq("period_type", "weekly")
          .gte("period_end_date", periodRange.startStr)
          .lte("period_end_date", periodRange.endStr);
        childWeeklyCountIds = (childCounts || []).map((c) => c.id);
      }

      const [sameTypeAssignmentsRaw, childWeeklyAssignmentsRaw, exclusionsResult] = await Promise.all([
        supabase
          .from("inventory_order_assignments" as any)
          .select("source_type, source_row_id, count_id")
          .eq("location_id", locationId)
          .eq("period_type", periodType),
        isAggregating && childWeeklyCountIds.length > 0
          ? supabase
              .from("inventory_order_assignments" as any)
              .select("source_type, source_row_id")
              .eq("location_id", locationId)
              .eq("period_type", "weekly")
              .in("count_id", childWeeklyCountIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase
          .from("inventory_order_exclusions" as any)
          .select("source_type, source_row_id")
          .eq("location_id", locationId)
          .eq("period_type", periodType)
          .eq("count_id", effectiveCountId),
      ]);

      const exclusionSet = new Set<string>(
        ((exclusionsResult.data as any[]) || []).map((e) => `${e.source_type}_${e.source_row_id}`)
      );
      const sameTypeAssignmentMap = new Map<string, string>();
      for (const assignment of (sameTypeAssignmentsRaw.data as any[]) || []) {
        sameTypeAssignmentMap.set(
          `${assignment.source_type}_${assignment.source_row_id}`,
          assignment.count_id,
        );
      }

      const targetIds: Record<"pfg" | "pa" | "invoice", Set<string>> = {
        pfg: new Set(),
        pa: new Set(),
        invoice: new Set(),
      };
      for (const a of (sameTypeAssignmentsRaw.data as any[]) || []) {
        if (a.count_id !== effectiveCountId) continue;
        targetIds[a.source_type as "pfg" | "pa" | "invoice"]?.add(a.source_row_id);
      }

      for (const a of (childWeeklyAssignmentsRaw.data as any[]) || []) {
        const k = `${a.source_type}_${a.source_row_id}`;
        const sameTypeAssignedCountId = sameTypeAssignmentMap.get(k);
        const isLockedToOtherSameType = !!sameTypeAssignedCountId && sameTypeAssignedCountId !== effectiveCountId;

        if (!exclusionSet.has(k) && !isLockedToOtherSameType) {
          targetIds[a.source_type as "pfg" | "pa" | "invoice"]?.add(a.source_row_id);
        }
      }

      const fetchByIds = async (table: "pfg_orders" | "pa_orders" | "vendor_invoices", ids: string[], cols: string) => {
        if (ids.length === 0) return [] as any[];
        const { data } = await (supabase.from(table) as any)
          .select(cols)
          .in("id", ids)
          .order("delivery_date", { ascending: true });
        return data || [];
      };

      // For upcoming periods, only fetch purchases (no count items exist yet)
      if (isUpcoming) {
        const [pfg, pa, vendorInv] = await Promise.all([
          fetchByIds("pfg_orders", [...targetIds.pfg], "id, pfg_order_id, order_number, order_date, delivery_date, total_amount"),
          fetchByIds("pa_orders", [...targetIds.pa], "id, pa_order_id, order_number, order_date, delivery_date, total_amount"),
          fetchByIds("vendor_invoices", [...targetIds.invoice], "id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status"),
        ]);
        const hasBoundOrders = pfg.length + pa.length + vendorInv.length > 0;
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
              return { vendor: "PFG", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel, outsideWindow: isOutsideWindow(o.delivery_date) };
            }),
            ...pa.map((o: any) => {
              const cleanId = o.order_number || o.pa_order_id || o.id.slice(0, 8);
              const deliveryDateLabel = o.delivery_date ? format(new Date(o.delivery_date + "T12:00:00"), "EEEE, MMM d") : null;
              return { vendor: "PA", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel, outsideWindow: isOutsideWindow(o.delivery_date) };
            }),
            ...vendorInv.map((o: any) => {
              const d = o.delivery_date || o.invoice_date;
              const cleanId = o.invoice_number || o.id.slice(0, 8);
              const deliveryDateLabel = d ? format(new Date(d + "T12:00:00"), "EEEE, MMM d") : null;
              return { vendor: o.vendor_name || "Invoice", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: d ? format(new Date(d + "T12:00:00"), "MMM d") : "—", deliveryDate: deliveryDateLabel, outsideWindow: isOutsideWindow(d) };
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
        .eq("is_sandbox", false)
        .lt("period_end_date", periodRange.startStr)
        .order("period_end_date", { ascending: false })
        .limit(1);

      const beginCount = beginCounts?.[0] || null;

      const [beginItems, endItems] = await Promise.all([
        beginCount
          ? supabase.from("inventory_count_items").select("id, item_id, quantity, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, entered_cases, entered_units, entered_inner_packs").eq("count_id", beginCount.id)
          : { data: [] },
        supabase.from("inventory_count_items").select("id, item_id, quantity, cost_at_count, pack_quantity_at_count, inner_pack_quantity_at_count, entered_cases, entered_units, entered_inner_packs").eq("count_id", count.id),
      ]);

      // Collect all item_ids referenced in both counts to include inactive items
      const referencedIds = new Set<string>();
      for (const ci of (beginItems.data as any[]) || []) referencedIds.add(ci.item_id);
      for (const ci of (endItems.data as any[]) || []) referencedIds.add(ci.item_id);

      // Fetch costs for ALL referenced items (active + inactive) so deactivating
      // an item after counting doesn't silently drop its value from COGS
      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, cost_per_unit, pack_quantity, pack_quantity_override, inner_pack_quantity, count_units_per_case, is_recipe, brand_item_id, unit, recipe_yield_qty, recipe_yield_unit")
        .in("id", Array.from(referencedIds));

      const itemMap = new Map<string, any>();
      for (const i of items || []) {
        itemMap.set(i.id, i);
      }

      // Leg-aware valuation shared with Session / Review / Export / Inventory summary.
      // One context fetch covers both begin + end counts. When legs are off at this
      // location the helper returns empty maps and getItemValueWithLegs cleanly falls
      // through to the canonical parent-row path (no regression).
      const { fetchLegsValuationContext, makeGetItemValueWithLegs } = await import("@/hooks/useLegsValuation");
      const periodCountIds = [beginCount?.id, count.id].filter(Boolean) as string[];
      const legsCtx = await fetchLegsValuationContext({ locationId, countIds: periodCountIds });
      const getItemValueWithLegs = makeGetItemValueWithLegs(legsCtx);

      // Single source of truth — see src/utils/countItemValue.ts
      // forceLiveData=false → honor snapshot fields (cost_at_count, pack_quantity_at_count)
      // saved at submit time. Historical counts must read what was stored, not recompute
      // with today's mutated live pack_quantity values. Recipes bypass legs (never
      // multi-config) and stay on calculateCountItemValue directly.
      const getCountItemLineValue = (ci: any) => {
        const item = itemMap.get(ci.item_id);
        const conversion = item?.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
        // Recipe live-cost fallback — only for the current (end) count when it
        // is still in_progress AND the recipe has no cost_per_unit. Begin count
        // (always completed in a period) and any historical row read snapshots.
        const ciIsCurrentInProgress = ci.count_id === count.id && count.status === 'in_progress';
        const isRecipe = item?.is_recipe === true;
        const needsLive = isRecipe && (item?.cost_per_unit == null || item?.cost_per_unit === 0);
        const liveCpu = (ciIsCurrentInProgress && needsLive) ? recipeCosts?.get(ci.item_id) : undefined;
        const itemForValue = item ? {
          brand_item_id: item.brand_item_id,
          cost_per_unit: liveCpu ?? item.cost_per_unit,
          pack_quantity: item.pack_quantity,
          pack_quantity_override: item.pack_quantity_override,
          inner_pack_quantity: item.inner_pack_quantity,
          is_recipe: item.is_recipe === true,
          unit: item.unit,
          recipe_yield_qty: item.recipe_yield_qty,
          recipe_yield_unit: item.recipe_yield_unit,
        } : undefined;
        if (item?.is_recipe === true) {
          return calculateCountItemValue(ci, itemForValue, conversion || null, false);
        }
        return getItemValueWithLegs(ci, itemForValue, conversion || null, { forceLiveData: false });
      };

      const getLivePerUnitCost = (itemId: string) => {
        const item = itemMap.get(itemId);
        const packQty = getEffectivePackQty(item || {});
        return (Number(item?.cost_per_unit) || 0) / Math.max(packQty, 1);
      }

      let beginValue = 0;
      for (const ci of (beginItems.data as any[]) || []) {
        beginValue += getCountItemLineValue(ci);
      }

      let endValue = 0;
      for (const ci of (endItems.data as any[]) || []) {
        endValue += getCountItemLineValue(ci);
      }

      // Purchases: pull strictly from the new assignments table (decoupled by period_type)
      // — reuse `targetIds` and `fetchByIds` computed at the top of this queryFn.
      const [pfg, pa, vendorInv] = await Promise.all([
        fetchByIds("pfg_orders", [...targetIds.pfg], "id, pfg_order_id, order_number, order_date, delivery_date, total_amount"),
        fetchByIds("pa_orders", [...targetIds.pa], "id, pa_order_id, order_number, order_date, delivery_date, total_amount"),
        fetchByIds("vendor_invoices", [...targetIds.invoice], "id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status"),
      ]);

      
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
            return { vendor: "PFG", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel, outsideWindow: isOutsideWindow(o.delivery_date) };
          }),
          ...pa.map((o: any) => {
            const cleanId = o.order_number || o.pa_order_id || o.id.slice(0, 8);
            const deliveryDateLabel = o.delivery_date ? format(new Date(o.delivery_date + "T12:00:00"), "EEEE, MMM d") : null;
            return { vendor: "PA", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: format(new Date(o.delivery_date + "T12:00:00"), "MMM d"), deliveryDate: deliveryDateLabel, outsideWindow: isOutsideWindow(o.delivery_date) };
          }),
          ...vendorInv.map((o: any) => {
            const d = o.delivery_date || o.invoice_date;
            const cleanId = o.invoice_number || o.id.slice(0, 8);
            const deliveryDateLabel = d ? format(new Date(d + "T12:00:00"), "EEEE, MMM d") : null;
            return { vendor: o.vendor_name || "Invoice", id: `#${cleanId}`, amount: Number(o.total_amount) || 0, date: d ? format(new Date(d + "T12:00:00"), "MMM d") : "—", deliveryDate: deliveryDateLabel, outsideWindow: isOutsideWindow(d) };
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
              <DailySpotChecksGrid periodRange={periodRange} spotChecks={spotChecks} locationId={locationId} todayStr={todayStr} onStartDailyCount={onStartDailyCount} timezone={timezone} />
            )}
          </CardContent>
        </Card>
      ) : cogsData ? (
        <Card className="relative">
          <CardContent className="p-4 sm:p-5">
            {/* Top row: meta (date range + user) on left, Review eye + optional Resume on right */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
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
                        currentEndOverride={count.sales_end_override || null}
                        currentStartOverride={count.sales_start_override || null}
                      />
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {count.counted_by_profile?.full_name || "Unknown"}
                  {count.completed_at &&
                    ` • ${format(new Date(count.completed_at), "MMM d 'at' h:mm a")}`}
                </p>
                {count.is_late_close && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[18px] uppercase border-amber-500/50 text-amber-600 mt-1">
                    Flex
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  onClick={() => navigate(`/inventory/${locationId}/count/${count.id}`)}
                  title="Open review"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                {/* Resume action is handled by the "Resume" button in the progress row above. */}

              </div>
            </div>


            <div className="mt-2 space-y-2">
              {/* Beginning — display only (not interactive) */}
              <div className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border">
                <span className="text-sm text-foreground">Beginning Inventory</span>
                <span className="text-sm font-semibold tabular-nums">${Math.round(cogsData.beginValue).toLocaleString()}</span>
              </div>


              {/* Purchases — badge row, expands inline list */}
              <button
                onClick={() => setShowPurchases(!showPurchases)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border hover:bg-muted/60 active:scale-[0.99] transition-all"
              >
                <span className="text-sm text-foreground">+ Purchases</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums">${Math.round(cogsData.purchasesTotal).toLocaleString()}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showPurchases ? "rotate-180" : ""}`} />
                </span>
              </button>

              {/* Inline purchases list */}
              {showPurchases && (
                <div className="pl-3 border-l-2 border-border/60 ml-1 space-y-2 pt-1 pb-1">
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

              {/* Ending — badge row, taps through to review */}
              <button
                onClick={() => navigate(`/inventory/${locationId}/count/${count.id}`)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-background border border-border hover:bg-muted/60 active:scale-[0.99] transition-all"
              >
                <span className="text-sm text-foreground">− Ending Inventory</span>
                <span className="text-sm font-semibold tabular-nums">${Math.round(cogsData.endValue).toLocaleString()}</span>
              </button>

              <div className="border-t border-border/60 pt-2 mt-1">
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
              <DailySpotChecksGrid periodRange={periodRange} spotChecks={spotChecks} locationId={locationId} todayStr={todayStr} onStartDailyCount={onStartDailyCount} timezone={timezone} />
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
                {canManageOrders && !isUpcoming && count.id && onDeleteCount && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDeleteCount(count)}
                    title="Delete count"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Variance moved to Review screen (InventoryCountView → Actual vs Theo tab). */}




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

      {isLite ? (
        <LiteInvoiceUploadDialog
          open={showInvoiceUpload}
          onOpenChange={setShowInvoiceUpload}
          locationId={locationId}
        />
      ) : (
        <InvoiceUploadDialog
          open={showInvoiceUpload}
          onOpenChange={setShowInvoiceUpload}
          locationId={locationId}
          countId={realCountId || count.id}
        />
      )}
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
  timezone,
}: {
  periodRange: { startStr: string; endStr: string } | null;
  spotChecks: any[] | undefined;
  locationId: string;
  todayStr: string;
  onStartDailyCount?: () => void;
  timezone: string;
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
                ? `Completed ${formatInTimeZone(new Date(previewCheck.completed_at), timezone, "h:mm a")}`
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

