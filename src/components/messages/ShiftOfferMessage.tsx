import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Clock, Calendar, User } from "lucide-react";

interface ShiftOfferMessageProps {
  offerId: string;
  messageId: string;
}

export function ShiftOfferMessage({ offerId, messageId }: ShiftOfferMessageProps) {
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

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

      const { error } = await supabase
        .from("shift_offers")
        .update({ 
          claimed_by_user_id: user.id,
          status: "claimed" 
        })
        .eq("id", offerId);

      if (error) throw error;
      toast.success("Shift claimed! Awaiting approval.");
    } catch (error) {
      console.error("Error claiming shift:", error);
      toast.error("Failed to claim shift");
    } finally {
      setClaiming(false);
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
      </div>
    </Card>
  );
}
