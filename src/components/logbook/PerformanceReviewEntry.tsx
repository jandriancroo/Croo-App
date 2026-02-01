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
import { ChevronDown, ChevronRight, ClipboardCheck, CheckCircle2, Clock, MoreVertical, Trash2, Star, User } from "lucide-react";
import { format } from "date-fns";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";

interface PerformanceReviewEntryProps {
  reviewId: string;
  employeeName: string;
  employeePhoto?: string;
  createdAt: string;
  createdByName?: string;
  isSigned: boolean;
  signedAt?: string | null;
  onDeleted?: () => void;
}

export function PerformanceReviewEntry({
  reviewId,
  employeeName,
  employeePhoto,
  createdAt,
  createdByName,
  isSigned,
  signedAt,
  onDeleted,
}: PerformanceReviewEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { isAdmin, isManager } = useUserRole();
  const queryClient = useQueryClient();
  const canManage = isAdmin || isManager;

  // Fetch ratings when expanded
  const { data: ratings = [] } = useQuery({
    queryKey: ["performance-review-ratings", reviewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_ratings")
        .select(`
          *,
          item:performance_review_items(name, description)
        `)
        .eq("review_id", reviewId)
        .order("created_at");

      if (error) throw error;
      return data || [];
    },
    enabled: isExpanded,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch full review details when expanded
  const { data: reviewDetails } = useQuery({
    queryKey: ["performance-review-details", reviewId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_reviews")
        .select("follow_up_notes, review_period_start, review_period_end")
        .eq("id", reviewId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: isExpanded,
    staleTime: 5 * 60 * 1000,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("performance_reviews")
        .delete()
        .eq("id", reviewId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Performance review deleted");
      queryClient.invalidateQueries({ queryKey: ["performance-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
      onDeleted?.();
    },
    onError: (error) => {
      console.error("Delete error:", error);
      toast.error("Failed to delete review");
    },
  });

  // Calculate average rating
  const averageRating = ratings.length > 0
    ? (ratings.reduce((sum: number, r: any) => sum + r.rating, 0) / ratings.length).toFixed(1)
    : null;

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
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <ClipboardCheck className="h-5 w-5 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-base">Performance Review</CardTitle>
                    <Badge variant={isSigned ? "default" : "secondary"} className="text-xs">
                      {isSigned ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Signed
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3 mr-1" />
                          Pending
                        </>
                      )}
                    </Badge>
                    {averageRating && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {averageRating}/10
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={employeePhoto} />
                      <AvatarFallback className="text-[10px]">
                        <User className="h-3 w-3" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{employeeName}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{format(new Date(createdAt), "MMM d, yyyy")}</span>
                    {createdByName && (
                      <>
                        <span>•</span>
                        <span>by {createdByName}</span>
                      </>
                    )}
                    {signedAt && (
                      <>
                        <span>•</span>
                        <span>signed {format(new Date(signedAt), "MMM d")}</span>
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
              {/* Review Period */}
              {(reviewDetails?.review_period_start || reviewDetails?.review_period_end) && (
                <div className="text-sm text-muted-foreground">
                  Review Period: {reviewDetails.review_period_start && format(new Date(reviewDetails.review_period_start), "MMM d, yyyy")}
                  {reviewDetails.review_period_end && ` - ${format(new Date(reviewDetails.review_period_end), "MMM d, yyyy")}`}
                </div>
              )}

              {/* Ratings */}
              {ratings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Ratings</h4>
                  <div className="space-y-2">
                    {ratings.map((rating: any) => (
                      <div key={rating.id} className="bg-muted/30 rounded-lg p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{rating.item?.name}</span>
                          <div className="flex items-center gap-1">
                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            <span className="text-sm font-medium">{rating.rating}/10</span>
                          </div>
                        </div>
                        {rating.notes && (
                          <p className="text-xs text-muted-foreground">{rating.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Follow-up Notes */}
              {reviewDetails?.follow_up_notes && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Follow-Up Notes</h4>
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                    <p className="text-sm whitespace-pre-wrap">{reviewDetails.follow_up_notes}</p>
                  </div>
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
            <AlertDialogTitle>Delete Performance Review?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the performance review for {employeeName}. 
              This action cannot be undone.
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
    </>
  );
}
