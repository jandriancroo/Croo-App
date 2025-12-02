import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Settings, Calendar, MoreVertical, Copy, Trash2, Wrench, ChevronDown } from "lucide-react";
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
  notes: string | null;
  tagged_roles: string[] | null;
  is_recurring: boolean;
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
}

export default function Schedule() {
  const navigate = useNavigate();
  const { role, isAdmin, isManager } = useUserRole();
  const isMobile = useIsMobile();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
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
  const [publishedSnapshot, setPublishedSnapshot] = useState<any>(null);
  const [selectedDayForBreakdown, setSelectedDayForBreakdown] = useState<Date | null>(null);
  const [dayBreakdownOpen, setDayBreakdownOpen] = useState(false);
  const [clearScheduleDialogOpen, setClearScheduleDialogOpen] = useState(false);
  const [copyScheduleDialogOpen, setCopyScheduleDialogOpen] = useState(false);
  const [weeksToAdd, setWeeksToAdd] = useState(1);
  const [weeklyTotalSales, setWeeklyTotalSales] = useState(0);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [isCreatingShift, setIsCreatingShift] = useState(false);

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
    if (role) {
      fetchScheduleData();
    }
  }, [currentWeekStart, role]);

  const fetchScheduleData = async () => {
    setLoading(true);
    try {
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      // Fetch or create schedule for this week
      let { data: scheduleData, error: scheduleError } = await supabase
        .from("schedules")
        .select("*")
        .eq("week_start_date", format(currentWeekStart, "yyyy-MM-dd"))
        .single();

      if (scheduleError && scheduleError.code === "PGRST116") {
        // Schedule doesn't exist, create it if user can
        if (isAdmin || isManager) {
          const { data: newSchedule, error: createError } = await supabase
            .from("schedules")
            .insert({
              week_start_date: format(currentWeekStart, "yyyy-MM-dd"),
              week_end_date: format(weekEnd, "yyyy-MM-dd"),
            })
            .select()
            .single();

          if (createError) throw createError;
          scheduleData = newSchedule;
        }
      }

      if (!scheduleData) {
        setLoading(false);
        return;
      }

      setScheduleId(scheduleData.id);
      setIsPublished(scheduleData.is_published || false);
      setPublishedSnapshot(scheduleData.published_snapshot);

      // Parallelize all independent data fetches
      const [
        shiftsResult,
        eventsResult,
        recurringEventsResult,
        profilesResult,
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
          .select("*")
          .eq("schedule_id", scheduleData.id),
        
        // Fetch recurring events (not tied to specific schedule)
        supabase
          .from("schedule_events")
          .select("*")
          .eq("is_recurring", true)
          .is("schedule_id", null),
        
        // Fetch all profiles
        supabase
          .from("profiles")
          .select(`
            id, 
            full_name, 
            profile_photo_url,
            hourly_wage,
            display_order
          `)
          .eq("is_active", true),
        
        // Fetch user roles
        supabase
          .from("user_roles")
          .select("user_id, role"),
        
        // Fetch shift templates
        supabase
          .from("shift_templates")
          .select("*"),
        
        // Fetch availability requests
        supabase
          .from("availability_requests")
          .select("*")
          .eq("request_type", "unpaid")
          .in("status", ["pending", "approved"])
          .gte("start_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("start_date", format(weekEnd, "yyyy-MM-dd")),
        
        // Fetch projected sales for the week
        scheduleData ? supabase
          .from("schedule_projected_sales")
          .select("*")
          .eq("schedule_id", scheduleData.id) : Promise.resolve({ data: [], error: null }),
        
        // Fetch holidays for the week
        supabase
          .from("holidays")
          .select("*")
          .gte("holiday_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("holiday_date", format(weekEnd, "yyyy-MM-dd")),
        
        // Fetch location blackout dates
        supabase
          .from("location_settings")
          .select("blackout_dates")
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
        is_recurring: event.is_recurring ?? true
      }));
      
      const recurringEvents = (recurringEventsResult.data || []).map(event => ({
        ...event,
        tagged_roles: event.tagged_roles as string[] | null,
        is_recurring: true
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

      // Handle profiles and roles
      if (profilesResult.error) throw profilesResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const profilesWithRoles = (profilesResult.data || []).map(profile => {
        const userRole = rolesResult.data?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          role: userRole?.role || 'team_member',
          display_order: profile.display_order ?? 0
        };
      });

      // Sort by role first, then by display_order within each role
      const roleOrder = { admin: 0, manager: 1, team_member: 2 };
      profilesWithRoles.sort((a, b) => {
        const aRoleOrder = roleOrder[a.role as keyof typeof roleOrder] ?? 3;
        const bRoleOrder = roleOrder[b.role as keyof typeof roleOrder] ?? 3;
        
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
        setHolidays(holidaysResult.data || []);
      }

      // Handle blackout dates
      if (locationSettingsResult && !locationSettingsResult.error && locationSettingsResult.data) {
        setBlackoutDates(locationSettingsResult.data.blackout_dates || []);
      } else {
        setBlackoutDates([]);
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

      const reqDate = new Date(request.start_date);
      const cellDate = new Date(shiftDate);

      if (request.time_scope === "multi_day" && request.end_date) {
        const endDate = new Date(request.end_date);
        return cellDate >= reqDate && cellDate <= endDate;
      }
      return reqDate.toDateString() === cellDate.toDateString();
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
      
      // Only allow reordering within the same role
      if (activeProfile && overProfile && activeProfile.role === overProfile.role) {
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
          
          // Update local state
          const newProfiles = profiles.map(p => {
            const reordered = reorderedRoleProfiles.find(rp => rp.id === p.id);
            if (reordered) {
              const newOrder = reorderedRoleProfiles.findIndex(rp => rp.id === p.id);
              return { ...p, display_order: newOrder };
            }
            return p;
          });
          
          setProfiles(newProfiles);
          toast.success("Employee order updated");
        } catch (error) {
          console.error("Error updating employee order:", error);
          toast.error("Failed to update employee order");
        }
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
      // If schedule is published, unpublish it when making changes
      if (isPublished && scheduleId) {
        await supabase
          .from('schedules')
          .update({ is_published: false })
          .eq('id', scheduleId);
        setIsPublished(false);
      }

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
        fetchScheduleData();
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
        fetchScheduleData();
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

      // Unpublish the schedule after clearing
      await supabase
        .from("schedules")
        .update({ is_published: false, published_snapshot: null })
        .eq("id", scheduleId);

      toast.success("Schedule cleared successfully");
      setClearScheduleDialogOpen(false);
      fetchScheduleData();
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

      // If republishing, detect and notify changes
      if (publishedSnapshot) {
        const changes = detectScheduleChanges(publishedSnapshot, currentShifts || []);
        
        if (changes.length > 0) {
          // Log changes and prepare notifications
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
          
          // Notify affected users of changes
          const affectedUserIds = [...new Set(changes.map(c => c.user_id))];
          if (affectedUserIds.length > 0) {
            await supabase.functions.invoke('send-push-notification', {
              body: {
                user_ids: affectedUserIds,
                title: 'Weekly Schedule Updated',
                body: `Schedule for ${dateRange} has been updated`,
                notification_type: 'schedule_updates',
                data: { type: 'schedule_update', schedule_id: scheduleId }
              }
            });
          }
          
          toast.success(`Schedule published! ${changes.length} change(s) notified to affected employees.`);
        } else {
          toast.success("Schedule published!");
        }
      } else {
        // First publish - notify all users with shifts
        if (usersWithShifts.length > 0) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: usersWithShifts,
              title: 'Weekly Schedule Posted',
              body: `New schedule for ${dateRange}`,
              notification_type: 'schedule_updates',
              data: { type: 'schedule_update', schedule_id: scheduleId }
            }
          });
        }
        toast.success("Schedule published! Team members have been notified.");
      }

      // Update schedule with new snapshot
      const { error } = await supabase
        .from('schedules')
        .update({ 
          is_published: true,
          published_snapshot: currentShifts
        })
        .eq('id', scheduleId);

      if (error) throw error;

      setIsPublished(true);
      setPublishedSnapshot(currentShifts);
    } catch (error: any) {
      console.error('Error publishing schedule:', error);
      toast.error("Failed to publish schedule");
    } finally {
      setIsPublishing(false);
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

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading schedule...</p>
        </div>
      </Layout>
    );
  }

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
          scheduleId={scheduleId}
          templates={templates}
        />
      ) : (
        <div className="space-y-6 pb-20">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={handlePreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-3xl font-bold">
              {format(currentWeekStart, "MMM d, yyyy")} - {format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), "MMM d, yyyy")}
            </h1>
            <Button variant="outline" size="icon" onClick={handleNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex gap-2">
            {(isAdmin || isManager) && (
              <>
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
                    <DropdownMenuItem onClick={() => navigate("/shift-templates")} className="gap-2 cursor-pointer">
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
                  </DropdownMenuContent>
                </DropdownMenu>
                {scheduleId && (
                  <LiveStatusBadge
                    isPublished={isPublished}
                    isPublishing={isPublishing}
                    onGoLive={handleGoLive}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <DndContext 
          sensors={sensors} 
          onDragStart={handleDragStart} 
          onDragEnd={handleDragEnd}
          collisionDetection={closestCenter}
        >
          <Card className="p-6 overflow-x-auto">
            {/* Week Day Headers */}
            <div className="grid grid-cols-8 gap-0 border-b-2 border-border">
              <div className="font-semibold p-2 border-r border-border bg-muted/50 text-xs"></div>
              {weekDays.map((day, index) => {
                const dayString = format(day, "yyyy-MM-dd");
                const dayHolidays = holidays.filter(h => h.holiday_date === dayString);
                const isBlackout = blackoutDates.includes(dayString);
                
                return (
                  <div 
                    key={index} 
                    className="text-center p-2 border-r last:border-r-0 border-border bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => {
                      setSelectedDayForBreakdown(day);
                      setDayBreakdownOpen(true);
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

            {/* Events Section */}
            <div className="border-b border-border">
              <EventRow events={events} scheduleId={scheduleId} isEditable={isAdmin || isManager} onUpdate={fetchScheduleData} />
            </div>

            {/* Shifts by User - Grouped by Role */}
            <div className="divide-y divide-border">
              {['admin', 'manager', 'team_member'].map((roleFilter) => {
                const roleProfiles = profiles.filter(p => p.role === roleFilter);
                if (roleProfiles.length === 0) return null;

                const roleColorClass = roleFilter === 'admin' 
                  ? 'bg-role-admin/5 border-l-4 border-role-admin' 
                  : roleFilter === 'manager'
                  ? 'bg-role-manager/5 border-l-4 border-role-manager'
                  : 'bg-role-team-member/5 border-l-4 border-role-team-member';

                return (
                  <div key={roleFilter} className={`${roleColorClass}`}>
                    <div className="px-3 py-1 font-semibold text-sm uppercase tracking-wide">
                      {roleFilter === 'team_member' ? 'Team Members' : `${roleFilter}s`}
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
              />
            </div>
          </Card>

          {/* Floating Templates Bar - Bottom */}
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
                <div className="flex items-center gap-3 border-t border-border pt-1">
                  <h3 className="font-semibold whitespace-nowrap text-xs">Templates:</h3>
                  {templates.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto flex-1">
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

          <DragOverlay>{activeShift ? <ShiftCard shift={activeShift} isDragging /> : null}</DragOverlay>
        </DndContext>

        {editingShift && (
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
          />
        )}

        <ConflictWarningDialog
          open={conflictDialogOpen}
          onOpenChange={setConflictDialogOpen}
          onConfirm={handleConflictConfirm}
          conflicts={conflicts}
        />

        {selectedDayForBreakdown && scheduleId && (
          <DayBreakdownDialog
            open={dayBreakdownOpen}
            onOpenChange={setDayBreakdownOpen}
            date={selectedDayForBreakdown}
            scheduleId={scheduleId}
            shifts={shifts}
            profiles={profiles}
          />
        )}

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
      </div>
      )}
    </Layout>
  );
}
