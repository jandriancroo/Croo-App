import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { ChefHat, Clock, Users, Check, Eye } from "lucide-react";
import { format, parseISO, isToday } from "date-fns";
import { useUserRole } from "@/hooks/useUserRole";

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

export function CateringOrdersAlert() {
  const { currentLocation } = useLocation();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const [todaysOrders, setTodaysOrders] = useState<CateringOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<CateringOrder | null>(null);
  const [loading, setLoading] = useState(true);

  const canComplete = isShiftManager || isGeneralManager || isManager || isAdmin;

  useEffect(() => {
    if (currentLocation?.id) {
      fetchTodaysOrders();
    }
  }, [currentLocation?.id]);

  const fetchTodaysOrders = async () => {
    try {
      // Get today's date in PST timezone
      const now = new Date();
      const pstDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
      const today = format(pstDate, "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation?.id)
        .eq("pickup_date", today)
        .eq("status", "pending")
        .order("pickup_time", { ascending: true });

      if (error) throw error;
      setTodaysOrders((data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[]);
    } catch (error) {
      console.error("Error fetching today's catering orders:", error);
    } finally {
      setLoading(false);
    }
  };

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
      fetchTodaysOrders();
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

  if (loading || todaysOrders.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="p-4 border-primary/50 bg-primary/5">
        <div className="flex items-center gap-2 mb-3">
          <ChefHat className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Today's Catering Orders</h3>
          <Badge variant="secondary">{todaysOrders.length}</Badge>
        </div>

        <div className="space-y-2">
          {todaysOrders.map((order) => (
            <div
              key={order.id}
              className="p-3 bg-background border rounded-lg cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setSelectedOrder(order)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{order.customer_name}</p>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1 text-primary font-medium">
                      <Clock className="h-3 w-3" />
                      {formatTime(order.pickup_time)}
                    </span>
                    {order.headcount && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {order.headcount}
                      </span>
                    )}
                  </div>
                </div>
                <Badge>{order.items.length} items</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Order Details Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              Catering Order
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
                  <span className="text-primary font-medium">
                    Today at {formatTime(selectedOrder.pickup_time)}
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

              {canComplete && (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => handleComplete(selectedOrder)}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Mark Completed
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
