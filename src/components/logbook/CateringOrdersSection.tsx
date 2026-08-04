import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { ChefHat, Check, Loader2, Trash2, Eye } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { compressImage } from "@/utils/imageCompression";
import { useUserRole } from "@/hooks/useUserRole";
import { CateringOrderCard } from "./CateringOrderCard";
interface CateringOrder {
  id: string;
  order_number: string | null;
  customer_name: string;
  pickup_date: string;
  pickup_time: string;
  headcount: number | null;
  items: { quantity: number; item: string; notes?: string; price?: number }[];
  notes: string | null;
  source_url: string | null;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  contact_phone: string | null;
  total_price: number | null;
  vendor: string | null;
}

interface CateringOrdersSectionProps {
  showHeader?: boolean;
  externalUploadOpen?: boolean;
  onExternalUploadChange?: (open: boolean) => void;
  searchQuery?: string;
}

export function CateringOrdersSection({ showHeader: _showHeader = true, externalUploadOpen, onExternalUploadChange, searchQuery = "" }: CateringOrdersSectionProps) {
  const { currentLocation } = useLocation();
  const { getTodayInTimezone, timezone } = useLocationTimezone();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const [orders, setOrders] = useState<CateringOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CateringOrder | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Handle external upload control
  useEffect(() => {
    if (externalUploadOpen !== undefined) {
      setShowUploadDialog(externalUploadOpen);
    }
  }, [externalUploadOpen]);

  // Sync internal state back to parent
  useEffect(() => {
    if (onExternalUploadChange) {
      onExternalUploadChange(showUploadDialog);
    }
  }, [showUploadDialog, onExternalUploadChange]);

  const canComplete = isShiftManager || isGeneralManager || isManager || isAdmin;

  useEffect(() => {
    if (currentLocation?.id) {
      fetchOrders();
    }
  }, [currentLocation?.id]);

  const fetchOrders = async () => {
    try {
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation?.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders((data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[]);
    } catch (error) {
      console.error("Error fetching catering orders:", error);
      toast.error("Failed to load catering orders");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentLocation?.id) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upload file to storage
      let fileToUpload = file;
      if (file.type.startsWith("image/")) {
        fileToUpload = await compressImage(file, 1200, 1200, 0.85);
      }

      const fileExt = file.name.split(".").pop();
      const filePath = `catering-orders/${currentLocation.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("checklist-images")
        .upload(filePath, fileToUpload);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("checklist-images")
        .getPublicUrl(filePath);

      // Parse with AI
      toast.info("Parsing order with AI...");
      
      const { data: parseResult, error: parseError } = await supabase.functions.invoke(
        "ai-extraction-service?action=parse-catering-order",
        { body: { imageUrl: urlData.publicUrl, timezone } }
      );

      if (parseError) throw parseError;
      if (!parseResult.success) throw new Error(parseResult.error);

      const orderData = parseResult.data;

      // Insert order
      const { error: insertError } = await supabase
        .from("catering_orders")
        .insert({
          location_id: currentLocation.id,
          order_number: orderData.order_number || null,
          customer_name: orderData.customer_name,
          pickup_date: orderData.pickup_date,
          pickup_time: orderData.pickup_time,
          headcount: orderData.headcount || null,
          items: orderData.items,
          notes: orderData.notes || null,
          source_url: urlData.publicUrl,
          created_by: user.id,
          contact_phone: orderData.contact_phone || null,
          total_price: orderData.total_price || null,
        });

      if (insertError) throw insertError;

      // Send push notification for new catering order
      if (currentLocation?.id) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              notification_type: 'catering_order',
              title: `New Catering Order - ${currentLocation?.name || 'Location'}`,
              body: `${orderData.customer_name} - ${format(parseISO(orderData.pickup_date), "MMM d")} at ${orderData.pickup_time}`,
              location_id: currentLocation.id,
              roles: ['admin', 'manager', 'shift_manager', 'shift_manager_in_training'],
            }
          });
        } catch (notifError) {
          console.error('Failed to send push notification:', notifError);
        }
      }

      toast.success("Catering order added!");
      setShowUploadDialog(false);
      fetchOrders();
    } catch (error) {
      console.error("Error uploading catering order:", error);
      toast.error(error instanceof Error ? error.message : "Failed to process order");
    } finally {
      setUploading(false);
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

      toast.success("Order marked as completed!");
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error("Error completing order:", error);
      toast.error("Failed to complete order");
    }
  };

  const handleDelete = async (orderId: string) => {
    if (!confirm("Delete this catering order?")) return;

    try {
      const { error } = await supabase
        .from("catering_orders")
        .delete()
        .eq("id", orderId);

      if (error) throw error;
      toast.success("Order deleted");
      fetchOrders();
    } catch (error) {
      console.error("Error deleting order:", error);
      toast.error("Failed to delete order");
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Use location timezone for accurate date comparisons
  const { getDateInTimezoneOffset } = useLocationTimezone();
  const todayStr = getTodayInTimezone();
  const tomorrowStr = getDateInTimezoneOffset(1);

  // Determine variant for each order
  const getOrderVariant = (order: CateringOrder): "today" | "tomorrow" | "upcoming" | "past_due" | "completed" => {
    if (order.status === "completed") return "completed";
    if (order.pickup_date < todayStr) return "past_due";
    if (order.pickup_date === todayStr) return "today";
    if (order.pickup_date === tomorrowStr) return "tomorrow";
    return "upcoming";
  };

  // Group orders by pickup date for pending, by completed_at date for completed
  const ordersByDate = orders.reduce((acc, order) => {
    const dateKey = order.status === "completed" && order.completed_at 
      ? format(new Date(order.completed_at), 'yyyy-MM-dd')
      : order.pickup_date;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(order);
    return acc;
  }, {} as Record<string, CateringOrder[]>);

  // Filter orders by search query
  const filteredOrdersByDate = useMemo(() => {
    if (!searchQuery.trim()) return ordersByDate;
    
    const lowerQuery = searchQuery.toLowerCase();
    const filtered: Record<string, CateringOrder[]> = {};
    
    Object.entries(ordersByDate).forEach(([dateKey, orders]) => {
      const matchingOrders = orders.filter(order => {
        const searchableText = [
          order.customer_name,
          order.order_number || '',
          order.vendor || '',
          order.contact_phone || '',
          ...order.items.map(item => item.item)
        ].join(' ').toLowerCase();
        
        return searchableText.includes(lowerQuery);
      });
      
      if (matchingOrders.length > 0) {
        filtered[dateKey] = matchingOrders;
      }
    });
    
    return filtered;
  }, [ordersByDate, searchQuery]);

  // Sort dates - most recent first (descending)
  const sortedDates = Object.keys(filteredOrdersByDate).sort((a, b) => b.localeCompare(a));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No catering orders. Upload a PDF or screenshot to get started.
          </p>
        ) : (
          <>
            {sortedDates.map((dateKey) => (
              <div key={dateKey} className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-background py-2 z-10">
                  {format(new Date(dateKey + 'T12:00:00'), 'EEEE, MMM d')}
                </h3>
                <div className="space-y-2">
                  {filteredOrdersByDate[dateKey]
                    .sort((a, b) => a.pickup_time.localeCompare(b.pickup_time))
                    .map((order) => (
                      <CateringOrderCard
                        key={order.id}
                        order={order}
                        variant={getOrderVariant(order)}
                        onView={() => setSelectedOrder(order)}
                        onComplete={() => handleComplete(order)}
                        onDelete={() => handleDelete(order.id)}
                        canComplete={canComplete}
                        canDelete={isAdmin}
                      />
                    ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Catering Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a PDF or screenshot of the catering order. AI will automatically extract the details.
            </p>
            <Input
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            {uploading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing order...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                  <span>
                    {format(parseISO(selectedOrder.pickup_date), "EEEE, MMM d")} at{" "}
                    {formatTime(selectedOrder.pickup_time)}
                  </span>
                </div>
                {selectedOrder.headcount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Headcount</span>
                    <span>{selectedOrder.headcount}</span>
                  </div>
                )}
                {selectedOrder.total_price && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Price</span>
                    <span className="font-medium text-green-600">${selectedOrder.total_price.toFixed(2)}</span>
                  </div>
                )}
                {selectedOrder.contact_phone && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Contact</span>
                    <a href={`tel:${selectedOrder.contact_phone}`} className="text-primary hover:underline">
                      {selectedOrder.contact_phone}
                    </a>
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
                <a
                  href={selectedOrder.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    type="button"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    View Original
                  </Button>
                </a>
              )}

              <div className="flex gap-2 pt-2 border-t">
                {selectedOrder.status === "pending" && canComplete && (
                  <Button
                    className="flex-1"
                    onClick={() => handleComplete(selectedOrder)}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Mark Completed
                  </Button>
                )}
                {selectedOrder.status === "completed" && (
                  <Badge variant="secondary" className="flex-1 justify-center py-2">
                    <Check className="h-4 w-4 mr-2" />
                    Completed
                  </Badge>
                )}
                {isAdmin && (
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => {
                      handleDelete(selectedOrder.id);
                      setSelectedOrder(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
