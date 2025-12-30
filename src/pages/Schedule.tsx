import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { Plus, Settings, Calendar, MoreVertical, Copy, Trash2, Wrench, ChevronDown, AlertTriangle, Sparkles } from "lucide-react";
import { DateNavigator } from "@/components/ui/date-navigator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays } from "date-fns";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { ShiftCard } from "@/components/schedule/ShiftCard";
import { EventRow } from "@/components/schedule/EventRow";
import { EmployeeRow } from "@/components/schedule/EmployeeRow";
import { EditShiftDialog } from "@/components/schedule/EditShiftDialog";
import { ConflictWarningDialog } from "@/components/schedule/ConflictWarningDialog";
import { MobileScheduleView } from "@/components/schedule/MobileScheduleView";
import { MobileShiftDialog } from "@/components/schedule/MobileShiftDialog";
import { LaborTotals } from "@/components/schedule/LaborTotals";
import { LiveStatusBadge } from "@/components/schedule/LiveStatusBadge";
import { DayBreakdownDialog } from "@/components/schedule/DayBreakdownDialog";
import { PortraitOnlyMessage } from "@/components/schedule/PortraitOnlyMessage";
import { AutoScheduleWizard } from "@/components/schedule/AutoScheduleWizard";

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  role?: string;
  hourly_wage?: number;
  display_order?: number;
}

interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
}

interface ScheduledShift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_time_off: boolean;
  template_id: string | null;
  shift_date: string;
}

interface ScheduleEvent {
  id: string;
  event_name: string;
  event_time: string;
  day_of_week: number;
  days_of_week?: number[] | null;
  notes: string | null;
  tagged_roles: string[] | null;
  is_recurring: boolean;
  category_id?: string | null;
  is_daily_task?: boolean;
  event_categories?: { name: string; color: string } | null;
  category?: { name: string; color: string } | null;
}

interface AvailabilityRequest {
  id: string;
  user_id: string;
  request_type: string;
  time_scope: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
}

interface Holiday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  location_id?: string | null;
}

