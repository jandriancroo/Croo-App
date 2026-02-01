import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, FileText, CheckCircle2, Clock, Users } from "lucide-react";
import { format } from "date-fns";

interface ReadAndSignEntryProps {
  documentId: string;
  title: string;
  createdAt: string;
  createdByName?: string;
  createdByPhoto?: string;
}

export function ReadAndSignEntry({
  documentId,
  title,
  createdAt,
  createdByName,
  createdByPhoto,
}: ReadAndSignEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch assignment counts immediately for the badge
  const { data: assignmentCounts } = useQuery({
    queryKey: ["read-and-sign-counts", documentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("read_and_sign_assignments")
        .select("id, signed_at")
        .eq("document_id", documentId);

      if (error) throw error;
      
      const assignments = data || [];
      return {
        signed: assignments.filter((a) => a.signed_at).length,
        total: assignments.length,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch document details, items, and assignments (only when expanded)
  const { data } = useQuery({
    queryKey: ["read-and-sign-details", documentId],
    queryFn: async () => {
      const [itemsResult, assignmentsResult] = await Promise.all([
        supabase
          .from("read_and_sign_items")
          .select("*")
          .eq("document_id", documentId)
          .order("order_index"),
        supabase
          .from("read_and_sign_assignments")
          .select(`
            *,
            employee:profiles!read_and_sign_assignments_employee_id_fkey(full_name, profile_photo_url)
          `)
          .eq("document_id", documentId),
      ]);

      if (itemsResult.error) throw itemsResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;

      // Organize items into hierarchy
      const items = itemsResult.data || [];
      const parentItems = items.filter((i) => !i.parent_id);
      const childrenMap = items.reduce((acc, item) => {
        if (item.parent_id) {
          if (!acc[item.parent_id]) acc[item.parent_id] = [];
          acc[item.parent_id].push(item);
        }
        return acc;
      }, {} as Record<string, typeof items>);

      return {
        items: parentItems.map((parent) => ({
          ...parent,
          children: childrenMap[parent.id] || [],
        })),
        assignments: assignmentsResult.data || [],
      };
    },
    enabled: isExpanded,
    staleTime: 5 * 60 * 1000,
  });

  const signedCount = assignmentCounts?.signed || 0;
  const totalCount = assignmentCounts?.total || 0;
  const allSigned = totalCount > 0 && signedCount === totalCount;

  return (
    <Card className="overflow-hidden">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-base truncate">{title}</CardTitle>
                  <Badge variant={allSigned ? "default" : "secondary"} className="text-xs">
                    {allSigned ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Complete
                      </>
                    ) : (
                      <>
                        <Clock className="h-3 w-3 mr-1" />
                        {signedCount}/{totalCount || "?"} Signed
                      </>
                    )}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{format(new Date(createdAt), "MMM d, yyyy")}</span>
                  {createdByName && (
                    <>
                      <span>•</span>
                      <span>by {createdByName}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center">
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Document Items */}
            {data?.items && data.items.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Document Content</h4>
                <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                  {data.items.map((item, idx) => (
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
                </div>
              </div>
            )}

            {/* Signatures */}
            {data?.assignments && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h4 className="text-sm font-medium text-muted-foreground">
                    Signatures ({signedCount}/{totalCount})
                  </h4>
                </div>

                {/* Signed */}
                {data.assignments.filter((a) => a.signed_at).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-green-600 font-medium">Signed</p>
                    <div className="flex flex-wrap gap-2">
                      {data.assignments
                        .filter((a) => a.signed_at)
                        .map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 rounded-full px-3 py-1"
                          >
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={a.employee?.profile_photo_url} />
                              <AvatarFallback className="text-[10px]">
                                {a.employee?.full_name?.charAt(0) || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium">{a.employee?.full_name}</span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(a.signed_at), "MMM d")}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Pending */}
                {data.assignments.filter((a) => !a.signed_at).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-amber-600 font-medium">Pending</p>
                    <div className="flex flex-wrap gap-2">
                      {data.assignments
                        .filter((a) => !a.signed_at)
                        .map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-full px-3 py-1"
                          >
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={a.employee?.profile_photo_url} />
                              <AvatarFallback className="text-[10px]">
                                {a.employee?.full_name?.charAt(0) || "?"}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs">{a.employee?.full_name}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
