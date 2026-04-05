import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { toast } from "sonner";
import { ChefHat, Check, Eye } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { TemporaryTaskCard } from "./TemporaryTaskCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface CateringOrder {
  id: string;
  order_number: string | null;
  customer_name: string;
  pickup_date: string;
  pickup_time: string;
  headcount: number | null;
  items: { quantity: number; item: string; notes?: string }[];
  notes: string | null;
  source_url: string | null;
  status: string;
}

const ORANGE_COLOR = "#f97316";
const AMBER_COLOR = "#f59e0b";

export function CateringOrdersAlert() {
  const { currentLocation } = useLocation();
  const { getBusinessDateInTimezone, getDateInTimezoneOffset } = useLocationTimezone();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<CateringOrder | null>(null);
  const [isTomorrowOrder, setIsTomorrowOrder] = useState(false);

  const canComplete = isShiftManager || isGeneralManager || isManager || isAdmin;
  const today = getBusinessDateInTimezone();
  const tomorrow = getDateInTimezoneOffset(1);

  // Fetch today's orders with React Query
  const { data: todaysOrders = [], isLoading: loadingToday } = useQuery({
    queryKey: ["catering-alerts-today", currentLocation?.id, today],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("pickup_date", today)
        .eq("status", "pending")
        .order("pickup_time", { ascending: true });

      if (error) throw error;
      
      return (data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[];
    },
    enabled: !!currentLocation?.id,
    staleTime: 30 * 1000, // 30s cache
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch tomorrow's orders with React Query
  const { data: tomorrowsOrders = [], isLoading: loadingTomorrow } = useQuery({
    queryKey: ["catering-orders-tomorrow", currentLocation?.id, tomorrow],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("pickup_date", tomorrow)
        .eq("status", "pending")
        .order("pickup_time", { ascending: true });

      if (error) throw error;
      
      return (data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[];
    },
    enabled: !!currentLocation?.id,
    staleTime: 60 * 1000, // 1 min cache - tomorrow orders change less often
    refetchInterval: 120000, // Refresh every 2 minutes
  });

  const handleComplete = async (order: CateringOrder) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("catering_orders")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        })
        .eq("id", order.id);

      if (error) throw error;

      toast.success("Catering order completed!");
      setSelectedOrder(null);
      // Invalidate query to refetch
      queryClient.invalidateQueries({ queryKey: ["catering-alerts-today"] });
      queryClient.invalidateQueries({ queryKey: ["todays-catering-orders"] });
    } catch (error) {
      console.error("Error completing order:", error);
      toast.error("Failed to complete order");
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const handleOrderClick = (order: CateringOrder, isTomorrow: boolean) => {
    setSelectedOrder(order);
    setIsTomorrowOrder(isTomorrow);
  };

  const loading = loadingToday || loadingTomorrow;

  if (loading || (todaysOrders.length === 0 && tomorrowsOrders.length === 0)) {
    return null;
  }

  return (
    <>
      {/* Today's orders */}
      {todaysOrders.map((order) => (
        <TemporaryTaskCard
          key={order.id}
          id={order.id}
          title={`${order.customer_name} • Due @ ${formatTime(order.pickup_time)}`}
          subtitle={`${order.items.length} items${order.headcount ? ` • ${order.headcount} guests` : ""}`}
          icon={ChefHat}
          accentColor={ORANGE_COLOR}
          buttonLabel="Done"
          onAction={() => handleOrderClick(order, false)}
          badge={{ label: "CATERING", color: ORANGE_COLOR }}
          shareDetails={`Catering: ${order.customer_name} • ${formatTime(order.pickup_time)} • ${order.items.length} items`}
        />
      ))}
      
      {/* Tomorrow's orders */}
      {tomorrowsOrders.map((order) => (
        <TemporaryTaskCard
          key={order.id}
          id={order.id}
          title={`${order.customer_name} • Due Tomorrow @ ${formatTime(order.pickup_time)}`}
          subtitle={`${order.items.length} items${order.headcount ? ` • ${order.headcount} guests` : ""}`}
          icon={ChefHat}
          accentColor={AMBER_COLOR}
          buttonLabel="View"
          onAction={() => handleOrderClick(order, true)}
          badge={{ label: "CATERING", color: AMBER_COLOR }}
          shareDetails={`Catering: ${order.customer_name} • Tomorrow ${formatTime(order.pickup_time)} • ${order.items.length} items`}
        />
      ))}

      {/* Order Details Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              Catering Order
              {isTomorrowOrder && (
                <Badge variant="outline" className="ml-2 border-amber-500 text-amber-600">
                  Due Tomorrow
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="font-medium">{selectedOrder.customer_name}</span>
                </div>
                {selectedOrder.order_number && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Order #</span>
                    <span>{selectedOrder.order_number}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Pickup</span>
                  <span className={isTomorrowOrder ? "text-amber-600 font-medium" : "text-primary font-medium"}>
                    {isTomorrowOrder ? "Tomorrow" : "Today"} at {formatTime(selectedOrder.pickup_time)}
                  </span>
                </div>
                {selectedOrder.headcount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Headcount</span>
                    <span>{selectedOrder.headcount}</span>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Items</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <span className="font-medium min-w-[24px]">{item.quantity}x</span>
                      <div>
                        <span>{item.item}</span>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-1">Notes</h4>
                  <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                </div>
              )}

              {selectedOrder.source_url && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => window.open(selectedOrder.source_url!, "_blank")}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Original
                </Button>
              )}

              {/* Only show complete button for today's orders */}
              {canComplete && !isTomorrowOrder && (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => handleComplete(selectedOrder)}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Mark Completed
                </Button>
              )}
              
              {isTomorrowOrder && (
                <p className="text-sm text-center text-muted-foreground">
                  This order can be completed tomorrow.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
