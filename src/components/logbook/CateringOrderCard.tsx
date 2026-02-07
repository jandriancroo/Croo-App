import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChefHat, Check, MoreVertical, Trash2, Eye, DollarSign } from "lucide-react";
import { format, parseISO } from "date-fns";

interface CateringOrderCardProps {
  order: {
    id: string;
    order_number: string | null;
    customer_name: string;
    pickup_date: string;
    pickup_time: string;
    headcount: number | null;
    items: { quantity: number; item: string; notes?: string; price?: number }[];
    notes: string | null;
    status: string;
    completed_at: string | null;
    contact_phone: string | null;
    total_price: number | null;
    vendor: string | null;
    created_at: string;
  };
  variant: "today" | "tomorrow" | "upcoming" | "past_due" | "completed";
  onView: () => void;
  onComplete?: () => void;
  onDelete?: () => void;
  canComplete?: boolean;
  canDelete?: boolean;
}

const VENDOR_LABELS: Record<string, string> = {
  ez_cater: "EZ Cater",
  direct: "Direct",
  phone: "Phone",
  other: "Other",
};

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};

export function CateringOrderCard({
  order,
  variant,
  onView,
  onComplete,
  onDelete,
  canComplete,
  canDelete,
}: CateringOrderCardProps) {
  const isCompleted = variant === "completed";
  
  const getVariantStyles = () => {
    switch (variant) {
      case "today":
        return "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent";
      case "tomorrow":
        return "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent";
      case "past_due":
        return "border-destructive/50 bg-gradient-to-br from-destructive/10 to-transparent";
      case "completed":
        return "";
      default:
        return "";
    }
  };

  const getPickupLabel = () => {
    switch (variant) {
      case "today":
        return `Pickup @ ${formatTime(order.pickup_time)}`;
      case "tomorrow":
        return `Pickup Tomorrow @ ${formatTime(order.pickup_time)}`;
      case "past_due":
        return `Pickup ${format(parseISO(order.pickup_date), "MMM d")} @ ${formatTime(order.pickup_time)}`;
      case "completed":
        return null; // Handled separately with checkmark
      default:
        return `Pickup ${format(parseISO(order.pickup_date), "MMM d")} @ ${formatTime(order.pickup_time)}`;
    }
  };

  return (
    <Card className={getVariantStyles()}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Avatar with chef hat icon - matches log entry style */}
          <Avatar>
            <AvatarFallback className="bg-primary/10">
              <ChefHat className="h-4 w-4 text-primary" />
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{order.customer_name}</div>
                <div className="text-sm text-muted-foreground">
                  {isCompleted ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <Check className="h-3.5 w-3.5" />
                      Picked up @ {formatTime(order.pickup_time)}
                    </span>
                  ) : (
                    getPickupLabel()
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(order.created_at), 'h:mm a')}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover">
                    <DropdownMenuItem onClick={onView}>
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </DropdownMenuItem>
                    {canComplete && order.status === "pending" && (
                      <DropdownMenuItem onClick={onComplete}>
                        <Check className="h-4 w-4 mr-2" />
                        Mark Completed
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem 
                        onClick={onDelete}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Tags row - matches log entry style */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {/* Status badges for pending orders */}
              {variant === "past_due" && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  Past Due
                </Badge>
              )}

              {/* Vendor tag */}
              {order.vendor && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {VENDOR_LABELS[order.vendor] || order.vendor}
                </Badge>
              )}

              {/* Total price */}
              {order.total_price && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-500/30">
                  <DollarSign className="h-3 w-3" />
                  {order.total_price.toFixed(2)}
                </Badge>
              )}
            </div>

            {/* Details button - matches log entry style */}
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full mt-3"
              onClick={onView}
            >
              <Eye className="h-4 w-4 mr-1" />
              Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
