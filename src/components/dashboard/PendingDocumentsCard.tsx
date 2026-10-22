import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import React, { useState } from "react";
import { ReadAndSignView } from "@/components/logbook/ReadAndSignView";
import type { QuickExtraRow } from "@/lib/quickTasks/extraRows";

export function useReadAndSignRows(): { rows: QuickExtraRow[]; overlay: React.ReactNode } {
  const { user } = useAuth();
  const [activeAssignment, setActiveAssignment] = useState<any>(null);

  // Fetch pending Read & Sign documents for current user
  const { data: pendingDocs = [], refetch } = useQuery({
    queryKey: ["pending-read-and-sign", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const now = new Date().toISOString();
      
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
            scheduled_at,
            created_by_profile:profiles!read_and_sign_documents_created_by_fkey(full_name)
          )
        `)
        .eq("employee_id", user.id)
        .is("signed_at", null)
        .order("assigned_at", { ascending: false });

      if (error) throw error;
      
      // Filter out documents that are scheduled for the future
      return (data || []).filter(doc => {
        const scheduledAt = doc.document?.scheduled_at;
        if (!scheduledAt) return true; // No schedule = show immediately
        return new Date(scheduledAt) <= new Date(now);
      });
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

  const rows: QuickExtraRow[] = pendingDocs.map((doc: any) => ({
    key: `read-sign-${doc.id}`, title: doc.document?.title || "Document", icon: FileText, wash: "amber", overdue: false,
    dueLabel: "Read & Sign", onSelect: () => setActiveAssignment(doc),
  }));
  const overlay = (
    <>
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
  return { rows, overlay };
}

/** Legacy card (no longer mounted on the Dash). */
export function PendingDocumentsCard() {
  const { rows, overlay } = useReadAndSignRows();
  return (
    <>
      {rows.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-amber-500" />Documents to Read & Sign</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {rows.map(r => (
              <Button key={r.key} variant="outline" className="w-full justify-between h-auto py-3 px-4" onClick={r.onSelect}>
                <span className="font-medium text-sm">{r.title}</span><ChevronRight className="h-4 w-4" />
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      {overlay}
    </>
  );
}
