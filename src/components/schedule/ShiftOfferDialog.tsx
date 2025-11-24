import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ShiftOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: any;
  onOfferCreated?: () => void;
}

export function ShiftOfferDialog({ open, onOpenChange, shift, onOfferCreated }: ShiftOfferDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create shift offer
      const { data: newOffer, error: offerError } = await supabase
        .from("shift_offers")
        .insert({
          shift_id: shift.id,
          offered_by_user_id: user.id,
          status: "available"
        })
        .select()
        .single();

      if (offerError) throw offerError;

      // Get or create shift marketplace chat
      let { data: marketplaceChat } = await supabase
        .from("chats")
        .select("id")
        .eq("title", "🔄 Shift Marketplace")
        .single();

      if (!marketplaceChat) {
        const { data: newChat, error: chatError } = await supabase
          .from("chats")
          .insert({
            created_by: user.id,
            is_group: true,
            title: "🔄 Shift Marketplace"
          })
          .select()
          .single();

        if (chatError) throw chatError;
        marketplaceChat = newChat;

        // Add all users to marketplace chat
        const { data: allUsers } = await supabase
          .from("profiles")
          .select("id");

        if (allUsers) {
          await supabase
            .from("chat_members")
            .insert(allUsers.map(u => ({
              chat_id: marketplaceChat.id,
              user_id: u.id
            })));
        }
      }

      // Post message about the shift offer with offer ID
      const shiftDate = new Date(shift.shift_date).toLocaleDateString();
      const messageContent = `SHIFT_OFFER:${newOffer.id}`;

      await supabase
        .from("messages")
        .insert({
          chat_id: marketplaceChat.id,
          sender_id: user.id,
          content: messageContent
        });

      toast.success("Shift offered up successfully!");
      onOfferCreated?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Error offering shift:", error);
      toast.error("Failed to offer shift");
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
            This will make your shift available for other team members to claim.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Position:</span>
            <span className="font-medium">{shift?.template?.position || "N/A"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date:</span>
            <span className="font-medium">
              {shift?.shift_date ? new Date(shift.shift_date).toLocaleDateString() : "N/A"}
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
          <Button onClick={handleOfferUp} disabled={isSubmitting}>
            {isSubmitting ? "Offering..." : "Offer Up Shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
