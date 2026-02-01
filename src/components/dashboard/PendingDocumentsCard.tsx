import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useState } from "react";
import { ReadAndSignView } from "@/components/logbook/ReadAndSignView";

export function PendingDocumentsCard() {
  const { user } = useAuth();
  const [activeAssignment, setActiveAssignment] = useState<any>(null);

  // Fetch pending Read & Sign documents for current user
  const { data: pendingDocs = [], refetch } = useQuery({
    queryKey: ["pending-read-and-sign", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("read_and_sign_assignments")
        .select(`
          id,
          document_id,
          assigned_at,
          document:read_and_sign_documents(
            id,
            title,
            list_style,
            created_at,
            created_by_profile:profiles!read_and_sign_documents_created_by_fkey(full_name)
          )
        `)
        .eq("employee_id", user.id)
        .is("signed_at", null)
        .order("assigned_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  // Fetch items for active document
  const { data: documentItems = [] } = useQuery({
    queryKey: ["read-and-sign-items", activeAssignment?.document_id],
    queryFn: async () => {
      if (!activeAssignment?.document_id) return [];

      const { data, error } = await supabase
        .from("read_and_sign_items")
        .select("*")
        .eq("document_id", activeAssignment.document_id)
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
    enabled: !!activeAssignment?.document_id,
  });

  const handleComplete = () => {
    setActiveAssignment(null);
    refetch();
  };

  if (pendingDocs.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-amber-500/50 bg-amber-500/5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-500" />
              Documents to Read & Sign
            </CardTitle>
            <Badge variant="outline" className="text-amber-600 border-amber-500/50">
              {pendingDocs.length} pending
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendingDocs.map((doc) => (
            <Button
              key={doc.id}
              variant="outline"
              className="w-full justify-between h-auto py-3 px-4"
              onClick={() => setActiveAssignment(doc)}
            >
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <p className="font-medium text-sm">{doc.document?.title || "Document"}</p>
                  <p className="text-xs text-muted-foreground">
                    From {doc.document?.created_by_profile?.full_name || "Manager"}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4" />
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Full-screen Read & Sign View */}
      {activeAssignment && documentItems.length > 0 && (
        <ReadAndSignView
          assignment={{
            id: activeAssignment.id,
            document_id: activeAssignment.document_id,
          }}
          document={{
            id: activeAssignment.document?.id,
            title: activeAssignment.document?.title || "Document",
            list_style: activeAssignment.document?.list_style || "numbered",
            created_at: activeAssignment.document?.created_at,
            created_by_profile: activeAssignment.document?.created_by_profile,
          }}
          items={documentItems}
          onComplete={handleComplete}
        />
      )}
    </>
  );
}
