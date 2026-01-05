import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MapPin, CalendarDays, Calendar, CalendarRange, Pencil, Check, Play } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import InventoryCountSession from "@/components/inventory/InventoryCountSession";
import InventoryCountView from "@/components/inventory/InventoryCountView";

const InventoryCount = () => {
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
          completed_at: new Date().toISOString()
        })
        .eq("id", countId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Inventory count submitted!");
      queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-count-details", countId] });
      navigate(`/inventory/${locationId}`);
    },
    onError: () => {
      toast.error("Failed to submit count");
    }
  });

  // Determine the current state
  const isCompleted = countData?.status === "completed";
  const isInProgress = countData?.status === "in_progress";
  const isEditing = isCompleted && editMode;
  const isViewOnly = isCompleted && !editMode;
  const isReviewMode = isInProgress && !editMode && !continueMode; // Saved but not submitted - review mode
  const isCounting = !isCompleted && (!isInProgress || continueMode); // Active counting mode

  const handleClose = () => {
    queryClient.invalidateQueries({ queryKey: ["inventory-counts", locationId] });
    queryClient.invalidateQueries({ queryKey: ["inventory-in-progress", locationId] });
    navigate(`/inventory/${locationId}`);
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
    
    const endDate = new Date(count.period_end_date);
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
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        {/* Header */}
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
            <Badge variant={isEditing ? "outline" : isViewOnly ? "default" : isReviewMode ? "secondary" : "secondary"}>
              {isEditing ? "Editing" : isViewOnly ? "Completed" : isReviewMode ? "Review" : "Counting"}
            </Badge>
          </div>
        </div>

        {/* Location & Period Info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            <MapPin className="h-4 w-4" />
            <span className="font-medium text-foreground">
              {location?.name || "Loading..."}
            </span>
            {location?.store_number && (
              <Badge variant="outline" className="text-xs">
                #{location.store_number}
              </Badge>
            )}
          </div>
          
          <h1 className="text-xl font-bold">{formatPeriodLabel(countData)}</h1>
        </div>

        {/* Count Session, View, or Review */}
        {isViewOnly ? (
          <>
            {/* Edit button for completed counts */}
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
            {/* Review mode: show items + Continue and Submit buttons */}
            <div className="flex gap-2 justify-end">
              <Button 
                variant="outline" 
                onClick={() => navigate(`/inventory/${locationId}/count/${countId}?continue=true`)}
              >
                <Play className="h-4 w-4 mr-2" />
                Continue Counting
              </Button>
              <Button 
                onClick={() => submitCountMutation.mutate()}
                disabled={submitCountMutation.isPending}
              >
                <Check className="h-4 w-4 mr-2" />
                {submitCountMutation.isPending ? "Submitting..." : "Submit Count"}
              </Button>
            </div>
            <InventoryCountView 
              countId={countId!} 
              locationId={locationId!}
            />
          </>
        ) : isCounting || isEditing ? (
          <InventoryCountSession 
            countId={countId!} 
            locationId={locationId!}
            isEditing={isEditing}
            isViewOnly={false}
            onClose={handleClose}
          />
        ) : null}
      </div>
    </Layout>
  );
};

export default InventoryCount;