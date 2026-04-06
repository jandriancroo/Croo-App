import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Truck, Lock, UtensilsCrossed, Carrot, Receipt } from "lucide-react";
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

interface VendorOrder {
  id: string;
  vendor: "PFG" | "PA" | "INV";
  vendorName?: string;
  orderId: string;
  orderDate: string;
  deliveryDate: string;
  totalAmount: number;
  boundToCountId: string | null;
  boundPeriodLabel?: string;
  boundPeriodType?: string;
  isInheritedFromChild?: boolean;
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
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["order-reconciliation-v1", locationId, countId, periodStartDate, periodEndDate],
    queryFn: async () => {
      const windowStart = periodStartDate
        ? format(subDays(new Date(periodStartDate + "T12:00:00"), 7), "yyyy-MM-dd")
        : format(subDays(new Date(), 30), "yyyy-MM-dd");
      const windowEnd = periodEndDate
        ? format(addDays(new Date(periodEndDate + "T12:00:00"), 7), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd");

      const [countResult, pfgResult, paResult, invResult] = await Promise.all([
        supabase
          .from("inventory_counts")
          .select("period_type")
          .eq("id", countId)
          .maybeSingle(),
        supabase
          .from("pfg_orders")
          .select("id, pfg_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
          .eq("location_id", locationId)
          .gte("delivery_date", windowStart)
          .lte("delivery_date", windowEnd)
          .order("order_date", { ascending: true }),
        supabase
          .from("pa_orders")
          .select("id, pa_order_id, order_number, order_date, delivery_date, total_amount, bound_to_count_id")
          .eq("location_id", locationId)
          .gte("delivery_date", windowStart)
          .lte("delivery_date", windowEnd)
          .order("order_date", { ascending: true }),
        // Fetch vendor invoices in date range OR already bound to this count
        supabase
          .from("vendor_invoices")
          .select("id, vendor_name, invoice_number, invoice_date, delivery_date, total_amount, status, inventory_count_id")
          .eq("location_id", locationId)
          .eq("status", "parsed")
          .or(`and(delivery_date.gte.${windowStart},delivery_date.lte.${windowEnd}),and(invoice_date.gte.${windowStart},invoice_date.lte.${windowEnd}),inventory_count_id.eq.${countId}`)
          .order("delivery_date", { ascending: true }),
      ]);

      const currentPeriodType = countResult.data?.period_type;
      const isAggregatingPeriod =
        currentPeriodType === "monthly" || currentPeriodType === "yearly";

      // Monthly/yearly: child weekly orders are inherited (shown as read-only)
      // Weekly: NO inheritance from parent monthly — they are separate accounting periods
      let inheritedChildCountIds = new Set<string>();
      if (isAggregatingPeriod && periodStartDate && periodEndDate) {
        const { data: childCounts } = await supabase
          .from("inventory_counts")
          .select("id")
          .eq("location_id", locationId)
          .eq("period_type", "weekly")
          .gte("period_end_date", periodStartDate)
          .lte("period_end_date", periodEndDate);

        inheritedChildCountIds = new Set((childCounts || []).map((c) => c.id));
      }

      const otherCountIds = new Set<string>();
      for (const o of [...(pfgResult.data || []), ...(paResult.data || [])]) {
        if ((o as any).bound_to_count_id && (o as any).bound_to_count_id !== countId) {
          otherCountIds.add((o as any).bound_to_count_id);
        }
      }
      for (const o of (invResult.data || [])) {
        if ((o as any).inventory_count_id && (o as any).inventory_count_id !== countId) {
          otherCountIds.add((o as any).inventory_count_id);
        }
      }

      let periodLabelMap = new Map<string, string>();
      if (otherCountIds.size > 0) {
        const { data: counts } = await supabase
          .from("inventory_counts")
          .select("id, period_type, period_end_date, status, counted_at, completed_at")
          .in("id", [...otherCountIds]);
        for (const c of counts || []) {
          const effectiveEnd = getEffectivePeriodEndDate(c) || c.period_end_date;
          const endDate = effectiveEnd
            ? new Date(effectiveEnd + "T12:00:00")
            : null;
          const label = endDate
            ? c.period_type === "monthly"
              ? `ME ${format(endDate, "MMM ''yy")}`
              : `WE ${format(endDate, "MMM d")}`
            : "Other count";
          periodLabelMap.set(c.id, label);
        }
      }

      const all: VendorOrder[] = [
        ...(pfgResult.data || []).map((o: any) => ({
          id: `pfg_${o.id}`,
          vendor: "PFG" as const,
          orderId: o.order_number || (o.pfg_order_id?.includes('_') ? o.pfg_order_id.split('_').pop() : o.pfg_order_id) || o.id.slice(0, 8),
          orderDate: o.order_date,
          deliveryDate: o.delivery_date,
          totalAmount: Number(o.total_amount) || 0,
          boundToCountId: o.bound_to_count_id,
          isInheritedFromChild: !!o.bound_to_count_id && inheritedChildCountIds.has(o.bound_to_count_id),
          boundPeriodLabel: o.bound_to_count_id && o.bound_to_count_id !== countId
            ? periodLabelMap.get(o.bound_to_count_id)
            : undefined,
        })),
        ...(paResult.data || []).map((o: any) => ({
          id: `pa_${o.id}`,
          vendor: "PA" as const,
          orderId: o.order_number || o.pa_order_id || o.id.slice(0, 8),
          orderDate: o.order_date,
          deliveryDate: o.delivery_date,
          totalAmount: Number(o.total_amount) || 0,
          boundToCountId: o.bound_to_count_id,
          isInheritedFromChild: !!o.bound_to_count_id && inheritedChildCountIds.has(o.bound_to_count_id),
          boundPeriodLabel: o.bound_to_count_id && o.bound_to_count_id !== countId
            ? periodLabelMap.get(o.bound_to_count_id)
            : undefined,
        })),
        ...(invResult.data || []).map((o: any) => ({
          id: `inv_${o.id}`,
          vendor: "INV" as const,
          vendorName: o.vendor_name || "Invoice",
          orderId: o.invoice_number || o.id.slice(0, 8),
          orderDate: o.invoice_date || o.delivery_date,
          deliveryDate: o.delivery_date || o.invoice_date,
          totalAmount: Number(o.total_amount) || 0,
          boundToCountId: o.inventory_count_id,
          isInheritedFromChild: !!o.inventory_count_id && inheritedChildCountIds.has(o.inventory_count_id),
          boundPeriodLabel: o.inventory_count_id && o.inventory_count_id !== countId
            ? periodLabelMap.get(o.inventory_count_id)
            : undefined,
        })),
      ];

      // Sort by most recent first (delivery date desc, then order date desc)
      all.sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || b.orderDate.localeCompare(a.orderDate));
      return all;
    },
    enabled: !!locationId && !!countId,
  });

  // Initialize selected IDs from orders bound to this count
  if (orders && !initialized) {
    const bound = new Set(
      orders
        .filter((o) => o.boundToCountId === countId || o.isInheritedFromChild)
        .map((o) => o.id)
    );
    if (bound.size === 0 && periodStartDate && periodEndDate) {
      for (const o of orders) {
        if (!o.boundToCountId && o.deliveryDate >= periodStartDate && o.deliveryDate <= periodEndDate) {
          bound.add(o.id);
        }
      }
    }
    setSelectedIds(bound);
    setInitialized(true);
  }

  const toggle = (id: string) => {
    if (!editable) return;
    const order = orders?.find((o) => o.id === id);
    if (order?.boundToCountId && order.boundToCountId !== countId && !order.isInheritedFromChild) return;

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orders) return;

      const pfgBind: string[] = [];
      const pfgUnbind: string[] = [];
      const paBind: string[] = [];
      const paUnbind: string[] = [];
      const invBind: string[] = [];
      const invUnbind: string[] = [];

      for (const o of orders) {
        // Skip orders locked to a different (non-child) count
        if (o.boundToCountId && o.boundToCountId !== countId && !o.isInheritedFromChild) continue;

        const realId = o.id.replace(/^(pfg_|pa_|inv_)/, "");
        const isSelected = selectedIds.has(o.id);
        const wasBound = o.boundToCountId === countId;
        const wasInherited = o.isInheritedFromChild && !!o.boundToCountId;

        if (o.vendor === "PFG") {
          if (isSelected && !wasBound && !wasInherited) pfgBind.push(realId);
          if (!isSelected && (wasBound || wasInherited)) pfgUnbind.push(realId);
        } else if (o.vendor === "PA") {
          if (isSelected && !wasBound && !wasInherited) paBind.push(realId);
          if (!isSelected && (wasBound || wasInherited)) paUnbind.push(realId);
        } else if (o.vendor === "INV") {
          if (isSelected && !wasBound && !wasInherited) invBind.push(realId);
          if (!isSelected && (wasBound || wasInherited)) invUnbind.push(realId);
        }
      }

      const promises: any[] = [];

      if (pfgBind.length > 0) {
        promises.push(
          supabase.from("pfg_orders").update({ bound_to_count_id: countId } as any).in("id", pfgBind).select()
        );
      }
      if (pfgUnbind.length > 0) {
        promises.push(
          supabase.from("pfg_orders").update({ bound_to_count_id: null } as any).in("id", pfgUnbind).select()
        );
      }
      if (paBind.length > 0) {
        promises.push(
          supabase.from("pa_orders").update({ bound_to_count_id: countId } as any).in("id", paBind).select()
        );
      }
      if (paUnbind.length > 0) {
        promises.push(
          supabase.from("pa_orders").update({ bound_to_count_id: null } as any).in("id", paUnbind).select()
        );
      }
      if (invBind.length > 0) {
        promises.push(
          supabase.from("vendor_invoices").update({ inventory_count_id: countId } as any).in("id", invBind).select()
        );
      }
      if (invUnbind.length > 0) {
        promises.push(
          supabase.from("vendor_invoices").update({ inventory_count_id: null } as any).in("id", invUnbind).select()
        );
      }

      await Promise.all(promises);
    },
    onSuccess: () => {
      toast.success("Orders applied to period");
      queryClient.invalidateQueries({ queryKey: ["order-reconciliation-v1", locationId] });
      queryClient.invalidateQueries({ queryKey: ["period-cogs"] });
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
    () => (orders || []).filter((o) => !o.boundPeriodLabel || o.isInheritedFromChild).length,
    [orders]
  );

  // Group orders by delivery date
  const groupedOrders = useMemo(() => {
    if (!orders) return [];
    const groups = new Map<string, VendorOrder[]>();
    for (const o of orders) {
      const dateKey = o.deliveryDate ? o.deliveryDate.slice(0, 10) : o.orderDate.slice(0, 10);
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(o);
    }
    return [...groups.entries()].map(([dateStr, items]) => {
      let label = dateStr;
      try {
        label = format(new Date(dateStr + "T12:00:00"), "EEEE, MMM d");
      } catch { /* fallback to raw string */ }
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
      <div className="py-6 text-center">
        <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No vendor orders found for this period window.</p>
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
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {selectedIds.size} of {selectableOrderCount} orders selected
        </p>
        <p className="text-sm font-semibold">
          ${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </p>
      </div>

      <div className={cn("space-y-0", compact ? "max-h-60 overflow-y-auto" : "max-h-96 overflow-y-auto")}>
        {groupedOrders.map((group) => (
          <div key={group.dateStr}>
            {/* Date group header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 px-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Delivered {group.label}
              </p>
            </div>

            <div className="divide-y divide-border/40">
              {group.items.map((order) => {
                const isBoundElsewhere = !!order.boundPeriodLabel;
                const isLockedElsewhere = isBoundElsewhere && !order.isInheritedFromChild;
                const isSelected = selectedIds.has(order.id);
                const inPeriod = periodStartDate && periodEndDate
                  ? order.deliveryDate >= periodStartDate && order.deliveryDate <= periodEndDate
                  : true;

                return (
                  <button
                    key={order.id}
                    onClick={() => toggle(order.id)}
                    disabled={isLockedElsewhere || !editable}
                    className={cn(
                      "w-full flex items-center justify-between py-3 px-2 rounded-lg transition-all",
                      isLockedElsewhere
                        ? "opacity-40 cursor-not-allowed"
                        : isSelected
                        ? "bg-primary/5"
                        : "hover:bg-muted/40",
                      !inPeriod && !isSelected && !isBoundElsewhere && "opacity-60"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all",
                          isLockedElsewhere
                            ? "border-muted-foreground/30 bg-muted/40"
                            : isSelected
                            ? "border-primary bg-primary"
                            : "border-border"
                        )}
                      >
                        {isLockedElsewhere ? (
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
                      {isBoundElsewhere && (
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {order.boundPeriodLabel}
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
