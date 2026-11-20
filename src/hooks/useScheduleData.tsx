import { periodGoal } from "@/lib/goalResolver";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useTeamScheduleVisibility } from "@/hooks/useTeamScheduleVisibility";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isSameWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { parseDateStringInTimezone } from "@/utils/timezoneUtils";
import { filterEventsByRole } from "@/utils/eventRoleFilter";
import { mergeScheduleEvents } from "@/lib/todaysScheduleEvents";
import { reassignShift, addShift, sendScheduleUpdate, publishSchedule, detectScheduleChanges as detectScheduleChangesShared, ensureDraftSchedule, findScheduleForWeek } from "@/lib/scheduleActions";
import { pickCanonicalSchedule, decideCopy, type CopyDecision } from "@/lib/scheduleCopy";
import { countPendingChanges } from "@/lib/scheduleDiff";

// Cache time constants
const SCHEDULE_STALE_TIME = 15 * 60 * 1000;
const SCHEDULE_STALE_TIME_PAST = Infinity;
const SCHEDULE_GC_TIME = 60 * 60 * 1000;

import type { DayAvailability, WeeklyAvailability } from "@/types/availability";

export type { DayAvailability, WeeklyAvailability };


export interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
  role?: string;
  hourly_wage?: number;
  display_order?: number;
  weekly_availability?: WeeklyAvailability | null;
}

export interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
}

export interface ScheduledShift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_time_off: boolean;
  template_id: string | null;
  shift_date: string;
}

export interface ScheduleEvent {
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

export interface AvailabilityRequest {
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

export interface Holiday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  location_id?: string | null;
}

export function useScheduleData() {
  const { role, isAdmin, isManager, canViewAllWages, canEditSchedule, wageMode, loading: roleLoading } = useUserRole();
  const { canSeeFullSchedule, loading: scheduleVisibilityLoading } = useTeamScheduleVisibility();
  const { currentLocation } = useAppLocation();
  const { timezone, getTodayInTimezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const didInitWeek = useRef(false);

  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [weeklyTotalSales, setWeeklyTotalSales] = useState(0);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [locationSettings, setLocationSettings] = useState<{ hours_open?: string; hours_close?: string; stations_enabled?: boolean; break_coverage_enabled?: boolean } | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const currentUserId = user?.id || null;

  // Initialize week start based on the location timezone (one-time)
  useEffect(() => {
    if (didInitWeek.current) return;
    if (!timezone) return;

    // A deep link (?week=yyyy-MM-dd, e.g. from an approval task) wins over "this week".
    const weekParam = new URLSearchParams(window.location.search).get('week');
    const todayStr = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : getTodayInTimezone();
    const [y, m, d] = todayStr.split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    setCurrentWeekStart(startOfWeek(localDate, { weekStartsOn: 1 }));
    didInitWeek.current = true;
  }, [timezone, getTodayInTimezone]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i)), [currentWeekStart]);

  // Determine "this week" using the location's timezone
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

  const isPastWeek = currentWeekStart < thisWeekStart;

  const scheduleQueryKey = useMemo(
    () => ['schedule', currentLocation?.id, format(currentWeekStart, 'yyyy-MM-dd')],
    [currentLocation?.id, currentWeekStart]
  );
  const stableDataQueryKey = useMemo(
    () => ['schedule-stable', currentLocation?.id],
    [currentLocation?.id]
  );

