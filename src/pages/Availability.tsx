import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Calendar, Clock, Plus } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { RequestAvailabilityDialog } from "@/components/availability/RequestAvailabilityDialog";

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

interface EmployeeHours {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  paid_hours: number;
  unpaid_hours: number;
}

export default function Availability() {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  const [employeeHours, setEmployeeHours] = useState<EmployeeHours[]>([]);
  const [loading, setLoading] = useState(true);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch all requests
      const { data: requestsData, error: requestsError } = await supabase
        .from("availability_requests")
        .select(`
          *,
          profiles!availability_requests_user_id_fkey(full_name, profile_photo_url)
        `)
        .order("created_at", { ascending: false });

      if (requestsError) throw requestsError;
      setRequests(requestsData || []);

      // Fetch employee hours
      if (isAdmin) {
        const currentYear = new Date().getFullYear();
        
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name, profile_photo_url")
          .eq("is_active", true);

        if (profilesError) throw profilesError;

        const { data: availabilityData, error: availabilityError } = await supabase
          .from("availability_requests")
          .select("user_id, request_type, hours_requested, status")
          .eq("status", "approved")
          .gte("start_date", `${currentYear}-01-01`)
          .lte("start_date", `${currentYear}-12-31`);

        if (availabilityError) throw availabilityError;

        const hoursByUser = (availabilityData || []).reduce((acc: any, req: any) => {
          if (!acc[req.user_id]) {
            acc[req.user_id] = { paid: 0, unpaid: 0 };
          }
          if (req.request_type === "paid") {
            acc[req.user_id].paid += req.hours_requested;
          } else {
            acc[req.user_id].unpaid += req.hours_requested;
          }
          return acc;
        }, {});

        const employeeHoursData = (profiles || []).map((profile) => ({
          id: profile.id,
          full_name: profile.full_name || "",
          profile_photo_url: profile.profile_photo_url,
          paid_hours: hoursByUser[profile.id]?.paid || 0,
          unpaid_hours: hoursByUser[profile.id]?.unpaid || 0,
        }));

        setEmployeeHours(employeeHoursData);
      }
    } catch (error: any) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load availability data");
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
      fetchData();
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
      fetchData();
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
      return `${format(new Date(request.start_date), "MMM d")} - ${format(new Date(request.end_date!), "MMM d, yyyy")}`;
    } else {
      return format(new Date(request.start_date), "MMM d, yyyy");
    }
  };

  const filteredRequests = requests.filter((request) => {
    if (filterStatus !== "all" && request.status !== filterStatus) return false;
    if (filterType !== "all" && request.request_type !== filterType) return false;
    return true;
  });

  if (roleLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading availability...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Availability Requests</h1>
            <p className="text-muted-foreground">Manage time off requests and employee accruals</p>
          </div>
          <Button onClick={() => setRequestDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Request Time Off
          </Button>
        </div>

        {/* Employee Accruals - Admin Only */}
        {isAdmin && (
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Employee Accruals (Year to Date)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {employeeHours.map((employee) => (
                <div
                  key={employee.id}
                  className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={employee.profile_photo_url || undefined} />
                    <AvatarFallback>{employee.full_name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="font-medium">{employee.full_name}</div>
                    <div className="flex gap-3 text-sm mt-1">
                      <div className="flex items-center gap-1">
                        <Badge variant="default" className="text-xs">Paid</Badge>
                        <span className="text-muted-foreground">{employee.paid_hours}h</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs">Unpaid</Badge>
                        <span className="text-muted-foreground">{employee.unpaid_hours}h</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Filters */}
        <Card className="p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Requests List */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">All Requests ({filteredRequests.length})</h2>

          {filteredRequests.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No requests found</p>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map((request) => (
                <div
                  key={request.id}
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={request.profiles.profile_photo_url || undefined} />
                        <AvatarFallback>{request.profiles.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="font-medium">{request.profiles.full_name}</div>
                          <Badge variant={request.request_type === "paid" ? "default" : "secondary"}>
                            {request.request_type === "paid" ? "Paid Sick Leave" : "Unpaid Time Off"}
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

                        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
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
                          <p className="text-sm text-muted-foreground italic">{request.notes}</p>
                        )}

                        {request.denial_reason && (
                          <div className="text-sm p-2 bg-destructive/10 rounded">
                            <strong>Denial Reason:</strong> {request.denial_reason}
                          </div>
                        )}
                      </div>
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

        {/* Denial Dialog */}
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

        <RequestAvailabilityDialog
          open={requestDialogOpen}
          onOpenChange={setRequestDialogOpen}
          onSuccess={fetchData}
        />
      </div>
    </Layout>
  );
}
