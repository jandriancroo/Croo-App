import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, Check, X, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Transfer, useInventoryTransfers } from "@/hooks/useInventoryTransfers";
import { formatInTimeZone } from "date-fns-tz";

interface PendingTransfersSectionProps {
  locationId: string;
}

export default function PendingTransfersSection({ locationId }: PendingTransfersSectionProps) {
  const { user } = useAuth();
  const { pendingIncoming, receiveTransfer, cancelTransfer } = useInventoryTransfers(locationId);
  const [expanded, setExpanded] = useState(true);

  if (pendingIncoming.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-300/50 bg-amber-50/30 dark:bg-amber-900/10 p-3">
      <button
        className="flex items-center justify-between w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Incoming Transfers
          </span>
          <Badge variant="secondary" className="bg-amber-200 text-amber-800 text-[10px]">
            {pendingIncoming.length}
          </Badge>
        </div>
        <ChevronDown className={`h-4 w-4 text-amber-600 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {pendingIncoming.map((transfer: Transfer) => (
            <div key={transfer.id} className="p-3 rounded-lg bg-card border space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    From {transfer.from_location?.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {transfer.transferred_by_profile?.full_name} · {formatInTimeZone(
                      new Date(transfer.created_at),
                      "America/Los_Angeles",
                      "MMM d 'at' h:mm a"
                    )}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                  Pending
                </Badge>
              </div>

              {/* Items list */}
              <div className="space-y-1">
                {((transfer as any).inventory_transfer_items || []).map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.item_id.slice(0, 8)}...</span>
                    <span className="font-medium">
                      {item.quantity} {item.unit_type === "case" ? "cs" : "ea"}
                    </span>
                  </div>
                ))}
              </div>

              {transfer.notes && (
                <p className="text-xs text-muted-foreground italic">"{transfer.notes}"</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={() => receiveTransfer.mutate({ transferId: transfer.id, userId: user?.id || "" })}
                  disabled={receiveTransfer.isPending}
                >
                  <Check className="h-3 w-3" /> Confirm Receipt
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1"
                  onClick={() => cancelTransfer.mutate(transfer.id)}
                  disabled={cancelTransfer.isPending}
                >
                  <X className="h-3 w-3" /> Decline
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
