import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ChevronRight, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { I9SecureUploadDialog } from "./I9SecureUploadDialog";

export function I9UploadCard() {
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

  if (pendingRequests.length === 0) return null;

  return (
    <>
      <Card className="border-primary/50 bg-primary/5 relative overflow-hidden">
        {/* Security accent strip */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-primary/80 to-primary" />
        
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="relative">
                <Shield className="h-5 w-5 text-primary" />
                <Lock className="h-2.5 w-2.5 text-primary absolute -bottom-0.5 -right-0.5" />
              </div>
              Secure Document Request
            </CardTitle>
            <Badge variant="outline" className="text-primary border-primary/50 text-[10px]">
              <Lock className="h-2.5 w-2.5 mr-1" />
              Encrypted
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendingRequests.map((req: any) => {
            const docTypes = (req.document_types || []) as string[];
            const DOC_LABELS: Record<string, string> = {
              photo_id: "Photo ID",
              ssn_card: "SSN Card",
              work_authorization: "Work Auth",
              passport: "Passport",
            };
            return (
              <Button
                key={req.id}
                variant="outline"
                className="w-full justify-between h-auto py-3 px-4 border-primary/20 hover:bg-primary/5"
                onClick={() => setActiveRequest(req)}
              >
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <p className="font-medium text-sm">
                      {docTypes.map((t) => DOC_LABELS[t] || t).join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {req.requested_by_profile?.full_name || "Manager"}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4" />
              </Button>
            );
          })}

          <p className="text-[10px] text-muted-foreground flex items-center gap-1 pt-1">
            <Lock className="h-3 w-3" />
            Documents are encrypted and auto-deleted after admin review
          </p>
        </CardContent>
      </Card>

      {activeRequest && (
        <I9SecureUploadDialog
          open={!!activeRequest}
          onOpenChange={(open) => !open && setActiveRequest(null)}
          request={activeRequest}
        />
      )}
    </>
  );
}
