import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ChefHat, ClipboardList, Clock, Users } from "lucide-react";

interface SharedTaskMessageProps {
  title: string;
  details?: string;
  accentColor?: string;
  senderName: string;
}

// Parse catering details from the shareDetails string
// Format: "Catering: Customer Name • Time • X items"
function parseCateringDetails(details: string) {
  if (!details?.startsWith("Catering:")) return null;
  
  const content = details.replace("Catering:", "").trim();
  const parts = content.split("•").map(p => p.trim());
  
  return {
    customerName: parts[0] || "Customer",
    time: parts[1] || "",
    items: parts[2] || "",
  };
}

export function SharedTaskMessage({ 
  title, 
  details, 
  accentColor = "#8B5CF6",
  senderName 
}: SharedTaskMessageProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  
  // Check if this is a catering order
  const cateringInfo = details ? parseCateringDetails(details) : null;
  const isCatering = !!cateringInfo;
  const Icon = isCatering ? ChefHat : ClipboardList;

  return (
    <>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {senderName} shared {isCatering ? "a catering order" : "a task"}
        </p>
        <Card
          className="overflow-hidden bg-card/80 backdrop-blur-sm max-w-[280px] cursor-pointer hover:bg-card/90 transition-colors"
          style={{ borderLeft: `4px solid ${accentColor}` }}
          onClick={() => setPreviewOpen(true)}
        >
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-3">
              <div
                className="p-2 rounded-lg shrink-0"
                style={{ backgroundColor: `${accentColor}20` }}
              >
                <Icon className="h-5 w-5" style={{ color: accentColor }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-sm leading-tight truncate">{title}</p>
                </div>
                {isCatering && (
                  <Badge 
                    variant="outline" 
                    className="text-[10px] px-1.5 py-0 h-4 font-semibold"
                    style={{ borderColor: accentColor, color: accentColor }}
                  >
                    CATERING
                  </Badge>
                )}
                {details && !isCatering && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {details}
                  </p>
                )}
                {cateringInfo && (
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{cateringInfo.time}</span>
                    <span>•</span>
                    <span>{cateringInfo.items}</span>
                  </div>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-center">
              Tap to view details
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="h-5 w-5" style={{ color: accentColor }} />
              {isCatering ? "Catering Order" : "Task Details"}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {isCatering && cateringInfo ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Customer</span>
                    <span className="font-medium">{cateringInfo.customerName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Pickup</span>
                    <span className="font-medium" style={{ color: accentColor }}>
                      {cateringInfo.time}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Order</span>
                    <span>{cateringInfo.items}</span>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <p className="text-sm text-muted-foreground text-center">
                    This catering order can only be completed from the Dashboard quick tasks.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div 
                  className="p-4 rounded-lg"
                  style={{ backgroundColor: `${accentColor}10`, borderLeft: `4px solid ${accentColor}` }}
                >
                  <p className="font-medium">{title}</p>
                  {details && (
                    <p className="text-sm text-muted-foreground mt-1">{details}</p>
                  )}
                </div>
                
                <p className="text-sm text-muted-foreground text-center">
                  Tasks can only be completed from the Dashboard.
                </p>
              </>
            )}
            
            <p className="text-xs text-muted-foreground text-center">
              Shared by {senderName}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
