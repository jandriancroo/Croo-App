import { useState, useEffect, useRef } from "react";
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
import { Trash2 } from "lucide-react";

interface DeleteCountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
  countPeriod: string;
}

const COOLDOWN_SECONDS = 5;

const DeleteCountDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
  countPeriod,
}: DeleteCountDialogProps) => {
  const [countdown, setCountdown] = useState(COOLDOWN_SECONDS);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (open) {
      setCountdown(COOLDOWN_SECONDS);
      intervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setCountdown(COOLDOWN_SECONDS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [open]);

  const canDelete = countdown === 0 && !isDeleting;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Inventory Count
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              Are you sure you want to permanently delete this inventory count?
            </p>
            <p className="font-medium text-foreground">
              {countPeriod}
            </p>
            <p className="text-destructive">
              This action cannot be undone. All count data and edit history will be lost.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (canDelete) {
                onConfirm();
              }
            }}
            disabled={!canDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              "Deleting..."
            ) : countdown > 0 ? (
              `Delete (${countdown}s)`
            ) : (
              "Delete Count"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteCountDialog;
