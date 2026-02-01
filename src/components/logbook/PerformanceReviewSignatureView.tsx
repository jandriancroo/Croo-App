import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SignaturePad } from "@/components/ui/signature-pad";
import { ClipboardCheck, Calendar, Loader2, RotateCw, Star, User } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

interface PerformanceReviewSignatureViewProps {
  review: {
    id: string;
    review_period_start?: string | null;
    review_period_end?: string | null;
    follow_up_notes?: string | null;
    created_at: string;
    created_by_profile?: { full_name: string };
    location?: { name: string };
  };
  onComplete: () => void;
  onClose: () => void;
}

export function PerformanceReviewSignatureView({ 
  review, 
  onComplete, 
}: PerformanceReviewSignatureViewProps) {
  const { user } = useAuth();
  const [isSigning, setIsSigning] = useState(false);

  // Fetch ratings for this review
  const { data: ratings = [] } = useQuery({
    queryKey: ["review-ratings-signature", review.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_ratings")
        .select(`
          *,
          item:performance_review_items(name, description)
        `)
        .eq("review_id", review.id)
        .order("created_at");

      if (error) throw error;
      return data || [];
    },
  });

  // Calculate average rating
  const averageRating = ratings.length > 0
    ? (ratings.reduce((sum: number, r: any) => sum + r.rating, 0) / ratings.length).toFixed(1)
    : null;

  const handleSignature = async (signatureDataUrl: string) => {
    setIsSigning(true);
    try {
      // Convert base64 to blob
      const response = await fetch(signatureDataUrl);
      const blob = await response.blob();
      
      // Upload signature to storage
      const fileName = `review-signatures/${review.id}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('logbook-attachments')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('logbook-attachments')
        .getPublicUrl(fileName);

      // Update the review with signature
      const { error: updateError } = await supabase
        .from('performance_reviews')
        .update({
          signature_url: publicUrl,
          signed_at: new Date().toISOString(),
        })
        .eq('id', review.id);

      if (updateError) throw updateError;

      // Send confirmation email to the employee
      try {
        if (user?.email) {
          await supabase.functions.invoke('send-notification-email', {
            body: {
              type: 'performance_review_signed',
              to: user.email,
              data: {
                manager_name: review.created_by_profile?.full_name || 'Management',
                location_name: review.location?.name,
                signed_date: new Date().toLocaleDateString(),
                average_rating: averageRating,
              },
            },
          });
        }
      } catch (emailError) {
        console.error('Failed to send review signed email:', emailError);
      }

      toast.success("Performance review acknowledged");
      onComplete();
    } catch (error: any) {
      toast.error("Failed to save signature: " + error.message);
    } finally {
      setIsSigning(false);
    }
  };

  const ACKNOWLEDGMENT_MESSAGE = "This performance review is meant to help you grow and improve. Please read through each rating and the manager's feedback carefully. Sign below to confirm you've reviewed this feedback.";

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-blue-500/10">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-blue-500" />
          <h1 className="font-semibold text-lg">Performance Review</h1>
        </div>
        <Badge variant="outline" className="text-xs">
          {format(new Date(review.created_at), 'MMM d, yyyy')}
        </Badge>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Review Info */}
        <div className="flex items-center gap-2 flex-wrap">
          {averageRating && (
            <Badge className="text-sm gap-1 bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
              <Star className="h-3 w-3 fill-yellow-500" />
              Average: {averageRating}/10
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            Reviewed by {review.created_by_profile?.full_name || 'Manager'}
          </span>
        </div>

        {/* Review Period */}
        {(review.review_period_start || review.review_period_end) && (
          <Card>
            <CardContent className="p-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                Review Period: {review.review_period_start && format(new Date(review.review_period_start), "MMM d, yyyy")}
                {review.review_period_end && ` - ${format(new Date(review.review_period_end), "MMM d, yyyy")}`}
              </span>
            </CardContent>
          </Card>
        )}

        {/* Ratings */}
        {ratings.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-medium text-sm text-muted-foreground">Your Ratings</h3>
            {ratings.map((rating: any) => (
              <Card key={rating.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{rating.item?.name}</span>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 10 }, (_, i) => (
                        <Star
                          key={i}
                          className={`h-4 w-4 ${
                            i < rating.rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-muted-foreground/20"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  {rating.item?.description && (
                    <p className="text-xs text-muted-foreground">{rating.item.description}</p>
                  )}
                  {rating.notes && (
                    <p className="text-sm bg-muted/30 rounded p-2 mt-2">{rating.notes}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Follow-up Notes */}
        {review.follow_up_notes && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" />
                Manager's Follow-Up Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{review.follow_up_notes}</p>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Acknowledgment Message */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="text-sm text-amber-700 dark:text-amber-400 italic">
              {ACKNOWLEDGMENT_MESSAGE}
            </p>
          </CardContent>
        </Card>

        {/* Landscape Prompt */}
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
          <RotateCw className="h-4 w-4" />
          <span>Rotate phone to landscape for best signing experience</span>
        </div>

        {/* Signature Pad */}
        <div className="pb-4">
          <SignaturePad 
            onSave={handleSignature}
            disabled={isSigning}
          />
        </div>
      </div>

      {/* Loading overlay */}
      {isSigning && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Saving signature...</span>
          </div>
        </div>
      )}
    </div>
  );
}