  // Stable data query (profiles, templates)
  const { data: stableData } = useQuery({
    queryKey: stableDataQueryKey,
    queryFn: async () => {
      if (!currentLocation?.id) return null;

      const [userLocationsResult, templatesResult] = await Promise.all([
        supabase.from("user_locations").select("user_id, show_on_schedule").eq("location_id", currentLocation.id),
        supabase.from("shift_templates").select("*").eq("location_id", currentLocation.id).order("start_time", { ascending: true }),
      ]);

      if (userLocationsResult.error) throw userLocationsResult.error;
      if (templatesResult.error) throw templatesResult.error;

      const locationUserIds = new Set(
        (userLocationsResult.data || [])
          .filter(ul => ul.show_on_schedule !== false)
          .map((ul) => ul.user_id)
      );
      const scopedIds = Array.from(locationUserIds);

      if (scopedIds.length === 0) {
        return { profiles: [], templates: templatesResult.data || [], locationUserIds: scopedIds };
      }

      // Scope profiles + roles (+ wages) to this location's roster — server-side, not JS.
      const [allProfilesResult, rolesResult, wagesResult] = await Promise.all([
        supabase
          .from("profiles")
          .select(`id, full_name, nickname, profile_photo_url, display_order, appears_on_schedule, weekly_availability`)
          .in("id", scopedIds)
          .eq("is_active", true)
          .eq("appears_on_schedule", true),
        supabase.from("user_roles").select("user_id, role").in("user_id", scopedIds),
        // Wages come from a role-checked RPC (never selectable on profiles) — managers get real wages;
        // Scheduling Managers get the store blended rate from the server (never individual pay).
        wageMode !== 'none'
          ? supabase.rpc('get_current_wages_batch', { p_user_ids: scopedIds, _location_id: currentLocation?.id })
          : Promise.resolve({ data: null } as any),
      ]);

      if (allProfilesResult.error) throw allProfilesResult.error;
      if (rolesResult.error) throw rolesResult.error;

      const locationProfiles = allProfilesResult.data || [];
      const wageMap = new Map<string, number>(
        (((wagesResult as any)?.data || []) as any[]).map((w) => [w.user_id, Number(w.hourly_wage)])
      );

      const profilesWithRoles = locationProfiles.map(profile => {
        const userRole = rolesResult.data?.find(r => r.user_id === profile.id);
        return {
          ...profile,
          weekly_availability: profile.weekly_availability as WeeklyAvailability | null,
          hourly_wage: wageMode !== 'none' ? (wageMap.get(profile.id) ?? 15) : undefined,
          role: userRole?.role || 'team_member',
          display_order: profile.display_order ?? 0
        };
      });


      const roleOrder: Record<string, number> = {
        super_admin: 0, brand_admin: 1, org_admin: 2, admin: 3,
        manager: 4, shift_manager: 5, shift_manager_in_training: 5.5, team_member: 6
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
    enabled: !!currentLocation?.id && !roleLoading,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  // Main schedule data query
  const {
    data: scheduleData,
    isLoading: loading,
    isFetching,
    refetch: refetchSchedule
  } = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: async () => {
      if (!currentLocation?.id) return null;

      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      const SCHEDULE_COLUMNS = "id, is_published, published_shifts_snapshot, last_status_changed_at, last_status_changed_by, last_status_action, week_start_date, week_end_date, location_id, approval_status, approval_requested_by, approval_requested_at, approval_decided_by, approval_decided_at, approval_message";

      // One schedule per store per week (unique index). Opening a week never creates one:
      // 0 rows = blank week (scheduleId null); the first real write goes through ensureDraftSchedule.
      const { data: weekRows, error: scheduleError } = await supabase
        .from("schedules")
        .select(`${SCHEDULE_COLUMNS}, created_at, scheduled_shifts(count)`)
        .eq("week_start_date", format(currentWeekStart, "yyyy-MM-dd"))
        .eq("location_id", currentLocation.id)
        .order("created_at", { ascending: true })
        .limit(5);
      if (scheduleError) throw scheduleError;
      const schedule = pickCanonicalSchedule(((weekRows || []) as any[]).map((r) => ({ ...r, shift_count: Number(r.scheduled_shifts?.[0]?.count ?? 0) }))) as any;

      if (!schedule && !canEditSchedule) {
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

      const lastWeekDate = format(addDays(currentWeekStart, -7), 'yyyy-MM-dd');

      const [
        shiftsResult, eventsResult, recurringEventsResult, availabilityResult,
        salesResult, holidaysResult, locationSettingsResult, lastWeekScheduleResult
      ] = await Promise.all([
        schedule ? supabase.from("scheduled_shifts").select(`*, template:shift_templates(*)`).eq("schedule_id", schedule.id) : Promise.resolve({ data: [] as any[], error: null }),
        schedule ? supabase.from("schedule_events").select("*, event_categories(name, color)").eq("schedule_id", schedule.id) : Promise.resolve({ data: [] as any[], error: null }),
        supabase.from("schedule_events").select("*, event_categories(name, color)").eq("is_recurring", true).is("schedule_id", null).eq("location_id", currentLocation.id),
        supabase.from("availability_requests").select("*").eq("location_id", currentLocation.id).eq("request_type", "unpaid").in("status", ["pending", "approved"]).lte("start_date", format(weekEnd, "yyyy-MM-dd")).or(`end_date.gte.${format(currentWeekStart, "yyyy-MM-dd")},and(end_date.is.null,start_date.gte.${format(currentWeekStart, "yyyy-MM-dd")})`),
        supabase.from("sales_cache").select("sale_date, override_projection, living_projection, initial_projection").eq("location_id", currentLocation.id).gte("sale_date", format(currentWeekStart, "yyyy-MM-dd")).lte("sale_date", format(weekEnd, "yyyy-MM-dd")),
        supabase.from("holidays").select("*").or(`location_id.eq.${currentLocation.id},location_id.is.null`).gte("holiday_date", format(currentWeekStart, "yyyy-MM-dd")).lte("holiday_date", format(weekEnd, "yyyy-MM-dd")),
        supabase.from("location_settings").select("blackout_dates, hours_open, hours_close, stations_enabled, break_coverage_enabled").eq("location_id", currentLocation.id).single(),
        supabase.from("schedules").select("id").eq("week_start_date", lastWeekDate).eq("location_id", currentLocation.id).order("is_published", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      ]);

      const lastWeekSchedule = lastWeekScheduleResult.data;
      const lastWeekShiftsResult = lastWeekSchedule?.id
        ? await supabase.from("scheduled_shifts").select("user_id, template_id, shift_date").eq("schedule_id", lastWeekSchedule.id).not("template_id", "is", null)
        : { data: [], error: null };

      if (shiftsResult.error) throw shiftsResult.error;
      // Draft (unpublished) schedules must never be visible to non-managers
      const canSeeDrafts = canEditSchedule;
      const shifts = (!schedule?.is_published && !canSeeDrafts) ? [] : (shiftsResult.data || []);
      const lastWeekShifts = (lastWeekShiftsResult as any)?.data || [];


      if (eventsResult.error) throw eventsResult.error;
      if (recurringEventsResult.error) throw recurringEventsResult.error;

      const scheduleEvents = (eventsResult.data || []).map(event => ({
        ...event, tagged_roles: event.tagged_roles as string[] | null, is_recurring: event.is_recurring ?? true, category: event.event_categories || null
      }));
      const recurringEvents = (recurringEventsResult.data || []).map(event => ({
        ...event, tagged_roles: event.tagged_roles as string[] | null, is_recurring: true, category: event.event_categories || null
      }));

      const allEvents: ScheduleEvent[] = mergeScheduleEvents(scheduleEvents, recurringEvents);

      const roleFilteredEvents = filterEventsByRole(allEvents, role);

      let profilesWithRoles = stableData?.profiles ?? [];
      const isTeamMemberContext = !canEditSchedule;
      if (isTeamMemberContext && canSeeFullSchedule && !scheduleVisibilityLoading && profilesWithRoles.length === 0) {
        const shiftUserIds = Array.from(new Set(shifts.map((s) => s.user_id).filter(Boolean) as string[]));
        if (shiftUserIds.length > 0) {
          const { data: shiftProfiles } = await supabase.from('profiles').select('id, full_name, nickname, profile_photo_url, display_order, appears_on_schedule, weekly_availability').in('id', shiftUserIds);
          const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", shiftUserIds);
          const { data: shiftWageRows } = canViewAllWages
            ? await supabase.rpc('get_current_wages_batch', { p_user_ids: shiftUserIds, _location_id: currentLocation?.id })
            : { data: null };
          const shiftWageMap = new Map<string, number>(((shiftWageRows || []) as any[]).map((w) => [w.user_id, Number(w.hourly_wage)]));
          profilesWithRoles = (shiftProfiles || []).map(profile => {
            const userRole = roles?.find(r => r.user_id === profile.id);
            return { ...profile, weekly_availability: profile.weekly_availability as WeeklyAvailability | null, hourly_wage: canViewAllWages ? (shiftWageMap.get(profile.id) ?? 15) : undefined, role: userRole?.role || 'team_member', display_order: profile.display_order ?? 0 };
          });
        }
      }

      const templates = stableData?.templates ?? [];

      if (availabilityResult.error) throw availabilityResult.error;
      const availabilityRequests = availabilityResult.data || [];

      let totalSales = 0;
      if (!salesResult.error && salesResult.data) {
        totalSales = periodGoal(salesResult.data);
      }

      let processedHolidays: Holiday[] = [];
      if (!holidaysResult.error && holidaysResult.data) {
        processedHolidays = (holidaysResult.data as Holiday[]).filter(h => h.holiday_type !== 'birthday' || h.location_id === currentLocation.id);
      }

      let processedBlackoutDates: string[] = [];
      let processedLocationSettings: { hours_open?: string; hours_close?: string; stations_enabled?: boolean; break_coverage_enabled?: boolean } | null = null;
      if (!locationSettingsResult.error && locationSettingsResult.data) {
        processedBlackoutDates = locationSettingsResult.data.blackout_dates || [];
        processedLocationSettings = {
          hours_open: locationSettingsResult.data.hours_open || undefined,
          hours_close: locationSettingsResult.data.hours_close || undefined,
          stations_enabled: !!(locationSettingsResult.data as any).stations_enabled,
          break_coverage_enabled: !!(locationSettingsResult.data as any).break_coverage_enabled,
        };
      }

      setWeeklyTotalSales(totalSales);
      setHolidays(processedHolidays);
      setBlackoutDates(processedBlackoutDates);
      setLocationSettings(processedLocationSettings);

      return {
        scheduleId: (schedule?.id ?? null) as string | null,
        isPublished: schedule?.is_published || false,
        publishedSnapshot: (Array.isArray(schedule?.published_shifts_snapshot) ? schedule.published_shifts_snapshot : []) as unknown as ScheduledShift[],
        shifts,
        events: roleFilteredEvents,
        profiles: profilesWithRoles,
        templates,
        availabilityRequests,
        lastStatusChangedAt: schedule?.last_status_changed_at ?? null,
        lastStatusChangedBy: schedule?.last_status_changed_by ?? null,
        lastStatusAction: schedule?.last_status_action ?? null,
        lastWeekShifts,
      };
    },
    enabled: !!role && !!currentLocation?.id && !!stableData,
    staleTime: isPastWeek ? SCHEDULE_STALE_TIME_PAST : SCHEDULE_STALE_TIME,
    gcTime: SCHEDULE_GC_TIME,
    placeholderData: (previousData) => previousData,
  });

  // Prefetch adjacent weeks
  useEffect(() => {
    if (!role || !currentLocation?.id || !stableData) return;

    const prefetchWeek = (weekStart: Date) => {
      const weekKey = ['schedule', currentLocation.id, format(weekStart, 'yyyy-MM-dd')];
      const weekEndDate = endOfWeek(weekStart, { weekStartsOn: 1 });
      const existingData = queryClient.getQueryData(weekKey);
      if (existingData) return;

      queryClient.prefetchQuery({
        queryKey: weekKey,
        queryFn: async () => {
          const { data: schedule } = await supabase
            .from("schedules")
            .select("id, is_published, published_shifts_snapshot, last_status_changed_at, last_status_changed_by, last_status_action")
            .eq("week_start_date", format(weekStart, "yyyy-MM-dd"))
            .eq("location_id", currentLocation.id)
            .order("is_published", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();

          if (!schedule) return null;

          const [shiftsResult, eventsResult, recurringEventsResult, availabilityResult] = await Promise.all([
            supabase.from("scheduled_shifts").select(`*, template:shift_templates(*)`).eq("schedule_id", schedule.id),
            supabase.from("schedule_events").select("*, event_categories(name, color)").eq("schedule_id", schedule.id),
            supabase.from("schedule_events").select("*, event_categories(name, color)").eq("is_recurring", true).is("schedule_id", null).eq("location_id", currentLocation.id),
            supabase.from("availability_requests").select("*").eq("location_id", currentLocation.id).eq("request_type", "unpaid").in("status", ["pending", "approved"]).lte("start_date", format(weekEndDate, "yyyy-MM-dd")).or(`end_date.gte.${format(weekStart, "yyyy-MM-dd")},and(end_date.is.null,start_date.gte.${format(weekStart, "yyyy-MM-dd")})`),
          ]);

          const scheduleEvents = (eventsResult.data || []).map(event => ({
            ...event, tagged_roles: event.tagged_roles as string[] | null, is_recurring: event.is_recurring ?? true, category: event.event_categories || null
          }));
          const recurringEvents = (recurringEventsResult.data || []).map(event => ({
            ...event, tagged_roles: event.tagged_roles as string[] | null, is_recurring: true, category: event.event_categories || null
          }));

          const allEvents: ScheduleEvent[] = mergeScheduleEvents(scheduleEvents, recurringEvents);

          return {
            scheduleId: schedule.id,
            isPublished: schedule.is_published || false,
            publishedSnapshot: (Array.isArray(schedule.published_shifts_snapshot) ? schedule.published_shifts_snapshot : []) as unknown as ScheduledShift[],
            shifts: (!schedule.is_published && !canEditSchedule) ? [] : (shiftsResult.data || []),
            events: filterEventsByRole(allEvents, role),
            profiles: stableData.profiles,
            templates: stableData.templates,
            availabilityRequests: availabilityResult.data || [],
            lastStatusChangedAt: schedule.last_status_changed_at,
            lastStatusChangedBy: schedule.last_status_changed_by,
            lastStatusAction: schedule.last_status_action,
          };
        },
        staleTime: SCHEDULE_STALE_TIME,
      });
    };

    prefetchWeek(subWeeks(currentWeekStart, 1));
    prefetchWeek(addWeeks(currentWeekStart, 1));
  }, [currentWeekStart, currentLocation?.id, role, queryClient, stableData]);

  // Extract data from query result with defaults
  const scheduleId = scheduleData?.scheduleId ?? null;
  // Blank week: the id created by the first write (ensureScheduleId), kept only for this store + week.
  const weekKey = `${currentLocation?.id ?? ''}|${format(currentWeekStart, "yyyy-MM-dd")}`;
  const ensuredRef = useRef<{ key: string; id: string } | null>(null);
  const scheduleIdRef = useRef<string | null>(null);
  scheduleIdRef.current = scheduleId ?? (ensuredRef.current?.key === weekKey ? ensuredRef.current.id : null);
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

  // Fetch status changer profile name
  const { data: statusChangerProfile } = useQuery({
    queryKey: ['profile-name', lastStatusChangedBy],
    queryFn: async () => {
      if (!lastStatusChangedBy) return null;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', lastStatusChangedBy).single();
      return data;
    },
    enabled: !!lastStatusChangedBy,
    staleTime: Infinity,
  });
  const lastStatusChangedByName = statusChangerProfile?.full_name || profiles.find(p => p.id === lastStatusChangedBy)?.full_name || null;

  // Helper to refetch schedule data after mutations
  const fetchScheduleData = useCallback((showLoading = true) => {
    queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    refetchSchedule();
  }, [queryClient, scheduleQueryKey, refetchSchedule]);

  // Conflict detection
  const checkForConflicts = useCallback((userId: string, dayIndex: number, shiftDate: string) => {
    if (userId === "unassigned") return [];
    const employee = profiles.find((p) => p.id === userId);
    if (!employee) return [];

    const conflictingRequests = availabilityRequests.filter((request) => {
      if (request.user_id !== userId) return false;
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
  }, [profiles, availabilityRequests]);

  // Execute shift operation (create from template or move existing)
  const executeShiftOperation = useCallback(async (active: any, userId: string, dayIndex: number, shiftDate: string, sidOverride?: string) => {
    const scheduleId = sidOverride ?? scheduleIdRef.current;
    if (!scheduleId) return;
    if (userId === "unassigned") {
      toast.error("Shifts must be assigned to an employee");
      return;
    }

    const previousData = queryClient.getQueryData(scheduleQueryKey);
    const isFromTemplate = active.data?.current?.isTemplate || active.isTemplate;
    const template = active.data?.current?.template || active.template;
    const pickedStationId: string | null = active.data?.current?.stationId ?? null;
    const existingShift = active.data?.current || active;
    const tempId = `temp-${Date.now()}`;

    queryClient.setQueryData(scheduleQueryKey, (old: any) => {
      if (!old) return old;
      if (isFromTemplate) {
        const optimisticShift = {
          id: tempId, schedule_id: scheduleId, template_id: template.id, user_id: userId,
          day_of_week: dayIndex, shift_date: shiftDate, start_time: template.start_time,
          end_time: template.end_time, is_time_off: false, template: template, station_id: pickedStationId, _optimistic: true,
        };
        return { ...old, shifts: [...old.shifts, optimisticShift] };
      } else {
        return { ...old, shifts: old.shifts.map((s: any) => s.id === existingShift.id ? { ...s, user_id: userId, day_of_week: dayIndex, shift_date: shiftDate, _optimistic: true } : s) };
      }
    });

    try {
      if (isFromTemplate) {
        const insertedShift = await addShift({ schedule_id: scheduleId, template_id: template.id, user_id: userId, day_of_week: dayIndex, shift_date: shiftDate, start_time: template.start_time, end_time: template.end_time, station_id: pickedStationId });
        queryClient.setQueryData(scheduleQueryKey, (old: any) => {
          if (!old) return old;
          return { ...old, shifts: old.shifts.map((s: any) => s.id === tempId ? { ...insertedShift, _optimistic: false } : s) };
        });
        toast.success("Shift added");
      } else {
        await reassignShift(existingShift.id, userId, dayIndex, shiftDate);
        queryClient.setQueryData(scheduleQueryKey, (old: any) => {
          if (!old) return old;
          return { ...old, shifts: old.shifts.map((s: any) => s.id === existingShift.id ? { ...s, _optimistic: false } : s) };
        });
        toast.success("Shift moved");
      }
    } catch (error: any) {
      console.error("Error handling drop:", error);
      queryClient.setQueryData(scheduleQueryKey, previousData);
      toast.error("Failed to update shift");
    }
  }, [queryClient, scheduleQueryKey]);

  // Clear drafts (server): a live week goes back to its posted version, an unposted week loses its drafts.
  // Never touches worked/punched shifts and never changes publish state (that's Withdraw). One batch: Undo reverses it.
  const handleClearSchedule = useCallback(async () => {
    if (!scheduleId) return;
    try {
      const { data, error } = await supabase.rpc('clear_schedule_drafts', { _schedule_id: scheduleId, _dry_run: false });
      if (error) throw error;
      await refetchSchedule();
      const r = (data || {}) as { shifts_affected?: number; skipped_past?: number; skipped_punched?: number };
      const n = Number(r.shifts_affected ?? 0);
      const skipped = Number(r.skipped_past ?? 0) + Number(r.skipped_punched ?? 0);
      const msg = n === 0 ? "No drafts to clear" : `Cleared ${n} draft change${n === 1 ? '' : 's'}`;
      toast.success(skipped > 0 ? `${msg}. Skipped ${skipped} worked or punched shift${skipped === 1 ? '' : 's'}.` : msg);
    } catch (error: any) {
      console.error("Error clearing drafts:", error);
      toast.error("Failed to clear drafts");
    }
  }, [scheduleId, refetchSchedule]);

  // Copy week (server RPC copy_schedule_week, one logged batch). Decide first:
  // posted target = blocked (no popup, no write); target with drafts = Cancel/Merge popup; else copy now.
  const copyInFlight = useRef(false);
  const [isCopying, setIsCopying] = useState(false);
  const targetWeekOf = useCallback((weeksToAdd: number) => addWeeks(currentWeekStart, weeksToAdd), [currentWeekStart]);

  const prepareCopySchedule = useCallback(async (weeksToAdd: number): Promise<{ decision: CopyDecision; shiftCount: number; targetWeekStart: Date } | null> => {
    if (!scheduleId || weeksToAdd < 1 || !currentLocation?.id) return null;
    const targetWeekStart = targetWeekOf(weeksToAdd);
    const target = await findScheduleForWeek(currentLocation.id, format(targetWeekStart, "yyyy-MM-dd"));
    let shiftCount = 0;
    if (target && !target.is_published) {
      const { count, error } = await supabase.from("scheduled_shifts").select("id", { count: "exact", head: true }).eq("schedule_id", target.id).eq("is_phantom", false);
      if (error) throw error;
      shiftCount = count ?? 0;
    }
    return { decision: decideCopy({ exists: !!target, isPublished: !!target?.is_published, shiftCount }), shiftCount, targetWeekStart };
  }, [scheduleId, currentLocation?.id, targetWeekOf]);

  const handleCopySchedule = useCallback(async (weeksToAdd: number, mode: 'copy' | 'merge' = 'copy'): Promise<'done' | 'blocked' | 'confirm' | 'failed' | 'busy'> => {
    if (!scheduleId || weeksToAdd < 1 || !currentLocation?.id) return 'failed';
    if (copyInFlight.current) return 'busy'; // double-clicks are ignored
    copyInFlight.current = true;
    setIsCopying(true);
    try {
      const targetWeekStart = targetWeekOf(weeksToAdd);
      const { data, error } = await supabase.rpc('copy_schedule_week', {
        _source_schedule_id: scheduleId, _target_week_start: format(targetWeekStart, "yyyy-MM-dd"), _mode: mode, _from: 'current',
      });
      if (error) {
        const m = String(error.message ?? '');
        if (m.includes('target_is_live')) return 'blocked';
        if (m.includes('target_has_shifts')) return 'confirm';
        throw error;
      }
      const r = (data || {}) as { added?: number; skipped?: number };
      const label = formatInTimeZone(targetWeekStart, timezone, "MMM d, yyyy");
      toast.success(mode === 'merge'
        ? `Merged into week of ${label}: ${r.added ?? 0} added, ${r.skipped ?? 0} duplicate${(r.skipped ?? 0) === 1 ? '' : 's'} skipped`
        : `Schedule copied to week of ${label}`);
      queryClient.invalidateQueries({ queryKey: ['schedule', currentLocation.id, format(targetWeekStart, 'yyyy-MM-dd')] });
      return 'done';
    } catch (error: any) {
      console.error("Error copying schedule:", error);
      toast.error("Failed to copy schedule");
      return 'failed';
    } finally {
      copyInFlight.current = false;
      setIsCopying(false);
    }
  }, [scheduleId, currentLocation?.id, targetWeekOf, timezone, queryClient]);

  // First real write on a blank week creates its (draft) schedule row. Opening a week never does.
  const ensureScheduleId = useCallback(async (): Promise<string | null> => {
    if (scheduleIdRef.current) return scheduleIdRef.current;
    if (!currentLocation?.id || !canEditSchedule) return null;
    const ws = format(currentWeekStart, "yyyy-MM-dd");
    const we = format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const row = await ensureDraftSchedule(currentLocation.id, ws, we);
    ensuredRef.current = { key: `${currentLocation.id}|${ws}`, id: row.id };
    scheduleIdRef.current = row.id;
    queryClient.setQueryData(scheduleQueryKey, (old: any) => old ? { ...old, scheduleId: row.id } : old);
    queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    return row.id;
  }, [currentLocation?.id, canEditSchedule, currentWeekStart, queryClient, scheduleQueryKey]);

  // Week navigation
  const handlePreviousWeek = useCallback(() => {
    const target = subWeeks(currentWeekStart, 1);
    if (currentLocation?.id) {
      queryClient.invalidateQueries({ queryKey: ['schedule', currentLocation.id, format(target, 'yyyy-MM-dd')] });
    }
    setCurrentWeekStart(target);
  }, [currentWeekStart, currentLocation?.id, queryClient]);

  const handleNextWeek = useCallback(() => {
    const target = addWeeks(currentWeekStart, 1);
    if (currentLocation?.id) {
      queryClient.invalidateQueries({ queryKey: ['schedule', currentLocation.id, format(target, 'yyyy-MM-dd')] });
    }
    setCurrentWeekStart(target);
  }, [currentWeekStart, currentLocation?.id, queryClient]);

  // Pending changes detection
  const pendingChangesCount = useMemo(() => {
    if (!isPublished) return 0;
    if (!publishedSnapshot || publishedSnapshot.length === 0) return 0;
    return countPendingChanges(publishedSnapshot as any, shifts as any);
  }, [isPublished, publishedSnapshot, shifts]);
  const hasPendingChanges = pendingChangesCount > 0;

  // Detect schedule changes helper (shared with Theo's Confirm change)
  const detectScheduleChanges = useCallback((oldShifts: any[], newShifts: any[]) => detectScheduleChangesShared(oldShifts, newShifts), []);

  // Post (direct): server publishes + queues the team push; then the weekly email.
  const handleGoLive = useCallback(async () => {
    if (!scheduleId || !currentLocation?.id) return;
    setIsPublishing(true);
    try {
      await publishSchedule(scheduleId, currentLocation.id);
      toast.success("Posted. Team notified shortly.");
      await refetchSchedule();
    } catch (error: any) {
      console.error('Error publishing schedule:', error);
      toast.error(String(error?.message ?? '').includes('approval_required') ? "This week needs approval before it can be posted." : "Failed to publish schedule");
    } finally {
      setIsPublishing(false);
    }
  }, [scheduleId, currentLocation?.id, refetchSchedule]);

  // Update schedule
  const handleUpdate = useCallback(async () => {
    if (!scheduleId) return;
    setIsPublishing(true);
    try {
      await sendScheduleUpdate({
        scheduleId, weekStart: currentWeekStart, timezone, publishedSnapshot, changedBy: user?.id,
        onNotified: (affected, changeCount) => {
          if (changeCount > 0) toast.success(`Schedule updated! ${affected} affected team member(s) notified.`);
          else toast.success("Schedule updated!");
        },
      });
      await refetchSchedule();
    } catch (error: any) {
      console.error('Error updating schedule:', error);
      toast.error("Failed to update schedule");
    } finally {
      setIsPublishing(false);
    }
  }, [scheduleId, currentWeekStart, publishedSnapshot, user?.id, refetchSchedule, timezone]);

  // Withdraw schedule
  const handleWithdrawSchedule = useCallback(async () => {
    if (!scheduleId) return;
    try {
      const { error } = await supabase.from('schedules').update({
        is_published: false, published_shifts_snapshot: null,
        last_status_changed_at: new Date().toISOString(), last_status_changed_by: user?.id, last_status_action: 'withdrawn'
      }).eq('id', scheduleId);
      if (error) throw error;
      await refetchSchedule();
      toast.success("Schedule withdrawn. It will no longer be visible to team members until you post it again.");
    } catch (error: any) {
      console.error('Error withdrawing schedule:', error);
      toast.error("Failed to withdraw schedule");
    }
  }, [scheduleId, user?.id, refetchSchedule]);

  // Handle role change from drag
  const handleRoleChange = useCallback(async (userId: string, newRole: string, userName: string) => {
    try {
      const { error } = await supabase.from('user_roles').update({ role: newRole as any }).eq('user_id', userId);
      if (error) throw error;
      fetchScheduleData(false);
      const roleDisplayName = newRole === 'team_member' ? 'Team Member' : newRole === 'shift_manager' ? 'Shift Manager' : newRole === 'shift_manager_in_training' ? 'Shift Manager in Training' : newRole === 'manager' ? 'Manager' : newRole;
      toast.success(`${userName}'s role changed to ${roleDisplayName}`);
    } catch (error) {
      console.error('Error changing role:', error);
      toast.error('Failed to change user role');
    }
  }, [fetchScheduleData]);

  // Handle drag reorder
  const handleDragReorder = useCallback(async (activeId: string, overId: string) => {
    const activeProfile = profiles.find(p => p.id === activeId);
    const overProfile = profiles.find(p => p.id === overId);
    if (!activeProfile || !overProfile) return null;

    if (activeProfile.role !== overProfile.role) {
      return { type: 'role_change' as const, userId: activeProfile.id, userName: activeProfile.full_name, newRole: overProfile.role || 'team_member' };
    }

    // Same role - handle reordering
    const { arrayMove } = await import('@dnd-kit/sortable');
    const roleProfiles = profiles.filter(p => p.role === activeProfile.role);
    const oldIndex = roleProfiles.findIndex(p => p.id === activeId);
    const newIndex = roleProfiles.findIndex(p => p.id === overId);
    const reorderedRoleProfiles = arrayMove(roleProfiles, oldIndex, newIndex);

    const newProfiles = profiles.map(p => {
      const reorderedIndex = reorderedRoleProfiles.findIndex(rp => rp.id === p.id);
      if (reorderedIndex !== -1) return { ...p, display_order: reorderedIndex };
      return p;
    });

    const roleOrder = { admin: 0, manager: 1, team_member: 2 };
    newProfiles.sort((a, b) => {
      const aRoleOrder = roleOrder[a.role as keyof typeof roleOrder] ?? 3;
      const bRoleOrder = roleOrder[b.role as keyof typeof roleOrder] ?? 3;
      if (aRoleOrder === bRoleOrder) return (a.display_order ?? 0) - (b.display_order ?? 0);
      return aRoleOrder - bRoleOrder;
    });

    queryClient.setQueryData(scheduleQueryKey, (oldData: any) => {
      if (!oldData) return oldData;
      return { ...oldData, profiles: newProfiles };
    });

    try {
      await Promise.all(reorderedRoleProfiles.map((profile, index) =>
        supabase.from('profiles').update({ display_order: index }).eq('id', profile.id)
      ));
      toast.success("Employee order updated");
    } catch (error) {
      console.error("Error updating employee order:", error);
      toast.error("Failed to update employee order");
      fetchScheduleData(false);
    }
    return null;
  }, [profiles, queryClient, scheduleQueryKey, fetchScheduleData]);

  // Week label
  const getWeekLabel = useCallback(() => {
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
    const diffTime = currentWeekStart.getTime() - thisWeekStart.getTime();
    const diffWeeks = Math.round(diffTime / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks < 0) return { label: `${Math.abs(diffWeeks)} Weeks Ago`, variant: "secondary" as const };
    return { label: `${diffWeeks} Weeks Ahead`, variant: "outline" as const };
  }, [currentWeekStart, thisWeekStart]);

  // Is current week check
  const isCurrentWeek = useCallback(() => {
    return isSameWeek(currentWeekStart, thisWeekStart, { weekStartsOn: 1 });
  }, [currentWeekStart, thisWeekStart]);

  // Smart Tap handler
  const handleSmartTap = useCallback(async (userId: string, dayIndex: number, shiftDate: string, template: any, stationId?: string | null) => {
    const sid = scheduleIdRef.current ?? await ensureScheduleId().catch(() => null);
    if (!sid) return;
    const fakeActive = { data: { current: { isTemplate: true, template, stationId: stationId ?? null } }, isTemplate: true, template };
    const detectedConflicts = checkForConflicts(userId, dayIndex, shiftDate);
    if (detectedConflicts.length > 0) {
      return { type: 'conflict' as const, fakeActive, userId, dayIndex, shiftDate, conflicts: detectedConflicts };
    }
    if (isCurrentWeek() && isPublished) {
      return { type: 'current_week_warning' as const, action: () => executeShiftOperation(fakeActive, userId, dayIndex, shiftDate, sid) };
    }
    await executeShiftOperation(fakeActive, userId, dayIndex, shiftDate, sid);
    return null;
  }, [ensureScheduleId, checkForConflicts, isCurrentWeek, isPublished, executeShiftOperation]);

  return {
    // State
    currentWeekStart,
    setCurrentWeekStart,
    weekDays,
    weeklyTotalSales,
    holidays,
    blackoutDates,
    locationSettings,
    isPublishing,
    currentUserId,

    // Query data
    scheduleId,
    isPublished,
    publishedSnapshot,
    shifts,
    lastWeekShifts,
    events,
    profiles,
    templates,
    availabilityRequests,
    lastStatusChangedAt,
    lastStatusChangedByName,
    lastStatusAction,
    loading,
    isFetching,

    // Derived
    hasPendingChanges,
    pendingChangesCount,
    canViewAllWages,
    isAdmin,
    isManager,
    canEditSchedule,
    wageMode,
    role,
    currentLocation,

    // Actions
    fetchScheduleData,
    refetchSchedule,
    checkForConflicts,
    executeShiftOperation,
    handleClearSchedule,
    handleCopySchedule,
    prepareCopySchedule,
    isCopying,
    ensureScheduleId,
    handlePreviousWeek,
    handleNextWeek,
    handleGoLive,
    handleUpdate,
    handleWithdrawSchedule,
    handleRoleChange,
    handleDragReorder,
    handleSmartTap,
    getWeekLabel,
    isCurrentWeek,
    queryClient,
    scheduleQueryKey,
    getTodayInTimezone,
    timezone,
  };
}
