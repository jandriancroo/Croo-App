import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Package, Truck, Check, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeliveryReconciliationProps {
  countId: string;
  locationId: string;
  onComplete: () => void;
}

interface DeliveryOrder {
  id: string;
  orderType: "pfg" | "produce_alliance";
  orderNumber: string | null;
  deliveryDate: string;
  totalAmount: number | null;
  itemCount: number;
  vendorLabel: string;
}

const DeliveryReconciliation = ({ countId, locationId, onComplete }: DeliveryReconciliationProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [checkedOrders, setCheckedOrders] = useState<Set<string>>(new Set());
  const [showSkipWarning, setShowSkipWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Find the previous completed count to determine the delivery window
  const { data: previousCount, isLoading: prevLoading } = useQuery({
    queryKey: ["previous-completed-count", locationId, countId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_counts")
        .select("id, count_date, counted_at")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .neq("id", countId)
        .order("count_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // Fetch deliveries since last count (or all if first count)
  const { data: deliveries, isLoading: deliveriesLoading } = useQuery({
    queryKey: ["unreconciled-deliveries", locationId, previousCount?.count_date],
    queryFn: async () => {
      const sinceDate = previousCount?.count_date || "2000-01-01";

      const [pfgResult, paResult] = await Promise.all([
        supabase
          .from("pfg_orders")
          .select("id, order_number, delivery_date, total_amount, items")
          .eq("location_id", locationId)
          .gt("delivery_date", sinceDate)
          .order("delivery_date", { ascending: true }),
        supabase
          .from("pa_orders")
          .select("id, order_number, delivery_date, total_amount, items")
          .eq("location_id", locationId)
          .gt("delivery_date", sinceDate)
          .order("delivery_date", { ascending: true }),
      ]);

      // Filter out orders already reconciled to another count
      const { data: alreadyReconciled } = await supabase
        .from("inventory_count_deliveries")
        .select("order_id, order_type")
        .neq("count_id", countId);

      const reconciledSet = new Set(
        (alreadyReconciled || []).map(r => `${r.order_type}:${r.order_id}`)
      );

      const orders: DeliveryOrder[] = [];

      for (const order of pfgResult.data || []) {
        if (reconciledSet.has(`pfg:${order.id}`)) continue;
        const items = Array.isArray(order.items) ? order.items : [];
        orders.push({
          id: order.id,
          orderType: "pfg",
          orderNumber: order.order_number,
          deliveryDate: order.delivery_date,
          totalAmount: order.total_amount ? Number(order.total_amount) : null,
          itemCount: items.length,
          vendorLabel: "PFG",
        });
      }

      for (const order of paResult.data || []) {
        if (reconciledSet.has(`produce_alliance:${order.id}`)) continue;
        const items = Array.isArray(order.items) ? order.items : [];
        orders.push({
          id: order.id,
          orderType: "produce_alliance",
          orderNumber: order.order_number,
          deliveryDate: order.delivery_date,
          totalAmount: order.total_amount ? Number(order.total_amount) : null,
          itemCount: items.length,
          vendorLabel: "Produce Alliance",
        });
      }

      return orders;
    },
    enabled: previousCount !== undefined, // Wait for prev count query to finish (even if null)
  });

  // Check existing reconciliation records for this count
  const { data: existingReconciliation } = useQuery({
    queryKey: ["existing-reconciliation", countId],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_count_deliveries")
        .select("order_id, order_type, reconciled")
        .eq("count_id", countId);
      return data || [];
    },
  });

  // Initialize checked state from existing reconciliation
  const isInitialized = useMemo(() => {
    if (!existingReconciliation || existingReconciliation.length === 0) return false;
    const newChecked = new Set<string>();
    for (const r of existingReconciliation) {
      if (r.reconciled) {
        newChecked.add(`${r.order_type}:${r.order_id}`);
      }
    }
    if (newChecked.size > 0 && checkedOrders.size === 0) {
      setCheckedOrders(newChecked);
    }
    return true;
  }, [existingReconciliation]);

  // No previous count = first count, skip reconciliation
  const isFirstCount = previousCount === null && !prevLoading;
  const isLoading = prevLoading || deliveriesLoading;
  const noDeliveries = !isLoading && (!deliveries || deliveries.length === 0);

  // Auto-skip if first count or no deliveries
  if (isFirstCount || noDeliveries) {
    if (!isLoading) {
      // Use setTimeout to avoid state update during render
      setTimeout(() => onComplete(), 0);
    }
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const toggleOrder = (orderType: string, orderId: string) => {
    const key = `${orderType}:${orderId}`;
    setCheckedOrders(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!deliveries) return;
    if (checkedOrders.size === deliveries.length) {
      setCheckedOrders(new Set());
    } else {
      setCheckedOrders(new Set(deliveries.map(d => `${d.orderType}:${d.id}`)));
    }
  };

  const uncheckedCount = (deliveries?.length || 0) - checkedOrders.size;

  const handleContinue = async () => {
    if (uncheckedCount > 0) {
      setShowSkipWarning(true);
      return;
    }
    await saveReconciliation();
  };

  const saveReconciliation = async () => {
    if (!deliveries || !user) return;
    setIsSaving(true);

    try {
      const records = deliveries.map(d => ({
        count_id: countId,
        order_type: d.orderType,
        order_id: d.id,
        reconciled: checkedOrders.has(`${d.orderType}:${d.id}`),
        reconciled_by: user.id,
        reconciled_at: new Date().toISOString(),
      }));

      // Upsert all reconciliation records
      const { error } = await supabase
        .from("inventory_count_deliveries")
        .upsert(records, { onConflict: "order_type,order_id" });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["existing-reconciliation", countId] });
      onComplete();
    } catch (err) {
      console.error("Failed to save reconciliation:", err);
      toast.error("Failed to save delivery reconciliation");
    } finally {
      setIsSaving(false);
    }
  };

  const totalReconciled = deliveries
    ?.filter(d => checkedOrders.has(`${d.orderType}:${d.id}`))
    .reduce((sum, d) => sum + (d.totalAmount || 0), 0) || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Truck className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">Reconcile Deliveries</h2>
          <p className="text-sm text-muted-foreground">
            Check off deliveries received since your last count
          </p>
        </div>
      </div>

      {/* Select All */}
      <div className="flex items-center justify-between">
        <button
          onClick={toggleAll}
          className="text-sm text-primary font-medium hover:underline"
        >
          {checkedOrders.size === deliveries?.length ? "Uncheck All" : "Check All"}
        </button>
        <div className="text-sm text-muted-foreground">
          {checkedOrders.size}/{deliveries?.length || 0} reconciled
        </div>
      </div>

      {/* Delivery List */}
      <div className="space-y-2">
        {deliveries?.map(order => {
          const isChecked = checkedOrders.has(`${order.orderType}:${order.id}`);
          return (
            <Card
              key={`${order.orderType}:${order.id}`}
              className={cn(
                "cursor-pointer transition-colors",
                isChecked ? "border-primary/30 bg-primary/5" : "border-border"
              )}
              onClick={() => toggleOrder(order.orderType, order.id)}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleOrder(order.orderType, order.id)}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{order.vendorLabel}</span>
                      {order.orderNumber && (
                        <span className="text-xs text-muted-foreground">#{order.orderNumber}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        Delivered {format(new Date(order.deliveryDate + "T12:00:00"), "MMM d, yyyy")}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {order.itemCount} item{order.itemCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  {order.totalAmount != null && (
                    <span className="text-sm font-medium shrink-0">
                      ${order.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary */}
      <Card className="bg-muted/50">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Reconciled</span>
            <span className="font-semibold">
              ${totalReconciled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Continue Button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleContinue}
        disabled={isSaving}
      >
        {isSaving ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : uncheckedCount > 0 ? (
          <AlertTriangle className="h-4 w-4 mr-2" />
        ) : (
          <Check className="h-4 w-4 mr-2" />
        )}
        {isSaving ? "Saving..." : uncheckedCount > 0
          ? `Continue with ${uncheckedCount} unreconciled`
          : "Continue to Count"
        }
      </Button>

      {/* Skip Warning Dialog */}
      <AlertDialog open={showSkipWarning} onOpenChange={setShowSkipWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unreconciled Deliveries</AlertDialogTitle>
            <AlertDialogDescription>
              {uncheckedCount} delivery{uncheckedCount !== 1 ? " orders are" : " order is"} not checked off.
              They'll carry forward to your next count period. This may affect your variance calculations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={saveReconciliation}>
              Continue Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DeliveryReconciliation;
