import { useEffect, useState } from "react";
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
import { Lock, AlertTriangle } from "lucide-react";



interface OpenHistoricalCountDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  countPeriod: string;
  countdownSeconds?: number;
}

/**
 * Safety gate shown before opening a historical (completed) inventory count.
 * Forces the user to read a warning and wait out a short countdown before
 * the OPEN button enables — same spirit as the delete confirmation dialog.
 */
const OpenHistoricalCountDialog = ({
  open,
  onConfirm,
  onCancel,
  countPeriod,
  countdownSeconds = 5,
}: OpenHistoricalCountDialogProps) => {
  const [remaining, setRemaining] = useState(countdownSeconds);

  useEffect(() => {
    if (!open) {
      setRemaining(countdownSeconds);
      return;
    }
    setRemaining(countdownSeconds);
    const interval = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [open, countdownSeconds]);

  const canOpen = remaining === 0;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <Lock className="h-5 w-5" />
            Opening a Completed Count
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="font-medium text-foreground">{countPeriod}</p>
              <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    This is a historical, frozen count.
                  </p>
                  <p>
                    Values shown reflect the snapshot taken when this count was
                    submitted. Editing it can change historical reports, AvT,
                    and COGS for the period it belongs to.
                  </p>
                  <p>
                    Only proceed if you intend to review or correct it.
                  </p>
                </div>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (canOpen) onConfirm();
            }}
            disabled={!canOpen}
          >
            {canOpen ? "Open Count" : `Open in ${remaining}s`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default OpenHistoricalCountDialog;
