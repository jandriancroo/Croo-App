import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChefHat, Check } from 'lucide-react';

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

interface CateringOrderDialogProps {
  selectedOrder: CateringOrder | null;
  onClose: () => void;
  canComplete: boolean;
  onComplete: (order: CateringOrder) => void;
  pdfPreviewUrl: string | null;
  onPdfPreviewChange: (url: string | null) => void;
}

function formatCateringTime(time: string) {
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

export const CateringOrderDialog = React.memo(function CateringOrderDialog({
  selectedOrder,
  onClose,
  canComplete,
  onComplete,
  pdfPreviewUrl,
  onPdfPreviewChange,
}: CateringOrderDialogProps) {
  return (
    <>
      <Dialog open={!!selectedOrder} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-orange-500" />
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
                  <span className="text-orange-500 font-medium">
                    Today at {formatCateringTime(selectedOrder.pickup_time)}
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
                  onClick={() => onPdfPreviewChange(selectedOrder.source_url)}
                >
                  View Original
                </Button>
              )}

              {selectedOrder.status === 'completed' ? (
                <div className="w-full py-3 px-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center justify-center gap-2">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="text-green-600 font-medium">Order Completed</span>
                </div>
              ) : canComplete && (
                <Button
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                  size="lg"
                  onClick={() => onComplete(selectedOrder)}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Mark Completed
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pdfPreviewUrl} onOpenChange={(open) => !open && onPdfPreviewChange(null)}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>Original Order</DialogTitle>
          </DialogHeader>
          <div className="flex-1 px-4 pb-4 min-h-0">
            {pdfPreviewUrl && (
              <iframe
                src={pdfPreviewUrl}
                className="w-full h-full rounded-md border bg-white"
                title="PDF Preview"
              />
            )}
          </div>
          {pdfPreviewUrl && (
            <div className="p-4 pt-0 flex justify-center">
              <Button asChild size="lg">
                <a href={pdfPreviewUrl} target="_blank" rel="noopener noreferrer">
                  Open PDF in New Tab
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
