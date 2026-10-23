import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DateTime } from "luxon";

interface ShiftOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: any;
  onOfferCreated?: () => void;
}

export function ShiftOfferDialog({ open, onOpenChange, shift, onOfferCreated }: ShiftOfferDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingOffer, setExistingOffer] = useState<any>(null);

  // Check if shift is already offered
  useEffect(() => {
    const checkExistingOffer = async () => {
      if (!shift?.id) return;

      const { data, error } = await supabase
        .from("shift_offers")
        .select("*")
        .eq("shift_id", shift.id)
        .eq("status", "available")
        .order("created_at", { ascending: true })
        .limit(1);

      if (error) {
        console.error("[ShiftOfferDialog] checkExistingOffer error", { shiftId: shift.id, error });
        setExistingOffer(null);
        return;
      }

      setExistingOffer(data?.[0] ?? null);
    };

    if (open) {
      checkExistingOffer();
    }
  }, [open, shift?.id]);

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}${ampm}`;
  };

  const handleOfferUp = async () => {
    setIsSubmitting(true);
    try {
      console.log("[ShiftOfferDialog] handleOfferUp start", {
        shiftId: shift?.id,
        locationId: shift?.location_id,
      });

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      // Resolve owner + location from the database (callers don't always pass location_id).
      const { data: shiftRow, error: shiftRowError } = await supabase
        .from("scheduled_shifts")
        .select("user_id, schedules(location_id)")
        .eq("id", shift.id)
        .single();
      if (shiftRowError) throw shiftRowError;
      const offeredByUserId: string | null = (shift as any)?.user_id ?? shiftRow.user_id;
      const locationId: string | undefined = shift.location_id || (shiftRow as any)?.schedules?.location_id;
      if (!locationId) throw new Error("Couldn't find this shift's store");

      // Check if this shift is already offered to prevent duplicates
      const { data: existingOffers, error: existingOfferError } = await supabase
        .from("shift_offers")
        .select("id,status")
        .eq("shift_id", shift.id)
        .in("status", ["available", "claimed"])
        .order("created_at", { ascending: true })
        .limit(1);

      if (existingOfferError) throw existingOfferError;

      if (existingOffers?.length) {
        toast.error("This shift is already in the marketplace");
        return;
      }

      // Create shift offer
      const { data: newOffer, error: offerError } = await supabase
        .from("shift_offers")
        .insert({
          shift_id: shift.id,
          offered_by_user_id: offeredByUserId,
          status: "available",
        })
        .select()
        .single();

      if (offerError) throw offerError;
      // The offer shows up as a card in the feed's Shift Swaps bar (useOpenShiftOffers); no chat post.

      toast.success("Shift offered up successfully!");
      onOfferCreated?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error("[ShiftOfferDialog] Error offering shift", {
        error,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
      });
      toast.error(error?.message ? `Failed to offer shift: ${error.message}` : "Failed to offer shift");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Offer Up Shift</DialogTitle>
          <DialogDescription>
            This will make your shift available for other team members to claim from the feed.
          </DialogDescription>
        </DialogHeader>
        
        {existingOffer && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This shift is already offered up in the marketplace.
            </AlertDescription>
          </Alert>
        )}
        
        <div className="py-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Position:</span>
            <span className="font-medium">{shift?.template?.position || "N/A"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date:</span>
            <span className="font-medium">
              {shift?.shift_date ? DateTime.fromFormat(shift.shift_date, "yyyy-MM-dd").toFormat("M/d/yyyy") : "N/A"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Time:</span>
            <span className="font-medium">
              {shift?.start_time && shift?.end_time 
                ? `${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}`
                : "N/A"}
            </span>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleOfferUp} disabled={isSubmitting || !!existingOffer}>
            {isSubmitting ? "Offering..." : existingOffer ? "Already Offered" : "Offer Up Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
