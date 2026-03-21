import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format, startOfWeek, endOfWeek, isBefore, isThisWeek, addWeeks, isSameWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import {
  formatDateTimeInTimezone,
  parseDateStringInTimezone,
} from "@/utils/timezoneUtils";

const TZ = "America/Los_Angeles";

/** Format a date-only string (YYYY-MM-DD) in LA timezone — safe from off-by-one bugs */
const fmtDate = (dateStr: string, pattern: string): string => {
  // Use noon UTC to guarantee the date lands on the correct calendar day in any timezone
  return formatInTimeZone(new Date(`${dateStr}T12:00:00Z`), TZ, pattern);
};

export interface AvailabilityRequest {
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

export function useAvailabilityData() {
  const { user } = useAuth();
  const { canApproveRequests, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { canViewSickTime } = useRolePermissions();

  const [requests, setRequests] = useState<AvailabilityRequest[]>([]);
  const [myPtoBalance, setMyPtoBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [hidePastRequests, setHidePastRequests] = useState(true);

  // Dialog state
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [denialReason, setDenialReason] = useState("");
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

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

  const DEFAULT_PTO_HOURS = 40;

  useEffect(() => {
    if (currentLocation) {
      fetchData();
    }
  }, [user, canApproveRequests, currentLocation]);

  // Handle quick status changes from dropdown
  useEffect(() => {
    if (selectedRequest && editStatus && !editDialogOpen) {
      const applyQuickStatusChange = async () => {
        setProcessing(true);
        try {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (!authUser) throw new Error("Not authenticated");

          const { error } = await supabase
            .from("availability_requests")
            .update({
              status: editStatus,
              reviewed_by: authUser.id,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", selectedRequest);

          if (error) throw error;
          toast.success(`Request ${editStatus}`);
          fetchData();
        } catch (error: any) {
          console.error("Error updating status:", error);
          toast.error("Failed to update status");
        } finally {
          setProcessing(false);
          setSelectedRequest(null);
          setEditStatus("");
        }
      };
      applyQuickStatusChange();
    }
  }, [selectedRequest, editStatus, editDialogOpen]);

  const fetchData = async () => {
    if (!user || !currentLocation) return;

    try {
      setLoading(true);

      if (canApproveRequests) {
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

  // Formatting helpers
  const formatTimeScope = (request: AvailabilityRequest) => {
    if (request.time_scope === "partial_day") {
      const dateStr = fmtDate(request.start_date, "MMM d, yyyy");
      const timeRange = `${format(new Date(`2000-01-01T${request.start_time}`), "h:mm a")} - ${format(new Date(`2000-01-01T${request.end_time}`), "h:mm a")}`;
      return `${dateStr} • ${timeRange}`;
    } else if (request.time_scope === "multi_day") {
      const start = request.start_date;
      const end = request.end_date;
      if (!end) return fmtDate(start, "MMM d, yyyy");
      const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
      return `${fmtDate(rangeStart, "MMM d")} - ${fmtDate(rangeEnd, "MMM d, yyyy")}`;
    } else {
      return fmtDate(request.start_date, "MMM d, yyyy");
    }
  };

  const formatDayOfWeek = (request: AvailabilityRequest) => {
    if (request.time_scope === "multi_day") {
      const start = request.start_date;
      const end = request.end_date;
      if (!end) return fmtDate(start, "EEE");
      const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
      return `${fmtDate(rangeStart, "EEE")} - ${fmtDate(rangeEnd, "EEE")}`;
    }
    return fmtDate(request.start_date, "EEEE");
  };

  const formatRequestedDate = (createdAt: string) => {
    return formatDateTimeInTimezone(createdAt, "America/Los_Angeles", {
      month: "short",
      day: "numeric",
    });
  };

  // Filtering & grouping
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });

  const filteredRequests = requests.filter((request) => {
    if (hidePastRequests) {
      const requestDate = parseDateStringInTimezone(request.start_date, "America/Los_Angeles");
      if (isBefore(requestDate, currentWeekStart)) return false;
    }
    if (filterStatus !== "all" && request.status !== filterStatus) return false;
    if (filterType !== "all" && request.request_type !== filterType) return false;
    return true;
  });

  const getWeekKey = (dateStr: string) => {
    const date = parseDateStringInTimezone(dateStr, "America/Los_Angeles");
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    return format(weekStart, "yyyy-MM-dd");
  };

  const getWeekLabel = (weekKeyStr: string): string => {
    const weekStart = parseDateStringInTimezone(weekKeyStr, TZ);
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const now = new Date();
    const startLabel = fmtDate(weekKeyStr, "MMM d");
    const endLabel = formatInTimeZone(weekEnd, TZ, "MMM d, yyyy");
    const dateRange = `${startLabel} – ${endLabel}`;
    if (isThisWeek(weekStart, { weekStartsOn: 1 })) return `This Week (${dateRange})`;
    if (isSameWeek(weekStart, addWeeks(now, 1), { weekStartsOn: 1 })) return `Next Week (${dateRange})`;
    if (isSameWeek(weekStart, addWeeks(now, -1), { weekStartsOn: 1 })) return `Last Week (${dateRange})`;
    return dateRange;
  };

  const sortedRequests = [...filteredRequests].sort((a, b) =>
    a.start_date.localeCompare(b.start_date)
  );

  const groupedByWeek = sortedRequests.reduce((acc, request) => {
    const weekKey = getWeekKey(request.start_date);
    if (!acc[weekKey]) acc[weekKey] = [];
    acc[weekKey].push(request);
    return acc;
  }, {} as Record<string, AvailabilityRequest[]>);

  const sortedWeekKeys = Object.keys(groupedByWeek).sort();

  return {
    user,
    canApproveRequests,
    canViewSickTime,
    roleLoading,
    loading,
    processing,
    myPtoBalance,
    // Filters
    filterStatus, setFilterStatus,
    filterType, setFilterType,
    hidePastRequests, setHidePastRequests,
    // Request dialog
    requestDialogOpen, setRequestDialogOpen,
    // Deny dialog
    denyDialogOpen, setDenyDialogOpen,
    selectedRequest, setSelectedRequest,
    denialReason, setDenialReason,
    handleDeny,
    // Edit dialog
    editDialogOpen, setEditDialogOpen,
    editingRequest,
    editRequestType, setEditRequestType,
    editTimeScope, setEditTimeScope,
    editStartDate, setEditStartDate,
    editEndDate, setEditEndDate,
    editStartTime, setEditStartTime,
    editEndTime, setEditEndTime,
    editHours, setEditHours,
    editStatus, setEditStatus,
    editNotes, setEditNotes,
    openEditDialog,
    handleEditRequest,
    // Delete dialog
    deleteDialogOpen, setDeleteDialogOpen,
    openDeleteDialog,
    handleDeleteRequest,
    // Employee edit dialog
    employeeEditDialogOpen, setEmployeeEditDialogOpen,
    employeeEditNotes, setEmployeeEditNotes,
    openEmployeeEditDialog,
    handleEmployeeEditRequest,
    // Data
    filteredRequests,
    groupedByWeek,
    sortedWeekKeys,
    // Formatters
    formatTimeScope,
    formatDayOfWeek,
    formatRequestedDate,
    getWeekLabel,
    // Refetch
    fetchData,
  };
}
