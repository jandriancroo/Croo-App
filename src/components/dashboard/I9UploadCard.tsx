import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ChevronRight, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { I9SecureUploadDialog } from "./I9SecureUploadDialog";
import type { QuickExtraRow } from "@/lib/quickTasks/extraRows";

const I9_DOC_LABELS: Record<string, string> = { photo_id: "Photo ID", ssn_card: "SSN Card", work_authorization: "Work Auth", passport: "Passport" };

export function useI9UploadRows(): { rows: QuickExtraRow[]; overlay: React.ReactNode } {
  const { user } = useAuth();
  const [activeRequest, setActiveRequest] = useState<any>(null);

  const { data: pendingRequests = [] } = useQuery({
    queryKey: ["i9-pending-upload", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("i9_document_requests")
        .select(`
          id, document_types, notes, created_at, expires_at,
          requested_by_profile:profiles!i9_document_requests_requested_by_fkey(full_name),
          location:locations!i9_document_requests_location_id_fkey(name)
        `)
        .eq("employee_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  const rows: QuickExtraRow[] = pendingRequests.map((req: any) => ({
    key: `i9-${req.id}`,
    title: `Upload ${((req.document_types || []) as string[]).map((t) => I9_DOC_LABELS[t] || t).join(", ") || "documents"}`,
    icon: Shield, wash: "red", overdue: false, dueLabel: "Secure upload", onSelect: () => setActiveRequest(req),
  }));
  const overlay = (
    <>
      {activeRequest && (
        <I9SecureUploadDialog
          open={!!activeRequest}
          onOpenChange={(open) => !open && setActiveRequest(null)}
          request={activeRequest}
        />
      )}
    </>
  );
  return { rows, overlay };
}

/** Legacy card (no longer mounted on the Dash). */
export function I9UploadCard() {
  const { rows, overlay } = useI9UploadRows();
  return (
    <>
      {rows.length > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Lock className="h-4 w-4 text-primary" />Secure Document Request</CardTitle></CardHeader>
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
