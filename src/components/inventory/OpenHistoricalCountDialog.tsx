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
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Lock className="h-5 w-5" />
            Editing a Completed Count
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="font-medium text-foreground">{countPeriod}</p>
              <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    This count is frozen.
                  </p>
                  <p className="text-destructive">
                    Editing it will change historical reports, AvT, and COGS for
                    the period it belongs to. This cannot be undone.
                  </p>
                  <p>
                    Only proceed if you intend to correct it.
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
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {canOpen ? "Edit Count" : `Edit in ${remaining}s`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default OpenHistoricalCountDialog;
