import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Download, Clock, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
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

const DOC_TYPE_LABELS: Record<string, string> = {
  photo_id: "Photo ID",
  ssn_card: "SSN Card",
  work_authorization: "Work Auth",
  passport: "Passport",
};

interface I9DocumentsSectionProps {
  userId: string;
  employeeName?: string;
}

export function I9DocumentsSection({ userId, employeeName = "Employee" }: I9DocumentsSectionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [retrieving, setRetrieving] = useState<string | null>(null);
  const [confirmRetrieve, setConfirmRetrieve] = useState<{ docId: string; storagePath: string; fileName: string; requestId: string; docType: string } | null>(null);

  const { data: requests = [] } = useQuery({
    queryKey: ["i9-requests", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("i9_document_requests")
        .select(`
          id, document_types, status, notes, created_at, expires_at,
          requested_by_profile:profiles!i9_document_requests_requested_by_fkey(full_name)
        `)
        .eq("employee_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["i9-documents", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("i9_documents")
        .select("*")
        .eq("employee_id", userId)
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  });

  const handleRetrieve = async () => {
    if (!confirmRetrieve || !user?.id) return;
    const { docId, storagePath, fileName, requestId, docType } = confirmRetrieve;
    setRetrieving(docId);
    setConfirmRetrieve(null);

    try {
      // 1. Get signed URL for download
      const { data: urlData, error: urlError } = await supabase.storage
        .from("i9-documents")
        .createSignedUrl(storagePath, 60); // 60-second expiry

      if (urlError || !urlData?.signedUrl) throw urlError || new Error("No URL");

      // 2. Trigger browser download
      const a = document.createElement("a");
      a.href = urlData.signedUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // 3. Mark as retrieved in DB
      await supabase
        .from("i9_documents")
        .update({ retrieved_at: new Date().toISOString(), retrieved_by: user.id })
        .eq("id", docId);

      // 4. Log audit
      const { data: reqData } = await supabase
        .from("i9_document_requests")
        .select("location_id")
        .eq("id", requestId)
        .single();

      if (reqData) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();

        await supabase.from("i9_audit_log").insert({
          request_id: requestId,
          employee_id: userId,
          location_id: reqData.location_id,
          action: "retrieved",
          document_type: docType as any,
          performed_by: user.id,
          performed_by_name: profile?.full_name || "Admin",
          employee_name: employeeName,
        });
      }

      // 5. Delete from storage after brief delay
      setTimeout(async () => {
        await supabase.storage.from("i9-documents").remove([storagePath]);
        await supabase
          .from("i9_documents")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", docId);

        // Check if all docs in request are retrieved
        const { data: remaining } = await supabase
          .from("i9_documents")
          .select("id")
          .eq("request_id", requestId)
          .is("retrieved_at", null);

        if (!remaining?.length) {
          await supabase
            .from("i9_document_requests")
            .update({ status: "retrieved" as any })
            .eq("id", requestId);
        }

        queryClient.invalidateQueries({ queryKey: ["i9-documents", userId] });
        queryClient.invalidateQueries({ queryKey: ["i9-requests", userId] });
      }, 5000); // 5-second grace window

      toast.success("Document downloaded — it will be auto-deleted from server");
      queryClient.invalidateQueries({ queryKey: ["i9-documents", userId] });
    } catch (err) {
      console.error("Error retrieving I-9 doc:", err);
      toast.error("Failed to download document");
    } finally {
      setRetrieving(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <>
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">I-9 Documents</span>
          <Badge variant="secondary" className="text-xs">{requests.length}</Badge>
        </div>

        <div className="space-y-3">
          {requests.map((req: any) => {
            const docTypes = (req.document_types || []) as string[];
            const isRetrieved = req.status === "retrieved";
            const isUploaded = req.status === "uploaded";
            const isPending = req.status === "pending";
            const uploadedDocs = documents.filter((d: any) => d.request_id === req.id);

            return (
              <div
                key={req.id}
                className={`rounded-lg border p-3 space-y-2 ${
                  isRetrieved
                    ? "border-green-500/30 bg-green-500/5"
                    : isUploaded
                    ? "border-primary/30 bg-primary/5"
                    : "border-amber-500/30 bg-amber-500/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isRetrieved ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : isUploaded ? (
                      <Download className="h-4 w-4 text-primary" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber-500" />
                    )}
                    <span className="text-xs font-medium">
                      {isRetrieved ? "Retrieved" : isUploaded ? "Ready for Review" : "Awaiting Upload"}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(req.created_at), "MMM d, yyyy")}
                  </span>
                </div>

                {/* Requested doc types */}
                <div className="flex flex-wrap gap-1">
                  {docTypes.map((type) => (
                    <Badge key={type} variant="outline" className="text-[10px]">
                      {DOC_TYPE_LABELS[type] || type}
                    </Badge>
                  ))}
                </div>

                {/* Uploaded docs — download buttons */}
                {uploadedDocs.length > 0 && !isRetrieved && (
                  <div className="space-y-1.5 pt-1">
                    {uploadedDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between gap-2 p-2 rounded bg-background border border-border">
                        <div className="flex items-center gap-2 min-w-0">
                          <Shield className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{DOC_TYPE_LABELS[doc.document_type] || doc.document_type}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{doc.file_name}</p>
                          </div>
                        </div>
                        {doc.retrieved_at ? (
                          <Badge variant="secondary" className="text-[10px] flex-shrink-0">Retrieved</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs flex-shrink-0"
                            disabled={retrieving === doc.id}
                            onClick={() =>
                              setConfirmRetrieve({
                                docId: doc.id,
                                storagePath: doc.storage_path,
                                fileName: doc.file_name,
                                requestId: doc.request_id,
                                docType: doc.document_type,
                              })
                            }
                          >
                            {retrieving === doc.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Download className="h-3 w-3 mr-1" />
                                Retrieve
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isRetrieved && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Files auto-deleted from server after retrieval
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirm retrieval dialog */}
      <AlertDialog open={!!confirmRetrieve} onOpenChange={(open) => !open && setConfirmRetrieve(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Retrieve Document
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will download the document to your device and <strong>permanently delete it from the server</strong>.</p>
              <p className="text-destructive font-medium">This action cannot be undone. The employee will need to re-upload if you lose the file.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRetrieve}>
              <Download className="h-4 w-4 mr-2" />
              Download & Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