export default function Schedule() {
  const navigate = useNavigate();
  const { role, isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const isMobile = useIsMobile();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [availabilityRequests, setAvailabilityRequests] = useState<AvailabilityRequest[]>([]);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<any>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingShiftData, setPendingShiftData] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [publishedSnapshot, setPublishedSnapshot] = useState<any[]>([]);
  const [selectedDayForBreakdown, setSelectedDayForBreakdown] = useState<Date | null>(null);
  const [dayBreakdownOpen, setDayBreakdownOpen] = useState(false);
  const [clearScheduleDialogOpen, setClearScheduleDialogOpen] = useState(false);
  const [copyScheduleDialogOpen, setCopyScheduleDialogOpen] = useState(false);
  const [weeksToAdd, setWeeksToAdd] = useState(1);
  const [weeklyTotalSales, setWeeklyTotalSales] = useState(0);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [locationSettings, setLocationSettings] = useState<{ hours_open?: string; hours_close?: string } | null>(null);
  const [isCreatingShift, setIsCreatingShift] = useState(false);
  const [autoScheduleOpen, setAutoScheduleOpen] = useState(false);
  const [roleChangeDialogOpen, setRoleChangeDialogOpen] = useState(false);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    userId: string;
    userName: string;
    newRole: string;
  } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id || null);
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    })
  );

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  useEffect(() => {
    if (role && currentLocation?.id) {
      fetchScheduleData();
    }
  }, [currentWeekStart, role, currentLocation?.id]);

  const fetchScheduleData = async (showLoading = true) => {
    if (!currentLocation?.id) return;
    
    // Only show loading spinner on initial load, not on refreshes after actions
    if (showLoading && shifts.length === 0) {
      setLoading(true);
    }
    try {
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      // Fetch or create schedule for this week and location
      let { data: scheduleData, error: scheduleError } = await supabase
        .from("schedules")
        .select("*")
        .eq("week_start_date", format(currentWeekStart, "yyyy-MM-dd"))
        .eq("location_id", currentLocation.id)
        .single();

      if (scheduleError && scheduleError.code === "PGRST116") {
        // Schedule doesn't exist, create it if user can
        if (isAdmin || isManager) {
          const { data: newSchedule, error: createError } = await supabase
            .from("schedules")
            .insert({
              week_start_date: format(currentWeekStart, "yyyy-MM-dd"),
              week_end_date: format(weekEnd, "yyyy-MM-dd"),
              location_id: currentLocation.id,
            })
            .select()
            .single();

          if (createError) throw createError;
          scheduleData = newSchedule;
        }
      }

      if (!scheduleData) {
        // Clear state when no schedule exists
        setScheduleId(null);
        setIsPublished(false);
        setPublishedSnapshot(null);
        setShifts([]);
        setEvents([]);
        setLoading(false);
        return;
      }

      setScheduleId(scheduleData.id);
      setIsPublished(scheduleData.is_published || false);
      setPublishedSnapshot(Array.isArray(scheduleData.published_shifts_snapshot) ? scheduleData.published_shifts_snapshot : []);

      // Parallelize all independent data fetches
      const [
        shiftsResult,
        eventsResult,
        recurringEventsResult,
        userLocationsResult,
        allProfilesResult,
        rolesResult,
        templatesResult,
        availabilityResult,
        salesResult,
        holidaysResult,
        locationSettingsResult
      ] = await Promise.all([
        // Fetch shifts with template data
        supabase
          .from("scheduled_shifts")
          .select(`
            *,
            template:shift_templates(*)
          `)
          .eq("schedule_id", scheduleData.id),
        
        // Fetch events for this schedule
        supabase
          .from("schedule_events")
          .select("*, event_categories(name, color)")
          .eq("schedule_id", scheduleData.id),
        
        // Fetch recurring events (not tied to specific schedule) for this location
        supabase
          .from("schedule_events")
          .select("*, event_categories(name, color)")
          .eq("is_recurring", true)
          .is("schedule_id", null)
          .eq("location_id", currentLocation.id),
        
        // Fetch user_locations for this location to get user IDs
        supabase
          .from("user_locations")
          .select("user_id")
          .eq("location_id", currentLocation!.id),
        
        // Fetch all active profiles that appear on schedule
        supabase
          .from("profiles")
          .select(`
            id, 
            full_name, 
            profile_photo_url,
            hourly_wage,
            display_order,
            appears_on_schedule
          `)
          .eq("is_active", true)
          .eq("appears_on_schedule", true),
        
        // Fetch user roles
        supabase
          .from("user_roles")
          .select("user_id, role"),
        
        // Fetch shift templates for this location
        supabase
          .from("shift_templates")
          .select("*")
          .eq("location_id", currentLocation!.id)
          .order("start_time", { ascending: true }),
        
        // Fetch availability requests for this location
        supabase
          .from("availability_requests")
          .select("*")
          .eq("location_id", currentLocation!.id)
          .eq("request_type", "unpaid")
          .in("status", ["pending", "approved"])
          .gte("start_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("start_date", format(weekEnd, "yyyy-MM-dd")),
        
        // Fetch projected sales for the week
        scheduleData ? supabase
          .from("schedule_projected_sales")
          .select("*")
          .eq("schedule_id", scheduleData.id) : Promise.resolve({ data: [], error: null }),
        
        // Fetch holidays for the week (location-specific or global)
        supabase
          .from("holidays")
          .select("*")
          .or(`location_id.eq.${currentLocation!.id},location_id.is.null`)
          .gte("holiday_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("holiday_date", format(weekEnd, "yyyy-MM-dd")),
        
        // Fetch location settings (blackout dates, hours)
        supabase
          .from("location_settings")
          .select("blackout_dates, hours_open, hours_close")
          .eq("location_id", currentLocation!.id)
          .single()
      ]);

      // Handle shifts
      if (shiftsResult.error) throw shiftsResult.error;
      setShifts(shiftsResult.data || []);

      // Handle events - combine schedule-specific and recurring events
      if (eventsResult.error) throw eventsResult.error;
      if (recurringEventsResult.error) throw recurringEventsResult.error;
      
      const scheduleEvents = (eventsResult.data || []).map(event => ({
        ...event,
        tagged_roles: event.tagged_roles as string[] | null,
        is_recurring: event.is_recurring ?? true,
        category: event.event_categories || null
      }));
      
      const recurringEvents = (recurringEventsResult.data || []).map(event => ({
        ...event,
        tagged_roles: event.tagged_roles as string[] | null,
        is_recurring: true,
        category: event.event_categories || null
      }));
      
      // Merge and deduplicate (schedule-specific events take precedence)
      const allEvents = [...scheduleEvents];
      recurringEvents.forEach(recurEvent => {
        const exists = scheduleEvents.some(e => 
          e.event_name === recurEvent.event_name && 
          e.day_of_week === recurEvent.day_of_week &&
          e.event_time === recurEvent.event_time
        );
        if (!exists) {
          allEvents.push(recurEvent);
        }
      });
      
      setEvents(allEvents);

      // Handle profiles and roles - filter by location
      if (userLocationsResult.error) throw userLocationsResult.error;
      if (allProfilesResult.error) throw allProfilesResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const locationUserIds = new Set((userLocationsResult.data || []).map(ul => ul.user_id));
      const locationProfiles = (allProfilesResult.data || []).filter(p => locationUserIds.has(p.id));
      
      console.log('[Schedule] All profiles from query:', allProfilesResult.data?.length);
      console.log('[Schedule] Location user IDs:', Array.from(locationUserIds));
      console.log('[Schedule] Filtered location profiles:', locationProfiles.map(p => ({ id: p.id, name: p.full_name })));
      console.log('[Schedule] Roles from DB:', rolesResult.data);

      const profilesWithRoles = locationProfiles.map(profile => {
        const userRole = rolesResult.data?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || 'team_member',
          display_order: profile.display_order ?? 0
        };
      });
      
      console.log('[Schedule] Profiles with roles:', profilesWithRoles.map(p => ({ name: p.full_name, role: p.role })));

      // Sort by role first, then by display_order within each role
      const roleOrder: Record<string, number> = { 
        super_admin: 0,
        admin: 1, 
        general_manager: 2,
        shift_manager: 3,
        manager: 3, 
        team_member: 4 
      };
      profilesWithRoles.sort((a, b) => {
        const aRoleOrder = roleOrder[a.role as string] ?? 5;
        const bRoleOrder = roleOrder[b.role as string] ?? 5;
        
        // If same role, sort by display_order
        if (aRoleOrder === bRoleOrder) {
          return (a.display_order ?? 0) - (b.display_order ?? 0);
        }
        
        return aRoleOrder - bRoleOrder;
      });

      setProfiles(profilesWithRoles);

      // Handle templates
      if (templatesResult.error) throw templatesResult.error;
      setTemplates(templatesResult.data || []);

      // Handle availability
      if (availabilityResult.error) throw availabilityResult.error;
      setAvailabilityRequests(availabilityResult.data || []);

      // Handle projected sales
      if (salesResult && !salesResult.error && salesResult.data) {
        const totalSales = (salesResult.data as any[]).reduce((sum: number, sale: any) => 
          sum + (Number(sale.projected_sales) || 0)
        , 0);
        setWeeklyTotalSales(totalSales);
      } else {
        setWeeklyTotalSales(0);
      }

      // Handle holidays
      if (holidaysResult.error) {
        console.error('Error fetching holidays:', holidaysResult.error);
      } else {
        const allHolidays = (holidaysResult.data || []) as Holiday[];
        // Birthdays must be location-specific; ignore legacy "global" birthday rows.
        const filtered = allHolidays.filter(h => h.holiday_type !== 'birthday' || h.location_id === currentLocation?.id);
        setHolidays(filtered);
      }

      // Handle location settings
      if (locationSettingsResult && !locationSettingsResult.error && locationSettingsResult.data) {
        setBlackoutDates(locationSettingsResult.data.blackout_dates || []);
        setLocationSettings({
          hours_open: locationSettingsResult.data.hours_open || undefined,
          hours_close: locationSettingsResult.data.hours_close || undefined
        });
      } else {
        setBlackoutDates([]);
        setLocationSettings(null);
      }

      // Sync birthday holidays (non-blocking, happens in background)
      supabase.functions.invoke('sync-birthday-events').catch(err => 
        console.error('Failed to sync birthday holidays:', err)
      );
    } catch (error: any) {
      console.error("Error fetching schedule data:", error);
      toast.error("Failed to load schedule");
    } finally {
      setLoading(false);
    }
  };

  const checkForConflicts = (userId: string, dayIndex: number, shiftDate: string) => {
    if (userId === "unassigned") return [];

    const employee = profiles.find((p) => p.id === userId);
    if (!employee) return [];

    const conflictingRequests = availabilityRequests.filter((request) => {
      if (request.user_id !== userId) return false;

      // Compare date strings directly to avoid timezone issues
      // shiftDate and start_date are both in "yyyy-MM-dd" format
      if (request.time_scope === "multi_day" && request.end_date) {
        return shiftDate >= request.start_date && shiftDate <= request.end_date;
      }
      return request.start_date === shiftDate;
    });

    return conflictingRequests.map((req) => ({
      employeeName: employee.full_name,
      date: shiftDate,
      requestType: req.request_type,
      timeScope: req.time_scope,
      status: req.status,
      startTime: req.start_time,
      endTime: req.end_time,
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveShift(active.data.current);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveShift(null);

    if (!over) return;

    // Check if we're dragging an employee (for reordering)
    const isEmployeeDrag = profiles.some(p => p.id === active.id);
    
    if (isEmployeeDrag && active.id !== over.id) {
      // Handle employee reordering
      const activeProfile = profiles.find(p => p.id === active.id);
      const overProfile = profiles.find(p => p.id === over.id);
      
      if (!activeProfile || !overProfile) return;
      
      // Check if moving to a different role
      if (activeProfile.role !== overProfile.role) {
        // Show role change confirmation dialog
        setPendingRoleChange({
          userId: activeProfile.id,
          userName: activeProfile.full_name,
          newRole: overProfile.role || 'team_member'
        });
        setRoleChangeDialogOpen(true);
        return;
      }
      
      // Same role - handle reordering
      const roleProfiles = profiles.filter(p => p.role === activeProfile.role);
      const oldIndex = roleProfiles.findIndex(p => p.id === active.id);
      const newIndex = roleProfiles.findIndex(p => p.id === over.id);
      
      const reorderedRoleProfiles = arrayMove(roleProfiles, oldIndex, newIndex);
      
      // Update display_order for all profiles in this role
      try {
        await Promise.all(
          reorderedRoleProfiles.map((profile, index) =>
            supabase
              .from('profiles')
              .update({ display_order: index })
              .eq('id', profile.id)
          )
        );
        
        // Update local state with new display_order values
        const newProfiles = profiles.map(p => {
          const reordered = reorderedRoleProfiles.find(rp => rp.id === p.id);
          if (reordered) {
            const newOrder = reorderedRoleProfiles.findIndex(rp => rp.id === p.id);
            return { ...p, display_order: newOrder };
          }
          return p;
        });
        
        // Re-sort profiles by role first, then by display_order within each role
        const roleOrder = { admin: 0, manager: 1, team_member: 2 };
        newProfiles.sort((a, b) => {
          const aRoleOrder = roleOrder[a.role as keyof typeof roleOrder] ?? 3;
          const bRoleOrder = roleOrder[b.role as keyof typeof roleOrder] ?? 3;
          if (aRoleOrder === bRoleOrder) {
            return (a.display_order ?? 0) - (b.display_order ?? 0);
          }
          return aRoleOrder - bRoleOrder;
        });
        
        setProfiles(newProfiles);
        toast.success("Employee order updated");
      } catch (error) {
        console.error("Error updating employee order:", error);
        toast.error("Failed to update employee order");
      }
      return;
    }

    // Handle shift drag and drop (existing logic)
    if (!scheduleId) return;

    const overId = over.id as string;
    const lastHyphenIndex = overId.lastIndexOf("-");
    const dayIndex = parseInt(overId.substring(lastHyphenIndex + 1));
    const userId = overId.substring(5, lastHyphenIndex);
    const shiftDate = format(weekDays[dayIndex], "yyyy-MM-dd");

    // Check for conflicts
    const detectedConflicts = checkForConflicts(userId, dayIndex, shiftDate);

    if (detectedConflicts.length > 0) {
      // Store pending shift data and show conflict dialog
      setPendingShiftData({
        type: active.data.current?.isTemplate ? "template" : "move",
        active,
        userId,
        dayIndex,
        shiftDate,
      });
      setConflicts(detectedConflicts);
      setConflictDialogOpen(true);
      return;
    }

    // No conflicts, proceed with scheduling
    await executeShiftOperation(active, userId, dayIndex, shiftDate);
  };

  const executeShiftOperation = async (active: any, userId: string, dayIndex: number, shiftDate: string) => {
    try {
      // NOTE: We no longer unpublish the schedule when making changes
      // The schedule stays "published" but changes are tracked as pending
      // until the admin clicks "Update" to notify affected employees

      if (active.data?.current?.isTemplate || active.isTemplate) {
        // Dragging from template
        const template = active.data?.current?.template || active.template;
        const { error } = await supabase.from("scheduled_shifts").insert({
          schedule_id: scheduleId,
          template_id: template.id,
          user_id: userId === "unassigned" ? null : userId,
          day_of_week: dayIndex,
          shift_date: shiftDate,
          start_time: template.start_time,
          end_time: template.end_time,
          is_time_off: false,
        });

        if (error) throw error;
        toast.success("Shift added");
        fetchScheduleData(false);
      } else {
        // Moving existing shift
        const shift = active.data?.current || active;
        const { error } = await supabase
          .from("scheduled_shifts")
          .update({
            user_id: userId === "unassigned" ? null : userId,
            day_of_week: dayIndex,
            shift_date: shiftDate,
          })
          .eq("id", shift.id);

        if (error) throw error;
        toast.success("Shift moved");
        fetchScheduleData(false);
      }
    } catch (error: any) {
      console.error("Error handling drop:", error);
      toast.error("Failed to update shift");
    }
  };

  const handleConflictConfirm = async () => {
    if (!pendingShiftData) return;

    setConflictDialogOpen(false);
    await executeShiftOperation(
      pendingShiftData.active,
      pendingShiftData.userId,
      pendingShiftData.dayIndex,
      pendingShiftData.shiftDate
    );
    setPendingShiftData(null);
    setConflicts([]);
  };

  const handleClearSchedule = async () => {
    if (!scheduleId) return;
    
    try {
      const { error } = await supabase
        .from("scheduled_shifts")
        .delete()
        .eq("schedule_id", scheduleId);

      if (error) throw error;

      // Reset to unpublished state after clearing
      await supabase
        .from("schedules")
        .update({ is_published: false, published_shifts_snapshot: null })
        .eq("id", scheduleId);
      setIsPublished(false);
      setPublishedSnapshot([]);

      toast.success("Schedule cleared successfully");
      setClearScheduleDialogOpen(false);
      fetchScheduleData(false);
    } catch (error: any) {
      console.error("Error clearing schedule:", error);
      toast.error("Failed to clear schedule");
    }
  };

  const handleCopySchedule = async () => {
    if (!scheduleId || weeksToAdd < 1) return;

    try {
      const targetWeekStart = addWeeks(currentWeekStart, weeksToAdd);
      const targetWeekEnd = endOfWeek(targetWeekStart, { weekStartsOn: 1 });

      // Check if target schedule already exists
      const { data: existingSchedule } = await supabase
        .from("schedules")
        .select("id")
        .eq("week_start_date", format(targetWeekStart, "yyyy-MM-dd"))
        .single();

      let targetScheduleId = existingSchedule?.id;

      // Create target schedule if it doesn't exist
      if (!targetScheduleId) {
        const { data: newSchedule, error: createError } = await supabase
          .from("schedules")
          .insert({
            week_start_date: format(targetWeekStart, "yyyy-MM-dd"),
            week_end_date: format(targetWeekEnd, "yyyy-MM-dd"),
            is_published: false,
          })
          .select()
          .single();

        if (createError) throw createError;
        targetScheduleId = newSchedule.id;
      }

      // Copy all shifts to the target week
      const shiftsToCopy = shifts.map((shift) => {
        const shiftDate = new Date(shift.shift_date);
        const dayOffset = Math.floor((shiftDate.getTime() - currentWeekStart.getTime()) / (1000 * 60 * 60 * 24));
        const newShiftDate = addDays(targetWeekStart, dayOffset);

        return {
          schedule_id: targetScheduleId,
          user_id: shift.user_id,
          day_of_week: shift.day_of_week,
          start_time: shift.start_time,
          end_time: shift.end_time,
          is_time_off: shift.is_time_off,
          template_id: shift.template_id,
          shift_date: format(newShiftDate, "yyyy-MM-dd"),
        };
      });

      if (shiftsToCopy.length > 0) {
        const { error: copyError } = await supabase
          .from("scheduled_shifts")
          .insert(shiftsToCopy);

        if (copyError) throw copyError;
      }

      toast.success(`Schedule copied to week of ${format(targetWeekStart, "MMM d, yyyy")}`);
      setCopyScheduleDialogOpen(false);
      setWeeksToAdd(1);
    } catch (error: any) {
      console.error("Error copying schedule:", error);
      toast.error("Failed to copy schedule");
    }
  };

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  // Compute if there are pending changes by comparing current shifts to snapshot
  // Only show pending changes if there IS a snapshot to compare against
  const hasPendingChanges = (() => {
    if (!isPublished) return false;
    // If no snapshot exists (legacy published schedule), no pending changes
    if (!publishedSnapshot || publishedSnapshot.length === 0) return false;
    
    // Create maps for comparison
    const snapshotMap = new Map(publishedSnapshot.map((s: any) => [s.id, s]));
    const currentMap = new Map(shifts.map(s => [s.id, s]));
    
    // Check for removed shifts
    for (const [id] of snapshotMap) {
      if (!currentMap.has(id)) return true;
    }
    
    // Check for added or modified shifts
    for (const [id, shift] of currentMap) {
      const snapshotShift = snapshotMap.get(id);
      if (!snapshotShift) return true; // New shift
      
      // Check if any relevant fields changed
      if (
        snapshotShift.user_id !== shift.user_id ||
        snapshotShift.start_time !== shift.start_time ||
        snapshotShift.end_time !== shift.end_time ||
        snapshotShift.shift_date !== shift.shift_date ||
        snapshotShift.day_of_week !== shift.day_of_week
      ) {
        return true;
      }
    }
    
    return false;
  })();

  const handleGoLive = async () => {
    if (!scheduleId) return;
    
    setIsPublishing(true);
    try {
      // Get current shifts snapshot
      const { data: currentShifts, error: shiftsError } = await supabase
        .from('scheduled_shifts')
        .select('*')
        .eq('schedule_id', scheduleId);

      if (shiftsError) throw shiftsError;

      // Get unique user IDs with shifts in this schedule
      const usersWithShifts = [...new Set((currentShifts || [])
        .filter(s => s.user_id)
        .map(s => s.user_id)
      )];

      // Format date range for notification
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
      const dateRange = `${format(currentWeekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;

      // Notify ALL users with shifts for initial Go Live
      if (usersWithShifts.length > 0) {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            user_ids: usersWithShifts,
            title: 'Weekly Schedule Published',
            body: `Schedule for ${dateRange} is now live`,
            notification_type: 'schedule_updates',
            data: { type: 'schedule_update', schedule_id: scheduleId }
          }
        });
        
        toast.success(`Schedule published! ${usersWithShifts.length} team member(s) notified.`);
      } else {
        toast.success("Schedule published!");
      }

      // Update schedule with new snapshot
      const { error } = await supabase
        .from('schedules')
        .update({ 
          is_published: true,
          published_shifts_snapshot: currentShifts
        })
        .eq('id', scheduleId);

      if (error) throw error;

      setIsPublished(true);
      setPublishedSnapshot(currentShifts || []);
    } catch (error: any) {
      console.error('Error publishing schedule:', error);
      toast.error("Failed to publish schedule");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUpdate = async () => {
    if (!scheduleId) return;
    
    setIsPublishing(true);
    try {
      // Get current shifts
      const { data: currentShifts, error: shiftsError } = await supabase
        .from('scheduled_shifts')
        .select('*')
        .eq('schedule_id', scheduleId);

      if (shiftsError) throw shiftsError;

      // Format date range for notification
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
      const dateRange = `${format(currentWeekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;

      // Detect changes and only notify affected employees
      const changes = detectScheduleChanges(publishedSnapshot, currentShifts || []);
      
      if (changes.length > 0) {
        // Get unique affected user IDs
        const affectedUserIds = [...new Set(changes.map(c => c.user_id).filter(Boolean))];
        
        // Log changes
        for (const change of changes) {
          await supabase
            .from('schedule_change_log')
            .insert({
              schedule_id: scheduleId,
              user_id: change.user_id,
              change_type: change.type,
              old_shift_data: change.oldShift,
              new_shift_data: change.newShift
            });
        }
        
        // Notify only affected users
        if (affectedUserIds.length > 0) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: affectedUserIds,
              title: 'Schedule Updated',
              body: `Your schedule for ${dateRange} has been updated`,
              notification_type: 'schedule_updates',
              data: { type: 'schedule_update', schedule_id: scheduleId }
            }
          });
        }
        
        toast.success(`Schedule updated! ${affectedUserIds.length} affected team member(s) notified.`);
      } else {
        toast.success("Schedule updated!");
      }

      // Update snapshot
      const { error } = await supabase
        .from('schedules')
        .update({ 
          published_shifts_snapshot: currentShifts
        })
        .eq('id', scheduleId);

      if (error) throw error;

      setPublishedSnapshot(currentShifts || []);
    } catch (error: any) {
      console.error('Error updating schedule:', error);
      toast.error("Failed to update schedule");
    } finally {
      setIsPublishing(false);
    }
  };

  const handleWithdrawSchedule = async () => {
    if (!scheduleId) return;
    
    try {
      const { error } = await supabase
        .from('schedules')
        .update({ 
          is_published: false,
          published_shifts_snapshot: null
        })
        .eq('id', scheduleId);

      if (error) throw error;

      setIsPublished(false);
      setPublishedSnapshot([]);
      setWithdrawDialogOpen(false);
      toast.success("Schedule withdrawn. It will no longer be visible to team members until you Go Live again.");
    } catch (error: any) {
      console.error('Error withdrawing schedule:', error);
      toast.error("Failed to withdraw schedule");
    }
  };

  const detectScheduleChanges = (oldShifts: any[], newShifts: any[]) => {
    const changes: any[] = [];
    const oldShiftsMap = new Map(oldShifts.map(s => [s.id, s]));
    const newShiftsMap = new Map(newShifts.map(s => [s.id, s]));

    // Check for removed shifts
    oldShifts.forEach(oldShift => {
      if (!newShiftsMap.has(oldShift.id) && oldShift.user_id) {
        changes.push({
          user_id: oldShift.user_id,
          type: 'removed',
          oldShift: oldShift,
          newShift: null
        });
      }
    });

    // Check for added or changed shifts
    newShifts.forEach(newShift => {
      const oldShift = oldShiftsMap.get(newShift.id);
      
      if (!oldShift && newShift.user_id) {
        // New shift added
        changes.push({
          user_id: newShift.user_id,
          type: 'added',
          oldShift: null,
          newShift: newShift
        });
      } else if (oldShift && newShift.user_id) {
        // Check if time changed
        if (oldShift.start_time !== newShift.start_time || 
            oldShift.end_time !== newShift.end_time) {
          changes.push({
            user_id: newShift.user_id,
            type: 'time_changed',
            oldShift: oldShift,
            newShift: newShift
          });
        }
        // Check if date changed
        else if (oldShift.shift_date !== newShift.shift_date ||
                 oldShift.day_of_week !== newShift.day_of_week) {
          changes.push({
            user_id: newShift.user_id,
            type: 'date_changed',
            oldShift: oldShift,
            newShift: newShift
          });
        }
        // Check if user assignment changed
        else if (oldShift.user_id !== newShift.user_id) {
          if (oldShift.user_id) {
            changes.push({
              user_id: oldShift.user_id,
              type: 'removed',
              oldShift: oldShift,
              newShift: null
            });
          }
          if (newShift.user_id) {
            changes.push({
              user_id: newShift.user_id,
              type: 'added',
              oldShift: null,
              newShift: newShift
            });
          }
        }
      }
    });

    return changes;
  };

  const handleRoleChange = async () => {
    if (!pendingRoleChange) return;
    
    try {
      // Update user_roles table
      const { error } = await supabase
        .from('user_roles')
        .update({ role: pendingRoleChange.newRole as 'admin' | 'general_manager' | 'shift_manager' | 'team_member' })
        .eq('user_id', pendingRoleChange.userId);
      
      if (error) throw error;
      
      // Update local state
      setProfiles(profiles.map(p => 
        p.id === pendingRoleChange.userId 
          ? { ...p, role: pendingRoleChange.newRole }
          : p
      ));
      
      const roleDisplayName = pendingRoleChange.newRole === 'team_member' ? 'Team Member' 
        : pendingRoleChange.newRole === 'shift_manager' ? 'Shift Manager'
        : pendingRoleChange.newRole === 'general_manager' ? 'General Manager'
        : pendingRoleChange.newRole;
      toast.success(`${pendingRoleChange.userName}'s role changed to ${roleDisplayName}`);
    } catch (error) {
      console.error('Error changing role:', error);
      toast.error('Failed to change user role');
    } finally {
      setPendingRoleChange(null);
      setRoleChangeDialogOpen(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading schedule...</p>
        </div>
      </Layout>
    );
  }

  // For team members on tablet/desktop: filter to show only their shifts
  const isTeamMemberDesktopView = !isMobile && !isAdmin && !isManager;
  const filteredProfiles = isTeamMemberDesktopView && currentUserId
    ? profiles.filter(p => p.id === currentUserId)
    : profiles;
  const filteredShifts = isTeamMemberDesktopView && currentUserId
    ? shifts.filter(s => s.user_id === currentUserId)
    : shifts;

  return (
    <Layout>
      {isMobile ? (
        <MobileScheduleView
          currentWeekStart={currentWeekStart}
          shifts={shifts.map(s => ({
            ...s,
            template_id: s.template_id,
            template: templates.find(t => t.id === s.template_id) ? {
              position: templates.find(t => t.id === s.template_id)?.template_name.split(' ').slice(0, -3).join(' ') || null,
              color: templates.find(t => t.id === s.template_id)?.color || null,
            } : undefined,
          }))}
          events={events}
          profiles={profiles}
          onShiftClick={(shift) => setEditingShift(shift)}
          onWeekChange={setCurrentWeekStart}
          onUpdate={fetchScheduleData}
          isPublished={isPublished}
          publishedSnapshot={publishedSnapshot}
          scheduleId={scheduleId}
          templates={templates}
          onGoLive={handleGoLive}
          onSendUpdate={handleUpdate}
          isPublishing={isPublishing}
          hasPendingChanges={hasPendingChanges}
        />
      ) : (
        <div className="space-y-6 pb-20">
        {/* Header */}
        <div className="flex items-center gap-4 mb-2">
          <div className="flex-1 flex justify-center">
            <div className="w-[75%]">
              <DateNavigator
                onPrev={handlePreviousWeek}
                onNext={handleNextWeek}
                label={`${format(currentWeekStart, "MMM d")} - ${format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), "MMM d, yyyy")}`}
                className="w-full"
              />
            </div>
          </div>
          {(isAdmin || isManager) && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setAutoScheduleOpen(true)}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Croo AI
              </Button>
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => setIsCreatingShift(true)}
                className="opacity-60 hover:opacity-100 transition-opacity"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Wrench className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-background">
                  <DropdownMenuItem onClick={() => navigate("/availability")} className="gap-2 cursor-pointer">
                    <Calendar className="h-4 w-4" />
                    View Availability
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/schedule-templates")} className="gap-2 cursor-pointer">
                    <Settings className="h-4 w-4" />
                    Manage Templates
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setCopyScheduleDialogOpen(true)} className="gap-2 cursor-pointer">
                    <Copy className="h-4 w-4" />
                    Copy Schedule to Future Week
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setClearScheduleDialogOpen(true)} className="gap-2 cursor-pointer text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Clear Schedule
                  </DropdownMenuItem>
                  {isPublished && (
                    <DropdownMenuItem onClick={() => setWithdrawDialogOpen(true)} className="gap-2 cursor-pointer text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      Withdraw Schedule
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {scheduleId && (
                <LiveStatusBadge
                  isPublished={isPublished}
                  isPublishing={isPublishing}
                  hasPendingChanges={hasPendingChanges}
                  onGoLive={handleGoLive}
                  onUpdate={handleUpdate}
                />
              )}
            </div>
          )}
        </div>

        {/* Team member view-only badge */}
        {isTeamMemberDesktopView && (
          <div className="bg-muted/50 border border-border rounded-lg px-4 py-2 text-center">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">View Only</span> — Showing your shifts for this week
            </p>
          </div>
        )}

        <DndContext 
          sensors={isTeamMemberDesktopView ? [] : sensors} 
          onDragStart={isTeamMemberDesktopView ? undefined : handleDragStart} 
          onDragEnd={isTeamMemberDesktopView ? undefined : handleDragEnd}
          collisionDetection={closestCenter}
        >
          <Card className="p-6 overflow-x-auto">
            {/* Week Day Headers */}
            <div className="grid grid-cols-[140px_repeat(7,1fr)] md:grid-cols-[160px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] gap-0 border-b-2 border-border">
              <div className="font-semibold p-2 border-r border-border bg-muted/50 text-xs"></div>
              {weekDays.map((day, index) => {
                const dayString = format(day, "yyyy-MM-dd");
                const dayHolidays = holidays.filter(h => h.holiday_date === dayString);
                const isBlackout = blackoutDates.includes(dayString);
                
                return (
                  <div 
                    key={index} 
                    className={`text-center p-2 border-r last:border-r-0 border-border bg-muted/50 ${(isAdmin || isManager) ? 'cursor-pointer hover:bg-muted transition-colors' : ''}`}
                    onClick={() => {
                      if (isAdmin || isManager) {
                        setSelectedDayForBreakdown(day);
                        setDayBreakdownOpen(true);
                      }
                    }}
                  >
                    <div className="font-semibold text-sm">{format(day, "EEE")}</div>
                    <div className="text-xs text-muted-foreground">{format(day, "M/d")}</div>
                    {dayHolidays.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayHolidays.map(holiday => (
                          <div key={holiday.id} className="text-[10px] text-primary font-medium leading-tight">
                            {holiday.holiday_name}
                          </div>
                        ))}
                      </div>
                    )}
                    {isBlackout && (
                      <div className="mt-1 text-[10px] text-destructive font-medium leading-tight">
                        🚫 Blackout
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Events Section - show for all users */}
            <div className="border-b border-border">
              <EventRow events={events} scheduleId={scheduleId} isEditable={isAdmin || isManager} onUpdate={fetchScheduleData} locationId={currentLocation?.id} />
            </div>

            {/* Shifts by User - Grouped by Role (filtered for team members) */}
            <div className="divide-y divide-border">
              {isTeamMemberDesktopView ? (
                // Team member view: only show their own row
                filteredProfiles.length > 0 ? (
                  filteredProfiles.map((profile) => (
                    <EmployeeRow
                      key={profile.id}
                      profile={profile}
                      shifts={filteredShifts.filter((s) => s.user_id === profile.id)}
                      templates={templates}
                      availabilityRequests={availabilityRequests.filter((r) => r.user_id === profile.id)}
                      currentWeekStart={currentWeekStart}
                      isEditable={false}
                      onUpdate={fetchScheduleData}
                      canTakeShifts={false}
                      currentUserId={currentUserId || undefined}
                      onEditShift={() => {}} // No editing for team members
                      isDraggable={false}
                      isPublished={isPublished}
                      publishedSnapshot={publishedSnapshot}
                    />
                  ))
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    No shifts scheduled for you this week
                  </div>
                )
              ) : (
              // Admin/Manager view: show all employees grouped by role
                <>
                  {['super_admin', 'org_admin', 'admin', 'general_manager', 'shift_manager', 'manager', 'team_member'].map((roleFilter) => {
                    const roleProfiles = profiles.filter(p => p.role === roleFilter);
                    if (roleProfiles.length === 0) return null;

                    const roleColorClass = ['super_admin', 'org_admin', 'admin'].includes(roleFilter)
                      ? 'bg-role-admin/5 border-l-4 border-role-admin'
                      : ['general_manager', 'shift_manager', 'manager'].includes(roleFilter)
                      ? 'bg-role-manager/5 border-l-4 border-role-manager'
                      : 'bg-role-team-member/5 border-l-4 border-role-team-member';

                    const roleLabels: Record<string, string> = {
                      super_admin: 'Super Admins',
                      org_admin: 'Org Admins',
                      admin: 'Admins',
                      general_manager: 'General Managers',
                      shift_manager: 'Shift Managers',
                      manager: 'Managers',
                      team_member: 'Team Members'
                    };
                    const roleLabel = roleLabels[roleFilter] || roleFilter;

                    return (
                      <div key={roleFilter} className={`${roleColorClass}`}>
                        <div className="px-3 py-1 font-semibold text-sm uppercase tracking-wide">
                          {roleLabel}
                        </div>
                        <SortableContext
                          items={roleProfiles.map(p => p.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {roleProfiles.map((profile) => (
                            <EmployeeRow
                              key={profile.id}
                              profile={profile}
                              shifts={shifts.filter((s) => s.user_id === profile.id)}
                              templates={templates}
                              availabilityRequests={availabilityRequests.filter((r) => r.user_id === profile.id)}
                              currentWeekStart={currentWeekStart}
                              isEditable={isAdmin || isManager}
                              onUpdate={fetchScheduleData}
                              canTakeShifts={isAdmin || isManager}
                              currentUserId={currentUserId || undefined}
                              onEditShift={setEditingShift}
                              isDraggable={isAdmin || isManager}
                              isPublished={isPublished}
                              publishedSnapshot={publishedSnapshot}
                            />
                          ))}
                        </SortableContext>
                      </div>
                    );
                  })}

                  {/* Unassigned Shifts */}
                  <EmployeeRow
                    profile={{ id: "unassigned", full_name: "Unassigned", profile_photo_url: null }}
                    shifts={shifts.filter((s) => s.user_id === null)}
                    templates={templates}
                    availabilityRequests={[]}
                    currentWeekStart={currentWeekStart}
                    isEditable={isAdmin || isManager}
                    onUpdate={fetchScheduleData}
                    canTakeShifts={isAdmin || isManager}
                    currentUserId={currentUserId || undefined}
                    onEditShift={setEditingShift}
                    isPublished={isPublished}
                    publishedSnapshot={publishedSnapshot}
                  />
                </>
              )}
            </div>
          </Card>

          {/* Floating Templates Bar - Bottom (Admin/Manager only) */}
          {(isAdmin || isManager) && (
            <div className="fixed bottom-0 left-0 right-0 bg-card border-t-2 border-border shadow-lg z-50">
              <div className="max-w-screen-2xl mx-auto px-4 py-2">
                <Collapsible defaultOpen={false}>
                  {/* Labor Totals Header */}
                  <div className="border-b border-border pb-1 flex items-center justify-between">
                    <h3 className="font-semibold text-xs">Schedule Tools</h3>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  <CollapsibleContent>
                    {/* Labor Totals Summary */}
                    <LaborTotals
                      shifts={shifts}
                      profiles={profiles}
                      currentWeekStart={currentWeekStart}
                      scheduleId={scheduleId}
                      isEditable={isAdmin || isManager}
                    />
                  </CollapsibleContent>
                </Collapsible>
                
                {/* Shift Templates - Always visible */}
                <div className="flex items-start gap-3 border-t border-border pt-1">
                  <h3 className="font-semibold whitespace-nowrap text-xs pt-1">Templates:</h3>
                  {templates.length > 0 ? (
                    <div className="flex flex-wrap gap-2 flex-1">
                      {templates.map((template) => (
                        <ShiftCard key={template.id} shift={{ template, isTemplate: true }} />
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-muted-foreground text-xs">No templates</p>
                      <Button size="sm" onClick={() => navigate("/shift-templates")} className="h-6 text-xs px-2">
                        <Plus className="h-3 w-3 mr-1" />
                        Create
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isTeamMemberDesktopView && (
            <DragOverlay>{activeShift ? <ShiftCard shift={activeShift} isDragging /> : null}</DragOverlay>
          )}
        </DndContext>

        {(isAdmin || isManager) && editingShift && (() => {
          const snapshotShift = publishedSnapshot?.find((s: any) => s.id === editingShift.id);
          const isShiftModified = snapshotShift && (
            snapshotShift.start_time !== editingShift.start_time ||
            snapshotShift.end_time !== editingShift.end_time ||
            snapshotShift.user_id !== editingShift.user_id ||
            snapshotShift.shift_date !== editingShift.shift_date ||
            snapshotShift.template_id !== editingShift.template_id
          );
          const isShiftPublished = isPublished && snapshotShift && !isShiftModified;
          
          return (
            <EditShiftDialog
              open={!!editingShift}
              onOpenChange={(open) => !open && setEditingShift(null)}
              shift={editingShift}
              profiles={profiles}
              templates={templates}
              onUpdate={fetchScheduleData}
              scheduleId={scheduleId || ""}
              currentWeekStart={currentWeekStart}
              currentUserId={currentUserId || undefined}
              availabilityRequests={availabilityRequests}
              isAdmin={isAdmin}
              isShiftPublished={isShiftPublished}
            />
          );
        })()}

        {(isAdmin || isManager) && (
          <ConflictWarningDialog
            open={conflictDialogOpen}
            onOpenChange={setConflictDialogOpen}
            onConfirm={handleConflictConfirm}
            conflicts={conflicts}
          />
        )}

        {(isAdmin || isManager) && selectedDayForBreakdown && scheduleId && (
          <DayBreakdownDialog
            open={dayBreakdownOpen}
            onOpenChange={setDayBreakdownOpen}
            date={selectedDayForBreakdown}
            scheduleId={scheduleId}
            shifts={shifts}
            profiles={profiles}
            locationSettings={locationSettings}
          />
        )}

        {(isAdmin || isManager) && (
          <MobileShiftDialog
            open={isCreatingShift}
            onOpenChange={setIsCreatingShift}
            shift={{
              id: '',
              user_id: null,
              day_of_week: 0,
              start_time: '09:00',
              end_time: '17:00',
              shift_date: format(currentWeekStart, 'yyyy-MM-dd'),
            }}
            profiles={profiles}
            isAdmin={isAdmin || isManager}
            onShiftUpdated={fetchScheduleData}
            isCreating={true}
            scheduleId={scheduleId}
            templates={templates}
          />
        )}

        {(isAdmin || isManager) && (
          <AlertDialog open={clearScheduleDialogOpen} onOpenChange={setClearScheduleDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear Schedule</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove all shifts from the current week's schedule. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearSchedule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Clear Schedule
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {(isAdmin || isManager) && (
          <AlertDialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Withdraw Schedule
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will unpublish the schedule for this week. Team members will no longer see their shifts until you publish again. Use this if you published the schedule with mistakes that need to be corrected before anyone sees it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleWithdrawSchedule} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Withdraw Schedule
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {(isAdmin || isManager) && (
          <Dialog open={copyScheduleDialogOpen} onOpenChange={setCopyScheduleDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Copy Schedule to Future Week</DialogTitle>
                <DialogDescription>
                  Copy all shifts from this week to a future week. The schedule will remain unpublished.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="weeks">Weeks from now</Label>
                  <Input
                    id="weeks"
                    type="number"
                    min="1"
                    value={weeksToAdd}
                    onChange={(e) => setWeeksToAdd(parseInt(e.target.value) || 1)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Target week: {format(addWeeks(currentWeekStart, weeksToAdd), "MMM d, yyyy")} - {format(endOfWeek(addWeeks(currentWeekStart, weeksToAdd), { weekStartsOn: 1 }), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCopyScheduleDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCopySchedule}>
                  Copy Schedule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Role Change Confirmation Dialog */}
        <AlertDialog open={roleChangeDialogOpen} onOpenChange={setRoleChangeDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change User Role?</AlertDialogTitle>
              <AlertDialogDescription>
                Would you like to change {pendingRoleChange?.userName}'s role to {
                  pendingRoleChange?.newRole === 'team_member' ? 'Team Member' 
                  : pendingRoleChange?.newRole === 'shift_manager' ? 'Shift Manager'
                  : pendingRoleChange?.newRole === 'general_manager' ? 'General Manager'
                  : pendingRoleChange?.newRole
                }?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingRoleChange(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRoleChange}>
                Change Role
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      )}

      {/* Auto Schedule Wizard */}
      {currentLocation && (
        <AutoScheduleWizard
          open={autoScheduleOpen}
          onOpenChange={setAutoScheduleOpen}
          currentWeekStart={currentWeekStart}
          locationId={currentLocation.id}
          scheduleId={scheduleId}
          onScheduleGenerated={() => fetchScheduleData(false)}
        />
      )}
    </Layout>
  );
}
