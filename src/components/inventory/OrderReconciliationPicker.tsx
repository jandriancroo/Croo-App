import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Truck, Lock, UtensilsCrossed, Carrot, Receipt, RefreshCw } from "lucide-react";
import { format, subDays, addDays } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getEffectivePeriodEndDate } from "@/utils/periodLabelUtils";

interface OrderReconciliationPickerProps {
  locationId: string;
  countId: string;
  periodStartDate?: string;
  periodEndDate?: string;
  editable?: boolean;
  onSaved?: () => void;
  compact?: boolean;
}

type SourceType = "pfg" | "pa" | "invoice";

interface VendorOrder {
  id: string; // composite: `${sourceType}_${realId}`
  sourceType: SourceType;
  realId: string;
  vendor: "PFG" | "PA" | "INV";
  vendorName?: string;
  orderId: string;
  orderDate: string;
  deliveryDate: string;
  totalAmount: number;
  // Assignment within the SAME period_type as the current count
  assignedCountId: string | null;
  assignedPeriodLabel?: string;
  // True when this order is assigned to a child weekly count and we're viewing a monthly/yearly
  isInheritedFromChild?: boolean;
  // True when an exclusion record at this count overrides inherited assignment
  isExcludedHere?: boolean;
}

export default function OrderReconciliationPicker({
  locationId,
  countId,
  periodStartDate,
  periodEndDate,
  editable = true,
  onSaved,
  compact = false,
}: OrderReconciliationPickerProps) {
  const PALM_SPRINGS_LOCATION_ID = "d667741f-6d4c-433e-bb22-307e817ea7f1";
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const isPalmSpringsDiagnostics = locationId === PALM_SPRINGS_LOCATION_ID;

  /**
   * Manual rescan: hits PFG with the period date window to pull any orders
   * that were missing from the last background sync (TRACS lag, late promotion
   * to Azure, etc.). Invoices are intentionally ignored — only true orders
   * (4-prefix from TRACS, or invoice-source from Azure) get persisted by the
   * edge function. After completion, the picker query is invalidated so any
   * newly-arrived orders appear inline.
   */
  const handleRescanPfg = async () => {
    if (isRescanning) return;
    setIsRescanning(true);
    try {
      const beforeCount = (orders || []).filter((o) => o.sourceType === "pfg").length;
      // Cover the full reconciliation period plus a 7-day buffer (min 21 days)
      // so month-end counts pull every order in the window, not just the last 14 days.
      const periodStartMs = periodStartDate ? new Date(periodStartDate).getTime() : Date.now() - 21 * 86400000;
      const daysBack = Math.max(21, Math.ceil((Date.now() - periodStartMs) / 86400000) + 7);
      const { data, error } = await supabase.functions.invoke("pfg-service", {
        body: { action: "sync_orders", locationId, daysBack },
      });

      if (error) throw error;
      await queryClient.invalidateQueries({
        queryKey: ["order-reconciliation-v2", locationId],
      });
      // Small delay to let the query refetch before diffing
      setTimeout(async () => {
        const refreshed = queryClient.getQueryData<VendorOrder[]>([
          "order-reconciliation-v2",
          locationId,
          countId,
          currentPeriodType,
          periodStartDate,
          periodEndDate,
        ]);
        const afterCount = (refreshed || []).filter((o) => o.sourceType === "pfg").length;
        const diff = Math.max(0, afterCount - beforeCount);
        if (diff > 0) {
          toast.success(`Found ${diff} new PFG order${diff === 1 ? "" : "s"}`);
        } else {
          toast(data?.results?.[0]?.error ?? "No new PFG orders");
        }
      }, 600);
    } catch (err: any) {
      console.error("[PFG Rescan] failed:", err);
      toast.error(`Rescan failed: ${err?.message ?? "unknown error"}`);
    } finally {
      setIsRescanning(false);
    }
  };

  const serializeOrdersForAudit = (sourceOrders: VendorOrder[]) =>
    sourceOrders.map((order) => ({
      id: order.id,
      vendor: order.vendor,
      vendorName: order.vendorName ?? null,
      orderId: order.orderId,
      orderDate: order.orderDate,
      deliveryDate: order.deliveryDate,
      totalAmount: order.totalAmount,
      assignedCountId: order.assignedCountId,
      assignedPeriodLabel: order.assignedPeriodLabel ?? null,
      isInheritedFromChild: !!order.isInheritedFromChild,
      isExcludedHere: !!order.isExcludedHere,
    }));

  const logPalmSpringsOrderAudit = async (
    operation: string,
    details: Record<string, unknown>
  ) => {
    if (!isPalmSpringsDiagnostics) return;

    const { error } = await supabase.from("inventory_count_audit_log" as any).insert({
      operation,
      table_name: "inventory_order_reconciliation",
      record_id: countId,
      count_id: countId,
      details: {
        location_id: locationId,
        count_id: countId,
        period_start_date: periodStartDate ?? null,
        period_end_date: periodEndDate ?? null,
        ...details,
      },
    } as any);

    if (error) {
      console.warn("[OrderAudit] Failed to log Palm Springs diagnostics:", error.message);
    }
  };

  const { data: countMeta } = useQuery({
    queryKey: ["count-period-type", countId],
    queryFn: async () => {
      const { data } = await supabase.from("inventory_counts").select("period_type").eq("id", countId).maybeSingle();
      return data;
    },
    enabled: !!countId,
  });
  const currentPeriodType = countMeta?.period_type as "weekly" | "monthly" | "yearly" | undefined;

  const { data: orders, isLoading } = useQuery({
    queryKey: ["order-reconciliation-v2", locationId, countId, currentPeriodType, periodStartDate, periodEndDate],
    enabled: !!locationId && !!countId && !!currentPeriodType,
    queryFn: async () => {
      const windowStart = periodStartDate
        ? format(subDays(new Date(periodStartDate + "T12:00:00"), 7), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const windowEnd = periodEndDate
        ? format(addDays(new Date(periodEndDate + "T12:00:00"), 7), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      const isAggregatingPeriod =
        currentPeriodType === "monthly" || currentPeriodType === "yearly";

      // Identify child weekly counts inside this period (for monthly/yearly inheritance display)
      let childWeeklyCountIds: string[] = [];
      if (isAggregatingPeriod && periodStartDate && periodEndDate) {
        const { data: childCounts } = await supabase
          .from("inventory_counts")
          .select("id")
          .eq("location_id", locationId)
          .eq("is_sandbox", false)
          .eq("period_type", "weekly")
          .gte("period_end_date", periodStartDate)
          .lte("period_end_date", periodEndDate);
        childWeeklyCountIds = (childCounts || []).map((c) => c.id);
      }

      const [pfgResult, paResult, invResult, sameTypeAssignments, childWeeklyAssignments, exclusionsResult] = await Promise.all([
        supabase
          .from("pfg_orders")
          .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount")
          .eq("location_id", locationId)
          .gte("delivery_date", windowStart)
          .lte("delivery_date", windowEnd)
          .order("order_date", { ascending: true }),
        supabase
          .from("pa_orders")
          .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount")
          .eq("location_id", locationId)
          .gte("delivery_date", windowStart)
          .lte("delivery_date", windowEnd)
          .order("order_date", { ascending: true }),
        supabase
          .from("vendor_invoices")
          .select("id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status")
          .eq("location_id", locationId)
          .eq("status", "parsed")
          .or(
            `and(delivery_date.gte.${windowStart},delivery_date.lte.${windowEnd}),and(invoice_date.gte.${windowStart},invoice_date.lte.${windowEnd})`
          )
          .order("delivery_date", { ascending: true }),
        // All assignments at the SAME period_type (so we know which orders are locked to other counts of the same type)
        supabase
          .from("inventory_order_assignments" as any)
          .select("id, source_type, source_row_id, count_id, period_type")
          .eq("location_id", locationId)
          .eq("period_type", currentPeriodType as string),
        // Child weekly assignments — only when viewing monthly/yearly
        isAggregatingPeriod && childWeeklyCountIds.length > 0
          ? supabase
              .from("inventory_order_assignments" as any)
              .select("id, source_type, source_row_id, count_id, period_type")
              .eq("location_id", locationId)
              .eq("period_type", "weekly")
              .in("count_id", childWeeklyCountIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        // Exclusions for THIS count (negative overrides for inherited children)
        supabase
          .from("inventory_order_exclusions" as any)
          .select("id, source_type, source_row_id, count_id, period_type")
          .eq("location_id", locationId)
          .eq("count_id", countId)
          .eq("period_type", currentPeriodType as string),
      ]);

      // Build maps from assignments
      const sameTypeMap = new Map<string, { count_id: string }>(); // key: `${source}_${rowId}`
      for (const a of (sameTypeAssignments.data as any[]) || []) {
        sameTypeMap.set(`${a.source_type}_${a.source_row_id}`, { count_id: a.count_id });
      }
      const childWeeklyMap = new Map<string, { count_id: string }>();
      for (const a of (childWeeklyAssignments.data as any[]) || []) {
        childWeeklyMap.set(`${a.source_type}_${a.source_row_id}`, { count_id: a.count_id });
      }
      const exclusionSet = new Set<string>();
      for (const e of (exclusionsResult.data as any[]) || []) {
        exclusionSet.add(`${e.source_type}_${e.source_row_id}`);
      }

      // Resolve labels for "other counts of the same period_type" so we can show locked badges
      const otherCountIds = new Set<string>();
      for (const [, v] of sameTypeMap) {
        if (v.count_id && v.count_id !== countId) otherCountIds.add(v.count_id);
      }
      const periodLabelMap = new Map<string, string>();
      if (otherCountIds.size > 0) {
        const { data: counts } = await supabase
          .from("inventory_counts")
          .select("id, period_type, period_end_date, status, counted_at, completed_at")
          .in("id", [...otherCountIds]);
        for (const c of counts || []) {
          const effectiveEnd = getEffectivePeriodEndDate(c) || c.period_end_date;
          const endDate = effectiveEnd ? new Date(effectiveEnd + "T12:00:00") : null;
          const label = endDate
            ? c.period_type === "monthly"
              ? `ME ${format(endDate, "MMM ''yy")}`
              : c.period_type === "yearly"
              ? `YE ${format(endDate, "yyyy")}`
              : `WE ${format(endDate, "MMM d")}`
            : "Other count";
          periodLabelMap.set(c.id, label);
        }
      }

      const buildOrder = (
        sourceType: SourceType,
        rawRow: any,
        vendorLabel: "PFG" | "PA" | "INV",
        orderIdStr: string,
        orderDate: string,
        deliveryDate: string,
        vendorName?: string
      ): VendorOrder => {
        const key = `${sourceType}_${rawRow.id}`;
        const sameTypeAssignment = sameTypeMap.get(key);
        const childAssignment = childWeeklyMap.get(key);
        const isInherited = !sameTypeAssignment && !!childAssignment && isAggregatingPeriod;
        const assignedCountId = sameTypeAssignment?.count_id ?? (isInherited ? childAssignment!.count_id : null);
        const assignedPeriodLabel =
          assignedCountId && assignedCountId !== countId
            ? periodLabelMap.get(assignedCountId) ??
              (isInherited && childAssignment
                ? `WE (child)`
                : undefined)
            : undefined;

        return {
          id: key,
          sourceType,
          realId: rawRow.id,
          vendor: vendorLabel,
          vendorName,
          orderId: orderIdStr,
          orderDate,
          deliveryDate,
          totalAmount: Number(rawRow.total_amount) || 0,
          assignedCountId,
          assignedPeriodLabel,
          isInheritedFromChild: isInherited,
          isExcludedHere: exclusionSet.has(key),
        };
      };

      const all: VendorOrder[] = [
        ...((pfgResult.data as any[]) || []).map((o) =>
          buildOrder(
            "pfg",
            o,
            "PFG",
            o.order_number ||
              (o.pfg_order_id?.includes("_") ? o.pfg_order_id.split("_").pop() : o.pfg_order_id) ||
              o.id.slice(0, 8),
            o.order_date,
            o.delivery_date
          )
        ),
        ...((paResult.data as any[]) || []).map((o) =>
          buildOrder(
            "pa",
            o,
            "PA",
            o.order_number || o.pa_order_id || o.id.slice(0, 8),
            o.order_date,
            o.delivery_date
          )
        ),
        ...((invResult.data as any[]) || []).map((o) =>
          buildOrder(
            "invoice",
            o,
            "INV",
            o.invoice_number || o.id.slice(0, 8),
            o.invoice_date || o.delivery_date,
            o.delivery_date || o.invoice_date,
            o.vendor_name || "Invoice"
          )
        ),
      ];

      all.sort(
        (a, b) =>
          (b.deliveryDate || "").localeCompare(a.deliveryDate || "") ||
          (b.orderDate || "").localeCompare(a.orderDate || "")
      );
      return all;
    },
  });

  useEffect(() => {
    if (!isPalmSpringsDiagnostics) return;
    void logPalmSpringsOrderAudit("PICKER_CONTEXT", {
      current_period_type: currentPeriodType ?? null,
      initialized,
      selected_ids: Array.from(selectedIds),
    });
  }, [countId, periodStartDate, periodEndDate]);

  useEffect(() => {
    if (!orders || isLoading || !isPalmSpringsDiagnostics) return;
    void logPalmSpringsOrderAudit("QUERY_LOAD", {
      current_period_type: currentPeriodType ?? null,
      initialized,
      selected_ids: Array.from(selectedIds),
      order_count: orders.length,
      orders: serializeOrdersForAudit(orders),
    });
  }, [orders, isLoading, currentPeriodType]);

  // Initialize selected IDs strictly from DB state:
  //  - assignment at this count for current period_type → selected
  //  - inherited from child weekly (monthly/yearly view) → selected unless an exclusion exists
  if (orders && !initialized) {
    const initial = new Set<string>();
    for (const o of orders) {
      if (o.assignedCountId === countId) initial.add(o.id);
      else if (o.isInheritedFromChild && !o.isExcludedHere) initial.add(o.id);
    }
    setSelectedIds(initial);
    setInitialized(true);
  }

  const isLockedToOther = (o: VendorOrder) =>
    !!o.assignedCountId && o.assignedCountId !== countId && !o.isInheritedFromChild;

  const toggle = (id: string) => {
    if (!editable) return;
    const order = orders?.find((o) => o.id === id);
    if (!order) return;
    if (isLockedToOther(order)) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orders || !currentPeriodType) return;

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id ?? null;

      // Build the operation plan against the new tables
      const assignmentsToUpsert: Array<{
        source_type: SourceType;
        source_row_id: string;
        count_id: string;
        location_id: string;
        period_type: string;
        assignment_mode: string;
        created_by: string | null;
      }> = [];
      const assignmentDeleteKeys: Array<{ source_type: SourceType; source_row_id: string }> = [];
      const exclusionsToInsert: Array<{
        source_type: SourceType;
        source_row_id: string;
        count_id: string;
        location_id: string;
        period_type: string;
        created_by: string | null;
      }> = [];
      const exclusionDeleteKeys: Array<{ source_type: SourceType; source_row_id: string }> = [];

      for (const o of orders) {
        if (isLockedToOther(o)) continue;

        const isSelected = selectedIds.has(o.id);
        const wasAssignedHere = o.assignedCountId === countId && !o.isInheritedFromChild;
        const wasInherited = !!o.isInheritedFromChild;

        if (isSelected) {
          // Ensure assignment to THIS count at current period_type
          if (!wasAssignedHere && !wasInherited) {
            assignmentsToUpsert.push({
              source_type: o.sourceType,
              source_row_id: o.realId,
              count_id: countId,
              location_id: locationId,
              period_type: currentPeriodType,
              assignment_mode: "manual",
              created_by: userId,
            });
          }
          // If a prior exclusion was removing this from THIS count, clear it
          if (o.isExcludedHere) {
            exclusionDeleteKeys.push({ source_type: o.sourceType, source_row_id: o.realId });
          }
        } else {
          // Deselected
          if (wasAssignedHere) {
            // Remove assignment for this period_type (frees the order to be assigned elsewhere of same type)
            assignmentDeleteKeys.push({ source_type: o.sourceType, source_row_id: o.realId });
          }
          if (wasInherited && !o.isExcludedHere) {
            // Add an exclusion so the inherited child assignment doesn't keep pulling it into this aggregate count
            exclusionsToInsert.push({
              source_type: o.sourceType,
              source_row_id: o.realId,
              count_id: countId,
              location_id: locationId,
              period_type: currentPeriodType,
              created_by: userId,
            });
          }
        }
      }

      if (isPalmSpringsDiagnostics) {
        await logPalmSpringsOrderAudit("BEFORE_APPLY", {
          current_period_type: currentPeriodType ?? null,
          selected_ids: Array.from(selectedIds),
          plan: {
            assignments_upsert: assignmentsToUpsert,
            assignments_delete: assignmentDeleteKeys,
            exclusions_insert: exclusionsToInsert,
            exclusions_delete: exclusionDeleteKeys,
          },
          orders: serializeOrdersForAudit(orders),
        });
      }

      const promises: any[] = [];

      if (assignmentsToUpsert.length > 0) {
        promises.push(
          supabase
            .from("inventory_order_assignments" as any)
            .upsert(assignmentsToUpsert as any, { onConflict: "source_type,source_row_id,period_type" })
            .select()
        );
      }

      // Delete assignments by composite key, grouped per source_type
      const groupedAssignmentDeletes = new Map<SourceType, string[]>();
      for (const k of assignmentDeleteKeys) {
        const arr = groupedAssignmentDeletes.get(k.source_type) || [];
        arr.push(k.source_row_id);
        groupedAssignmentDeletes.set(k.source_type, arr);
      }
      for (const [sourceType, rowIds] of groupedAssignmentDeletes) {
        promises.push(
          supabase
            .from("inventory_order_assignments" as any)
            .delete()
            .eq("location_id", locationId)
            .eq("period_type", currentPeriodType)
            .eq("source_type", sourceType)
            .eq("count_id", countId)
            .in("source_row_id", rowIds)
            .select()
        );
      }

      if (exclusionsToInsert.length > 0) {
        promises.push(
          supabase
            .from("inventory_order_exclusions" as any)
            .upsert(exclusionsToInsert as any, {
              onConflict: "source_type,source_row_id,count_id,period_type",
            })
            .select()
        );
      }

      const groupedExclusionDeletes = new Map<SourceType, string[]>();
      for (const k of exclusionDeleteKeys) {
        const arr = groupedExclusionDeletes.get(k.source_type) || [];
        arr.push(k.source_row_id);
        groupedExclusionDeletes.set(k.source_type, arr);
      }
      for (const [sourceType, rowIds] of groupedExclusionDeletes) {
        promises.push(
          supabase
            .from("inventory_order_exclusions" as any)
            .delete()
            .eq("location_id", locationId)
            .eq("period_type", currentPeriodType)
            .eq("count_id", countId)
            .eq("source_type", sourceType)
            .in("source_row_id", rowIds)
            .select()
        );
      }

      const results = await Promise.all(promises);

      if (isPalmSpringsDiagnostics) {
        await logPalmSpringsOrderAudit("AFTER_APPLY", {
          current_period_type: currentPeriodType ?? null,
          selected_ids: Array.from(selectedIds),
          write_results: results.map((result: any) => ({
            error: result?.error?.message ?? null,
            row_count: Array.isArray(result?.data) ? result.data.length : 0,
          })),
        });
      }
    },
    onSuccess: () => {
      toast.success("Orders applied to period");
      queryClient.invalidateQueries({ queryKey: ["order-reconciliation-v2", locationId] });
      queryClient.invalidateQueries({ queryKey: ["period-cogs"] });
      // Reset so the next open re-reads from DB
      setInitialized(false);
      onSaved?.();
    },
    onError: (e) => {
      console.error("Failed to save order bindings:", e);
      toast.error("Failed to save order assignments");
    },
  });

  const selectedTotal = useMemo(
    () => (orders || []).filter((o) => selectedIds.has(o.id)).reduce((s, o) => s + o.totalAmount, 0),
    [orders, selectedIds]
  );

  const selectableOrderCount = useMemo(
    () => (orders || []).filter((o) => !isLockedToOther(o)).length,
    [orders]
  );

  // Group orders by delivery date
  const groupedOrders = useMemo(() => {
    if (!orders) return [];
    const groups = new Map<string, VendorOrder[]>();
    for (const o of orders) {
      const dateKey = o.deliveryDate ? o.deliveryDate.slice(0, 10) : (o.orderDate || "").slice(0, 10);
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(o);
    }
    return [...groups.entries()].map(([dateStr, items]) => {
      let label = dateStr;
      try {
        label = format(new Date(dateStr + "T12:00:00"), "EEEE, MMM d");
      } catch {
        /* fallback */
      }
      return { dateStr, label, items };
    });
  }, [orders]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <div className="py-6 text-center space-y-3">
        <Truck className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">No vendor orders found for this period window.</p>
        {editable && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRescanPfg}
            disabled={isRescanning}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRescanning && "animate-spin")} />
            {isRescanning ? "Rescanning..." : "Rescan PFG"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {periodStartDate && periodEndDate && (
        <p className="text-xs font-medium text-primary/80">
          Period: {format(new Date(periodStartDate + "T12:00:00"), "EEE, MMM d")} – {format(new Date(periodEndDate + "T12:00:00"), "EEE, MMM d, yyyy")}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {selectedIds.size} of {selectableOrderCount} orders selected
        </p>
        <div className="flex items-center gap-2">
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRescanPfg}
              disabled={isRescanning}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              title="Re-fetch PFG orders for this period — catches late TRACS syncs"
            >
              <RefreshCw className={cn("h-3 w-3", isRescanning && "animate-spin")} />
              {isRescanning ? "Rescanning..." : "Rescan PFG"}
            </Button>
          )}
          <p className="text-sm font-semibold">
            ${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      <div className={cn("space-y-0", compact ? "max-h-60 overflow-y-auto" : "max-h-96 overflow-y-auto")}>
        {groupedOrders.map((group) => (
          <div key={group.dateStr}>
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 px-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Delivered {group.label}
              </p>
            </div>

            <div className="divide-y divide-border/40">
              {group.items.map((order) => {
                const lockedElsewhere = isLockedToOther(order);
                const isSelected = selectedIds.has(order.id);
                const inPeriod =
                  periodStartDate && periodEndDate
                    ? order.deliveryDate >= periodStartDate && order.deliveryDate <= periodEndDate
                    : true;
                const showOtherBadge = !!order.assignedPeriodLabel && order.assignedCountId !== countId;

                return (
                  <button
                    key={order.id}
                    onClick={() => toggle(order.id)}
                    disabled={lockedElsewhere || !editable}
                    className={cn(
                      "w-full flex items-center justify-between py-3 px-2 rounded-lg transition-all",
                      lockedElsewhere
                        ? "opacity-40 cursor-not-allowed"
                        : isSelected
                        ? "bg-primary/5"
                        : "hover:bg-muted/40",
                      !inPeriod && !isSelected && !showOtherBadge && "opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all",
                          lockedElsewhere
                            ? "border-muted-foreground/30 bg-muted/40"
                            : isSelected
                            ? "border-primary bg-primary"
                            : "border-border"
                        )}
                      >
                        {lockedElsewhere ? (
                          <Lock className="h-3 w-3 text-muted-foreground" />
                        ) : isSelected ? (
                          <Check className="h-3.5 w-3.5 text-primary-foreground" />
                        ) : null}
                      </div>

                      <div
                        className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                          order.vendor === "PFG"
                            ? "bg-red-500 text-red-200"
                            : order.vendor === "PA"
                            ? "bg-green-500 text-green-200"
                            : "bg-amber-500 text-amber-100"
                        )}
                      >
                        {order.vendor === "PFG" ? (
                          <UtensilsCrossed className="h-5 w-5" />
                        ) : order.vendor === "PA" ? (
                          <Carrot className="h-5 w-5" />
                        ) : (
                          <Receipt className="h-5 w-5" />
                        )}
                      </div>

                      <div className="text-left">
                        <p className="text-sm font-medium font-mono">
                          {order.vendor === "INV" ? order.vendorName : order.vendor} #{order.orderId}
                        </p>
                      </div>
                    </div>

                    <div className="text-right flex items-center gap-2">
                      {showOtherBadge && (
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {order.assignedPeriodLabel}
                        </Badge>
                      )}
                      <p className="text-sm font-semibold">
                        ${order.totalAmount.toLocaleString()}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editable && (
        <Button
          className="w-full"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          Apply {selectedIds.size} Orders to Period
        </Button>
      )}
    </div>
  );
}
