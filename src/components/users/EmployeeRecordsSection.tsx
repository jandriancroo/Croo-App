import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { AlertTriangle, CheckCircle2, Clock, Download, FileText, FolderOpen } from "lucide-react";
import { format } from "date-fns";
import { exportRecordToPdf } from "@/utils/exportRecordPdf";
import { CorrectiveActionNotesPanel } from "@/components/logbook/CorrectiveActionNotesPanel";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/lib/auth";
import type { NoteBullet } from "@/hooks/useConversationRecorder";

interface EmployeeRecordsSectionProps {
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
  notes_bullets: NoteBullet[] | null;
  recording_duration_seconds: number | null;
  created_by_profile?: { full_name: string } | null;
  location?: { name: string } | null;
}

interface SignedDocument {
  id: string;
  document_id: string;
  signed_at: string;
  signature_url: string;
  document?: {
    id: string;
    title: string;
    list_style: string;
    created_at: string;
    created_by_profile?: { full_name: string };
  };
}

export function EmployeeRecordsSection({ userId, employeeName = "Employee" }: EmployeeRecordsSectionProps) {
  const [selectedWriteUp, setSelectedWriteUp] = useState<WriteUp | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<SignedDocument | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const { isAdmin } = useUserRole();
  const { user } = useAuth();
  const isSelfView = user?.id === userId;
  // Employee file transcript is admin+ only, and never on your own record.
  const canViewTranscript = isAdmin && !isSelfView;

  const { data: writeUps = [] } = useQuery({
    queryKey: ["employee-writeups", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_writeups")
        .select(`
          id, reason, issue_description, next_steps, photo_url,
          is_final_warning, signature_url, signed_at, created_at,
          notes_bullets, recording_duration_seconds,
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

  const { data: signedDocuments = [] } = useQuery({
    queryKey: ["signed-documents", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("read_and_sign_assignments")
        .select(`
          id, document_id, signed_at, signature_url,
          document:read_and_sign_documents(
            id, title, list_style, created_at,
            created_by_profile:profiles!read_and_sign_documents_created_by_fkey(full_name)
          )
        `)
        .eq("employee_id", userId)
        .not("signed_at", "is", null)
        .order("signed_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SignedDocument[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: documentItems = [] } = useQuery({
    queryKey: ["document-items", selectedDoc?.document_id],
    queryFn: async () => {
      if (!selectedDoc?.document_id) return [];
      const { data, error } = await supabase
        .from("read_and_sign_items")
        .select("*")
        .eq("document_id", selectedDoc.document_id)
        .order("order_index");
      if (error) throw error;
      const items = data || [];
      const parentItems = items.filter((i) => !i.parent_id);
      const childrenMap = items.reduce((acc, item) => {
        if (item.parent_id) {
          if (!acc[item.parent_id]) acc[item.parent_id] = [];
          acc[item.parent_id].push(item);
        }
        return acc;
      }, {} as Record<string, typeof items>);
      return parentItems.map((parent) => ({
        ...parent,
        children: childrenMap[parent.id] || [],
      }));
    },
    enabled: !!selectedDoc?.document_id,
    staleTime: 5 * 60 * 1000,
  });

  const totalCount = writeUps.length + signedDocuments.length;
  if (totalCount === 0) return null;

  return (
    <>
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Employee Records</span>
          <Badge variant="secondary" className="text-xs">{totalCount}</Badge>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {/* Corrective Actions */}
          {writeUps.map((wu) => (
            <button
              key={`wu-${wu.id}`}
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

          {/* Signed Documents */}
          {signedDocuments.map((doc) => (
            <button
              key={`doc-${doc.id}`}
              onClick={() => setSelectedDoc(doc)}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors text-center"
            >
              <div className="relative">
                <div className="w-12 h-14 bg-background rounded border border-border flex items-center justify-center">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-0.5">
                  <CheckCircle2 className="h-3 w-3 text-white" />
                </div>
              </div>
              <div className="w-full">
                <p className="text-xs font-medium truncate">{doc.document?.title || "Document"}</p>
                <p className="text-[10px] text-muted-foreground">
                  {doc.signed_at ? format(new Date(doc.signed_at), "MMM d, yyyy") : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Corrective Action Detail Dialog */}
      <Dialog open={!!selectedWriteUp} onOpenChange={(open) => { if (!open) { setSelectedWriteUp(null); setTranscriptText(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          {selectedWriteUp && (
            <Button
              variant="destructive"
              size="sm"
              className="absolute right-10 top-4 h-7 px-2.5 text-xs font-semibold gap-1"
              onClick={() =>
                exportRecordToPdf({
                  type: "writeup",
                  employeeName,
                  reason: selectedWriteUp.reason,
                  isFinalWarning: selectedWriteUp.is_final_warning,
                  issueDescription: selectedWriteUp.issue_description,
                  nextSteps: selectedWriteUp.next_steps,
                  photoUrl: selectedWriteUp.photo_url,
                  signatureUrl: selectedWriteUp.signature_url,
                  signedAt: selectedWriteUp.signed_at,
                  createdAt: selectedWriteUp.created_at,
                  createdByName: selectedWriteUp.created_by_profile?.full_name,
                  locationName: selectedWriteUp.location?.name,
                  notesBullets: selectedWriteUp.notes_bullets,
                  transcriptText: canViewTranscript ? transcriptText : null,
                })
              }
            >
              <Download className="h-3 w-3" />
              PDF
            </Button>
          )}
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Corrective Action Details
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
            {selectedWriteUp && (
              <div className="space-y-4 pb-4">
                <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
                  <span>{format(new Date(selectedWriteUp.created_at), "MMMM d, yyyy")}</span>
                  <span>by {selectedWriteUp.created_by_profile?.full_name || "Manager"}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="destructive">{selectedWriteUp.reason}</Badge>
                  {selectedWriteUp.is_final_warning && (
                    <Badge variant="destructive" className="bg-red-700">Final Warning</Badge>
                  )}
                  {selectedWriteUp.location?.name && (
                    <Badge variant="outline" className="text-xs">{selectedWriteUp.location.name}</Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Issue</span>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded-lg border border-border">
                    {selectedWriteUp.issue_description}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next Steps</span>
                  <p className="text-sm whitespace-pre-wrap bg-primary/5 p-3 rounded-lg border border-primary/20">
                    {selectedWriteUp.next_steps}
                  </p>
                </div>
                <CorrectiveActionNotesPanel
                  writeUpId={selectedWriteUp.id}
                  notesBullets={selectedWriteUp.notes_bullets}
                  signedAt={selectedWriteUp.signed_at}
                  recordingDurationSeconds={selectedWriteUp.recording_duration_seconds}
                  transcriptAccess={canViewTranscript ? "admin" : "none"}
                  readOnly
                  onTranscriptLoaded={setTranscriptText}
                />
                {selectedWriteUp.photo_url && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Photo</span>
                    <img src={selectedWriteUp.photo_url} alt="Evidence" className="w-full h-48 object-cover rounded-lg border border-border" />
                  </div>
                )}
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
                          <img src={selectedWriteUp.signature_url} alt="Signature" className="max-h-24 mx-auto" />
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
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Document Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <Button
            variant="destructive"
            size="sm"
            className="absolute right-10 top-4 h-7 px-2.5 text-xs font-semibold gap-1"
            onClick={() => {
              if (!selectedDoc) return;
              exportRecordToPdf({
                type: "document",
                employeeName,
                title: selectedDoc.document?.title || "Document",
                items: documentItems.map((item) => ({
                  content: item.content,
                  children: item.children?.map((c: any) => ({ content: c.content })),
                })),
                signatureUrl: selectedDoc.signature_url,
                signedAt: selectedDoc.signed_at,
                createdAt: selectedDoc.document?.created_at || "",
                createdByName: selectedDoc.document?.created_by_profile?.full_name,
              });
            }}
          >
            <Download className="h-3 w-3" />
            PDF
          </Button>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {selectedDoc?.document?.title || "Document"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
            <div className="space-y-4 pb-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Created {selectedDoc?.document?.created_at ? format(new Date(selectedDoc.document.created_at), "MMM d, yyyy") : ""}
                </span>
                {selectedDoc?.document?.created_by_profile?.full_name && (
                  <span>by {selectedDoc.document.created_by_profile.full_name}</span>
                )}
              </div>
              <Card>
                <CardContent className="p-4 space-y-2">
                  {documentItems.map((item, idx) => (
                    <div key={item.id}>
                      <div className="flex gap-2">
                        <span className="text-sm font-medium min-w-[20px]">{idx + 1}.</span>
                        <p className="text-sm">{item.content}</p>
                      </div>
                      {item.children && item.children.length > 0 && (
                        <div className="ml-6 mt-1 space-y-1 border-l-2 border-muted pl-3">
                          {item.children.map((child: any, childIdx: number) => (
                            <div key={child.id} className="flex gap-2">
                              <span className="text-xs text-muted-foreground min-w-[16px]">
                                {String.fromCharCode(97 + childIdx)}.
                              </span>
                              <p className="text-sm text-muted-foreground">{child.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">
                    Signed on {selectedDoc?.signed_at ? format(new Date(selectedDoc.signed_at), "MMMM d, yyyy 'at' h:mm a") : ""}
                  </span>
                </div>
                {selectedDoc?.signature_url && (
                  <div className="border rounded-lg p-4 bg-white">
                    <img src={selectedDoc.signature_url} alt="Signature" className="max-h-24 mx-auto" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
