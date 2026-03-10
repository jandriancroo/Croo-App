import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CalendarDays, Calendar, CalendarRange, Pencil, Check, Play, Save } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { calculateUsageRates } from "@/utils/inventoryRateCalculation";
import InventoryCountSession from "@/components/inventory/InventoryCountSession";
import InventoryCountView from "@/components/inventory/InventoryCountView";
import DeleteCountDialog from "@/components/inventory/DeleteCountDialog";
import DeliveryReconciliation from "@/components/inventory/DeliveryReconciliation";
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

const InventoryCount = () => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSaveExitDialog, setShowSaveExitDialog] = useState(false);
  const [reconciliationComplete, setReconciliationComplete] = useState(false);
  const saveRef = useRef<{ save: () => Promise<void>; isSaving: boolean } | null>(null);
  const { locationId, countId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  // Check if edit or continue mode from query param
  const editMode = searchParams.get("edit") === "true";
  const continueMode = searchParams.get("continue") === "true";

  // Check if we're editing (completed count) or actively counting
  const { data: countData, isLoading } = useQuery({
    queryKey: ["inventory-count-details", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select(`
          *,
          counted_by_profile:profiles!inventory_counts_counted_by_fkey(full_name)
        `)
        .eq("id", countId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!countId
  });

  // Fetch location details
  const { data: location } = useQuery({
    queryKey: ["location-details", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, store_number")
        .eq("id", locationId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!locationId
  });

  // Submit/complete count mutation
  const submitCountMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("inventory_counts")
        .update({ 
          status: "completed",
          completed_at: new Date().toISOString(),
          counted_at: new Date().toISOString()
        })
        .eq("id", countId);
      
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Inventory count submitted!");
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-count-details", countId] });
      
      // Auto-calculate usage rates from this and previous count
      try {
        const result = await calculateUsageRates(countId!, locationId!);
        if (result.calculated > 0) {
          toast.success(`Auto-calculated ${result.calculated} usage rate${result.calculated > 1 ? 's' : ''}`, {
            description: "Based on count-to-count usage and POS sales data",
          });
          queryClient.invalidateQueries({ queryKey: ["inventory-usage-rates", locationId] });
        }
      } catch (err) {
        console.error("Usage rate auto-calculation failed:", err);
      }
      
      navigate(`/inventory/${locationId}`);
    },
    onError: () => {
      toast.error("Failed to submit count");
    }
  });

  // Delete count mutation
  const deleteCountMutation = useMutation({
    mutationFn: async () => {
      // First delete count items
      const { error: itemsError } = await supabase
        .from("inventory_count_items")
        .delete()
        .eq("count_id", countId);
      
      if (itemsError) throw itemsError;

      // Then delete the count itself
      const { error } = await supabase
        .from("inventory_counts")
        .delete()
        .eq("id", countId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Inventory count deleted");
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
      navigate(`/inventory/${locationId}`);
    },
    onError: () => {
      toast.error("Failed to delete count");
    }
  });

  // Determine the current state
  const isCompleted = countData?.status === "completed";
  const isInProgress = countData?.status === "in_progress";
  const isEditing = isCompleted && editMode;
  const isViewOnly = isCompleted && !editMode;
  const isReviewMode = isInProgress && !editMode && !continueMode; // Saved but not submitted - review mode
  const isCounting = !isCompleted && (!isInProgress || continueMode); // Active counting mode
  const needsReconciliation = isCounting && !reconciliationComplete && !continueMode; // Show reconciliation before counting

  // Block browser tab/window close when actively counting or editing
  useEffect(() => {
    if (isCounting || isEditing) {
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [isCounting, isEditing]);

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
    queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
    navigate(`/inventory/${locationId}`);
  };

  const handleSaveAndExit = useCallback(async (redirectTo?: string) => {
    setShowSaveExitDialog(false);
    try {
      await saveRef.current?.save();
    } catch (e) {
      console.error("[Inventory] Save & Exit save failed:", e);
      toast.error("Save failed — your data is still here, try again");
      return; // Don't navigate if save failed
    }
    queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
    queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
    // Navigate to the review screen (count page without ?continue) so user can Submit
    navigate(redirectTo || `/inventory/${locationId}/count/${countId}`);
  }, [queryClient, locationId, countId, navigate]);

  const handleSaveExitCancel = useCallback(() => {
    setShowSaveExitDialog(false);
  }, []);

  const handleSaveClick = () => {
    if (isCounting || isEditing) {
      setShowSaveExitDialog(true);
    }
  };

  // Helper to get period icon
  const getPeriodIcon = (periodType: string | null) => {
    switch (periodType) {
      case "weekly":
        return <CalendarDays className="h-4 w-4" />;
      case "monthly":
        return <Calendar className="h-4 w-4" />;
      case "yearly":
        return <CalendarRange className="h-4 w-4" />;
      default:
        return null;
    }
  };

  // Helper to format period label
  const formatPeriodLabel = (count: any) => {
    if (!count?.period_type || !count?.period_end_date) {
      return count?.count_date ? format(new Date(count.count_date), "MMM d, yyyy") : "";
    }
    
    const endDate = new Date(count.period_end_date + 'T12:00:00');
    switch (count.period_type) {
      case "weekly":
        return `Week Ending ${format(endDate, "MMM d, yyyy")}`;
      case "monthly":
        return `${format(endDate, "MMMM yyyy")} Month End`;
      case "yearly":
        return `${format(endDate, "yyyy")} Year End`;
      default:
        return format(new Date(count.count_date), "MMM d, yyyy");
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="p-4 md:p-6 flex items-center justify-center min-h-[50vh]">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </Layout>
    );
  }

  if (!countData) {
    return (
      <Layout>
        <div className="p-4 md:p-6 space-y-4">
          <Button variant="ghost" onClick={() => navigate(`/inventory/${locationId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Inventory
          </Button>
          <div className="text-center py-12 text-muted-foreground">
            Count not found
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4 md:max-w-4xl md:mx-auto md:p-6">
        {/* Header */}
        {/* Header - hidden during active counting/editing since session has its own controls */}
        {!(isCounting || isEditing) && (
          <>
            <div className="flex items-center justify-between gap-4">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              
              <div className="flex items-center gap-2">
                {countData.period_type && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {getPeriodIcon(countData.period_type)}
                    <span className="capitalize">{countData.period_type}</span>
                  </div>
                )}
                <Badge variant={isViewOnly ? "default" : "secondary"}>
                  {isViewOnly ? "Completed" : "Review"}
                </Badge>
              </div>
            </div>

            {/* Period Info */}
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">{formatPeriodLabel(countData)}</h1>
            </div>
          </>
        )}

        {/* Count Session, View, or Review */}
        {isViewOnly ? (
          <>
            {/* Actions for completed counts */}
            <div className="flex justify-end">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate(`/inventory/${locationId}/count/${countId}?edit=true`)}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit Count
              </Button>
            </div>
            <InventoryCountView 
              countId={countId!} 
              locationId={locationId!}
            />
          </>
        ) : isReviewMode ? (
          <>
            {/* Review mode: Continue and Submit buttons */}
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="flex-1 sm:flex-none"
                onClick={() => navigate(`/inventory/${locationId}/count/${countId}?continue=true`)}
              >
                <Play className="h-4 w-4 mr-2" />
                Continue Counting
              </Button>
              <Button 
                className="flex-1 sm:flex-none"
                onClick={() => submitCountMutation.mutate()}
                disabled={submitCountMutation.isPending}
              >
                <Check className="h-4 w-4 mr-2" />
                {submitCountMutation.isPending ? "Submitting..." : "Submit"}
              </Button>
            </div>
            <InventoryCountView 
              countId={countId!} 
              locationId={locationId!}
            />
          </>
        ) : needsReconciliation ? (
          <DeliveryReconciliation
            countId={countId!}
            locationId={locationId!}
            onComplete={() => setReconciliationComplete(true)}
          />
        ) : isCounting || isEditing ? (
          <InventoryCountSession 
            countId={countId!} 
            locationId={locationId!}
            isEditing={isEditing}
            isViewOnly={false}
            onClose={handleClose}
            saveRef={saveRef}
          />
        ) : null}

        <DeleteCountDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={() => deleteCountMutation.mutate()}
          isDeleting={deleteCountMutation.isPending}
          countPeriod={formatPeriodLabel(countData)}
        />

        <AlertDialog open={showSaveExitDialog} onOpenChange={(open) => { if (!open) handleSaveExitCancel(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Save & exit?</AlertDialogTitle>
              <AlertDialogDescription>
                Your count progress will be saved. You can continue counting later from the recent counts list.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleSaveExitCancel}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleSaveAndExit()}>
                Save & Exit
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
};

export default InventoryCount;