import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useTeamScheduleVisibility } from "@/hooks/useTeamScheduleVisibility";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Settings, Calendar, Copy, Trash2, Wrench, ChevronDown, AlertTriangle, Sparkles, History, Minimize2, Maximize2, Printer } from "lucide-react";
import { exportScheduleToPrint } from "@/utils/exportSchedulePrint";
import { Badge } from "@/components/ui/badge";
import { DateNavigator } from "@/components/ui/date-navigator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isSameWeek } from "date-fns";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";
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
import { ChangeTrackingDialog } from "@/components/schedule/ChangeTrackingDialog";
import { filterEventsByRole } from "@/utils/eventRoleFilter";

// Cache time constants
const SCHEDULE_STALE_TIME = 15 * 60 * 1000; // 15 minutes for current/next week
const SCHEDULE_STALE_TIME_PAST = Infinity; // Past weeks never change - cache forever
const SCHEDULE_GC_TIME = 60 * 60 * 1000; // 60 minutes - keep in cache longer

interface DayAvailability {
  available: boolean;
  start?: string;
  end?: string;
}

interface WeeklyAvailability {
  monday?: DayAvailability;
  tuesday?: DayAvailability;
  wednesday?: DayAvailability;
  thursday?: DayAvailability;
  friday?: DayAvailability;
  saturday?: DayAvailability;
  sunday?: DayAvailability;
}

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  role?: string;
  hourly_wage?: number;
  display_order?: number;
  weekly_availability?: WeeklyAvailability | null;
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
  const { role, isAdmin, isManager, canViewAllWages } = useUserRole();
  const { canSeeFullSchedule, loading: scheduleVisibilityLoading } = useTeamScheduleVisibility();
  const { currentLocation } = useAppLocation();
  const isMobile = useIsMobile();
  const { timezone, getTodayInTimezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const didInitWeek = useRef(false);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const stickyHeaderScrollRef = useRef<HTMLDivElement>(null);
  const scheduleBodyRef = useRef<HTMLDivElement>(null);
  const [navbarHeight, setNavbarHeight] = useState(52);

  // Measure actual navbar height for sticky offset
  useEffect(() => {
    const measureHeader = () => {
      // Find the visible sticky header (desktop or mobile)
      const headers = document.querySelectorAll('header');
      for (const header of headers) {
        if (header.offsetHeight > 0 && getComputedStyle(header).position === 'sticky') {
          setNavbarHeight(header.getBoundingClientRect().height);
          break;
        }
      }
    };
    measureHeader();
    window.addEventListener('resize', measureHeader);
    return () => window.removeEventListener('resize', measureHeader);
  }, []);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<any>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingShiftData, setPendingShiftData] = useState<any>(null);
  const [conflicts, setConflicts] = useState<any[]>([]);
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
  const [changeTrackingOpen, setChangeTrackingOpen] = useState(false);
  const [roleChangeDialogOpen, setRoleChangeDialogOpen] = useState(false);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    userId: string;
    userName: string;
    newRole: string;
  } | null>(null);
   const [currentWeekWarningOpen, setCurrentWeekWarningOpen] = useState(false);
   const [pendingEditAction, setPendingEditAction] = useState<(() => void) | null>(null);
   const [isCompactMode, setIsCompactMode] = useState(false);

  // Get current user ID from auth context (no duplicate fetch needed)
  const { user } = useAuth();
  useEffect(() => {
    setCurrentUserId(user?.id || null);
  }, [user?.id]);

  // Initialize week start based on the location timezone (one-time)
  useEffect(() => {
    if (didInitWeek.current) return;
    if (!timezone) return;

    const todayStr = getTodayInTimezone();
    const [y, m, d] = todayStr.split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    setCurrentWeekStart(startOfWeek(localDate, { weekStartsOn: 1 }));
    didInitWeek.current = true;
  }, [timezone, getTodayInTimezone]);

  // Empty sensors array must be stable (same reference) to avoid DndContext re-render issues
  const emptySensors = useMemo(() => [], []);
  
  const activeSensors = useSensors(
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

  // Determine "this week" using the location's timezone (prevents off-by-one-week bugs)
  const thisWeekStart = useMemo(() => {
    try {
      const todayStr = getTodayInTimezone();
      const [y, m, d] = todayStr.split('-').map(Number);
      if (!y || !m || !d) return startOfWeek(new Date(), { weekStartsOn: 1 });
      return startOfWeek(new Date(y, m - 1, d), { weekStartsOn: 1 });
    } catch {
      return startOfWeek(new Date(), { weekStartsOn: 1 });
    }
  }, [getTodayInTimezone]);

  // Determine if viewing a past week (for infinite cache)
  const todayStart = thisWeekStart;
  const isPastWeek = currentWeekStart < todayStart;

  // Query key for the schedule data - includes location and week
  const scheduleQueryKey = ['schedule', currentLocation?.id, format(currentWeekStart, 'yyyy-MM-dd')];

  // Separate query for stable data (profiles, templates) - shared across all weeks
  const stableDataQueryKey = ['schedule-stable', currentLocation?.id];
  
  const { data: stableData } = useQuery({
    queryKey: stableDataQueryKey,
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      
      const [userLocationsResult, allProfilesResult, rolesResult, templatesResult] = await Promise.all([
        supabase
          .from("user_locations")
          .select("user_id, show_on_schedule")
          .eq("location_id", currentLocation.id),
        supabase
          .from("profiles")
          .select(`id, full_name, profile_photo_url, hourly_wage, display_order, appears_on_schedule, weekly_availability`)
          .eq("is_active", true)
          .eq("appears_on_schedule", true),
        supabase.from("user_roles").select("user_id, role"),
        supabase
          .from("shift_templates")
          .select("*")
          .eq("location_id", currentLocation.id)
          .order("start_time", { ascending: true }),
      ]);

      if (userLocationsResult.error) throw userLocationsResult.error;
      if (allProfilesResult.error) throw allProfilesResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (templatesResult.error) throw templatesResult.error;

      const locationUserIds = new Set((userLocationsResult.data || []).filter(ul => ul.show_on_schedule !== false).map((ul) => ul.user_id));
      
      const locationProfiles = (allProfilesResult.data || []).filter((p) => locationUserIds.has(p.id));
      
      const profilesWithRoles = locationProfiles.map(profile => {
        const userRole = rolesResult.data?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          weekly_availability: profile.weekly_availability as WeeklyAvailability | null,
          role: userRole?.role || 'team_member',
          display_order: profile.display_order ?? 0
        };
      });
      
      const roleOrder: Record<string, number> = { 
        super_admin: 0, brand_admin: 1, org_admin: 2, admin: 3, 
        manager: 4, shift_manager: 5, team_member: 6 
      };
      profilesWithRoles.sort((a, b) => {
        const aRoleOrder = roleOrder[a.role as string] ?? 5;
        const bRoleOrder = roleOrder[b.role as string] ?? 5;
        if (aRoleOrder === bRoleOrder) {
          return (a.display_order ?? 0) - (b.display_order ?? 0);
        }
        return aRoleOrder - bRoleOrder;
      });

      return {
        profiles: profilesWithRoles,
        templates: templatesResult.data || [],
        locationUserIds: Array.from(locationUserIds),
      };
    },
    enabled: !!currentLocation?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes - profiles/templates rarely change
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData, // Show previous data instantly while refetching
  });

  // Main schedule data query with React Query caching
  const { 
    data: scheduleData, 
    isLoading: loading, 
    isFetching,
    refetch: refetchSchedule 
  } = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: async () => {
      const perfStart = performance.now();
      console.log('[Schedule] fetchScheduleData started');
      
      if (!currentLocation?.id) return null;
      
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      // Fetch or create schedule for this week and location
      let { data: schedule, error: scheduleError } = await supabase
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
          schedule = newSchedule;
        }
      }

      if (!schedule) {
        return {
          scheduleId: null,
          isPublished: false,
          publishedSnapshot: [],
          shifts: [],
          events: [],
          profiles: stableData?.profiles ?? [],
          templates: stableData?.templates ?? [],
          availabilityRequests: [],
        };
      }

      console.log(`[Schedule] Schedule lookup: ${(performance.now() - perfStart).toFixed(0)}ms`);
      
      // Only fetch week-specific data - profiles/templates come from stableData
      // Fetch last week's schedule ID for Smart Tap recent templates
      const lastWeekDate = format(addDays(currentWeekStart, -7), 'yyyy-MM-dd');
      const { data: lastWeekSchedule } = await supabase
        .from("schedules")
        .select("id")
        .eq("week_start_date", lastWeekDate)
        .eq("location_id", currentLocation.id)
        .single();

      const parallelStart = performance.now();
      const [
        shiftsResult,
        eventsResult,
        recurringEventsResult,
        availabilityResult,
        salesResult,
        holidaysResult,
        locationSettingsResult,
        lastWeekShiftsResult
      ] = await Promise.all([
        supabase
          .from("scheduled_shifts")
          .select(`*, template:shift_templates(*)`)
          .eq("schedule_id", schedule.id),
        supabase
          .from("schedule_events")
          .select("*, event_categories(name, color)")
          .eq("schedule_id", schedule.id),
        supabase
          .from("schedule_events")
          .select("*, event_categories(name, color)")
          .eq("is_recurring", true)
          .is("schedule_id", null)
          .eq("location_id", currentLocation.id),
        supabase
          .from("availability_requests")
          .select("*")
          .eq("location_id", currentLocation.id)
          .eq("request_type", "unpaid")
          .in("status", ["pending", "approved"])
          .gte("start_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("start_date", format(weekEnd, "yyyy-MM-dd")),
        supabase
          .from("schedule_projected_sales")
          .select("*")
          .eq("schedule_id", schedule.id),
        supabase
          .from("holidays")
          .select("*")
          .or(`location_id.eq.${currentLocation.id},location_id.is.null`)
          .gte("holiday_date", format(currentWeekStart, "yyyy-MM-dd"))
          .lte("holiday_date", format(weekEnd, "yyyy-MM-dd")),
        supabase
          .from("location_settings")
          .select("blackout_dates, hours_open, hours_close")
          .eq("location_id", currentLocation.id)
          .single(),
        // Smart Tap: fetch last week's shifts for "recent" templates
        lastWeekSchedule?.id
          ? supabase
              .from("scheduled_shifts")
              .select("user_id, template_id, shift_date")
              .eq("schedule_id", lastWeekSchedule.id)
              .not("template_id", "is", null)
          : Promise.resolve({ data: [], error: null })
      ]);

      console.log(`[Schedule] Parallel queries: ${(performance.now() - parallelStart).toFixed(0)}ms`);

      // Process shifts
      if (shiftsResult.error) throw shiftsResult.error;
      const shifts = shiftsResult.data || [];
      
      // Process last week's shifts for Smart Tap
      const lastWeekShifts = (lastWeekShiftsResult as any)?.data || [];

      // Process events - combine schedule-specific and recurring
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
      
      const allEvents: ScheduleEvent[] = [...scheduleEvents];
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
      
      // Filter events by user role visibility
      const roleFilteredEvents = filterEventsByRole(allEvents, role);

      // Use cached profiles from stableData, with fallback for team members
      let profilesWithRoles = stableData?.profiles ?? [];
      
      // For team members who can see full schedule, augment with shift user IDs
      const isTeamMemberContext = !isAdmin && !isManager;
      if (isTeamMemberContext && canSeeFullSchedule && !scheduleVisibilityLoading && profilesWithRoles.length === 0) {
        // Fallback: fetch profiles from shifts
        const shiftUserIds = Array.from(new Set(shifts.map((s) => s.user_id).filter(Boolean) as string[]));
        if (shiftUserIds.length > 0) {
          const { data: shiftProfiles } = await supabase
            .from('profiles')
            .select('id, full_name, profile_photo_url, hourly_wage, display_order, appears_on_schedule, weekly_availability')
            .in('id', shiftUserIds);
          
          const { data: roles } = await supabase.from("user_roles").select("user_id, role");
          
          profilesWithRoles = (shiftProfiles || []).map(profile => {
            const userRole = roles?.find(r => r.user_id === profile.id);
            return {
              ...profile,
              weekly_availability: profile.weekly_availability as WeeklyAvailability | null,
              role: userRole?.role || 'team_member',
              display_order: profile.display_order ?? 0
            };
          });
        }
      }

      // Process templates from stableData
      const templates = stableData?.templates ?? [];

      // Process availability
      if (availabilityResult.error) throw availabilityResult.error;
      const availabilityRequests = availabilityResult.data || [];

      // Process sales
      let totalSales = 0;
      if (!salesResult.error && salesResult.data) {
        totalSales = (salesResult.data as any[]).reduce((sum: number, sale: any) => 
          sum + (Number(sale.projected_sales) || 0), 0);
      }

      // Process holidays
      let processedHolidays: Holiday[] = [];
      if (!holidaysResult.error && holidaysResult.data) {
        processedHolidays = (holidaysResult.data as Holiday[]).filter(
          h => h.holiday_type !== 'birthday' || h.location_id === currentLocation.id
        );
      }

      // Process location settings
      let processedBlackoutDates: string[] = [];
      let processedLocationSettings: { hours_open?: string; hours_close?: string } | null = null;
      if (!locationSettingsResult.error && locationSettingsResult.data) {
        processedBlackoutDates = locationSettingsResult.data.blackout_dates || [];
        processedLocationSettings = {
          hours_open: locationSettingsResult.data.hours_open || undefined,
          hours_close: locationSettingsResult.data.hours_close || undefined
        };
      }

      // Sync birthday holidays (throttled)
      const lastBirthdaySync = sessionStorage.getItem('lastBirthdaySyncTime');
      const now = Date.now();
      if (!lastBirthdaySync || now - parseInt(lastBirthdaySync) > 300000) {
        sessionStorage.setItem('lastBirthdaySyncTime', now.toString());
        supabase.functions.invoke('data-sync-service?action=sync-birthday-events').catch(err =>
          console.error('Failed to sync birthday holidays:', err)
        );
      }

      console.log(`[Schedule] fetchScheduleData completed: ${(performance.now() - perfStart).toFixed(0)}ms total`);

      // Update side-effect state that isn't part of main query data
      setWeeklyTotalSales(totalSales);
      setHolidays(processedHolidays);
      setBlackoutDates(processedBlackoutDates);
      setLocationSettings(processedLocationSettings);

      return {
        scheduleId: schedule.id,
        isPublished: schedule.is_published || false,
        publishedSnapshot: (Array.isArray(schedule.published_shifts_snapshot) 
          ? schedule.published_shifts_snapshot 
          : []) as unknown as ScheduledShift[],
        shifts,
        events: roleFilteredEvents,
        profiles: profilesWithRoles,
        templates,
        availabilityRequests,
        lastStatusChangedAt: schedule.last_status_changed_at,
        lastStatusChangedBy: schedule.last_status_changed_by,
        lastStatusAction: schedule.last_status_action,
        lastWeekShifts,
      };
    },
    enabled: !!role && !!currentLocation?.id && !!stableData,
    // Past weeks use infinite staleTime (they never change)
    staleTime: isPastWeek ? SCHEDULE_STALE_TIME_PAST : SCHEDULE_STALE_TIME,
    gcTime: SCHEDULE_GC_TIME,
    // Show stale data immediately while refetching in background
    placeholderData: (previousData) => previousData,
  });

  // Prefetch adjacent weeks for instant navigation
  useEffect(() => {
    if (!role || !currentLocation?.id || !stableData) return;

    const prefetchWeek = (weekStart: Date) => {
      const weekKey = ['schedule', currentLocation.id, format(weekStart, 'yyyy-MM-dd')];
      const weekEndDate = endOfWeek(weekStart, { weekStartsOn: 1 });
      
      // Check if data is already cached and fresh
      const existingData = queryClient.getQueryData(weekKey);
      if (existingData) return; // Already have data, skip prefetch
      
      queryClient.prefetchQuery({
        queryKey: weekKey,
        queryFn: async () => {
          const { data: schedule } = await supabase
            .from("schedules")
            .select("id, is_published, published_shifts_snapshot, last_status_changed_at, last_status_changed_by, last_status_action")
            .eq("week_start_date", format(weekStart, "yyyy-MM-dd"))
            .eq("location_id", currentLocation.id)
            .single();

          if (!schedule) return null;

          // Fetch week-specific data in parallel
          const [shiftsResult, eventsResult, recurringEventsResult, availabilityResult] = await Promise.all([
            supabase
              .from("scheduled_shifts")
              .select(`*, template:shift_templates(*)`)
              .eq("schedule_id", schedule.id),
            supabase
              .from("schedule_events")
              .select("*, event_categories(name, color)")
              .eq("schedule_id", schedule.id),
            supabase
              .from("schedule_events")
              .select("*, event_categories(name, color)")
              .eq("is_recurring", true)
              .is("schedule_id", null)
              .eq("location_id", currentLocation.id),
            supabase
              .from("availability_requests")
              .select("*")
              .eq("location_id", currentLocation.id)
              .eq("request_type", "unpaid")
              .in("status", ["pending", "approved"])
              .gte("start_date", format(weekStart, "yyyy-MM-dd"))
              .lte("start_date", format(weekEndDate, "yyyy-MM-dd")),
          ]);

          // Process events
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
          
          const allEvents: ScheduleEvent[] = [...scheduleEvents];
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

          return {
            scheduleId: schedule.id,
            isPublished: schedule.is_published || false,
            publishedSnapshot: (Array.isArray(schedule.published_shifts_snapshot) 
              ? schedule.published_shifts_snapshot 
              : []) as unknown as ScheduledShift[],
            shifts: shiftsResult.data || [],
            events: filterEventsByRole(allEvents, role),
            profiles: stableData.profiles, // Use cached stable data
            templates: stableData.templates, // Use cached stable data
            availabilityRequests: availabilityResult.data || [],
            lastStatusChangedAt: schedule.last_status_changed_at,
            lastStatusChangedBy: schedule.last_status_changed_by,
            lastStatusAction: schedule.last_status_action,
          };
        },
        // Full prefetch with proper staleTime for instant navigation
        staleTime: SCHEDULE_STALE_TIME,
      });
    };

    // Prefetch previous and next week
    prefetchWeek(subWeeks(currentWeekStart, 1));
    prefetchWeek(addWeeks(currentWeekStart, 1));
  }, [currentWeekStart, currentLocation?.id, role, queryClient, stableData]);

  // Extract data from query result with defaults
  const scheduleId = scheduleData?.scheduleId ?? null;
  const isPublished = scheduleData?.isPublished ?? false;
  const publishedSnapshot = scheduleData?.publishedSnapshot ?? [];
  const shifts = scheduleData?.shifts ?? [];
  const lastWeekShifts = scheduleData?.lastWeekShifts ?? [];
  const events = scheduleData?.events ?? [];
  const profiles = scheduleData?.profiles ?? [];
  const templates = scheduleData?.templates ?? [];
  const availabilityRequests = scheduleData?.availabilityRequests ?? [];
  const lastStatusChangedAt = scheduleData?.lastStatusChangedAt ?? null;
  const lastStatusChangedBy = scheduleData?.lastStatusChangedBy ?? null;
  const lastStatusAction = scheduleData?.lastStatusAction ?? null;

  // Fetch the name of the user who last changed the status (may not be in current location's profiles)
  const { data: statusChangerProfile } = useQuery({
    queryKey: ['profile-name', lastStatusChangedBy],
    queryFn: async () => {
      if (!lastStatusChangedBy) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', lastStatusChangedBy)
        .single();
      return data;
    },
    enabled: !!lastStatusChangedBy,
    staleTime: Infinity, // Names don't change often
  });
  const lastStatusChangedByName = statusChangerProfile?.full_name || profiles.find(p => p.id === lastStatusChangedBy)?.full_name || null;

  // Helper to refetch schedule data after mutations
  const fetchScheduleData = useCallback((showLoading = true) => {
    // If we previously prefetched a lightweight week payload, force a fresh fetch
    // so profiles/events/etc are always present.
    queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    refetchSchedule();
  }, [queryClient, scheduleQueryKey, refetchSchedule]);

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
      // Optimistic UI update - update query cache immediately
      const newProfiles = profiles.map(p => {
        const reorderedIndex = reorderedRoleProfiles.findIndex(rp => rp.id === p.id);
        if (reorderedIndex !== -1) {
          return { ...p, display_order: reorderedIndex };
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
      
      // Apply optimistic update to React Query cache
      queryClient.setQueryData(scheduleQueryKey, (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          profiles: newProfiles
        };
      });
      
      // Persist to database in background
      try {
        await Promise.all(
          reorderedRoleProfiles.map((profile, index) =>
            supabase
              .from('profiles')
              .update({ display_order: index })
              .eq('id', profile.id)
          )
        );
        toast.success("Employee order updated");
      } catch (error) {
        console.error("Error updating employee order:", error);
        toast.error("Failed to update employee order");
        // Rollback on failure - refetch from server
        fetchScheduleData(false);
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

    // Prevent dropping on unassigned - shifts must always have an employee
    if (userId === "unassigned") {
      toast.error("Shifts must be assigned to an employee");
      return;
    }

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

    // No conflicts, proceed with scheduling (with current week warning if applicable)
    if (isCurrentWeek() && isPublished) {
      setPendingEditAction(() => () => executeShiftOperation(active, userId, dayIndex, shiftDate));
      setCurrentWeekWarningOpen(true);
    } else {
      await executeShiftOperation(active, userId, dayIndex, shiftDate);
    }
  };

  const executeShiftOperation = async (active: any, userId: string, dayIndex: number, shiftDate: string) => {
    // Prevent creating unassigned shifts
    if (userId === "unassigned") {
      toast.error("Shifts must be assigned to an employee");
      return;
    }

    // Snapshot current data for potential rollback
    const previousData = queryClient.getQueryData(scheduleQueryKey);

    const isFromTemplate = active.data?.current?.isTemplate || active.isTemplate;
    const template = active.data?.current?.template || active.template;
    const existingShift = active.data?.current || active;

    // Generate temporary ID for new shifts
    const tempId = `temp-${Date.now()}`;

    // Optimistically update the cache immediately
    queryClient.setQueryData(scheduleQueryKey, (old: any) => {
      if (!old) return old;

      if (isFromTemplate) {
        // Adding new shift from template - create optimistic shift object
        const optimisticShift = {
          id: tempId,
          schedule_id: scheduleId,
          template_id: template.id,
          user_id: userId,
          day_of_week: dayIndex,
          shift_date: shiftDate,
          start_time: template.start_time,
          end_time: template.end_time,
          is_time_off: false,
          template: template,
          _optimistic: true, // Mark as optimistic for visual feedback
        };
        return {
          ...old,
          shifts: [...old.shifts, optimisticShift],
        };
      } else {
        // Moving existing shift - update in place
        return {
          ...old,
          shifts: old.shifts.map((s: any) =>
            s.id === existingShift.id
              ? { ...s, user_id: userId, day_of_week: dayIndex, shift_date: shiftDate, _optimistic: true }
              : s
          ),
        };
      }
    });

    // Perform database operation in background
    try {
      if (isFromTemplate) {
        const { data: insertedShift, error } = await supabase
          .from("scheduled_shifts")
          .insert({
            schedule_id: scheduleId,
            template_id: template.id,
            user_id: userId,
            day_of_week: dayIndex,
            shift_date: shiftDate,
            start_time: template.start_time,
            end_time: template.end_time,
            is_time_off: false,
          })
          .select(`*, template:shift_templates(*)`)
          .single();

        if (error) throw error;

        // Replace temp shift with real one from DB
        queryClient.setQueryData(scheduleQueryKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            shifts: old.shifts.map((s: any) =>
              s.id === tempId ? { ...insertedShift, _optimistic: false } : s
            ),
          };
        });

        toast.success("Shift added");
      } else {
        const { error } = await supabase
          .from("scheduled_shifts")
          .update({
            user_id: userId,
            day_of_week: dayIndex,
            shift_date: shiftDate,
          })
          .eq("id", existingShift.id);

        if (error) throw error;

        // Clear optimistic flag
        queryClient.setQueryData(scheduleQueryKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            shifts: old.shifts.map((s: any) =>
              s.id === existingShift.id ? { ...s, _optimistic: false } : s
            ),
          };
        });

        toast.success("Shift moved");
      }
    } catch (error: any) {
      console.error("Error handling drop:", error);
      // Rollback to previous state
      queryClient.setQueryData(scheduleQueryKey, previousData);
      toast.error("Failed to update shift");
    }
  };

  // Smart Tap: clicking an empty cell creates a shift from the selected template
  const handleSmartTap = async (userId: string, dayIndex: number, shiftDate: string, template: any) => {
    if (!scheduleId) return;
    
    // Build a fake "active" object that mimics a drag from template
    const fakeActive = {
      data: { current: { isTemplate: true, template } },
      isTemplate: true,
      template,
    };

    // Check for conflicts first
    const detectedConflicts = checkForConflicts(userId, dayIndex, shiftDate);
    if (detectedConflicts.length > 0) {
      setPendingShiftData({
        type: "template",
        active: fakeActive,
        userId,
        dayIndex,
        shiftDate,
      });
      setConflicts(detectedConflicts);
      setConflictDialogOpen(true);
      return;
    }

    // Current week warning
    if (isCurrentWeek() && isPublished) {
      setPendingEditAction(() => () => executeShiftOperation(fakeActive, userId, dayIndex, shiftDate));
      setCurrentWeekWarningOpen(true);
    } else {
      await executeShiftOperation(fakeActive, userId, dayIndex, shiftDate);
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
      // Refetch to update state
      await refetchSchedule();

      toast.success("Schedule cleared successfully");
      setClearScheduleDialogOpen(false);
      fetchScheduleData(false);
    } catch (error: any) {
      console.error("Error clearing schedule:", error);
      toast.error("Failed to clear schedule");
    }
  };

  const handleCopySchedule = async () => {
    if (!scheduleId || weeksToAdd < 1 || !currentLocation?.id) return;

    try {
      const targetWeekStart = addWeeks(currentWeekStart, weeksToAdd);
      const targetWeekEnd = endOfWeek(targetWeekStart, { weekStartsOn: 1 });

      // Check if target schedule already exists for this location
      const { data: existingSchedule } = await supabase
        .from("schedules")
        .select("id")
        .eq("week_start_date", format(targetWeekStart, "yyyy-MM-dd"))
        .eq("location_id", currentLocation.id)
        .single();

      let targetScheduleId = existingSchedule?.id;

      // Create target schedule if it doesn't exist
      if (!targetScheduleId) {
        const { data: newSchedule, error: createError } = await supabase
          .from("schedules")
          .insert({
            week_start_date: format(targetWeekStart, "yyyy-MM-dd"),
            week_end_date: format(targetWeekEnd, "yyyy-MM-dd"),
            location_id: currentLocation.id,
            is_published: false,
          })
          .select()
          .single();

        if (createError) throw createError;
        targetScheduleId = newSchedule.id;
      }

      // Copy all shifts to the target week
      const shiftsToCopy = shifts.map((shift) => {
        const shiftDate = parseDateStringInTimezone(shift.shift_date, timezone);
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
    const target = subWeeks(currentWeekStart, 1);
    if (currentLocation?.id) {
      queryClient.invalidateQueries({ queryKey: ['schedule', currentLocation.id, format(target, 'yyyy-MM-dd')] });
    }
    setCurrentWeekStart(target);
  };

  const handleNextWeek = () => {
    const target = addWeeks(currentWeekStart, 1);
    if (currentLocation?.id) {
      queryClient.invalidateQueries({ queryKey: ['schedule', currentLocation.id, format(target, 'yyyy-MM-dd')] });
    }
    setCurrentWeekStart(target);
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
      }

      // Send schedule emails to ALL employees with shifts (no permission check - fallback notification)
      if (currentLocation?.id) {
        supabase.functions.invoke('send-weekly-schedule-email', {
          body: {
            schedule_id: scheduleId,
            location_id: currentLocation.id
          }
        }).then(response => {
          if (response.error) {
            console.error('Failed to send schedule emails:', response.error);
          } else {
            console.log('Schedule emails sent:', response.data);
          }
        });
      }
        
      toast.success(`Schedule published! ${usersWithShifts.length} team member(s) notified.`);

      // Update schedule with new snapshot and audit info
      const { error } = await supabase
        .from('schedules')
        .update({ 
          is_published: true,
          published_shifts_snapshot: currentShifts,
          last_status_changed_at: new Date().toISOString(),
          last_status_changed_by: user?.id,
          last_status_action: 'published'
        })
        .eq('id', scheduleId);

      if (error) throw error;

      // Refetch to update state
      await refetchSchedule();
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
        
        // Log changes with who made them
        for (const change of changes) {
          await supabase
            .from('schedule_change_log')
            .insert({
              schedule_id: scheduleId,
              user_id: change.user_id,
              change_type: change.type,
              old_shift_data: change.oldShift,
              new_shift_data: change.newShift,
              changed_by: user?.id
            });
        }
        
        // Notify only affected users via push
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
        
        // Note: Push notifications are already sent above for affected employees
        // Email notifications can be added here if needed in the future
        
        toast.success(`Schedule updated! ${affectedUserIds.length} affected team member(s) notified.`);
      } else {
        toast.success("Schedule updated!");
      }

      // Mark all draft changes as published
      await supabase
        .from('schedule_change_log')
        .update({ is_draft: false })
        .eq('schedule_id', scheduleId)
        .eq('is_draft', true);

      // Update snapshot with audit info
      const { error } = await supabase
        .from('schedules')
        .update({ 
          published_shifts_snapshot: currentShifts,
          last_status_changed_at: new Date().toISOString(),
          last_status_changed_by: user?.id,
          last_status_action: 'updated'
        })
        .eq('id', scheduleId);

      if (error) throw error;

      await refetchSchedule();
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
          published_shifts_snapshot: null,
          last_status_changed_at: new Date().toISOString(),
          last_status_changed_by: user?.id,
          last_status_action: 'withdrawn'
        })
        .eq('id', scheduleId);

      if (error) throw error;

      // Refetch to update state
      await refetchSchedule();
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

  // Get week label relative to current week (computed in location timezone)
  const getWeekLabel = () => {
    if (isSameWeek(currentWeekStart, thisWeekStart, { weekStartsOn: 1 })) {
      return { label: "Current Week", variant: "default" as const };
    }

    const lastWeekStart = subWeeks(thisWeekStart, 1);
    if (isSameWeek(currentWeekStart, lastWeekStart, { weekStartsOn: 1 })) {
      return { label: "Last Week", variant: "secondary" as const };
    }

    const nextWeekStart = addWeeks(thisWeekStart, 1);
    if (isSameWeek(currentWeekStart, nextWeekStart, { weekStartsOn: 1 })) {
      return { label: "Next Week", variant: "outline" as const };
    }

    // Calculate weeks difference
    const diffTime = currentWeekStart.getTime() - thisWeekStart.getTime();
    const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000));

    if (diffWeeks < 0) {
      return { label: `${Math.abs(diffWeeks)} Weeks Ago`, variant: "secondary" as const };
    }
    return { label: `${diffWeeks} Weeks Ahead`, variant: "outline" as const };
  };

  // Check if viewing current week (for edit warning)
  const isCurrentWeek = () => {
    return isSameWeek(currentWeekStart, thisWeekStart, { weekStartsOn: 1 });
  };

  // Wrapper to show warning when editing current week
  const wrapEditAction = (action: () => void) => {
    if (isCurrentWeek() && isPublished) {
      setPendingEditAction(() => action);
      setCurrentWeekWarningOpen(true);
    } else {
      action();
    }
  };

  const handleRoleChange = async () => {
    if (!pendingRoleChange) return;
    
    try {
      // Update user_roles table
      const { error } = await supabase
        .from('user_roles')
        .update({ role: pendingRoleChange.newRole as 'admin' | 'manager' | 'shift_manager' | 'team_member' })
        .eq('user_id', pendingRoleChange.userId);
      
      if (error) throw error;
      
      // Update local state
      // Refetch to update profiles with new role
      fetchScheduleData(false);
      
      const roleDisplayName = pendingRoleChange.newRole === 'team_member' ? 'Team Member' 
        : pendingRoleChange.newRole === 'shift_manager' ? 'Shift Manager'
        : pendingRoleChange.newRole === 'manager' ? 'Manager'
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

  // Note: We no longer block on loading state - the UI renders immediately with skeleton/empty state
  // and data fills in as it arrives. This prevents the "blank page" issue.

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
          onWeekChange={(newWeek) => {
            // Invalidate the new week's query to force fresh data fetch
            // (prefetched data may be incomplete - missing profiles/events)
            queryClient.invalidateQueries({ 
              queryKey: ['schedule', currentLocation?.id, format(newWeek, 'yyyy-MM-dd')] 
            });
            setCurrentWeekStart(newWeek);
          }}
          onUpdate={fetchScheduleData}
          isPublished={isPublished}
          publishedSnapshot={publishedSnapshot}
          scheduleId={scheduleId}
          templates={templates}
          onGoLive={handleGoLive}
          onSendUpdate={handleUpdate}
          isPublishing={isPublishing}
          hasPendingChanges={hasPendingChanges}
          isLoading={loading}
        />
      ) : (
        <div className="pb-56">
        <DndContext 
          sensors={isTeamMemberDesktopView ? emptySensors : activeSensors}
          onDragStart={isTeamMemberDesktopView ? undefined : handleDragStart} 
          onDragEnd={isTeamMemberDesktopView ? undefined : handleDragEnd}
          collisionDetection={closestCenter}
        >
          <div className="relative">
            {/* Sticky floating header: date selector + tools + day headers + events */}
            <div 
              ref={stickyHeaderRef}
              className="sticky z-30 bg-card rounded-xl shadow-[0_8px_30px_-4px_hsl(var(--foreground)/0.15)] border border-border overflow-hidden"
              style={{ top: `${navbarHeight}px` }}
            >
            {/* Header toolbar */}
            <div className="flex items-center gap-2 md:gap-3 px-3 py-1.5 md:px-4 md:py-2 border-b border-border">
              <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0 overflow-hidden">
                <DateNavigator
                  onPrev={handlePreviousWeek}
                  onNext={handleNextWeek}
                  label={`${format(currentWeekStart, "MMM d")} - ${format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), "MMM d")}`}
                  leftAlignOnDesktop
                />
                <Badge variant={getWeekLabel().variant} className="whitespace-nowrap hidden lg:flex">
                  {getWeekLabel().label}
                </Badge>
              </div>
              {(isAdmin || isManager) && (
                <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                  <Button 
                    variant={isCompactMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => setIsCompactMode(!isCompactMode)}
                    className="gap-1.5 md:gap-2"
                    title={isCompactMode ? "Expand view" : "Compact view"}
                  >
                    {isCompactMode ? (
                      <>
                        <Maximize2 className="h-4 w-4" />
                        <span className="hidden lg:inline">Expand</span>
                      </>
                    ) : (
                      <>
                        <Minimize2 className="h-4 w-4" />
                        <span className="hidden lg:inline">Compact</span>
                      </>
                    )}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setAutoScheduleOpen(true)}
                    className="gap-1.5 md:gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span className="hidden lg:inline">Croo AI</span>
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => wrapEditAction(() => setIsCreatingShift(true))}
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
                    <DropdownMenuContent align="end" className="bg-background z-[60]">
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
                      <DropdownMenuItem onClick={() => setChangeTrackingOpen(true)} className="gap-2 cursor-pointer">
                        <History className="h-4 w-4" />
                        Change Tracking
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        const printProfiles = profiles.map((p: any) => ({
                          id: p.id,
                          fullName: p.full_name,
                          role: p.role,
                        }));
                        const printShifts = shifts.map((s: any) => {
                          const dayIdx = (new Date(s.shift_date).getDay() + 6) % 7;
                          return {
                            userId: s.user_id || "",
                            dayIndex: dayIdx,
                            startTime: s.start_time,
                            endTime: s.end_time,
                            isTimeOff: s.is_time_off,
                            templateName: s.template?.template_name,
                            templateColor: s.template?.color,
                          };
                        });
                        const printEvents = events.map((e: any) => ({
                          dayIndex: e.day_of_week,
                          name: e.event_name,
                          time: e.event_time,
                        }));
                        exportScheduleToPrint({
                          locationName: currentLocation?.name || "Schedule",
                          weekStart: currentWeekStart,
                          profiles: printProfiles,
                          shifts: printShifts,
                          events: printEvents,
                        });
                      }} className="gap-2 cursor-pointer">
                        <Printer className="h-4 w-4" />
                        Print Schedule
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => wrapEditAction(() => setClearScheduleDialogOpen(true))} className="gap-2 cursor-pointer text-destructive">
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
                      lastStatusChangedAt={lastStatusChangedAt}
                      lastStatusChangedByName={lastStatusChangedByName}
                      lastStatusAction={lastStatusAction}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Team member view-only badge */}
            {isTeamMemberDesktopView && (
              <div className="bg-muted/50 px-4 py-2 text-center border-b border-border">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">View Only</span> — Showing your shifts for this week
                </p>
              </div>
            )}

            {/* Day headers + Events - horizontally scrollable */}
            <div 
              ref={stickyHeaderScrollRef}
              className="overflow-x-auto scrollbar-none"
              onScroll={(e) => {
                if (scheduleBodyRef.current && scheduleBodyRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                  scheduleBodyRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
            {/* Week Day Headers */}
            <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0 border-b-2 border-border min-w-[700px]">
              <div className="font-semibold p-2 border-r border-border bg-muted/50 text-xs"></div>
              {weekDays.map((day, index) => {
                const dayString = format(day, "yyyy-MM-dd");
                const dayHolidays = holidays.filter(h => h.holiday_date === dayString);
                const isBlackout = blackoutDates.includes(dayString);
                const isToday = dayString === getTodayInTimezone();
                
                return (
                  <div 
                    key={index} 
                    className={`text-center ${isCompactMode ? 'py-1 px-0.5' : 'p-2'} border-r last:border-r-0 border-border ${isToday ? 'bg-primary text-primary-foreground' : 'bg-muted/50'} ${(isAdmin || isManager) ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                    onClick={() => {
                      if (isAdmin || isManager) {
                        setSelectedDayForBreakdown(day);
                        setDayBreakdownOpen(true);
                      }
                    }}
                  >
                    <div className={`font-semibold ${isCompactMode ? 'text-xs' : 'text-sm'}`}>{format(day, "EEE")}</div>
                    <div className={`${isCompactMode ? 'text-[10px]' : 'text-xs'} ${isToday ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{format(day, "M/d")}</div>
                    {!isCompactMode && dayHolidays.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayHolidays.map(holiday => (
                          <div key={holiday.id} className="text-[10px] text-primary font-medium leading-tight">
                            {holiday.holiday_type === 'birthday' 
                              ? `🎂 ${holiday.holiday_name.replace(/🎂\s*/, '').split(' ')[0]}'s B-Day`
                              : holiday.holiday_name}
                          </div>
                        ))}
                      </div>
                    )}
                    {!isCompactMode && isBlackout && (
                      <div className="mt-1 text-[10px] text-destructive font-medium leading-tight">
                        🚫 Blackout
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Events Section - hidden in compact mode */}
            {!isCompactMode && (
            <div className="border-b border-border">
              <EventRow events={events} scheduleId={scheduleId} isEditable={isAdmin || isManager} onUpdate={fetchScheduleData} locationId={currentLocation?.id} />
            </div>
            )}
            </div>
            </div>
            {/* Schedule grid content */}
            <div 
              ref={scheduleBodyRef}
              className="overflow-x-auto bg-card rounded-xl border border-border shadow-md mt-1"
              onScroll={(e) => {
                if (stickyHeaderScrollRef.current && stickyHeaderScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                  stickyHeaderScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
            >
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
                       onEditShift={() => {}}
                       isDraggable={false}
                       isPublished={isPublished}
                       publishedSnapshot={publishedSnapshot}
                       canViewAllWages={canViewAllWages}
                       isCompactMode={isCompactMode}
                       holidays={holidays}
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
                  {['super_admin', 'org_admin', 'admin', 'manager', 'shift_manager', 'team_member'].map((roleFilter) => {
                    const roleProfiles = profiles.filter(p => p.role === roleFilter);
                    if (roleProfiles.length === 0) return null;

                    const roleColorClass = ['super_admin', 'org_admin', 'admin'].includes(roleFilter)
                      ? 'bg-role-admin/5 border-l-4 border-role-admin'
                      : ['shift_manager', 'manager'].includes(roleFilter)
                      ? 'bg-role-manager/5 border-l-4 border-role-manager'
                      : 'bg-role-team-member/5 border-l-4 border-role-team-member';

                    const roleLabels: Record<string, string> = {
                      super_admin: 'Super Admins',
                      org_admin: 'Org Admins',
                      admin: 'Admins',
                      manager: 'Managers',
                      shift_manager: 'Shift Managers',
                      team_member: 'Team Members'
                    };
                    const roleLabel = roleLabels[roleFilter] || roleFilter;
                    
                    // Calculate total scheduled hours for this role group
                    const roleShifts = shifts.filter(s => roleProfiles.some(p => p.id === s.user_id));
                    const roleTotalHours = roleShifts.reduce((total, shift) => {
                      const [startHour, startMin] = shift.start_time.split(':').map(Number);
                      const [endHour, endMin] = shift.end_time.split(':').map(Number);
                      let shiftMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);
                      if (shiftMinutes < 0) shiftMinutes += 24 * 60;
                      const shiftHours = shiftMinutes / 60;
                      return total + (shiftHours > 5 ? shiftHours - 0.5 : shiftHours);
                    }, 0);

                    return (
                      <Collapsible key={roleFilter} defaultOpen={true}>
                        <div className={`${roleColorClass}`}>
                          <CollapsibleTrigger asChild>
                            <button className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer">
                              <div className="flex items-center gap-2">
                                <ChevronDown className="h-4 w-4 transition-transform duration-200 [&[data-state=open]>svg]:rotate-180" />
                                <span className="font-semibold text-sm uppercase tracking-wide">
                                  {roleLabel}
                                </span>
                                <span className="text-xs text-muted-foreground font-normal normal-case">
                                  ({roleProfiles.length} {roleProfiles.length === 1 ? 'employee' : 'employees'})
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground font-medium">
                                {roleTotalHours.toFixed(1)} hrs
                              </span>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
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
                                   onEditShift={(shift) => wrapEditAction(() => setEditingShift(shift))}
                                   isDraggable={isAdmin || isManager}
                                   isPublished={isPublished}
                                   publishedSnapshot={publishedSnapshot}
                                    canViewAllWages={canViewAllWages}
                                    isCompactMode={isCompactMode}
                                    holidays={holidays}
                                    allShifts={lastWeekShifts}
                                    onSmartTap={handleSmartTap}
                                  />
                              ))}
                            </SortableContext>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}

                  {/* Unassigned shifts are no longer displayed - shifts must always have an employee */}
                </>
              )}
            </div>
            </div>
          </div>

          {/* Visual Key Legend - Below schedule card */}
          <div className="flex items-center gap-4 px-2 py-1.5 text-[10px] text-muted-foreground">
            <span className="font-medium">Key:</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-4 rounded border-2 border-dashed border-muted-foreground/60 opacity-70 bg-muted/50" />
              <span>Draft</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div 
                className="w-8 h-4 rounded ring-2 ring-amber-500 ring-offset-1 bg-primary relative overflow-hidden"
              >
                <div 
                  className="absolute inset-0" 
                  style={{
                    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.2) 4px, rgba(0,0,0,0.2) 8px)`
                  }}
                />
              </div>
              <span>Time-Off Conflict</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div 
                className="w-8 h-4 rounded bg-muted/30 border border-dashed border-muted-foreground/30"
                style={{
                  background: "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 4px, transparent 4px, transparent 8px)"
                }}
              />
              <span>Time Off</span>
            </div>
          </div>

          {/* Floating Templates Bar - Bottom (Admin/Manager only) */}
           {(isAdmin || isManager) && (
            <div className="fixed bottom-0 left-0 right-0 z-50 overflow-visible">
              <div className="container max-w-7xl mx-auto px-4 overflow-visible">
                {/* Schedule Tools tab - floats above border via negative margin in LaborTotals */}
                <LaborTotals
                  shifts={shifts}
                  profiles={profiles}
                  currentWeekStart={currentWeekStart}
                  scheduleId={scheduleId}
                  isEditable={isAdmin || isManager}
                />
              </div>
              {/* Templates content below the border line */}
              <div className="bg-card border-t border-border" style={{ touchAction: 'none' }}>
                <div className="container max-w-7xl mx-auto px-4 py-2 max-h-[35vh] overflow-y-auto overflow-x-hidden" style={{ touchAction: 'none' }}>
                  <div className="flex items-start gap-3 pt-1">
                    <h3 className="font-semibold whitespace-nowrap text-xs pt-1">Templates:</h3>
                    {templates.length > 0 ? (
                      <div className={`flex flex-wrap ${isCompactMode ? 'gap-1' : 'gap-2'} flex-1`}>
                        {templates.map((template) => (
                          <ShiftCard key={template.id} shift={{ template, isTemplate: true }} isCompactMode={isCompactMode} />
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
            locationId={currentLocation?.id}
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
                  : pendingRoleChange?.newRole === 'manager' ? 'Manager'
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

        {/* Current Week Edit Warning Dialog */}
        <AlertDialog open={currentWeekWarningOpen} onOpenChange={setCurrentWeekWarningOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                Editing Active Schedule
              </AlertDialogTitle>
              <AlertDialogDescription>
                You're about to edit the <strong>current week's schedule</strong> which is already live. 
                Changes will affect employees who may already be working or have planned their week based on this schedule.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setPendingEditAction(null);
                setCurrentWeekWarningOpen(false);
              }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                if (pendingEditAction) {
                  pendingEditAction();
                }
                setPendingEditAction(null);
                setCurrentWeekWarningOpen(false);
              }} className="bg-amber-600 text-white hover:bg-amber-700">
                Edit Anyway
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

      {/* Change Tracking Dialog */}
      <ChangeTrackingDialog
        open={changeTrackingOpen}
        onOpenChange={setChangeTrackingOpen}
        scheduleId={scheduleId}
        weekStartDate={currentWeekStart}
        isPublished={isPublished}
      />
    </Layout>
  );
}
