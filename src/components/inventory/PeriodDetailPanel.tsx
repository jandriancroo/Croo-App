import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye, Pencil, Package, Truck, BarChart3, ClipboardCheck,
  Crosshair, TrendingDown, TrendingUp, ChevronDown, Loader2,
  Settings2, MoreVertical, Trash2,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion, AnimatePresence } from "framer-motion";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import OrderReconciliationPicker from "./OrderReconciliationPicker";

interface PeriodDetailPanelProps {
  count: any;
  locationId: string;
  onDeleteCount?: (count: any) => void;
}

export default function PeriodDetailPanel({ count, locationId, onDeleteCount }: PeriodDetailPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const stats = count._stats || { totalItems: 0, countedItems: 0, totalCost: 0 };
  const { isManager, isAdmin } = useUserRole();
  const canManageOrders = isManager || isAdmin;
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [realCountId, setRealCountId] = useState<string | null>(null);
  const [creatingCount, setCreatingCount] = useState(false);
  const isUpcoming = !!count._isUpcoming;
  

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
    
    // For flex counts (is_late_close), sales window extends to counted_at date
    let salesEndDate = endDate;
    if (count.is_late_close) {
      if (count.counted_at) {
        salesEndDate = formatInTimeZone(new Date(count.counted_at), 'America/Los_Angeles', 'yyyy-MM-dd');
      } else {
        const yesterday = subDays(new Date(), 1);
        const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
        if (yesterdayStr > endDate) {
          salesEndDate = yesterdayStr;
        }
      }
    }

    // Calculate standard start date
    let standardStart: string;
    if (count.period_type === "weekly") {
      const end = new Date(endDate + "T12:00:00");
      const start = subDays(end, 6);
      standardStart = format(start, "yyyy-MM-dd");
    } else if (count.period_type === "monthly") {
      const end = new Date(endDate + "T12:00:00");
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      standardStart = format(start, "yyyy-MM-dd");
    } else {
      return null;
    }

    // If previous count was flex/late close, adjust start to day after its counted_at
    let adjustedStart = standardStart;
    let isFlexAdjusted = false;
    if (prevCountData?.is_late_close && prevCountData?.counted_at) {
      const prevCountedDate = formatInTimeZone(new Date(prevCountData.counted_at), 'America/Los_Angeles', 'yyyy-MM-dd');
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
    const effectiveEnd = salesEndDate > endDate ? salesEndDate : endDate;
    const endMs = new Date(effectiveEnd + "T12:00:00").getTime();
    const activeDays = Math.round((endMs - startMs) / 86400000) + 1;
    const isNonStandard = activeDays !== 7 && count.period_type === "weekly";

    return {
      startStr: adjustedStart,
      endStr: endDate,
      salesEndStr: salesEndDate,
      isFlexAdjusted,
      activeDays,
      isNonStandard,
    };
  }, [count.period_end_date, count.period_type, count.is_late_close, count.counted_at, prevCountData]);

  // Fetch COGS data — now uses bound orders instead of date-range
  const { data: cogsData, isLoading: cogsLoading } = useQuery({
    queryKey: ["period-cogs", locationId, count.id, periodRange?.startStr, periodRange?.endStr],
    queryFn: async () => {
      if (!periodRange) return null;

      // For upcoming periods, only fetch purchases (no count items exist yet)
      if (isUpcoming) {
        const [pfgDateRange, paDateRange] = await Promise.all([
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
        ]);

        // Also check for orders bound to a real count_id (if one was created via Manage Orders)
        let pfgBound: any[] = [];
        let paBound: any[] = [];
        if (realCountId) {
          const [pfgB, paB] = await Promise.all([
            supabase
              .from("pfg_orders")
              .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
              .eq("location_id", locationId)
              .eq("bound_to_count_id", realCountId)
              .order("delivery_date", { ascending: true }),
            supabase
              .from("pa_orders")
              .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
              .eq("location_id", locationId)
              .eq("bound_to_count_id", realCountId)
              .order("delivery_date", { ascending: true }),
          ]);
          pfgBound = pfgB.data || [];
          paBound = paB.data || [];
        }

        const hasBoundOrders = pfgBound.length + paBound.length > 0;
        const pfg = hasBoundOrders ? pfgBound : (pfgDateRange.data || []);
        const pa = hasBoundOrders ? paBound : (paDateRange.data || []);
        const purchasesTotal = [...pfg, ...pa].reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

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

      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, cost_per_unit, pack_quantity, pack_quantity_override, is_recipe")
        .eq("location_id", locationId)
        .eq("is_active", true);

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

      // Fetch purchases: PREFER bound orders, fallback to date-range
      const [pfgBound, paBound, pfgDateRange, paDateRange] = await Promise.all([
        supabase
          .from("pfg_orders")
          .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
          .eq("location_id", locationId)
          .eq("bound_to_count_id", count.id)
          .order("delivery_date", { ascending: true }),
        supabase
          .from("pa_orders")
          .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
          .eq("location_id", locationId)
          .eq("bound_to_count_id", count.id)
          .order("delivery_date", { ascending: true }),
        // Fallback: date-range query for unbound orders in period
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
      ]);

      // Use bound orders if any exist, otherwise fallback to date-range unbound
      const hasBoundOrders = (pfgBound.data?.length || 0) + (paBound.data?.length || 0) > 0;
      const pfg = hasBoundOrders ? (pfgBound.data || []) : (pfgDateRange.data || []);
      const pa = hasBoundOrders ? (paBound.data || []) : (paDateRange.data || []);
      
      const purchasesTotal = [...pfg, ...pa].reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

      const { data: salesRows } = await supabase
        .from("sales_cache")
        .select("net_sales")
        .eq("location_id", locationId)
        .gte("sale_date", periodRange.startStr)
        .lte("sale_date", periodRange.salesEndStr);

      const netSales = (salesRows || []).reduce((s, d) => s + (Number(d.net_sales) || 0), 0);
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
        hasBoundOrders,
        purchases: [
          ...pfg.map((o: any) => {
            // Extract clean invoice number: "428_56356274_2026-02-24_4461199" → "4461199", or use order_number/pfg_order_id
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
        ],
      };
    },
    enabled: !!periodRange && (count.status === "completed" || count.status === "in_progress" || isUpcoming),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch variance data
  const { data: varianceData } = useQuery({
    queryKey: ["period-variance", locationId, count.id, periodRange?.startStr],
    queryFn: async () => {
      if (!periodRange) return [];

      const { data: prevCounts } = await supabase
        .from("inventory_counts")
        .select("id")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .lt("period_end_date", periodRange.startStr)
        .order("period_end_date", { ascending: false })
        .limit(1);

      if (!prevCounts?.[0]) return [];

      const [prevItems, currItems, itemDetails] = await Promise.all([
        supabase.from("inventory_count_items").select("item_id, quantity").eq("count_id", prevCounts[0].id),
        supabase.from("inventory_count_items").select("item_id, quantity").eq("count_id", count.id),
        supabase.from("inventory_items").select("id, name, cost_per_unit, pack_quantity, pack_quantity_override").eq("location_id", locationId).eq("is_active", true),
      ]);

      const prevMap = new Map<string, number>();
      for (const ci of (prevItems.data || [])) prevMap.set(ci.item_id, Number(ci.quantity));

      const nameMap = new Map<string, string>();
      const costMap = new Map<string, number>();
      for (const i of (itemDetails.data || [])) {
        nameMap.set(i.id, i.name);
        const pq = (i as any).pack_quantity_override ?? (i.pack_quantity || 1);
        costMap.set(i.id, (Number(i.cost_per_unit) || 0) / Math.max(pq, 1));
      }

      const variances: { name: string; expected: number; actual: number; diff: number; cost: number }[] = [];
      for (const ci of (currItems.data || [])) {
        const prev = prevMap.get(ci.item_id);
        if (prev === undefined) continue;
        const diff = Number(ci.quantity) - prev;
        if (Math.abs(diff) < 1) continue;
        const unitCost = costMap.get(ci.item_id) || 0;
        variances.push({
          name: nameMap.get(ci.item_id) || "Unknown",
          expected: prev,
          actual: Number(ci.quantity),
          diff,
          cost: diff * unitCost,
        });
      }

      variances.sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));
      return variances.slice(0, 20);
    },
    enabled: !!periodRange && count.status === "completed",
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
    enabled: !!periodRange && (count.status === "completed" || isUpcoming),
    staleTime: 5 * 60 * 1000,
  });

  const spotCount = spotChecks?.length || 0;

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
        /* Upcoming period: simplified header with purchases only */
        <Card className="border-primary/20">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold">{formatPeriodLabel(count)}</p>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 uppercase border-primary/40 text-primary">
                    Current
                  </Badge>
                  {periodRange?.isNonStandard && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 uppercase border-amber-500/50 text-amber-600">
                      {periodRange.activeDays}d
                    </Badge>
                  )}
                </div>
                {periodRange && (
                  <p className="text-xs font-medium text-primary/80 mt-0.5">
                    {format(new Date(periodRange.startStr + "T12:00:00"), "EEE, MMM d")} – {format(new Date(periodRange.endStr + "T12:00:00"), "EEE, MMM d, yyyy")}
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  Count not started yet — manage orders below
                </p>
              </div>
            </div>
            {cogsData && cogsData.purchases.length > 0 && (
              <div className="p-3 rounded-xl bg-muted/40">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Purchases this period</span>
                  <span className="text-lg font-bold">${Math.round(cogsData.purchasesTotal).toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : cogsData ? (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-lg font-bold">{formatPeriodLabel(count)}</p>
                  {count.is_late_close && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 uppercase border-amber-500/50 text-amber-600">
                      Flex
                    </Badge>
                  )}
                  {periodRange?.isNonStandard && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 uppercase border-amber-500/50 text-amber-600">
                      {periodRange.activeDays}d
                    </Badge>
                  )}
                </div>
                {periodRange && (
                  <p className="text-xs font-medium text-primary/80 mt-0.5">
                    {format(new Date(periodRange.startStr + "T12:00:00"), "EEE, MMM d")} – {format(new Date(periodRange.endStr + "T12:00:00"), "EEE, MMM d, yyyy")}
                    {count.is_late_close && periodRange.salesEndStr !== periodRange.endStr && (
                      <span className="text-amber-600 ml-1">(sales thru {format(new Date(periodRange.salesEndStr + "T12:00:00"), "MMM d")})</span>
                    )}
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-0.5">
                  {count.counted_by_profile?.full_name || "Unknown"}
                  {count.completed_at &&
                    ` • ${format(new Date(count.completed_at), "MMM d 'at' h:mm a")}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className={`text-2xl font-bold ${cogsData.cogsPct > 22 ? "text-destructive" : ""}`}>
                    {cogsData.cogsPct.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">COGS</p>
                </div>
                {canManageOrders && onDeleteCount && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDeleteCount(count)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Period
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <SummaryMetric label="BEGINNING" value={`$${Math.round(cogsData.beginValue).toLocaleString()}`} />
              <SummaryMetric label="PURCHASES" value={`$${Math.round(cogsData.purchasesTotal).toLocaleString()}`} />
              <SummaryMetric label="ENDING" value={`$${Math.round(cogsData.endValue).toLocaleString()}`} />
            </div>

            <div className="mt-4 p-3 rounded-xl bg-muted/40 space-y-1.5">
              <FormulaRow label="Beginning Inventory" value={cogsData.beginValue} />
              <FormulaRow label="+ Purchases" value={cogsData.purchasesTotal} />
              <FormulaRow label="− Ending Inventory" value={cogsData.endValue} />
              <div className="border-t border-border/60 pt-1.5 mt-1.5">
                <FormulaRow label="= Cost of Goods Sold" value={cogsData.cogsTotal} bold />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Net Sales</span>
                <span className="text-sm font-medium">${Math.round(cogsData.netSales).toLocaleString()}</span>
              </div>
            </div>

            {/* Order binding indicator */}
            {!cogsData.hasBoundOrders && cogsData.purchases.length > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-600">
                <Settings2 className="h-3.5 w-3.5" />
                <span>Using date-range purchases — bind orders for accuracy</span>
              </div>
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
                  {count.status === "completed" ? "Complete" : "In Progress"}
                </Badge>
                {canManageOrders && onDeleteCount && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDeleteCount(count)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Period
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4-tab layout */}
      <Tabs defaultValue="purchases" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-11">
          <TabsTrigger value="purchases" className="text-xs sm:text-sm gap-1">
            <Truck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Purchases</span>
            <span className="sm:hidden">Orders</span>
          </TabsTrigger>
          <TabsTrigger value="variance" className="text-xs sm:text-sm gap-1">
            <BarChart3 className="h-3.5 w-3.5" /> Variance
          </TabsTrigger>
          <TabsTrigger value="count" className="text-xs sm:text-sm gap-1">
            <ClipboardCheck className="h-3.5 w-3.5" /> Count
          </TabsTrigger>
          <TabsTrigger value="spotcheck" className="text-xs sm:text-sm gap-1 relative">
            <Crosshair className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Daily Spot</span>
            <span className="sm:hidden">Spot</span>
            {spotCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {spotCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Purchases */}
        <TabsContent value="purchases" className="mt-3">
          <Card>
            <CardContent className="p-4 space-y-0 divide-y divide-border/40">
              {/* Manage Orders button for manager+ */}
              {canManageOrders && periodRange && (
                <div className="pb-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={creatingCount}
                    onClick={async () => {
                      if (isUpcoming && !realCountId) {
                        // Auto-create the count record so we have a real ID for binding
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
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Settings2 className="h-4 w-4 mr-2" />
                    )}
                    Manage Orders for Period
                  </Button>
                </div>
              )}

              {cogsData?.purchases && cogsData.purchases.length > 0 ? (
                <>
                  {cogsData.purchases.map((po: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          po.vendor === "PFG" ? "bg-red-500 text-red-200" : "bg-green-500 text-green-200"
                        }`}>
                          {po.vendor === "PFG" ? <UtensilsCrossed className="h-5 w-5" /> : <Carrot className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium font-mono">{po.vendor} {po.id}</p>
                          <p className="text-xs text-muted-foreground">
                            Delivered {po.deliveryDate || po.date}
                          </p>
                        </div>
                      </div>
                      <p className="text-base font-semibold">${po.amount.toLocaleString()}</p>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3">
                    <span className="text-sm font-medium text-muted-foreground">Total Purchases</span>
                    <span className="text-base font-bold">
                      ${cogsData.purchases.reduce((s: number, p: any) => s + p.amount, 0).toLocaleString()}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No purchase orders found for this period.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variance */}
        <TabsContent value="variance" className="mt-3">
          <Card>
            <CardContent className="p-4 space-y-0 divide-y divide-border/40">
              {varianceData && varianceData.length > 0 ? (
                varianceData.map((v, i) => (
                  <div key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        v.diff < 0 ? "bg-destructive/10" : "bg-accent/60"
                      }`}>
                        {v.diff < 0 ? <TrendingDown className="h-4 w-4 text-destructive" /> : <TrendingUp className="h-4 w-4 text-primary" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{v.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Previous {v.expected} → Current {v.actual}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${v.diff < 0 ? "text-destructive" : "text-primary"}`}>
                        {v.diff > 0 ? "+" : ""}{v.diff} units
                      </p>
                      <p className={`text-xs ${v.cost < 0 ? "text-destructive" : "text-primary"}`}>
                        {v.cost < 0 ? "−" : "+"}${Math.abs(v.cost).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No variance data for this period.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Count */}
        <TabsContent value="count" className="mt-3">
          <Card>
            <CardContent className="p-6 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto">
                <Package className="h-7 w-7 text-muted-foreground" />
              </div>
              {isUpcoming ? (
                <div>
                  <p className="text-lg font-bold">Not Started</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This period's count hasn't been started yet. Use "Start Count" above when ready.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-lg font-bold">{stats.countedItems} / {stats.totalItems} items</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      On-hand value: <span className="font-semibold text-foreground">
                        ${stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-3 justify-center">
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => navigate(`/inventory/${locationId}/count/${count.id}`)}
                    >
                      <Eye className="h-4 w-4 mr-2" /> View Details
                    </Button>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => navigate(`/inventory/${locationId}/count/${count.id}?edit=true`)}
                    >
                      <Pencil className="h-4 w-4 mr-2" /> Edit Count
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Spot Check */}
        <TabsContent value="spotcheck" className="mt-3">
          <Card>
            <CardContent className="p-4">
              <SpotCheckList checks={spotChecks || []} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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

function SpotCheckList({ checks }: { checks: any[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(checks.length === 1 ? 0 : null);

  if (!checks.length) {
    return (
      <div className="py-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto mb-3">
          <Crosshair className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No daily spot checks this period.</p>
        <p className="text-xs text-muted-foreground mt-1">Spot checks are quick snapshots of key items mid-week.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-border/40">
      {checks.map((sc, i) => (
        <div key={sc.id || i} className="py-3 first:pt-0 last:pb-0">
          <button
            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Crosshair className="h-4 w-4 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">
                  {format(new Date(sc.count_date + "T12:00:00"), "MMM d")}
                  {sc.started_at && ` · ${format(new Date(sc.started_at), "h:mm a")}`}
                </p>
                <p className="text-xs text-muted-foreground">{sc.items?.length || 0} items checked</p>
              </div>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedIdx === i ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {expandedIdx === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div className="ml-12 mt-3 space-y-0 divide-y divide-border/30">
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Item</span>
                    <div className="flex items-center gap-6">
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide w-16 text-right">Prev</span>
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide w-16 text-right">Now</span>
                    </div>
                  </div>
                  {(sc.items || []).map((item: any, j: number) => {
                    const delta = Number(item.quantity) - (Number(item.previous_quantity) || 0);
                    return (
                      <div key={j} className="flex items-center justify-between py-2">
                        <span className="text-sm">{item.inventory_item?.name || "Unknown"}</span>
                        <div className="flex items-center gap-6">
                          <span className="text-sm text-muted-foreground w-16 text-right">{item.previous_quantity ?? "—"}</span>
                          <span className={`text-sm font-medium w-16 text-right ${delta < -3 ? "text-destructive" : ""}`}>
                            {item.quantity}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sc.notes && (
                  <div className="ml-12 mt-2 px-3 py-2 rounded-lg bg-muted/40">
                    <p className="text-xs text-muted-foreground italic">📝 {sc.notes}</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

// ——— Helpers ———

function formatPeriodLabel(count: any): string {
  if (!count.period_type || !count.period_end_date) {
    return format(new Date(count.count_date + "T12:00:00"), "MMM d, yyyy");
  }
  const endDate = new Date(count.period_end_date + "T12:00:00");
  switch (count.period_type) {
    case "weekly":
      return `Week Ending ${format(endDate, "MMM d, yyyy")}`;
    case "monthly":
      return `${format(endDate, "MMMM yyyy")} Month End`;
    default:
      return format(new Date(count.count_date + "T12:00:00"), "MMM d, yyyy");
  }
}
