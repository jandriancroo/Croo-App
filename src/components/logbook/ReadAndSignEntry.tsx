import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, PenLine, CheckCircle2, Clock, Users, MoreVertical, Trash2, RotateCcw, Pencil } from "lucide-react";
import { format } from "date-fns";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { getDisplayName } from "@/utils/displayName";
import { EditReadAndSignDialog } from "./EditReadAndSignDialog";

interface ReadAndSignEntryProps {
  documentId: string;
  title: string;
  createdAt: string;
  createdByName?: string;
  createdByPhoto?: string;
  revisionNumber?: number;
  revisedAt?: string | null;
  onDeleted?: () => void;
}

export function ReadAndSignEntry({
  documentId,
  title,
  createdAt,
  createdByName,
  revisionNumber = 0,
  revisedAt,
  onDeleted,
}: ReadAndSignEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { isAdmin, isManager } = useUserRole();
  const queryClient = useQueryClient();
  const canManage = isAdmin || isManager;

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
            employee:profiles!read_and_sign_assignments_employee_id_fkey(full_name, nickname, profile_photo_url)
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

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Delete in order: item_checks -> assignments -> items -> document
      // The cascade should handle most of this, but let's be explicit
      const { error } = await supabase
        .from("read_and_sign_documents")
        .delete()
        .eq("id", documentId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Read & Sign document deleted");
      queryClient.invalidateQueries({ queryKey: ["read-and-sign"] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
      onDeleted?.();
    },
    onError: (error) => {
      console.error("Delete error:", error);
      toast.error("Failed to delete document");
    },
  });

  const signedCount = assignmentCounts?.signed || 0;
  const totalCount = assignmentCounts?.total || 0;
  const allSigned = totalCount > 0 && signedCount === totalCount;
  const isRevised = revisionNumber > 0;

  const handleDelete = () => {
    setShowDeleteConfirm(false);
    deleteMutation.mutate();
  };

  return (
    <>
      <Card className="overflow-hidden">
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <PenLine className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base truncate">{title}</CardTitle>
                    {isRevised && (
                      <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600">
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Revised
                      </Badge>
                    )}
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
                    {revisedAt && (
                      <>
                        <span>•</span>
                        <span>revised {format(new Date(revisedAt), "MMM d")}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem 
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEditDialog(true);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowDeleteConfirm(true);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
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
                      <p className="text-xs font-medium text-green-600 dark:text-green-400">Signed</p>
                      <div className="flex flex-wrap gap-2">
                        {data.assignments
                          .filter((a) => a.signed_at)
                          .map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center gap-2 bg-green-500/10 rounded-full px-3 py-1"
                            >
                              <Avatar className="h-5 w-5">
                                <AvatarImage src={a.employee?.profile_photo_url} />
                                <AvatarFallback className="text-[10px]">
                                  {getDisplayName(a.employee?.full_name, a.employee?.nickname)?.charAt(0) || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs font-medium">{getDisplayName(a.employee?.full_name, a.employee?.nickname)}</span>
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
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Pending</p>
                      <div className="flex flex-wrap gap-2">
                        {data.assignments
                          .filter((a) => !a.signed_at)
                          .map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center gap-2 bg-amber-500/10 rounded-full px-3 py-1"
                            >
                              <Avatar className="h-5 w-5">
                                <AvatarImage src={a.employee?.profile_photo_url} />
                                <AvatarFallback className="text-[10px]">
                                  {getDisplayName(a.employee?.full_name, a.employee?.nickname)?.charAt(0) || "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs">{getDisplayName(a.employee?.full_name, a.employee?.nickname)}</span>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Read & Sign Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{title}" including all assignments and signatures. 
              Signed documents will be removed from employee profiles. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <EditReadAndSignDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        documentId={documentId}
        currentTitle={title}
        signedCount={signedCount}
      />
    </>
  );
}
