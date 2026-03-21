import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getDisplayName } from "@/utils/displayName";

interface ShiftOffer {
  id: string;
  status: string;
  created_at: string;
  shift: {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    template: {
      position: string;
    };
  };
  offered_by: {
    id: string;
    full_name: string;
    nickname: string | null;
    profile_photo_url: string;
  };
  claimed_by: {
    id: string;
    full_name: string;
    nickname: string | null;
    profile_photo_url: string;
  } | null;
}

export function ShiftPoolSection() {
  const [claimedOffers, setClaimedOffers] = useState<ShiftOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchClaimedOffers = async () => {
    try {
      const { data, error } = await supabase
        .from("shift_offers")
        .select(`
          id,
          status,
          created_at,
          shift:scheduled_shifts (
            id,
            shift_date,
            start_time,
            end_time,
            template:shift_templates (
              position
            )
          ),
          offered_by:profiles!shift_offers_offered_by_user_id_fkey (
            id,
            full_name,
            nickname,
            profile_photo_url
          ),
          claimed_by:profiles!shift_offers_claimed_by_user_id_fkey (
            id,
            full_name,
            nickname,
            profile_photo_url
          )
        `)
        .eq("status", "claimed")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClaimedOffers(data as any || []);
    } catch (error) {
      console.error("Error fetching claimed offers:", error);
      toast.error("Failed to load shift pool");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchClaimedOffers();

    const channel = supabase
      .channel("shift-offers-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shift_offers"
        },
        () => fetchClaimedOffers()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes}${ampm}`;
  };

  const handleApprove = async (offer: ShiftOffer) => {
    try {
      // Update shift offer status
      const { error: offerError } = await supabase
        .from("shift_offers")
        .update({ status: "approved" })
        .eq("id", offer.id);

      if (offerError) throw offerError;

      // Update the scheduled shift to assign to the claimer
      const { error: shiftError } = await supabase
        .from("scheduled_shifts")
        .update({ user_id: offer.claimed_by?.id })
        .eq("id", offer.shift.id);

      if (shiftError) throw shiftError;

      toast.success("Shift swap approved!");
      fetchClaimedOffers();
    } catch (error) {
      console.error("Error approving shift:", error);
      toast.error("Failed to approve shift swap");
    }
  };

  const handleDeny = async (offerId: string) => {
    try {
      const { error } = await supabase
        .from("shift_offers")
        .update({ 
          status: "available",
          claimed_by_user_id: null 
        })
        .eq("id", offerId);

      if (error) throw error;

      toast.success("Shift claim denied");
      fetchClaimedOffers();
    } catch (error) {
      console.error("Error denying shift:", error);
      toast.error("Failed to deny shift claim");
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading shift pool...</div>;
  }

  if (claimedOffers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Shift Pool</CardTitle>
          <CardDescription>No pending shift claims to review</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shift Pool</CardTitle>
        <CardDescription>Review and approve shift claims</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {claimedOffers.map((offer) => (
          <Card key={offer.id}>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{offer.shift.template?.position}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(offer.shift.shift_date).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatTime(offer.shift.start_time)} - {formatTime(offer.shift.end_time)}
                    </p>
                  </div>
                  <Badge>Claimed</Badge>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={offer.offered_by.profile_photo_url} />
                      <AvatarFallback>
                        {getDisplayName(offer.offered_by.full_name, offer.offered_by.nickname)?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{getDisplayName(offer.offered_by.full_name, offer.offered_by.nickname)}</p>
                      <p className="text-muted-foreground text-xs">Offering</p>
                    </div>
                  </div>

                  <span className="text-muted-foreground">→</span>

                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={offer.claimed_by?.profile_photo_url} />
                      <AvatarFallback>
                        {getDisplayName(offer.claimed_by?.full_name, offer.claimed_by?.nickname)?.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{getDisplayName(offer.claimed_by?.full_name, offer.claimed_by?.nickname)}</p>
                      <p className="text-muted-foreground text-xs">Claiming</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(offer)}
                    className="flex-1"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDeny(offer.id)}
                    className="flex-1"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Deny
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}
