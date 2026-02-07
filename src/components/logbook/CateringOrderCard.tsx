import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChefHat, Users, Check, MoreVertical, Trash2, Eye, DollarSign } from "lucide-react";
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
  const getVariantStyles = () => {
    switch (variant) {
      case "today":
        return "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent";
      case "tomorrow":
        return "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent";
      case "past_due":
        return "border-destructive/50 bg-gradient-to-br from-destructive/10 to-transparent";
      case "completed":
        return "opacity-60";
      default:
        return "";
    }
  };

  const getDateLabel = () => {
    switch (variant) {
      case "today":
        return <span className="text-primary font-medium">Today</span>;
      case "tomorrow":
        return <span className="text-amber-600 font-medium">Tomorrow</span>;
      case "past_due":
        return <span className="text-destructive font-medium">{format(parseISO(order.pickup_date), "MMM d")}</span>;
      default:
        return <span>{format(parseISO(order.pickup_date), "MMM d")}</span>;
    }
  };

  return (
    <Card className={getVariantStyles()} onClick={onView}>
      <CardContent className="p-4 cursor-pointer">
        <div className="flex items-start gap-3">
          {/* Icon avatar */}
          <Avatar className={variant === "completed" ? "bg-green-500/10" : variant === "past_due" ? "bg-destructive/10" : "bg-primary/10"}>
            <AvatarFallback className="bg-transparent">
              {variant === "completed" ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <ChefHat className={`h-4 w-4 ${variant === "past_due" ? "text-destructive" : "text-primary"}`} />
              )}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{order.customer_name}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    {getDateLabel()} at {formatTime(order.pickup_time)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(order.created_at), 'h:mm a')}
                </div>
                {(canComplete || canDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
                )}
              </div>
            </div>

            {/* Tags row */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {/* Status tag */}
              {variant === "completed" ? (
                <Badge variant="secondary" className="bg-green-500/10 text-green-600 text-[10px] px-1.5 py-0">
                  <Check className="h-3 w-3 mr-0.5" />
                  Completed
                </Badge>
              ) : variant === "past_due" ? (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  Past Due
                </Badge>
              ) : variant === "today" ? (
                <Badge className="text-[10px] px-1.5 py-0">
                  Due Today
                </Badge>
              ) : variant === "tomorrow" ? (
                <Badge variant="outline" className="border-amber-500 text-amber-600 text-[10px] px-1.5 py-0">
                  Due Tomorrow
                </Badge>
              ) : null}

              {/* Vendor tag */}
              {order.vendor && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {VENDOR_LABELS[order.vendor] || order.vendor}
                </Badge>
              )}

              {/* Items count */}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {order.items.length} items
              </Badge>

              {/* Headcount */}
              {order.headcount && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  <Users className="h-3 w-3 mr-0.5" />
                  {order.headcount}
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
