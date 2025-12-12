import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Check, X, Calendar, Clock, Plus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { RequestAvailabilityDialog } from "@/components/availability/RequestAvailabilityDialog";
import { ShiftPoolSection } from "@/components/availability/ShiftPoolSection";
import { useLocation as useAppLocation } from "@/hooks/useLocation";

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
  edited_by: string | null;
  edited_at: string | null;
  profiles: {
    full_name: string;
    profile_photo_url: string | null;
  };
  editor?: {
    full_name: string;
  } | null;
}

interface EmployeeHours {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  paid_hours: number;
  unpaid_hours: number;
}

export default function Availability() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  const [employeeHours, setEmployeeHours] = useState<EmployeeHours[]>([]);
  const [myPtoBalance, setMyPtoBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [timeOffSort, setTimeOffSort] = useState<string>("lastName");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<AvailabilityRequest | null>(null);
  const [editHours, setEditHours] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null);

  // Default PTO balance (can be configured per company/location later)
  const DEFAULT_PTO_HOURS = 40;

  useEffect(() => {
    if (currentLocation) {
      fetchData();
    }
  }, [user, isAdmin, currentLocation]);

  const fetchData = async () => {
    if (!user || !currentLocation) return;
    
    try {
      setLoading(true);

      if (isAdmin) {
        // Admin view - fetch all requests for current location with editor info
        const { data: requestsData, error: requestsError } = await supabase
          .from("availability_requests")
          .select(`
            *,
            profiles!availability_requests_user_id_fkey(full_name, profile_photo_url),
            editor:profiles!availability_requests_edited_by_fkey(full_name)
          `)
          .eq("location_id", currentLocation.id)
          .order("created_at", { ascending: false });

        if (requestsError) throw requestsError;
        setRequests(requestsData || []);

        // Fetch employee hours for admin - filter by location
        const currentYear = new Date().getFullYear();
        
        // Get profiles for users at this location
        const { data: userLocations, error: userLocError } = await supabase
          .from("user_locations")
          .select("user_id")
          .eq("location_id", currentLocation.id);
        
        if (userLocError) throw userLocError;
        
        const locationUserIds = (userLocations || []).map(ul => ul.user_id);
        
        if (locationUserIds.length > 0) {
          const { data: profiles, error: profilesError } = await supabase
            .from("profiles")
            .select("id, full_name, profile_photo_url")
            .eq("is_active", true)
            .in("id", locationUserIds);

          if (profilesError) throw profilesError;

          const { data: availabilityData, error: availabilityError } = await supabase
            .from("availability_requests")
            .select("user_id, request_type, hours_requested, status")
            .eq("status", "approved")
            .eq("location_id", currentLocation.id)
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
        } else {
          setEmployeeHours([]);
        }
      } else {
        // Non-admin view - fetch only user's own requests for current location
        const { data: requestsData, error: requestsError } = await supabase
          .from("availability_requests")
          .select(`
            *,
            profiles!availability_requests_user_id_fkey(full_name, profile_photo_url)
          `)
          .eq("user_id", user.id)
          .eq("location_id", currentLocation.id)
          .order("created_at", { ascending: false });

        if (requestsError) throw requestsError;
        setRequests(requestsData || []);

        // Calculate user's remaining PTO balance
        const currentYear = new Date().getFullYear();
        const { data: ptoData } = await supabase
          .from("availability_requests")
          .select("hours_requested")
          .eq("user_id", user.id)
          .eq("request_type", "paid")
          .eq("status", "approved")
          .gte("start_date", `${currentYear}-01-01`)
          .lte("start_date", `${currentYear}-12-31`);

        const usedPto = (ptoData || []).reduce((sum, req) => sum + (req.hours_requested || 0), 0);
        setMyPtoBalance(DEFAULT_PTO_HOURS - usedPto);
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

  const openEditDialog = (request: AvailabilityRequest) => {
    setEditingRequest(request);
    setEditHours(request.hours_requested.toString());
    setEditStatus(request.status);
    setEditNotes(request.notes || "");
    setEditDialogOpen(true);
  };

  const handleEditRequest = async () => {
    if (!editingRequest) return;

    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("availability_requests")
        .update({
          hours_requested: parseFloat(editHours),
          status: editStatus,
          notes: editNotes || null,
          edited_by: user.id,
          edited_at: new Date().toISOString(),
        })
        .eq("id", editingRequest.id);

      if (error) throw error;
      toast.success("Request updated");
      setEditDialogOpen(false);
      setEditingRequest(null);
      fetchData();
    } catch (error: any) {
      console.error("Error updating request:", error);
      toast.error("Failed to update request");
    } finally {
      setProcessing(false);
    }
  };

  const openDeleteDialog = (requestId: string) => {
    setDeletingRequestId(requestId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteRequest = async () => {
    if (!deletingRequestId) return;

    setProcessing(true);
    try {
      const { error } = await supabase
        .from("availability_requests")
        .delete()
        .eq("id", deletingRequestId);

      if (error) throw error;
      toast.success("Request deleted");
      setDeleteDialogOpen(false);
      setDeletingRequestId(null);
      fetchData();
    } catch (error: any) {
      console.error("Error deleting request:", error);
      toast.error("Failed to delete request");
    } finally {
      setProcessing(false);
    }
  };

  const formatTimeScope = (request: AvailabilityRequest) => {
    if (request.time_scope === "partial_day") {
      const dateStr = format(parseISO(request.start_date), "MMM d, yyyy");
      const timeRange = `${format(new Date(`2000-01-01T${request.start_time}`), "h:mm a")} - ${format(new Date(`2000-01-01T${request.end_time}`), "h:mm a")}`;
      return `${dateStr} • ${timeRange}`;
    } else if (request.time_scope === "multi_day") {
      return `${format(parseISO(request.start_date), "MMM d")} - ${format(parseISO(request.end_date!), "MMM d, yyyy")}`;
    } else {
      return format(parseISO(request.start_date), "MMM d, yyyy");
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
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">Availability</h1>
          </div>
          <Button onClick={() => setRequestDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Request Time Off
          </Button>
        </div>

        {/* PTO Balance - Non-Admin Only */}
        {!isAdmin && (
          <Card className="p-6 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Paid Time Off Balance</p>
                <p className="text-3xl font-bold">{myPtoBalance} hours</p>
              </div>
            </div>
          </Card>
        )}

        {/* Shift Pool - Admin Only */}
        {isAdmin && <ShiftPoolSection />}

        {/* Time Off Used - Admin Only */}
        {isAdmin && employeeHours.length > 0 && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Time Off Used (Year to Date)</h2>
              <Select value={timeOffSort} onValueChange={setTimeOffSort}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lastName">Last Name</SelectItem>
                  <SelectItem value="firstName">First Name</SelectItem>
                  <SelectItem value="mostUsed">Most Used</SelectItem>
                  <SelectItem value="leastUsed">Least Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              {[...employeeHours]
                .sort((a, b) => {
                  if (timeOffSort === "lastName") {
                    const aLast = a.full_name.split(" ").slice(-1)[0] || "";
                    const bLast = b.full_name.split(" ").slice(-1)[0] || "";
                    return aLast.localeCompare(bLast);
                  } else if (timeOffSort === "firstName") {
                    const aFirst = a.full_name.split(" ")[0] || "";
                    const bFirst = b.full_name.split(" ")[0] || "";
                    return aFirst.localeCompare(bFirst);
                  } else if (timeOffSort === "mostUsed") {
                    return (b.paid_hours + b.unpaid_hours) - (a.paid_hours + a.unpaid_hours);
                  } else {
                    return (a.paid_hours + a.unpaid_hours) - (b.paid_hours + b.unpaid_hours);
                  }
                })
                .map((employee) => (
                  <div
                    key={employee.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 border rounded-lg text-sm"
                  >
                    <span className="font-medium truncate">{employee.full_name}</span>
                    <div className="flex gap-2 flex-shrink-0 text-xs">
                      <span className="text-primary font-medium">{employee.paid_hours}h</span>
                      <span className="text-muted-foreground">{employee.unpaid_hours}h</span>
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
          <h2 className="text-xl font-semibold mb-4">
            {isAdmin ? "All Requests" : "My Requests"} ({filteredRequests.length})
          </h2>

          {filteredRequests.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No requests found</p>
          ) : (
            <div className="space-y-2">
              {filteredRequests.map((request) => (
                <div
                  key={request.id}
                  className="px-3 py-2 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-medium text-sm truncate">{request.profiles.full_name}</span>
                      <Badge variant={request.request_type === "paid" ? "default" : "secondary"} className="text-xs flex-shrink-0">
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
                        className="text-xs flex-shrink-0"
                      >
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatTimeScope(request)} • {request.hours_requested}h
                      </span>
                    </div>

                    {/* Show editor info if edited */}
                    {request.edited_by && request.editor && (
                      <span className="text-xs text-muted-foreground italic flex-shrink-0">
                        edited by {request.editor.full_name?.split(" ")[0]}
                      </span>
                    )}

                    {isAdmin && request.status === "pending" && (
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 px-2"
                          onClick={() => handleApprove(request.id)}
                          disabled={processing}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-2"
                          onClick={() => openDenyDialog(request.id)}
                          disabled={processing}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}

                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(request)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => openDeleteDialog(request.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Hours Requested</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={editHours}
                  onChange={(e) => setEditHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="denied">Denied</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Add notes..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditRequest} disabled={processing}>
                {processing ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Request</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this time-off request? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteRequest}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {processing ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <RequestAvailabilityDialog
          open={requestDialogOpen}
          onOpenChange={setRequestDialogOpen}
          onSuccess={fetchData}
        />
      </div>
    </Layout>
  );
}
