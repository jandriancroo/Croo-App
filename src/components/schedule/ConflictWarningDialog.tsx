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
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface ConflictWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  conflicts: Array<{
    employeeName: string;
    date: string;
    requestType: string;
    timeScope: string;
    status: string;
    startTime?: string | null;
    endTime?: string | null;
  }>;
}

export function ConflictWarningDialog({
  open,
  onOpenChange,
  onConfirm,
  conflicts,
}: ConflictWarningDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <AlertDialogTitle>Scheduling Conflict Detected</AlertDialogTitle>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                The following employee(s) have time off requests for this time period:
              </p>
              <div className="space-y-3">
                {conflicts.map((conflict, index) => (
                  <div
                    key={index}
                    className="p-3 bg-muted rounded-lg border border-destructive/20"
                  >
                    <div className="font-semibold">{conflict.employeeName}</div>
                    <div className="text-sm space-y-1 mt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Date:</span>
                        <span>{format(new Date(conflict.date), "MMM d, yyyy")}</span>
                      </div>
                      {conflict.timeScope === "partial_day" && conflict.startTime && conflict.endTime && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Time:</span>
                          <span>
                            {conflict.startTime} - {conflict.endTime}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={conflict.requestType === "paid" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {conflict.requestType === "paid" ? "Paid" : "Unpaid"}
                        </Badge>
                        <Badge
                          variant={conflict.status === "approved" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {conflict.status === "pending" ? "Pending" : "Approved"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm font-medium">
                Are you sure you want to schedule this shift anyway?
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-destructive/90">
            Schedule Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
