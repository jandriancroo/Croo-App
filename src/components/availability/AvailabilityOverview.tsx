import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Calendar, Clock } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";

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

  const formatTimeScope = (request: AvailabilityRequest) => {
    if (request.time_scope === "partial_day") {
      return `${format(new Date(`2000-01-01T${request.start_time}`), "h:mm a")} - ${format(new Date(`2000-01-01T${request.end_time}`), "h:mm a")}`;
    } else if (request.time_scope === "multi_day") {
      const start = request.start_date;
      const end = request.end_date;
      if (!end) return format(parseDateStringInTimezone(start, "America/Los_Angeles"), "MMM d, yyyy");

      // Display dates as stored - don't reorder
      return `${format(parseDateStringInTimezone(start, "America/Los_Angeles"), "MMM d")} - ${format(parseDateStringInTimezone(end, "America/Los_Angeles"), "MMM d, yyyy")}`;
    } else {
      return format(parseDateStringInTimezone(request.start_date, "America/Los_Angeles"), "MMM d, yyyy");
    }
  };

  if (loading) {
    return <div className="text-center p-4">Loading requests...</div>;
  }

  return (
    <>
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Recent Availability Requests</h2>
        </div>

        {requests.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No availability requests yet</p>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <div
                key={request.id}
                className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="font-medium">{request.profiles.full_name}</div>
                      <Badge variant={request.request_type === "paid" ? "default" : "secondary"}>
                        {request.request_type === "paid" ? "Paid" : "Unpaid"}
                      </Badge>
                      <Badge
                        variant={
                          request.status === "approved"
                            ? "default"
                            : request.status === "denied"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatTimeScope(request)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {request.hours_requested} hours
                      </div>
                    </div>

                    {request.notes && (
                      <p className="text-sm text-muted-foreground">{request.notes}</p>
                    )}

                    {request.denial_reason && (
                      <div className="text-sm p-2 bg-destructive/10 rounded">
                        <strong>Denial Reason:</strong> {request.denial_reason}
                      </div>
                    )}
                  </div>

                  {isAdmin && request.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleApprove(request.id)}
                        disabled={processing}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openDenyDialog(request.id)}
                        disabled={processing}
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