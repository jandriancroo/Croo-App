import { DateTime } from "luxon";
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { uniqueChannelName } from "@/lib/realtimeChannelName";
import { toast } from "sonner";
import { Clock, Calendar, User, Check, X, UserPlus, Undo2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { getDisplayName } from "@/utils/displayName";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShiftOfferConfirmDialog, AssignShiftDialog, type ConfirmTarget } from "@/components/schedule/ShiftMarketplaceDialogs";
import { approveShiftOffer, assignShiftOffer, denyShiftOfferClaim, undoShiftOffer, UNDO_MS } from "@/lib/shiftMarketplace";

interface OpenShiftCardProps {
  offerId: string;
  /** Feed list row: one line with a small Claim button; tap to open the full card. */
  compact?: boolean;
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

/** Open shift card in the feed's Shift Swaps bar: claim, take, assign, approve, deny, undo. */
export function OpenShiftCard({ offerId, compact = false }: OpenShiftCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [offer, setOffer] = useState<any>(null);
  const [claims, setClaims] = useState<ShiftClaim[]>([]);
  const [selectedClaimerId, setSelectedClaimerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>("You");
  const { role, isManager } = useUserRole();
  // Manager+ (manager, general manager, admins): approve, deny, assign; their own claim is instant.
  const isManagerPlus = isManager || (role as string | null) === "general_manager";
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [undoUntil, setUndoUntil] = useState<number>(0);

  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        const { data: p } = await supabase.from("profiles").select("full_name, nickname").eq("id", user.id).maybeSingle();
        if (p) setCurrentUserName(getDisplayName(p.full_name, p.nickname));
      }
    };
    getCurrentUser();
  }, []);

  useEffect(() => {
    fetchOffer();
    fetchClaims();

    const offerChannel = supabase
      .channel(uniqueChannelName(`shift-offer-${offerId}`))
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
      .channel(uniqueChannelName(`shift-claims-${offerId}`))
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

  // Tap Claim: always a confirm sheet first (the day as it will be). A manager's own Claim is a take-over (instant).
  const handleClaim = () => {
    if (!currentUserId || !offer) return;
    if (currentUserId === offer.offered_by.id && !isManagerPlus) {
      toast.error("You cannot claim your own shift");
      return;
    }
    if (claims.some((c) => c.user_id === currentUserId) && !isManagerPlus) {
      toast.error("You've already claimed this shift");
      return;
    }
    setConfirm({ verb: "Claim", person: { id: currentUserId, name: currentUserName }, takeOver: isManagerPlus });
  };

  // Team member claim: a pending claim the managers approve.
  const savePendingClaim = async (userId: string) => {
    const { error: claimError } = await supabase
      .from("shift_offer_claims")
      .insert({ shift_offer_id: offerId, user_id: userId });
    if (claimError) throw claimError;
    if (claims.length === 0) {
      const { error } = await supabase
        .from("shift_offers")
        .update({ claimed_by_user_id: userId, status: "claimed" })
        .eq("id", offerId);
      if (error) throw error;
    }
  };

  const offerUndo = (who: string) => {
    toast.success(`Shift given to ${who}`, {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => { void handleUndo(); } },
    });
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    setProcessing(true);
    try {
      if (confirm.verb === "Approve") {
        await approveShiftOffer(offerId, confirm.person.id);
        offerUndo(confirm.person.name.split(" ")[0]);
      } else if (confirm.verb === "Assign" || (confirm.verb === "Claim" && isManagerPlus)) {
        await assignShiftOffer(offerId, confirm.person.id);
        offerUndo(confirm.verb === "Claim" ? "you" : confirm.person.name.split(" ")[0]);
      } else {
        await savePendingClaim(confirm.person.id);
        toast.success("Shift claimed! Awaiting approval.");
      }
      setConfirm(null);
    } catch (error: any) {
      console.error("Shift marketplace action failed:", error);
      toast.error(error?.message || "Not saved");
    } finally {
      setProcessing(false);
    }
  };

  const handleUndo = async () => {
    setProcessing(true);
    try {
      await undoShiftOffer(offerId);
      toast.success("Undone. The shift is back with its owner.");
    } catch (error: any) {
      toast.error(error?.message || "Undo failed");
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

  const d = DateTime.fromFormat(offer.shift.shift_date, 'yyyy-MM-dd');
  const status =
    offer.status === 'approved' ? { t: `Covered${offer.claimed_by ? ` by ${getDisplayName(offer.claimed_by.full_name, offer.claimed_by.nickname)}` : ''}`, c: 'bg-success/15 text-success' }
    : offer.status === 'claimed' ? { t: `${claims.length || 1} wants it · needs approval`, c: 'bg-accent/15 text-accent' }
    : null;
  const isMine = currentUserId === offer.offered_by?.id;
  const open = offer.status === 'available' || offer.status === 'claimed';
  const alreadyClaimed = claims.some((c) => c.user_id === currentUserId);
  const canClaim = open && (isManagerPlus || (!isMine && !alreadyClaimed));
  const canAssign = open && isManagerPlus;

  // Slim row: date, time, role, who posted, existing status text, then Claim (everyone) and Assign (manager+).
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">
          {d.toFormat('ccc, LLL d')} · {formatTime(offer.shift.start_time)}–{formatTime(offer.shift.end_time)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {offer.shift.template?.position || 'Shift'} · {getDisplayName(offer.offered_by.full_name, offer.offered_by.nickname)}
        </div>
        {status && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.c}`}>{status.t}</span>}
      </div>
      {canClaim && (
        <Button size="xs" className="shrink-0 rounded-full px-4" onClick={handleClaim} disabled={processing}>Claim</Button>
      )}
      {canAssign && (
        <Button size="xs" variant="outline" className="shrink-0 rounded-full px-3" onClick={() => setAssignOpen(true)} disabled={processing}>Assign</Button>
      )}
      <ShiftOfferConfirmDialog
        shiftId={offer.shift.id}
        ownerName={getDisplayName(offer.offered_by.full_name, offer.offered_by.nickname)}
        target={confirm}
        busy={processing}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
      />
      {isManagerPlus && (
        <AssignShiftDialog
          open={assignOpen}
          shiftId={offer.shift.id}
          claimerIds={claims.map((c) => c.user_id)}
          onClose={() => setAssignOpen(false)}
          onPick={(p, info) => {
            setAssignOpen(false);
            // Picking someone who claimed approves their claim; anyone else is a direct assign.
            setConfirm({ verb: info.claimed ? "Approve" : "Assign", person: p, flags: info.flags });
          }}
        />
      )}
    </div>
  );
}
