import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";

interface SignedDocumentsSectionProps {
  userId: string;
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

export function SignedDocumentsSection({ userId }: SignedDocumentsSectionProps) {
  const [selectedDoc, setSelectedDoc] = useState<SignedDocument | null>(null);

  // Fetch signed documents for this user
  const { data: signedDocuments = [] } = useQuery({
    queryKey: ["signed-documents", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("read_and_sign_assignments")
        .select(`
          id,
          document_id,
          signed_at,
          signature_url,
          document:read_and_sign_documents(
            id,
            title,
            list_style,
            created_at,
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

  // Fetch document items when viewing details
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

      // Organize into hierarchy
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

  if (signedDocuments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Signed Documents</span>
          <Badge variant="secondary" className="text-xs">
            {signedDocuments.length}
          </Badge>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {signedDocuments.map((doc) => (
            <button
              key={doc.id}
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
                <p className="text-xs font-medium truncate">
                  {doc.document?.title || "Document"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {doc.signed_at ? format(new Date(doc.signed_at), "MMM d, yyyy") : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Document Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {selectedDoc?.document?.title || "Document"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
            <div className="space-y-4 pb-4">
              {/* Document Info */}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Created{" "}
                  {selectedDoc?.document?.created_at
                    ? format(new Date(selectedDoc.document.created_at), "MMM d, yyyy")
                    : ""}
                </span>
                {selectedDoc?.document?.created_by_profile?.full_name && (
                  <span>by {selectedDoc.document.created_by_profile.full_name}</span>
                )}
              </div>

              {/* Document Content */}
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

              {/* Signature */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">
                    Signed on{" "}
                    {selectedDoc?.signed_at
                      ? format(new Date(selectedDoc.signed_at), "MMMM d, yyyy 'at' h:mm a")
                      : ""}
                  </span>
                </div>
                {selectedDoc?.signature_url && (
                  <div className="border rounded-lg p-4 bg-white">
                    <img
                      src={selectedDoc.signature_url}
                      alt="Signature"
                      className="max-h-24 mx-auto"
                    />
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
