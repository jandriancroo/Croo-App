import { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface DeleteCountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting: boolean;
  countPeriod: string;
}

const DeleteCountDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
  countPeriod,
}: DeleteCountDialogProps) => {
  const { user } = useAuth();
  const expectedName =
    (user as any)?.user_metadata?.full_name?.trim() ||
    (user as any)?.user_metadata?.name?.trim() ||
    (user as any)?.email?.trim() ||
    "";

  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const matches =
    expectedName.length > 0 &&
    typed.trim().toLowerCase() === expectedName.toLowerCase();
  const canDelete = matches && !isDeleting;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Inventory Count
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Are you sure you want to permanently delete this inventory count?</p>
              <p className="font-medium text-foreground">{countPeriod}</p>
              <p className="text-destructive">
                This action cannot be undone. All count data and edit history will be lost.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 pt-1">
          <Label htmlFor="confirm-name" className="text-xs text-muted-foreground">
            Type your name <span className="font-semibold text-foreground">{expectedName}</span> to confirm
          </Label>
          <Input
            id="confirm-name"
            autoComplete="off"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expectedName}
            disabled={isDeleting}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (canDelete) onConfirm();
            }}
            disabled={!canDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : "Delete Count"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteCountDialog;
