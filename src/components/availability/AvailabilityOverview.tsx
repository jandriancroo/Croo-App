import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfWeek, isBefore } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Check, X, Calendar, Clock } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";

const TZ = "America/Los_Angeles";
/** Format a date-only string (YYYY-MM-DD) in LA timezone — safe from off-by-one bugs */
const fmtDate = (dateStr: string, pattern: string): string => {
  return formatInTimeZone(new Date(`${dateStr}T12:00:00Z`), TZ, pattern);
};

interface AvailabilityRequest {
  id: string;
  user_id: string;
  request_type: string;
  time_scope: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  hours_requested: number;
  status: string;
  denial_reason: string | null;
  notes: string | null;
  created_at: string;
  profiles: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

export function AvailabilityOverview() {
  const { isAdmin } = useUserRole();
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [hidePastRequests, setHidePastRequests] = useState(true);

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from("availability_requests")
        .select(`
          *,
          profiles!availability_requests_user_id_fkey(full_name, profile_photo_url)
        `)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setRequests(data || []);
    } catch (error: any) {
      console.error("Error fetching requests:", error);
      toast.error("Failed to load requests");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("availability_requests")
        .update({
          status: "approved",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) throw error;
      toast.success("Request approved");
      fetchRequests();
    } catch (error: any) {
      console.error("Error approving request:", error);
      toast.error("Failed to approve request");
    } finally {
      setProcessing(false);
    }
  };

  const handleDeny = async () => {
    if (!selectedRequest) return;

    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("availability_requests")
        .update({
          status: "denied",
          denial_reason: denialReason || null,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", selectedRequest);

      if (error) throw error;
      toast.success("Request denied");
      setDenyDialogOpen(false);
      setDenialReason("");
      setSelectedRequest(null);
      fetchRequests();
    } catch (error: any) {
      console.error("Error denying request:", error);
      toast.error("Failed to deny request");
    } finally {
      setProcessing(false);
    }
  };

  const openDenyDialog = (requestId: string) => {
    setSelectedRequest(requestId);
    setDenyDialogOpen(true);
  };

  const formatDateRange = (request: AvailabilityRequest) => {
    if (request.time_scope === "multi_day" && request.end_date) {
      return `${fmtDate(request.start_date, "EEE, MMM d")} – ${fmtDate(request.end_date, "EEE, MMM d")}`;
    }
    return fmtDate(request.start_date, "EEE, MMM d");
  };

  const formatRequestedDate = (createdAt: string) => {
    return formatInTimeZone(new Date(createdAt), TZ, "MMM d");
  };

  // Filter past requests (before start of current week)
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const filteredRequests = hidePastRequests
    ? requests.filter((r) => {
        const requestDate = parseDateStringInTimezone(r.start_date, "America/Los_Angeles");
        return !isBefore(requestDate, currentWeekStart);
      })
    : requests;

  if (loading) {
    return <div className="text-center p-4">Loading requests...</div>;
  }

  return (
    <>
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <h2 className="text-xl font-semibold">Availability Requests</h2>
          <div className="flex items-center gap-2">
            <Checkbox
              id="hide-past"
              checked={hidePastRequests}
              onCheckedChange={(checked) => setHidePastRequests(checked === true)}
            />
            <label htmlFor="hide-past" className="text-sm cursor-pointer text-muted-foreground">
              Hide past requests
            </label>
          </div>
        </div>

        {filteredRequests.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {hidePastRequests ? "No upcoming requests" : "No availability requests yet"}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredRequests.map((request) => (
              <div
                key={request.id}
                className="flex border rounded-lg overflow-hidden hover:border-primary/30 transition-colors"
              >
                {/* Left: Requested date (subtle) */}
                <div className="w-24 shrink-0 bg-muted/30 p-3 flex flex-col items-center justify-center border-r text-center">
                  <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide font-medium">
                    Requested
                  </div>
                  <div className="text-sm font-medium mt-0.5">
                    {formatRequestedDate(request.created_at)}
                  </div>
                </div>

                {/* Right: Main content */}
                <div className="flex-1 p-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{request.profiles.full_name}</div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Calendar className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-semibold text-primary">
                          {formatDateRange(request)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{request.hours_requested} hours</span>
                        <span>•</span>
                        <span className="capitalize">{request.request_type}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        variant={request.request_type === "paid" ? "default" : "secondary"}
                        className="text-[10px] px-2"
                      >
                        {request.request_type}
                      </Badge>
                      <Badge
                        variant={
                          request.status === "approved"
                            ? "default"
                            : request.status === "denied"
                            ? "destructive"
                            : "outline"
                        }
                        className="text-[10px] px-2"
                      >
                        {request.status}
                      </Badge>
                    </div>
                  </div>

                  {request.notes && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{request.notes}</p>
                  )}

                  {request.denial_reason && (
                    <div className="text-xs p-2 bg-destructive/10 rounded mt-2">
                      <strong>Denied:</strong> {request.denial_reason}
                    </div>
                  )}

                  {isAdmin && request.status === "pending" && (
                    <div className="flex gap-2 mt-3 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleApprove(request.id)}
                        disabled={processing}
                        className="h-7 text-xs"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openDenyDialog(request.id)}
                        disabled={processing}
                        className="h-7 text-xs"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Deny
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={denyDialogOpen} onOpenChange={setDenyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason (Optional)</label>
              <Textarea
                placeholder="Provide a reason for denying this request..."
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeny} disabled={processing}>
              {processing ? "Denying..." : "Deny Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}