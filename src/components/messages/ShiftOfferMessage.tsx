import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock, Calendar, User, Check, X } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useCrooCashAnimation } from "@/contexts/CrooCashAnimationContext";
import { getDisplayName } from "@/utils/displayName";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ShiftOfferMessageProps {
  offerId: string;
  messageId: string;
}

interface ShiftClaim {
  id: string;
  user_id: string;
  created_at: string;
  profile: {
    id: string;
    full_name: string;
    nickname: string | null;
    profile_photo_url: string | null;
  };
}

export function ShiftOfferMessage({ offerId, messageId }: ShiftOfferMessageProps) {
  const [offer, setOffer] = useState<any>(null);
  const [claims, setClaims] = useState<ShiftClaim[]>([]);
  const [selectedClaimerId, setSelectedClaimerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { isAdmin } = useUserRole();
  const { triggerAnimation } = useCrooCashAnimation();

  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    };
    getCurrentUser();
  }, []);

  useEffect(() => {
    fetchOffer();
    fetchClaims();

    const offerChannel = supabase
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

    const claimsChannel = supabase
      .channel(`shift-claims-${offerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shift_offer_claims",
          filter: `shift_offer_id=eq.${offerId}`
        },
        () => fetchClaims()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(offerChannel);
      supabase.removeChannel(claimsChannel);
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
            full_name,
            nickname
          ),
          claimed_by:profiles!shift_offers_claimed_by_user_id_fkey (
            id,
            full_name,
            nickname
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

  const fetchClaims = async () => {
    try {
      const { data, error } = await supabase
        .from("shift_offer_claims")
        .select(`
          id,
          user_id,
          created_at,
          profile:profiles (
            id,
            full_name,
            nickname,
            profile_photo_url
          )
        `)
        .eq("shift_offer_id", offerId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setClaims(data || []);
      if (data && data.length > 0 && !selectedClaimerId) {
        setSelectedClaimerId(data[0].user_id);
      }
    } catch (error) {
      console.error("Error fetching claims:", error);
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

      // Only non-admins cannot claim their own shifts
      if (user.id === offer.offered_by.id && !isAdmin) {
        toast.error("You cannot claim your own shift");
        return;
      }

      // Check if user already claimed this shift
      const existingClaim = claims.find(c => c.user_id === user.id);
      if (existingClaim) {
        toast.error("You've already claimed this shift");
        return;
      }

      // Determine if this is a weekend (Friday = 5, Saturday = 6, Sunday = 0)
      const shiftDate = new Date(offer.shift.shift_date);
      const dayOfWeek = shiftDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
      const amount = isWeekend ? 200 : 100; // $1 base, $2 for weekend (stored in cents)

      // Create claim record
      const { error: claimError } = await supabase
        .from("shift_offer_claims")
        .insert({
          shift_offer_id: offerId,
          user_id: user.id
        });

      if (claimError) throw claimError;

      // Update shift_offers status to claimed if this is the first claim
      if (claims.length === 0) {
        const { error } = await supabase
          .from("shift_offers")
          .update({ 
            claimed_by_user_id: user.id,
            status: "claimed" 
          })
          .eq("id", offerId);

        if (error) throw error;
      }

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
    if (!selectedClaimerId) {
      toast.error("Please select a team member to approve");
      return;
    }

    setProcessing(true);
    try {
      // Determine if this is a weekend shift for Croo Cash amount (Fri, Sat, Sun)
      const shiftDate = new Date(offer.shift.shift_date);
      const dayOfWeek = shiftDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
      const amount = isWeekend ? 200 : 100; // $1 base, $2 for weekend (stored in cents)

      // Update shift_offers status to approved
      const { error: offerError } = await supabase
        .from("shift_offers")
        .update({ 
          status: "approved",
          claimed_by_user_id: selectedClaimerId
        })
        .eq("id", offerId);

      if (offerError) throw offerError;

      // Update the scheduled_shifts to assign the selected claimer
      const { error: shiftError } = await supabase
        .from("scheduled_shifts")
        .update({ user_id: selectedClaimerId })
        .eq("id", offer.shift.id);

      if (shiftError) throw shiftError;

      // NOW deduct Croo Cash from the offerer (they lose points when claim is approved)
      const { error: offererTransactionError } = await supabase
        .from("croo_cash_transactions")
        .insert({
          user_id: offer.offered_by.id,
          amount: -amount,
          transaction_type: "offer_shift",
          shift_offer_id: offerId,
          shift_date: offer.shift.shift_date,
          is_weekend: isWeekend,
          notes: `Offered shift on ${shiftDate.toLocaleDateString()} - claim approved`
        });

      if (offererTransactionError) throw offererTransactionError;

      // Update offerer's Croo Cash balance
      const { data: offererProfile } = await supabase
        .from("profiles")
        .select("croo_cash_balance")
        .eq("id", offer.offered_by.id)
        .single();
      
      await supabase
        .from("profiles")
        .update({ croo_cash_balance: (offererProfile?.croo_cash_balance || 0) - amount })
        .eq("id", offer.offered_by.id);

      // Trigger animation if the current user is the one who got approved
      if (currentUserId === selectedClaimerId) {
        triggerAnimation(amount);
      }

      // Send push notification to the approved claimer
      const shiftDateFormatted = new Date(offer.shift.shift_date).toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      await supabase.functions.invoke('send-push-notification', {
        body: {
          user_ids: [selectedClaimerId],
          title: 'Shift Claim Approved!',
          body: `Your claim for ${shiftDateFormatted} has been approved`,
          notification_type: 'shift_approvals',
          data: { type: 'shift_approval', shift_id: offer.shift.id }
        }
      });

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
      // Get all claimers for this shift (Fri, Sat, Sun = weekend)
      const shiftDate = new Date(offer.shift.shift_date);
      const dayOfWeek = shiftDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6;
      const amount = isWeekend ? 200 : 100; // $1 base, $2 for weekend (stored in cents)

      // Reverse Croo Cash for all claimers
      for (const claim of claims) {
        // Create reversal transaction
        const { error: transactionError } = await supabase
          .from("croo_cash_transactions")
          .insert({
            user_id: claim.user_id,
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
          .eq("id", claim.user_id)
          .single();
        
        await supabase
          .from("profiles")
          .update({ croo_cash_balance: (profile?.croo_cash_balance || 0) - amount })
          .eq("id", claim.user_id);
      }

      // Delete all claims
      const { error: deleteClaimsError } = await supabase
        .from("shift_offer_claims")
        .delete()
        .eq("shift_offer_id", offerId);

      if (deleteClaimsError) throw deleteClaimsError;

      // Update shift_offers status to available and clear claimed_by
      const { error: offerError } = await supabase
        .from("shift_offers")
        .update({ 
          status: "available",
          claimed_by_user_id: null
        })
        .eq("id", offerId);

      if (offerError) throw offerError;

      toast.success("All claims denied - shift is available again");
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
        return <Badge className="bg-white text-[hsl(var(--croo-orange))] hover:bg-white/90 font-semibold">Available</Badge>;
      case "claimed":
        return <Badge className="bg-yellow-400 text-yellow-900 hover:bg-yellow-400/90 font-semibold">{claims.length} {claims.length === 1 ? 'Person' : 'People'} Interested</Badge>;
      case "approved":
        return <Badge className="bg-green-500 text-white hover:bg-green-500/90 font-semibold">Approved</Badge>;
      case "denied":
        return <Badge className="bg-red-500 text-white hover:bg-red-500/90 font-semibold">Denied</Badge>;
      case "cancelled":
        return <Badge className="bg-gray-500 text-white hover:bg-gray-500/90 font-semibold">Cancelled</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className="p-4 bg-[hsl(var(--croo-orange))] border-[hsl(var(--croo-orange))] border-2 shadow-lg">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-semibold text-lg text-white">{offer.shift.template?.position || "Shift"}</h4>
            <p className="text-sm text-white/80">
              Offered by {getDisplayName(offer.offered_by.full_name, offer.offered_by.nickname)}
            </p>
          </div>
          {statusBadge()}
        </div>

        <div className="space-y-2 text-sm text-white">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-white/90" />
            <span>{new Date(offer.shift.shift_date).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-white/90" />
            <span>
              {formatTime(offer.shift.start_time)} - {formatTime(offer.shift.end_time)}
            </span>
          </div>
        </div>

        {claims.length > 0 && offer.status === "claimed" && (
          <div className="space-y-2 border-t border-white/20 pt-3">
            <p className="text-sm font-medium text-white">Interested Team Members:</p>
            <div className="space-y-2">
              {claims.map((claim) => (
                <div key={claim.id} className="flex items-center gap-2 text-sm text-white">
                  {claim.profile.profile_photo_url ? (
                    <img 
                      src={claim.profile.profile_photo_url} 
                      alt={getDisplayName(claim.profile.full_name, claim.profile.nickname)}
                      className="w-6 h-6 rounded-full border-2 border-white/30"
                    />
                  ) : (
                    <User className="w-6 h-6 text-white/80" />
                  )}
                  <span>{getDisplayName(claim.profile.full_name, claim.profile.nickname)}</span>
                  <span className="text-xs text-white/70 ml-auto">
                    {new Date(claim.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {offer.status === "available" && (
          <Button 
            className="w-full bg-white text-[hsl(var(--croo-orange))] hover:bg-white/90 font-semibold" 
            onClick={handleClaim}
            disabled={claiming}
          >
            {claiming ? "Claiming..." : "Claim This Shift"}
          </Button>
        )}

        {offer.status === "claimed" && isAdmin && claims.length > 0 && (
          <div className="space-y-3 border-t border-white/20 pt-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white">Select who gets the shift:</label>
              <Select value={selectedClaimerId} onValueChange={setSelectedClaimerId}>
                <SelectTrigger className="w-full bg-white text-[hsl(var(--croo-orange))] border-white/30">
                  <SelectValue placeholder="Choose team member" />
                </SelectTrigger>
                <SelectContent className="bg-white z-50">
                  {claims.map((claim) => (
                    <SelectItem key={claim.id} value={claim.user_id}>
                      {getDisplayName(claim.profile.full_name, claim.profile.nickname)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button 
                className="flex-1 bg-green-600 hover:bg-green-700 text-white" 
                onClick={handleApprove}
                disabled={processing || !selectedClaimerId}
              >
                <Check className="h-4 w-4 mr-2" />
                {processing ? "Approving..." : "Approve"}
              </Button>
              <Button 
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={handleDeny}
                disabled={processing}
              >
                <X className="h-4 w-4 mr-2" />
                {processing ? "Denying..." : "Deny All"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
