import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import PanSizesSection from "./PanSizesSection";
import type { PanSizesConfig } from "./PanSizesSection";

interface BulkPanSizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onApply: (config: PanSizesConfig | null) => void;
  isPending: boolean;
}

export default function BulkPanSizeDialog({ open, onOpenChange, selectedCount, onApply, isPending }: BulkPanSizeDialogProps) {
  const [config, setConfig] = useState<PanSizesConfig | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Set Pan Sizes — {selectedCount} item{selectedCount !== 1 ? "s" : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Configure pan sizes below. This will be applied to all {selectedCount} selected items.
          </p>

          <PanSizesSection value={null} onChange={setConfig} />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => onApply(config)}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Apply to ${selectedCount}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
