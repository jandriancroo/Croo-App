import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock, Calendar, User, Check, X } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";

interface ShiftOfferMessageProps {
  offerId: string;
  messageId: string;
}

export function ShiftOfferMessage({ offerId, messageId }: ShiftOfferMessageProps) {
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const { isAdmin } = useUserRole();

  useEffect(() => {
    fetchOffer();

    const channel = supabase
      .channel(`shift-offer-${offerId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shift_offers",
          filter: `id=eq.${offerId}`
        },
        () => fetchOffer()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [offerId]);

  const fetchOffer = async () => {
    try {
      const { data, error } = await supabase
        .from("shift_offers")
        .select(`
          id,
          status,
          shift:scheduled_shifts (
            id,
            shift_date,
            start_time,
            end_time,
            template:shift_templates (
              position,
              color
            )
          ),
          offered_by:profiles!shift_offers_offered_by_user_id_fkey (
            id,
            full_name
          ),
          claimed_by:profiles!shift_offers_claimed_by_user_id_fkey (
            id,
            full_name
          )
        `)
        .eq("id", offerId)
        .single();

      if (error) throw error;
      setOffer(data);
    } catch (error) {
      console.error("Error fetching shift offer:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}${ampm}`;
  };

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (user.id === offer.offered_by.id) {
        toast.error("You cannot claim your own shift");
        return;
      }

      // Determine if this is a weekend (Friday = 5, Saturday = 6)
      const shiftDate = new Date(offer.shift.shift_date);
      const dayOfWeek = shiftDate.getDay();
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
      const amount = isWeekend ? 2 : 1;

      const { error } = await supabase
        .from("shift_offers")
        .update({ 
          claimed_by_user_id: user.id,
          status: "claimed" 
        })
        .eq("id", offerId);

      if (error) throw error;

      // Create Croo Cash transaction for taking shift
      const { error: transactionError } = await supabase
        .from("croo_cash_transactions")
        .insert({
          user_id: user.id,
          amount: amount,
          transaction_type: "take_shift",
          shift_offer_id: offerId,
          shift_date: offer.shift.shift_date,
          is_weekend: isWeekend,
          notes: `Claimed shift on ${shiftDate.toLocaleDateString()}`
        });

      if (transactionError) throw transactionError;

      // Update claimer's Croo Cash balance
      const { data: profile } = await supabase
        .from("profiles")
        .select("croo_cash_balance")
        .eq("id", user.id)
        .single();
      
      await supabase
        .from("profiles")
        .update({ croo_cash_balance: (profile?.croo_cash_balance || 0) + amount })
        .eq("id", user.id);

      toast.success("Shift claimed! Awaiting approval.");
    } catch (error) {
      console.error("Error claiming shift:", error);
      toast.error("Failed to claim shift");
    } finally {
      setClaiming(false);
    }
  };

  const handleApprove = async () => {
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Prevent admins from approving their own claims
      if (user.id === offer.claimed_by?.id) {
        toast.error("You cannot approve your own shift claim");
        setProcessing(false);
        return;
      }

      // Update shift_offers status to approved
      const { error: offerError } = await supabase
        .from("shift_offers")
        .update({ status: "approved" })
        .eq("id", offerId);

      if (offerError) throw offerError;

      // Update the scheduled_shifts to assign the claimer
      const { error: shiftError } = await supabase
        .from("scheduled_shifts")
        .update({ user_id: offer.claimed_by.id })
        .eq("id", offer.shift.id);

      if (shiftError) throw shiftError;

      toast.success("Shift approved and assigned!");
    } catch (error) {
      console.error("Error approving shift:", error);
      toast.error("Failed to approve shift");
    } finally {
      setProcessing(false);
    }
  };

  const handleDeny = async () => {
    setProcessing(true);
    try {
      // Get the claimer's info
      const claimedBy = offer.claimed_by?.id;
      
      // Determine if this was a weekend shift
      const shiftDate = new Date(offer.shift.shift_date);
      const dayOfWeek = shiftDate.getDay();
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
      const amount = isWeekend ? 2 : 1;

      // Update shift_offers status to denied and clear claimed_by
      const { error: offerError } = await supabase
        .from("shift_offers")
        .update({ 
          status: "denied",
          claimed_by_user_id: null
        })
        .eq("id", offerId);

      if (offerError) throw offerError;

      if (claimedBy) {
        // Reverse the Croo Cash transaction
        const { error: transactionError } = await supabase
          .from("croo_cash_transactions")
          .insert({
            user_id: claimedBy,
            amount: -amount,
            transaction_type: "denied_claim",
            shift_offer_id: offerId,
            shift_date: offer.shift.shift_date,
            is_weekend: isWeekend,
            notes: `Claim denied for shift on ${shiftDate.toLocaleDateString()}`
          });

        if (transactionError) throw transactionError;

        // Update claimer's Croo Cash balance
        const { data: profile } = await supabase
          .from("profiles")
          .select("croo_cash_balance")
          .eq("id", claimedBy)
          .single();
        
        await supabase
          .from("profiles")
          .update({ croo_cash_balance: (profile?.croo_cash_balance || 0) - amount })
          .eq("id", claimedBy);
      }

      toast.success("Shift claim denied");
    } catch (error) {
      console.error("Error denying shift:", error);
      toast.error("Failed to deny shift");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading shift...</div>;
  }

  if (!offer || !offer.shift) {
    return <div className="text-sm text-muted-foreground">Shift no longer available</div>;
  }

  const statusBadge = () => {
    switch (offer.status) {
      case "available":
        return <Badge variant="default">Available</Badge>;
      case "claimed":
        return <Badge variant="secondary">Claimed by {offer.claimed_by?.full_name}</Badge>;
      case "approved":
        return <Badge className="bg-green-500">Approved</Badge>;
      case "denied":
        return <Badge variant="destructive">Denied</Badge>;
      case "cancelled":
        return <Badge variant="outline">Cancelled</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="p-4 bg-accent/20 border-accent">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-semibold text-lg">{offer.shift.template?.position || "Shift"}</h4>
            <p className="text-sm text-muted-foreground">
              Offered by {offer.offered_by.full_name}
            </p>
          </div>
          {statusBadge()}
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{new Date(offer.shift.shift_date).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>
              {formatTime(offer.shift.start_time)} - {formatTime(offer.shift.end_time)}
            </span>
          </div>
        </div>

        {offer.status === "available" && (
          <Button 
            className="w-full" 
            onClick={handleClaim}
            disabled={claiming}
          >
            {claiming ? "Claiming..." : "Claim This Shift"}
          </Button>
        )}

        {offer.status === "claimed" && isAdmin && (
          <div className="flex gap-2">
            <Button 
              className="flex-1 bg-green-600 hover:bg-green-700" 
              onClick={handleApprove}
              disabled={processing}
            >
              <Check className="h-4 w-4 mr-2" />
              {processing ? "Approving..." : "Approve"}
            </Button>
            <Button 
              variant="destructive"
              className="flex-1" 
              onClick={handleDeny}
              disabled={processing}
            >
              <X className="h-4 w-4 mr-2" />
              {processing ? "Denying..." : "Deny"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
