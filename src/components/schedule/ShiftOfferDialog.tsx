import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
      
      const { data } = await supabase
        .from("shift_offers")
        .select("*")
        .eq("shift_id", shift.id)
        .eq("status", "available")
        .maybeSingle();
      
      setExistingOffer(data);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check if this shift is already offered to prevent duplicates
      const { data: existingOfferCheck } = await supabase
        .from("shift_offers")
        .select("id")
        .eq("shift_id", shift.id)
        .in("status", ["available", "claimed"])
        .maybeSingle();

      if (existingOfferCheck) {
        toast.error("This shift is already in the marketplace");
        setIsSubmitting(false);
        return;
      }

      // Create shift offer (no Croo Cash deduction yet - only when approved or no-show)
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
      const shiftDateFormatted = new Date(shift.shift_date).toLocaleDateString();
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
        <div className="text-sm text-muted-foreground space-y-1">
          <p>💰 <strong>Croo Cash:</strong></p>
          <p>• You'll lose $1.00 Croo Cash for offering this shift</p>
          {(() => {
            const offerDate = new Date(shift?.shift_date);
            const dayOfWeek = offerDate.getDay();
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
