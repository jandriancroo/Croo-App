import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { format, startOfWeek, isBefore } from "date-fns";
import { Check, X, Clock, Plus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { RequestAvailabilityDialog } from "@/components/availability/RequestAvailabilityDialog";
import { ShiftPoolSection } from "@/components/availability/ShiftPoolSection";
import { SchedulingPreferencesSection } from "@/components/availability/SchedulingPreferencesSection";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  formatDateTimeInTimezone,
  parseDateStringInTimezone,
} from "@/utils/timezoneUtils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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


export default function Availability() {
  const { user } = useAuth();
  const { canApproveRequests, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { canViewSickTime } = useRolePermissions();
  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  
  const [myPtoBalance, setMyPtoBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<AvailabilityRequest | null>(null);
  const [editRequestType, setEditRequestType] = useState<"paid" | "unpaid">("unpaid");
  const [editTimeScope, setEditTimeScope] = useState<"multi_day" | "full_day" | "partial_day">("full_day");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("17:00");
  const [editHours, setEditHours] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null);
  const [employeeEditDialogOpen, setEmployeeEditDialogOpen] = useState(false);
  const [employeeEditingRequest, setEmployeeEditingRequest] = useState<AvailabilityRequest | null>(null);
  const [employeeEditNotes, setEmployeeEditNotes] = useState("");
  const [hidePastRequests, setHidePastRequests] = useState(true);
  // Default PTO balance (can be configured per company/location later)
  const DEFAULT_PTO_HOURS = 40;

  useEffect(() => {
    if (currentLocation) {
      fetchData();
    }
  }, [user, canApproveRequests, currentLocation]);

  const fetchData = async () => {
    if (!user || !currentLocation) return;
    
    try {
      setLoading(true);

      if (canApproveRequests) {
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
    setEditRequestType((request.request_type as any) || "unpaid");
    setEditTimeScope((request.time_scope as any) || "full_day");
    setEditStartDate(request.start_date);
    setEditEndDate(request.end_date || "");
    setEditStartTime(request.start_time || "09:00");
    setEditEndTime(request.end_time || "17:00");
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

      const payload: any = {
        request_type: editRequestType,
        time_scope: editTimeScope,
        start_date: editStartDate,
        end_date: editTimeScope === "multi_day" ? (editEndDate || null) : null,
        start_time: editTimeScope === "partial_day" ? (editStartTime || null) : null,
        end_time: editTimeScope === "partial_day" ? (editEndTime || null) : null,
        hours_requested: parseFloat(editHours),
        status: editStatus,
        notes: editNotes || null,
        edited_by: user.id,
        edited_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("availability_requests")
        .update(payload)
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

  const openEmployeeEditDialog = (request: AvailabilityRequest) => {
    setEmployeeEditingRequest(request);
    setEmployeeEditNotes(request.notes || "");
    setEmployeeEditDialogOpen(true);
  };

  const handleEmployeeEditRequest = async () => {
    if (!employeeEditingRequest) return;

    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Employee edit resets status to pending for re-approval
      const { error } = await supabase
        .from("availability_requests")
        .update({
          notes: employeeEditNotes || null,
          status: "pending",
          edited_by: user.id,
          edited_at: new Date().toISOString(),
          reviewed_by: null,
          reviewed_at: null,
        })
        .eq("id", employeeEditingRequest.id);

      if (error) throw error;
      toast.success("Request updated and resubmitted for approval");
      setEmployeeEditDialogOpen(false);
      setEmployeeEditingRequest(null);
      fetchData();
    } catch (error: any) {
      console.error("Error updating request:", error);
      toast.error("Failed to update request");
    } finally {
      setProcessing(false);
    }
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
      const dateStr = format(parseDateStringInTimezone(request.start_date, "America/Los_Angeles"), "MMM d, yyyy");
      const timeRange = `${format(new Date(`2000-01-01T${request.start_time}`), "h:mm a")} - ${format(new Date(`2000-01-01T${request.end_time}`), "h:mm a")}`;
      return `${dateStr} • ${timeRange}`;
    } else if (request.time_scope === "multi_day") {
      const start = request.start_date;
      const end = request.end_date;
      if (!end) return format(parseDateStringInTimezone(start, "America/Los_Angeles"), "MMM d, yyyy");

      const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
      return `${format(parseDateStringInTimezone(rangeStart, "America/Los_Angeles"), "MMM d")} - ${format(parseDateStringInTimezone(rangeEnd, "America/Los_Angeles"), "MMM d, yyyy")}`;
    } else {
      return format(parseDateStringInTimezone(request.start_date, "America/Los_Angeles"), "MMM d, yyyy");
    }
  };

  // Filter past requests (before start of current week)
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  
  const filteredRequests = requests.filter((request) => {
    // Hide past filter
    if (hidePastRequests) {
      const requestDate = parseDateStringInTimezone(request.start_date, "America/Los_Angeles");
      if (isBefore(requestDate, currentWeekStart)) return false;
    }
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
      <div className="space-y-4">
        <div>
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold">Availability</h1>
            </div>
            <Button onClick={() => setRequestDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Request Time Off
            </Button>
          </div>
          <PageHeaderDivider />
        </div>
        {!canApproveRequests && canViewSickTime && (
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

        {/* Shift Pool - Manager Only */}
        {canApproveRequests && <ShiftPoolSection />}

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hide-past-main"
                checked={hidePastRequests}
                onCheckedChange={(checked) => setHidePastRequests(checked === true)}
              />
              <label htmlFor="hide-past-main" className="text-sm cursor-pointer text-muted-foreground whitespace-nowrap">
                Hide past
              </label>
            </div>
            <div className="flex-1 min-w-[120px]">
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
            <div className="flex-1 min-w-[120px]">
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
        <Card className="p-4 md:p-6">
          <h2 className="text-xl font-semibold mb-4">
            {canApproveRequests ? "All Requests" : "My Requests"} ({filteredRequests.length})
          </h2>

          {filteredRequests.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No requests found</p>
          ) : (
            <div className="space-y-3">
                {filteredRequests.map((request) => {
                  const statusVariant =
                    request.status === "approved"
                      ? "default"
                      : request.status === "denied"
                      ? "destructive"
                      : "outline";

                  const StatusBadge = (
                    <Badge variant={statusVariant as any} className="text-xs">
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </Badge>
                  );

                  return (
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
                          {formatDateTimeInTimezone(request.created_at, "America/Los_Angeles", {
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                      </div>

                      {/* Right: Main content */}
                      <div className="flex-1 p-3 min-w-0">
                        {/* Mobile: stacked, Tablet+: horizontal row */}
                        <div className="flex items-center justify-between gap-2">
                          {/* Mobile: stacked layout */}
                          <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-center md:gap-4">
                            <div className="font-medium truncate md:w-48 lg:w-56 md:shrink-0">
                              {canApproveRequests ? request.profiles.full_name : "You"}
                            </div>
                            <div className="font-semibold text-primary mt-1 md:mt-0 md:w-56 lg:w-72 md:shrink-0">
                              {formatTimeScope(request)}
                            </div>
                            <div className="flex items-center gap-3 mt-1 md:mt-0 text-sm text-muted-foreground md:flex-1 md:justify-end">
                              <span className="font-medium">{request.hours_requested}h</span>
                              <Badge
                                variant={request.request_type === "paid" ? "default" : "secondary"}
                                className="text-xs px-2 py-0.5"
                              >
                                {request.request_type === "paid" ? "Paid" : "Unpaid"}
                              </Badge>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                          {canApproveRequests ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 px-2">
                                  {StatusBadge}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => {
                                  setSelectedRequest(request.id);
                                  setEditStatus("pending");
                                }}>
                                  Pending
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  setSelectedRequest(request.id);
                                  setEditStatus("approved");
                                }}>
                                  Approved
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  setSelectedRequest(request.id);
                                  setEditStatus("denied");
                                }}>
                                  Denied
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            StatusBadge
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canApproveRequests && request.status === "pending" && (
                                <>
                                  <DropdownMenuItem onClick={() => handleApprove(request.id)}>
                                    <Check className="h-4 w-4 mr-2" />
                                    Approve
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openDenyDialog(request.id)}>
                                    <X className="h-4 w-4 mr-2" />
                                    Deny
                                  </DropdownMenuItem>
                                </>
                              )}
                              {canApproveRequests && (
                                <DropdownMenuItem onClick={() => openEditDialog(request)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                              {!canApproveRequests &&
                                request.user_id === user?.id &&
                                request.status === "pending" && (
                                  <DropdownMenuItem onClick={() => openEmployeeEditDialog(request)}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                )}
                              {(canApproveRequests ||
                                (!canApproveRequests &&
                                  request.user_id === user?.id &&
                                  request.status === "pending")) && (
                                <DropdownMenuItem
                                  onClick={() => openDeleteDialog(request.id)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>

        {/* Scheduling Preferences - Manager Only */}
        {canApproveRequests && <SchedulingPreferencesSection />}

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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Request Type</Label>
                  <Select value={editRequestType} onValueChange={(v) => setEditRequestType(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Time Period</Label>
                  <Select value={editTimeScope} onValueChange={(v) => setEditTimeScope(v as any)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_day">Full Day</SelectItem>
                      <SelectItem value="partial_day">Partial Day</SelectItem>
                      <SelectItem value="multi_day">Multiple Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
                </div>

                {editTimeScope === "multi_day" && (
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
                  </div>
                )}

                {editTimeScope === "partial_day" && (
                  <>
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        {/* Employee Edit Dialog */}
        <Dialog open={employeeEditDialogOpen} onOpenChange={setEmployeeEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Editing your request will reset it to pending status and require manager approval again.
              </p>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Add notes..."
                  value={employeeEditNotes}
                  onChange={(e) => setEmployeeEditNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEmployeeEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEmployeeEditRequest} disabled={processing}>
                {processing ? "Saving..." : "Update & Resubmit"}
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
