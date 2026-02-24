import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";

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

      // Determine who the offer should be attributed to.
      // For admin/manager offering someone else's shift, the offer must be attributed to the shift owner.
      let offeredByUserId: string | null = (shift as any)?.user_id ?? null;
      if (!offeredByUserId) {
        const { data: shiftRow, error: shiftRowError } = await supabase
          .from("scheduled_shifts")
          .select("user_id")
          .eq("id", shift.id)
          .single();
        if (shiftRowError) throw shiftRowError;
        offeredByUserId = shiftRow.user_id;
      }

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

      // Create shift offer (no Croo Cash deduction yet - only when approved or no-show)
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

      // Get the location_id from the shift
      const locationId = shift.location_id;
      // Find existing marketplace chat (unique index prevents duplicates)
      let { data: marketplaceChats, error: marketplaceChatsError } = await supabase
        .from("chats")
        .select("id")
        .eq("title", "Shift Marketplace")
        .eq("location_id", locationId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (marketplaceChatsError) throw marketplaceChatsError;

      let marketplaceChat = marketplaceChats?.[0] || null;

      if (!marketplaceChat) {
        // Try to create; unique index will prevent race-condition duplicates
        const { data: newChat, error: chatError } = await supabase
          .from("chats")
          .insert({
            created_by: user.id,
            is_group: true,
            title: "Shift Marketplace",
            location_id: locationId,
          })
          .select()
          .single();

        if (chatError) {
          // If unique constraint violation, fetch the existing one
          if (chatError.code === "23505") {
            const { data: existing } = await supabase
              .from("chats")
              .select("id")
              .eq("title", "Shift Marketplace")
              .eq("location_id", locationId)
              .limit(1)
              .single();
            marketplaceChat = existing;
          } else {
            throw chatError;
          }
        } else {
          marketplaceChat = newChat;
        }

        // Add users at this location to the marketplace chat
        const { data: locationUsers, error: locationUsersError } = await supabase
          .from("user_locations")
          .select("user_id")
          .eq("location_id", locationId);

        if (locationUsersError) throw locationUsersError;

        if (locationUsers?.length) {
          const { error: addMembersError } = await supabase
            .from("chat_members")
            .insert(
              locationUsers.map((u) => ({
                chat_id: marketplaceChat.id,
                user_id: u.user_id,
              }))
            );

          if (addMembersError) throw addMembersError;
        }
      }

      // Ensure the offering user is actually a member of the marketplace chat (required by messages RLS)
      const { error: ensureMemberError } = await supabase
        .from("chat_members")
        .insert({ chat_id: marketplaceChat.id, user_id: user.id })
        .select()
        .maybeSingle();

      // If already exists, ignore; otherwise fail
      if (ensureMemberError && ensureMemberError.code !== "23505") {
        throw ensureMemberError;
      }

      // Post message about the shift offer with offer ID
      const messageContent = `SHIFT_OFFER:${newOffer.id}`;
      const { error: messageError } = await supabase.from("messages").insert({
        chat_id: marketplaceChat.id,
        sender_id: user.id,
        content: messageContent,
      });

      if (messageError) throw messageError;

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
            This will make your shift available for other team members to claim in the Shift Marketplace.
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
              {shift?.shift_date ? parseDateStringInTimezone(shift.shift_date, 'America/Los_Angeles').toLocaleDateString() : "N/A"}
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
          <div className="text-sm text-muted-foreground space-y-1">
            <p>💰 <strong>Croo Cash:</strong></p>
            <p>• You'll lose $1.00 Croo Cash for offering this shift</p>
            {(() => {
              const offerDate = shift?.shift_date
                ? parseDateStringInTimezone(shift.shift_date, "America/Los_Angeles")
                : null;
              const dayOfWeek = offerDate ? offerDate.getDay() : null;
              // Weekend = Friday (5), Saturday (6), Sunday (0)
              return (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) && (
                <p className="text-primary font-semibold">🎉 Weekend Bonus! You'll lose $2.00 Croo Cash (doubled)</p>
              );
            })()}
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
