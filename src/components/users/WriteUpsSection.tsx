import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface WriteUpsSectionProps {
  userId: string;
  employeeName?: string;
}

interface WriteUp {
  id: string;
  reason: string;
  issue_description: string;
  next_steps: string;
  photo_url: string | null;
  is_final_warning: boolean;
  signature_url: string | null;
  signed_at: string | null;
  created_at: string;
  created_by_profile?: { full_name: string } | null;
  location?: { name: string } | null;
}

export function WriteUpsSection({ userId, employeeName }: WriteUpsSectionProps) {
  const [selectedWriteUp, setSelectedWriteUp] = useState<WriteUp | null>(null);

  const { data: writeUps = [] } = useQuery({
    queryKey: ["employee-writeups", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_writeups")
        .select(`
          id,
          reason,
          issue_description,
          next_steps,
          photo_url,
          is_final_warning,
          signature_url,
          signed_at,
          created_at,
          created_by_profile:profiles!employee_writeups_created_by_fkey(full_name),
          location:locations!employee_writeups_location_id_fkey(name)
        `)
        .eq("employee_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as WriteUp[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  if (writeUps.length === 0) return null;

  return (
    <>
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium text-foreground">Corrective Actions</span>
          <Badge variant="destructive" className="text-xs">
            {writeUps.length}
          </Badge>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {writeUps.map((wu) => (
            <button
              key={wu.id}
              onClick={() => setSelectedWriteUp(wu)}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors text-center"
            >
              <div className="relative">
                <div className="w-12 h-14 bg-background rounded border border-border flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                </div>
                <div className={`absolute -bottom-1 -right-1 rounded-full p-0.5 ${wu.signed_at ? 'bg-green-500' : 'bg-amber-500'}`}>
                  {wu.signed_at ? (
                    <CheckCircle2 className="h-3 w-3 text-white" />
                  ) : (
                    <Clock className="h-3 w-3 text-white" />
                  )}
                </div>
              </div>
              <div className="w-full">
                <p className="text-xs font-medium truncate">{wu.reason}</p>
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(wu.created_at), "MMM d, yyyy")}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Corrective Action Detail Dialog */}
      <Dialog open={!!selectedWriteUp} onOpenChange={(open) => !open && setSelectedWriteUp(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Corrective Action Details
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            {selectedWriteUp && (
              <div className="space-y-4 pb-4">
                {/* Meta */}
                <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
                  <span>{format(new Date(selectedWriteUp.created_at), "MMMM d, yyyy")}</span>
                  <span>by {selectedWriteUp.created_by_profile?.full_name || "Manager"}</span>
                </div>

                {/* Reason */}
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{selectedWriteUp.reason}</Badge>
                  {selectedWriteUp.is_final_warning && (
                    <Badge variant="destructive" className="bg-red-700">Final Warning</Badge>
                  )}
                  {selectedWriteUp.location?.name && (
                    <Badge variant="outline" className="text-xs">{selectedWriteUp.location.name}</Badge>
                  )}
                </div>

                {/* Issue Description */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Issue</span>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg border border-border">
                    {selectedWriteUp.issue_description}
                  </p>
                </div>

                {/* Next Steps */}
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next Steps</span>
                  <p className="text-sm whitespace-pre-wrap bg-primary/5 p-3 rounded-lg border border-primary/20">
                    {selectedWriteUp.next_steps}
                  </p>
                </div>

                {/* Photo */}
                {selectedWriteUp.photo_url && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Photo</span>
                    <img
                      src={selectedWriteUp.photo_url}
                      alt="Evidence"
                      className="w-full h-48 object-cover rounded-lg border border-border"
                    />
                  </div>
                )}

                {/* Signature */}
                <div className="space-y-2">
                  {selectedWriteUp.signed_at ? (
                    <>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium">
                          Acknowledged on {format(new Date(selectedWriteUp.signed_at), "MMMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                      {selectedWriteUp.signature_url && (
                        <div className="border rounded-lg p-4 bg-white">
                          <img
                            src={selectedWriteUp.signature_url}
                            alt="Signature"
                            className="max-h-24 mx-auto"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-amber-500">
                      <Clock className="h-4 w-4" />
                      <span className="text-sm font-medium">Pending acknowledgment</span>
                    </div>
                  )}
                </div>
                <DeleteCorrectiveActionButton
                  writeUp={selectedWriteUp}
                  employeeName={employeeName || "this employee"}
                  onDeleted={() => setSelectedWriteUp(null)}
                />
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeleteCorrectiveActionButton({
  writeUp,
  employeeName,
  onDeleted,
}: {
  writeUp: { id: string; reason: string; created_at: string; signed_at: string | null };
  employeeName: string;
  onDeleted: () => void;
}) {
  const { isOrgAdmin, role, loading } = useUserRole();
  const canDeleteCA = isOrgAdmin || (role as string) === "fbc";
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);

  if (loading || !canDeleteCA) return null;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      const { data, error } = await supabase
        .from("employee_writeups")
        .delete()
        .eq("id", writeUp.id)
        .select("id");
      if (error || !data || data.length === 0) {
        toast.error(
          "Couldn't delete this Corrective Action. You may not have permission, or it was already removed." +
            (error?.message ? ` (${error.message})` : "")
        );
        return;
      }
      toast.success("Corrective Action deleted");
      setConfirmOpen(false);
      onDeleted();
      queryClient.invalidateQueries({ queryKey: ["employee-writeups"] });
      queryClient.invalidateQueries({ queryKey: ["write-up-for-task"] });
      queryClient.invalidateQueries({ queryKey: ["temporary-tasks"] });
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  };

  return (
    <div className="pt-2 border-t border-border">
      <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
        <Trash2 className="h-4 w-4 mr-1.5" />
        Delete
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!deleting) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Corrective Action?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="space-y-0.5 text-foreground">
                  <div><span className="text-muted-foreground">Employee:</span> {employeeName}</div>
                  <div><span className="text-muted-foreground">Reason:</span> {writeUp.reason}</div>
                  <div><span className="text-muted-foreground">Date:</span> {format(new Date(writeUp.created_at), "MMMM d, yyyy")}</div>
                  <div><span className="text-muted-foreground">Status:</span> {writeUp.signed_at ? "Signed" : "Pending acknowledgment"}</div>
                </div>
                <p>This permanently deletes this Corrective Action and cannot be undone.</p>
                {writeUp.signed_at && (
                  <p className="font-semibold text-destructive">
                    This Corrective Action was signed by the employee. Deleting removes the signed record.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
