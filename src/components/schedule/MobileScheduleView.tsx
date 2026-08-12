import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { getDisplayName } from '@/utils/displayName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Users, CalendarPlus, RefreshCw, Circle, UserPlus, CalendarCheck, CheckCircle, Clock, BarChart3, CalendarDays, LayoutGrid, Printer, Share } from 'lucide-react';
import { exportDayTimelineToPrint } from '@/utils/exportDayTimelinePrint';
import { DateNavigator } from '@/components/ui/date-navigator';
import { Button } from '@/components/ui/button';
import { ShiftOfferDialog } from './ShiftOfferDialog';
const MobileShiftDialog = lazyWithRetry(() => import('./MobileShiftDialog').then(m => ({ default: m.MobileShiftDialog })));
const MobileAddScheduleSheet = lazyWithRetry(() => import('./MobileAddScheduleSheet').then(m => ({ default: m.MobileAddScheduleSheet })));
const MobileBuildScheduleWizard = lazyWithRetry(() => import('./MobileBuildScheduleWizard').then(m => ({ default: m.MobileBuildScheduleWizard })));
import { MobileShiftCard } from './MobileShiftCard';
import { QuickPunchDialog } from './QuickPunchDialog';
import { EditPunchDialog } from './EditPunchDialog';
import { MobileEventDialog } from './MobileEventDialog';
// Option6TodayContent kept as standalone component for potential reuse

import { useUserRole } from '@/hooks/useUserRole';
import { useTeamScheduleVisibility } from '@/hooks/useTeamScheduleVisibility';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { useAuth } from '@/lib/auth';
import { formatTime12Hour } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { AvailabilityRequest } from '@/hooks/useScheduleData';

import { getTodayInTimezone, getTimezoneOffset, formatTimeDisplay, getDayOfWeekInTimezone, parseDateStringInTimezone, getEndOfDateStringInTimezone, getBusinessDateForTimestamp } from '@/utils/timezoneUtils';
import { filterEventsByRole } from '@/utils/eventRoleFilter';
import { useLocationStations, type LocationStation } from '@/hooks/useLocationStations';
import { useUserStationAssignments } from '@/hooks/useUserStationAssignments';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
}

interface Shift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
  breaks?: unknown;
  template_id?: string | null;
  template?: {
    position: string | null;
    color: string | null;
  };
}

interface Event {
  id: string;
  event_name: string;
  event_time: string;
  day_of_week: number;
  days_of_week?: number[] | null;
  notes: string | null;
  tagged_roles?: string[] | null;
  is_recurring: boolean;
  category_id?: string | null;
  category?: {
    name: string;
    color: string;
  } | null;
}

interface MobileScheduleViewProps {
  currentWeekStart: Date;
  shifts: Shift[];
  events: Event[];
  profiles: Profile[];
  availabilityRequests?: AvailabilityRequest[];
  onShiftClick?: (shift: Shift) => void;
  onWeekChange?: (weekStart: Date) => void;
  onUpdate?: () => void;
  isPublished?: boolean;
  publishedSnapshot?: any[];
  scheduleId?: string | null;
  templates?: Array<{
    id: string;
    template_name: string;
    start_time: string;
    end_time: string;
    color: string | null;
  }>;
  onGoLive?: () => void;
  onSendUpdate?: () => void;
  isPublishing?: boolean;
  hasPendingChanges?: boolean;
  isLoading?: boolean; // Show skeleton cards while loading
  locationSettings?: { hours_open?: string; hours_close?: string; break_coverage_enabled?: boolean } | null;
  lastWeekShifts?: Array<{ user_id: string | null; template_id: string | null; shift_date: string }>;
}

interface DayPunch {
  id: string;
  user_id: string;
  clockInTime: string;
  clockOutTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  breakType: string | null;
  isActive: boolean;
  isOnBreak: boolean;
  profile: Profile;
  hoursWorked: number;
  createdByName: string | null; // Name of manager who created punch if different from employee
  scheduledShift?: {
    id: string;
    start_time: string;
    end_time: string;
    day_of_week: number;
    shift_date: string;
    is_phantom?: boolean;
  } | null;
}

export function MobileScheduleView({
  currentWeekStart,
  shifts,
  events,
  profiles,
  availabilityRequests = [],
  onShiftClick,
  onWeekChange,
  onUpdate,
  isPublished = false,
  publishedSnapshot,
  scheduleId,
  templates = [],
  onGoLive,
  onSendUpdate,
  isPublishing = false,
  hasPendingChanges = false,
  isLoading = false,
  locationSettings = null,
  lastWeekShifts = [],
}: MobileScheduleViewProps) {
  const [activeTab, setActiveTab] = useState<'today' | 'schedule'>(() => {
    const saved = sessionStorage.getItem('mobileScheduleTab');
    return saved === 'today' || saved === 'schedule' ? (saved as 'today' | 'schedule') : 'today';
  });
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [selectedShiftForOffer, setSelectedShiftForOffer] = useState<Shift | null>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [isCreatingShift, setIsCreatingShift] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetTab, setAddSheetTab] = useState<'shift' | 'employee'>('shift');
  const [addSheetLockTab, setAddSheetLockTab] = useState(false);
  const [addSheetWeekOverride, setAddSheetWeekOverride] = useState<Date | null>(null);
  const [buildWizardOpen, setBuildWizardOpen] = useState(false);
  const [quickPunchOpen, setQuickPunchOpen] = useState(false);
  const [editPunchOpen, setEditPunchOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [previewEvent, setPreviewEvent] = useState<Event | null>(null);
  const [selectedPunch, setSelectedPunch] = useState<{userId: string, userName: string, userPhoto: string | null, punchDate: string, clockInId: string} | null>(null);
  const [_todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  
  const { isAdmin, isManager, role } = useUserRole();
  const { canSeeFullSchedule, loading: scheduleVisibilityLoading } = useTeamScheduleVisibility();
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { timezone, closeTime } = useLocationTimezone();
  const queryClient = useQueryClient();

  // Stations grouping (mirrors desktop Schedule.tsx behavior)
  const { data: liveStationSettings } = useQuery({
    queryKey: ['mobile-schedule-stations-enabled', currentLocation?.id],
    enabled: !!currentLocation?.id,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_settings')
        .select('stations_enabled')
        .eq('location_id', currentLocation!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const stationsEnabled = !!(liveStationSettings as any)?.stations_enabled
    || !!(locationSettings as any)?.stations_enabled;
  const { stations } = useLocationStations(currentLocation?.id);
  const { assignments: stationAssignments } = useUserStationAssignments(currentLocation?.id);
  const useStationGrouping = stationsEnabled && stations.length > 0;

  /** Group a flat list by station_id (via the user's primary station). */
  const groupByStation = useCallback(<T,>(items: T[], getUserId: (item: T) => string | null | undefined) => {
    const buckets = new Map<string | null, T[]>();
    buckets.set(null, []);
    for (const s of stations) buckets.set(s.id, []);
    for (const it of items) {
      const uid = getUserId(it);
      const sid = uid ? stationAssignments[uid] ?? null : null;
      const key = sid && buckets.has(sid) ? sid : null;
      const arr = buckets.get(key);
      if (arr) arr.push(it);
    }
    const out: { station: LocationStation | null; items: T[] }[] = stations.map(st => ({
      station: st,
      items: buckets.get(st.id) ?? [],
    }));
    const un = buckets.get(null) ?? [];
    if (un.length > 0) out.push({ station: null, items: un });
    return out.filter(s => s.items.length > 0);
  }, [stations, stationAssignments]);

  /** Render a flat list of items either flat, or wrapped in station section headers when grouping is on. */
  const renderMaybeStationGrouped = useCallback(<T,>(
    items: T[],
    getUserId: (item: T) => string | null | undefined,
    renderItem: (item: T) => JSX.Element | null,
    keyForItem: (item: T) => string,
  ) => {
    if (!useStationGrouping) {
      return <>{items.map(it => <React.Fragment key={keyForItem(it)}>{renderItem(it)}</React.Fragment>)}</>;
    }
    const groups = groupByStation(items, getUserId);
    return (
      <>
        {groups.map(({ station, items: groupItems }) => (
          <div key={station?.id ?? 'unassigned'} className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-0.5 pt-1">
              <span
                className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
                style={{ background: station?.color || '#9ca3af' }}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {station?.name ?? 'Unassigned'}
              </span>
              <span className="text-[10px] text-muted-foreground/70">· {groupItems.length}</span>
            </div>
            {groupItems.map(it => (
              <React.Fragment key={keyForItem(it)}>{renderItem(it)}</React.Fragment>
            ))}
          </div>
        ))}
      </>
    );
  }, [useStationGrouping, groupByStation]);
  
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  
  // Calculate day index within current week - if selectedDate isn't in this week,
  // default to first day of the week to prevent -1 index issues
  const rawDayIndex = weekDays.findIndex(day => isSameDay(day, selectedDate));
  const selectedDayOfWeek = rawDayIndex >= 0 ? rawDayIndex : 0;
  
  // If selectedDate isn't in this week, sync it to first day
  useEffect(() => {
    if (rawDayIndex < 0) {
      setSelectedDate(weekDays[0]);
    }
  }, [rawDayIndex, weekDays]);

  // Memoized today string for query key stability
  const todayStr = useMemo(() => {
    if (!timezone) return null;
    return getTodayInTimezone(timezone);
  }, [timezone]);

  // Determine which date to fetch punches for — today or selected past date
  const punchDateStr = useMemo(() => {
    if (!todayStr) return null;
    const selStr = format(selectedDate, 'yyyy-MM-dd');
    // Only fetch for today or past dates, not future
    if (selStr <= todayStr) return selStr;
    return null;
  }, [selectedDate, todayStr]);

  // Use React Query for punch data — works for today AND past dates
  const { data: dayPunches = [], isLoading: loadingActive, refetch: refetchPunches } = useQuery({
    queryKey: ['schedule-punches', currentLocation?.id, punchDateStr],
    queryFn: async () => {
      if (!currentLocation?.id || !timezone || !punchDateStr) return [];
      
      const targetDayOfWeek = getDayOfWeekInTimezone(timezone);

      // Use DST-safe parseDateStringInTimezone for day boundaries
      const startOfDay = parseDateStringInTimezone(punchDateStr, timezone);
      const startMinus = new Date(startOfDay);
      startMinus.setHours(startMinus.getHours() - 12);
      const startOfDayTime = startMinus.toISOString();

      const endOfDay = getEndOfDateStringInTimezone(punchDateStr, timezone);
      const endOfDayPlus = new Date(endOfDay);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);
      const endOfDayTime = endOfDayPlus.toISOString();
      
      // Parallel queries for all data
      const punchesQuery = supabase
        .from('time_punches')
        .select('id, user_id, punch_time, punch_type, notes, created_by, shift_id')
        .eq('location_id', currentLocation.id)
        .gte('punch_time', startOfDayTime)
        .lte('punch_time', endOfDayTime)
        .order('punch_time', { ascending: true });
      
      const scheduledQuery = supabase
        .from('scheduled_shifts')
        .select('id, user_id, start_time, end_time, day_of_week, shift_date, is_phantom')
        .eq('shift_date', punchDateStr);
      
      const isToday = punchDateStr === todayStr;
      const eventsQuery = isToday
        ? supabase
            .from('schedule_events')
            .select('*, event_categories(name, color)')
            .eq('location_id', currentLocation.id)
            .eq('is_recurring', true)
        : Promise.resolve({ data: [] });
      
      const [punchesRes, scheduledRes, eventsRes] = await Promise.all([
        punchesQuery,
        scheduledQuery,
        eventsQuery
      ]);

      const allPunches = punchesRes.data || [];
      const todayScheduledShifts = (scheduledRes.data || []) as { id: string; user_id: string; start_time: string; end_time: string; day_of_week: number; shift_date: string; is_phantom?: boolean }[];
      const eventsData = (eventsRes as any).data || [];
      
      // Filter events for today only
      if (isToday && eventsData.length > 0) {
        const eventsForToday = eventsData.filter((event: any) => {
          if (event.days_of_week && event.days_of_week.length > 0) {
            return event.days_of_week.includes(targetDayOfWeek);
          }
          return event.day_of_week === targetDayOfWeek;
        }).map((event: any) => ({
          ...event,
          tagged_roles: event.tagged_roles as string[] | null,
          category: event.event_categories
        })).sort((a: any, b: any) => a.event_time.localeCompare(b.event_time));
        
        const roleFilteredEvents = filterEventsByRole(eventsForToday, role);
        setTodayEvents(roleFilteredEvents as Event[]);
      }
      
      // Get creator IDs and user IDs
      const createdByIds = [...new Set(allPunches
        .filter(p => p.created_by && p.created_by !== p.user_id)
        .map(p => p.created_by))] as string[];
      const punchUserIds = [...new Set(allPunches.map(p => p.user_id))];
      
      // Fetch profiles in parallel
      const [creatorRes, profilesRes] = await Promise.all([
        createdByIds.length > 0
          ? supabase.from('profiles').select('id, full_name, nickname').in('id', createdByIds)
          : Promise.resolve({ data: [] }),
        punchUserIds.length > 0
          ? supabase.from('profiles').select('id, full_name, nickname, profile_photo_url').in('id', punchUserIds)
          : Promise.resolve({ data: [] })
      ]);
      
      const creatorMap = new Map((creatorRes.data || []).map(p => [p.id, p.full_name]));
      const profileMap = new Map((profilesRes.data || []).map(p => [p.id, p]));
      
      // Group and process punches
      const userPunches: Record<string, typeof allPunches> = {};
      allPunches.forEach(p => {
        if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
        userPunches[p.user_id].push(p);
      });

      const punchSummaries: DayPunch[] = [];

      // Sanity cap: any "active" shift longer than this is treated as orphaned/stale data
      const MAX_REASONABLE_SHIFT_HOURS = 16;

      Object.entries(userPunches).forEach(([userId, punches]) => {
        // STEP 1: Split the user's punches into discrete shift groups.
        // A new shift starts whenever we see a clock_in (after the previous shift was closed,
        // OR when we see a second clock_in without an intervening clock_out — in which case
        // we treat the prior open shift as orphaned and abandon it).
        type ShiftGroup = {
          shiftId: string | null;
          clockIn: { id: string; punch_time: string; created_by: string | null };
          clockOut: { punch_time: string } | null;
          breakStart: { punch_time: string; notes: string } | null;
          breakEnd: { punch_time: string } | null;
        };
        const shiftGroups: ShiftGroup[] = [];
        let current: ShiftGroup | null = null;

        punches.forEach((p) => {
          if (p.punch_type === 'clock_in') {
            // If there's an open shift with no clock_out, push it (orphaned) and start fresh.
            if (current) shiftGroups.push(current);
            current = {
              shiftId: p.shift_id ?? null,
              clockIn: { id: p.id, punch_time: p.punch_time, created_by: p.created_by },
              clockOut: null,
              breakStart: null,
              breakEnd: null,
            };
            return;
          }
          if (p.punch_type === 'clock_out') {
            if (!current) return; // orphan clock_out, ignore
            if (!current.shiftId && p.shift_id) current.shiftId = p.shift_id;
            current.clockOut = { punch_time: p.punch_time };
            shiftGroups.push(current);
            current = null;
            return;
          }
          if (p.punch_type === 'break_start') {
            if (!current) return;
            if (!current.shiftId && p.shift_id) current.shiftId = p.shift_id;
            current.breakStart = { punch_time: p.punch_time, notes: p.notes || '' };
            current.breakEnd = null;
            return;
          }
          if (p.punch_type === 'break_end') {
            if (!current) return;
            if (!current.shiftId && p.shift_id) current.shiftId = p.shift_id;
            current.breakEnd = { punch_time: p.punch_time };
            return;
          }
        });
        // Don't forget a still-open shift at the end (someone currently clocked in)
        if (current) shiftGroups.push(current);

        if (shiftGroups.length === 0) return;

        // STEP 2: Pick the shift that belongs to the viewed day.
        // CRITICAL: only consider groups whose clock_in OR clock_out is on the viewed
        // local date. This prevents a still-open shift from a LATER day from hijacking
        // the choice when viewing a past date (which would then trip the >16h sanity
        // guard and silently drop the user from the day's completed list).
        const matchesDate = (iso: string) =>
          new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone }) === punchDateStr;

        // A shift belongs to its CLOCK-IN (business) date. Overnight shifts that
        // close after midnight stay anchored to the day they started — they must
        // NOT show up on the next calendar day as "clocked out".
        const candidates = shiftGroups.filter((s) => matchesDate(s.clockIn.punch_time));
        if (candidates.length === 0) return;

        // Prefer an active (still-open) shift, otherwise the latest one that started today.
        const activeShift = candidates.find((s) => !s.clockOut);
        const chosen = activeShift || candidates[candidates.length - 1];
        if (!chosen) return;

        // STEP 3: Compute hours, with sanity cap on stale "active" shifts.
        const profile = profileMap.get(userId) || profiles.find((p) => p.id === userId);
        const clockOutTime = chosen.clockOut?.punch_time || null;
        const isClockedIn = !chosen.clockOut;
        const isOnBreak = !!(chosen.breakStart && !chosen.breakEnd);
        const clockInMs = new Date(chosen.clockIn.punch_time).getTime();
        const endTime = clockOutTime ? new Date(clockOutTime).getTime() : Date.now();

        // Deduct unpaid (meal) break time
        let breakDeductionMs = 0;
        if (chosen.breakStart?.punch_time) {
          const notes = chosen.breakStart.notes || '';
          const isUnpaidBreak =
            notes.includes('30') ||
            notes.toLowerCase().includes('unpaid') ||
            notes.toLowerCase().includes('meal');
          if (isUnpaidBreak) {
            const breakStartMs = new Date(chosen.breakStart.punch_time).getTime();
            const breakEndMs = chosen.breakEnd?.punch_time
              ? new Date(chosen.breakEnd.punch_time).getTime()
              : isOnBreak
              ? Date.now()
              : breakStartMs + 30 * 60000;
            breakDeductionMs = breakEndMs - breakStartMs;
          }
        }
        const rawHours = Math.max(0, (endTime - clockInMs - breakDeductionMs) / 3600000);

        // Sanity guard: if shift is "active" but spans more than 16 hours, it's a stale
        // orphaned punch from a prior day (e.g., someone forgot to clock out long ago).
        // Skip rendering rather than showing 79h on the card.
        if (isClockedIn && rawHours > MAX_REASONABLE_SHIFT_HOURS) {
          return;
        }
        const hoursWorked = rawHours;

        const scheduledShift = chosen.shiftId
          ? todayScheduledShifts.find((s) => s.id === chosen.shiftId)
          : todayScheduledShifts.find((s) => s.user_id === userId);
        const createdByOther = chosen.clockIn.created_by && chosen.clockIn.created_by !== userId;
        const createdByName = createdByOther
          ? creatorMap.get(chosen.clockIn.created_by!) || null
          : null;

        punchSummaries.push({
          id: chosen.clockIn.id,
          user_id: userId,
          clockInTime: chosen.clockIn.punch_time,
          clockOutTime,
          breakStartTime: chosen.breakStart?.punch_time || null,
          breakEndTime: chosen.breakEnd?.punch_time || null,
          breakType: chosen.breakStart?.notes || null,
          isActive: isClockedIn,
          isOnBreak,
          profile: profile || { id: userId, full_name: 'Unknown', nickname: null, profile_photo_url: null },
          hoursWorked,
          createdByName,
          scheduledShift: scheduledShift
            ? {
                id: scheduledShift.id,
                start_time: scheduledShift.start_time,
                end_time: scheduledShift.end_time,
                day_of_week: scheduledShift.day_of_week,
                shift_date: scheduledShift.shift_date,
                is_phantom: scheduledShift.is_phantom,
              }
            : null,
        });
      });

      // Filter using the Business Date standard: every punch is attributed to exactly ONE
      // business day (open → next-day cutoff = close + 3h). This prevents overnight shifts
      // from appearing on both the day they started and the day they ended.
      const filteredPunches = punchSummaries.filter((punch) => {
        const businessDate = getBusinessDateForTimestamp(punch.clockInTime, timezone, closeTime);
        return businessDate === punchDateStr;
      });
      
      // Sort: active first, then by clock-in time
      filteredPunches.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime();
      });
      
      return filteredPunches;
    },
    enabled: !!currentLocation?.id && !!timezone && !!punchDateStr,
    staleTime: 30 * 1000,
    // Only auto-refetch for today
    refetchInterval: punchDateStr === todayStr ? 60 * 1000 : false,
  });

  // Day Insights — references the same SOT as the Dashboard SalesSummary.
  // For TODAY: prefers the in-memory enriched cache (written by SalesSummary)
  //   → falls back to the shared localStorage live-sales cache (also written
  //     by SalesSummary on the dashboard) → finally falls back to sales_cache
  //     + labor_cache so a fresh visit to /schedule still shows real numbers.
  // For PAST days: reads sales_cache + labor_cache directly (same tables the
  // dashboard reads for historical days via checkDatabaseCache).
  const { data: dayInsightsData } = useQuery({
    queryKey: ['day-insights', currentLocation?.id, punchDateStr],
    queryFn: async () => {
      if (!currentLocation?.id || !punchDateStr) return null;
      const isToday = punchDateStr === todayStr;

      // 1. In-memory enriched cache from SalesSummary (master writer)
      const enriched: any = queryClient.getQueryData(['dashboard-sales-enriched', currentLocation.id]);
      if (isToday && enriched) {
        return {
          sales: enriched?.daily || 0,
          laborCost: enriched?.labor?.laborCost || 0,
          laborHours: enriched?.labor?.hoursWorked || 0,
        };
      }

      // 2. localStorage live-sales cache (shared with SalesSummary)
      if (isToday) {
        try {
          const { getCachedLiveSales } = await import('@/utils/salesCache');
          const live = getCachedLiveSales(currentLocation.id);
          if (live?.data) {
            return {
              sales: live.data?.daily || 0,
              laborCost: live.data?.labor?.laborCost || 0,
              laborHours: live.data?.labor?.hoursWorked || 0,
            };
          }
        } catch {}
      }

      // 3. Direct DB read (sales_cache + labor_cache)
      const [salesRes, laborRes] = await Promise.all([
        supabase
          .from('sales_cache')
          .select('net_sales')
          .eq('location_id', currentLocation.id)
          .eq('sale_date', punchDateStr)
          .maybeSingle(),
        supabase
          .from('labor_cache')
          .select('labor_cost, labor_hours, source')
          .eq('location_id', currentLocation.id)
          .eq('labor_date', punchDateStr),
      ]);

      const sales = Number(salesRes.data?.net_sales) || 0;
      const laborRows = laborRes.data || [];
      // Match SalesSummary EXACTLY: single preferredRow used for BOTH hours and cost
      // punch_clock wins only when it has real data (hours>0 or cost>0), else qubeyond
      const punchClockRow = laborRows.find((r: any) => r.source === 'punch_clock' && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
      const externalRow = laborRows.find((r: any) => ['qubeyond', 'aloha', 'clover'].includes(r.source) && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
      const preferredRow = punchClockRow || externalRow;

      // labor_cache only holds CLOSED days — for today fall back to the shared
      // live-punch helper so this matches the dashboard.
      if (isToday && !(Number(preferredRow?.labor_hours) > 0)) {
        const { fetchLiveLaborForToday } = await import('@/utils/liveLabor');
        const live = await fetchLiveLaborForToday(currentLocation.id);
        if (live.hours > 0) {
          return { sales, laborCost: live.cost, laborHours: live.hours };
        }
      }

      return {
        sales,
        laborCost: Number(preferredRow?.labor_cost) || 0,
        laborHours: Number(preferredRow?.labor_hours) || 0,
      };
    },
    enabled: !!currentLocation?.id && !!punchDateStr,
    staleTime: punchDateStr === todayStr ? 60 * 1000 : 5 * 60 * 1000,
    refetchInterval: punchDateStr === todayStr ? 60 * 1000 : false,
  });



  // Get week label relative to current week (using timezone-aware calculation)
  const getWeekLabel = useCallback(() => {
    // Use timezone-aware "today" to determine "this week"
    const todayStr = timezone ? getTodayInTimezone(timezone) : null;
    let thisWeekStart: Date;
    
    if (todayStr) {
      const [y, m, d] = todayStr.split('-').map(Number);
      thisWeekStart = startOfWeek(new Date(y, m - 1, d), { weekStartsOn: 1 });
    } else {
      thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    }
    
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
    
    if (diffWeeks < 0) {
      return { label: `${Math.abs(diffWeeks)} Weeks Ago`, variant: "secondary" as const };
    } else {
      return { label: `${diffWeeks} Weeks Ahead`, variant: "outline" as const };
    }
  }, [currentWeekStart, timezone]);

  // Persist selected tab across re-mounts
  useEffect(() => {
    sessionStorage.setItem('mobileScheduleTab', activeTab);
  }, [activeTab]);

  const handlePreviousWeek = () => {
    const newWeekStart = subWeeks(currentWeekStart, 1);
    onWeekChange?.(newWeekStart);
    setSelectedDate(newWeekStart);
    setActiveTab('schedule');
  };

  const handleNextWeek = () => {
    const newWeekStart = addWeeks(currentWeekStart, 1);
    onWeekChange?.(newWeekStart);
    setSelectedDate(newWeekStart);
    setActiveTab('schedule');
  };

  // Get shifts and events for selected day
  // Use shift_date as source of truth (matches EmployeeRow.tsx fix)
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const isSelectedDateToday = selectedDateStr === todayStr;
  const isPastDate = selectedDateStr && todayStr && selectedDateStr < todayStr;




  if (import.meta.env.DEV) {
    console.info('[MobileScheduleView]', {
      selectedDateStr,
      isPublished,
      scheduleVisibilityLoading,
      canSeeFullSchedule,
      isAdmin,
      isManager,
      userId: user?.id,
      shiftsCount: shifts.length,
    });
  }
  
  // Admins/managers see all shifts, team members see all if canSeeFullSchedule, otherwise only their own shifts
  // While loading visibility permission, show only user's own shifts to be safe
  const dayShifts = shifts.filter(s => {
    // Use shift_date instead of day_of_week to prevent week navigation bugs
    if (s.shift_date !== selectedDateStr || !s.user_id) return false;
    
    // Admins/managers always see everything (including unpublished)
    if (isAdmin || isManager) return true;
    
    // For non-admin/manager: only show published shifts
    if (!isPublished) return false;
    
    // While loading visibility permission, default to showing only own shifts
    if (scheduleVisibilityLoading) return s.user_id === user?.id;
    
    // If they can see full schedule (shift managers OR team members with permission), show all
    if (canSeeFullSchedule) return true;
    
    // Otherwise, team members only see their own shifts
    return s.user_id === user?.id;
  });
  const dayEvents = filterEventsByRole(
    events.filter(e => {
      if (e.days_of_week && e.days_of_week.length > 0) {
        return e.days_of_week.includes(selectedDayOfWeek);
      }
      return e.day_of_week === selectedDayOfWeek;
    }),
    role
  );

  const getProfileForShift = (shift: Shift) => {
    return profiles.find(p => p.id === shift.user_id);
  };

  const getShiftLabel = (shift: Shift) => {
    const position = shift.template?.position || null;
    if (!position) return null;
    // Remove time information if present (e.g., "Opening Manager 9:00 AM" → "Opening Manager")
    return position.replace(/\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?$/i, '').trim();
  };

  const handlePrintDayTimeline = () => {
    exportDayTimelineToPrint({
      locationName: currentLocation?.name || 'Location',
      date: selectedDate,
      profiles: profiles.map((p: any) => ({ id: p.id, full_name: p.full_name, role: p.role })),
      shifts: dayShifts.map((s: any) => ({
        id: s.id,
        user_id: s.user_id,
        start_time: s.start_time,
        end_time: s.end_time,
        template_name: s.template?.template_name ?? null,
        template_color: s.template?.color ?? null,
        position: s.template?.position ?? null,
        breaks: s.breaks,
      })),
      breakCoverageEnabled: !!locationSettings?.break_coverage_enabled,
    });
  };

  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = async () => {
    const url = window.location.href;
    const text = currentLocation?.name
      ? `Schedule for ${currentLocation.name} — ${format(selectedDate, 'EEEE, MMMM d')}`
      : `Schedule for ${format(selectedDate, 'EEEE, MMMM d')}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, text, url });
      } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {}
  };

  // Determine if a shift is published (same logic as desktop EmployeeRow)
  const isShiftPublished = (shift: Shift): boolean => {
    // If schedule was never published, all shifts are drafts
    if (!isPublished) return false;
    
    // If no snapshot exists, consider all shifts published
    if (!publishedSnapshot || publishedSnapshot.length === 0) return true;
    
    // Check if shift exists in snapshot
    const snapshotShift = publishedSnapshot.find((s: any) => s.id === shift.id);
    
    // New shift after publish = draft
    if (!snapshotShift) return false;
    
    // Check if shift was modified since last publish
    const isModified = (
      snapshotShift.user_id !== shift.user_id ||
      snapshotShift.start_time !== shift.start_time ||
      snapshotShift.end_time !== shift.end_time ||
      snapshotShift.template_id !== shift.template_id ||
      snapshotShift.shift_date !== shift.shift_date ||
      snapshotShift.day_of_week !== shift.day_of_week
    );
    
    return !isModified;
  };


  // Count unique employees scheduled (only those with valid profiles)
  const shiftsWithProfiles = dayShifts.filter(s => profiles.some(p => p.id === s.user_id));
  const uniqueEmployeesScheduled = new Set(shiftsWithProfiles.map(s => s.user_id)).size;

  // Content for Schedule tab
  const renderScheduleContent = () => (
    <div className="space-y-0.5">
      {/* Week Header - Centered with week label */}
      <div className="flex flex-col items-center gap-0.5">
        <DateNavigator
          onPrev={handlePreviousWeek}
          onNext={handleNextWeek}
          label={`${format(currentWeekStart, 'MMM d')} - ${format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}`}
        />
        <Badge variant={getWeekLabel().variant} className="text-xs">
          {getWeekLabel().label}
        </Badge>
      </div>

      {/* Week Calendar - Compact pill-style selector */}
      <div className="bg-muted rounded-xl p-1 flex items-center justify-around border border-border/40 overflow-hidden">
        {weekDays.map((day, index) => {
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());
          
          return (
            <button
              key={index}
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center flex-1 py-0.5 rounded-lg transition-all ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : isToday
                    ? 'bg-primary/20 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                {format(day, 'EEE').slice(0, 3)}
              </span>
              <span className={`text-sm font-bold leading-tight ${isToday && !isSelected ? '' : ''}`}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Events for selected day - compact badge style, 2 per row */}
      {dayEvents.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Events</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {dayEvents.map(event => {
              const color = event.category?.color || '#8B5CF6';
              return (
                <div
                  key={event.id}
                  onClick={() => setPreviewEvent(event)}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg min-w-0 cursor-pointer active:opacity-80 transition-opacity"
                  style={{ backgroundColor: `${color}10` }}
                >
                  <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                  <span className="text-xs font-medium truncate flex-1">{event.event_name}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatTime12Hour(event.event_time)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Shifts for selected day */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {uniqueEmployeesScheduled} Scheduled
          </h4>
          {(isAdmin || isManager) && (
            <div className="flex gap-1 items-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setBuildWizardOpen(true)}
                title="Build Schedule"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              {scheduleId && (
                <>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7"
                    onClick={() => setEventDialogOpen(true)}
                  >
                    <CalendarPlus className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7"
                    onClick={() => setAddSheetOpen(true)}
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Print Day Timeline"
                    onClick={handlePrintDayTimeline}
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                </>
              )}
              {/* Publish/Update Button - styled like desktop */}
              {scheduleId && (!isPublished ? (
                <Button 
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={onGoLive}
                  disabled={isPublishing}
                >
                  {isPublishing ? 'Publishing...' : 'Go Live'}
                </Button>
              ) : hasPendingChanges ? (
                <Button 
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
                  onClick={onSendUpdate}
                  disabled={isPublishing}
                >
                  {isPublishing ? (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Update
                    </>
                  )}
                </Button>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-destructive/10 border border-destructive rounded-md">
                  <span className="relative flex items-end gap-[1px] h-3">
                    <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-1" style={{ height: '25%' }}></span>
                    <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-2" style={{ height: '50%' }}></span>
                    <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-3" style={{ height: '75%' }}></span>
                    <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-4" style={{ height: '100%' }}></span>
                  </span>
                  <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Live</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {isLoading && shifts.length === 0 ? (
          // Skeleton loading state - show 4 placeholder cards
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex rounded-lg bg-card border border-border/30 shadow-neumorphic overflow-hidden animate-pulse">
                <div className="w-1 bg-muted" />
                <div className="flex-1 p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 bg-muted rounded w-24" />
                      <div className="h-3 bg-muted rounded w-16" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : dayShifts.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No shifts scheduled</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {dayShifts
              .sort((a, b) => a.start_time.localeCompare(b.start_time))
              .map(shift => {
                const profile = getProfileForShift(shift);
                if (!profile) return null;
                
                const shiftLabel = getShiftLabel(shift);
                const shiftPublished = isShiftPublished(shift);
                
                return (
                  <MobileShiftCard
                    key={shift.id}
                    name={getDisplayName(profile.full_name, (profile as any).nickname)}
                    avatarUrl={profile.profile_photo_url}
                    startTime={shift.start_time}
                    endTime={shift.end_time}
                    accentColor={shift.template?.color}
                    isPublished={shiftPublished}
                    positionLabel={shiftLabel}
                    positionColor={shift.template?.color}
                    onClick={() => {
                      if (isAdmin || isManager) {
                        setSelectedShift(shift);
                        setShiftDialogOpen(true);
                      }
                    }}
                    actionButton={!isAdmin && !isManager && shift.user_id === user?.id ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs px-2 h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedShiftForOffer(shift);
                          setOfferDialogOpen(true);
                        }}
                      >
                        Offer Up
                      </Button>
                    ) : undefined}
                  />
                );
              })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-background -mx-[max(1rem,env(safe-area-inset-left))]">
      {/* Admin/Manager view */}
      {(isAdmin || isManager) ? (
        (
          /* V2: Combined single-scroll view — no tabs */
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto px-[max(1rem,env(safe-area-inset-left))] pt-3 pb-3 space-y-1.5">
              {/* Date header */}
              <div className="flex items-center justify-center">
                <DateNavigator
                  onPrev={handlePreviousWeek}
                  onNext={handleNextWeek}
                  label={`${format(selectedDate, 'EEEE, MMMM d')}`}
                />
              </div>

              {/* Week Calendar Strip */}
              <div className="bg-muted rounded-xl p-1 flex items-center justify-around border border-border/40 overflow-hidden">
                {weekDays.map((day, index) => {
                  const isSelected = isSameDay(day, selectedDate);
                  const isDayToday = isSameDay(day, new Date());
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(day)}
                      className={`flex flex-col items-center flex-1 py-0.5 rounded-lg transition-all ${
                        isSelected
                          ? 'bg-primary text-primary-foreground shadow-md'
                          : isDayToday
                            ? 'bg-primary/20 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
                      }`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wide">
                        {format(day, 'EEE').slice(0, 3)}
                      </span>
                      <span className="text-sm font-bold leading-tight">
                        {format(day, 'd')}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Events & Tasks — matching Option 6 layout */}
              <div className="space-y-1">
                {/* Events — flex-wrap pill style */}
                {dayEvents.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {dayEvents.map(event => {
                      const color = event.category?.color || '#8B5CF6';
                      return (
                        <div
                          key={event.id}
                          onClick={() => setPreviewEvent(event)}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg min-w-[calc(50%-2px)] max-w-full flex-grow cursor-pointer active:opacity-80 transition-opacity"
                          style={{ backgroundColor: `${color}10` }}
                        >
                          <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <CalendarDays className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                          <span className="text-xs font-medium truncate flex-1">{event.event_name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatTime12Hour(event.event_time)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {dayEvents.length > 0 && (
                  <div className="mx-6 border-t border-border/30" />
                )}
                {/* Tasks — from AssignedTemporaryTasks (excludes event tasks to avoid duplication) */}
                <AssignedTemporaryTasks showCompleted={true} includeCateringOrders={true} includeEventTasks={false} compact={true} />
              </div>

              {/* Quick Action Bar — always visible */}
              <div className="mb-2 flex items-stretch gap-1 rounded-lg bg-primary p-0.5 text-primary-foreground shadow-sm">
                <button
                  type="button"
                  onClick={isSelectedDateToday ? () => setQuickPunchOpen(true) : undefined}
                  disabled={!isSelectedDateToday}
                  title={isSelectedDateToday ? undefined : 'Quick Punch is only available for today'}
                  className="flex-1 flex flex-col items-center justify-center gap-0 py-1 rounded-md active:bg-primary-foreground/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide">Quick Punch</span>
                </button>
                {(isAdmin || isManager) && (
                  <>
                    {scheduleId && (
                      <>
                        <div className="w-px bg-primary-foreground/15 my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            setAddSheetTab('shift');
                            setAddSheetLockTab(true);
                            setAddSheetWeekOverride(null);
                            setAddSheetOpen(true);
                          }}
                          className="flex-1 flex flex-col items-center justify-center gap-0 py-1 rounded-md active:bg-primary-foreground/10 transition"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-semibold uppercase tracking-wide">New Shift</span>
                        </button>
                      </>
                    )}
                    <div className="w-px bg-primary-foreground/15 my-1" />
                    <button
                      type="button"
                      onClick={() => setBuildWizardOpen(true)}
                      className="flex-1 flex flex-col items-center justify-center gap-0 py-1 rounded-md active:bg-primary-foreground/10 transition"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide">Build Week</span>
                    </button>
                    {scheduleId && (
                      <>
                        <div className="w-px bg-primary-foreground/15 my-1" />
                        <button
                          type="button"
                          onClick={() => setEventDialogOpen(true)}
                          className="flex-1 flex flex-col items-center justify-center gap-0 py-1 rounded-md active:bg-primary-foreground/10 transition"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-semibold uppercase tracking-wide">New Event</span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* 5. TODAY: NOW + LATER sections with punch tracking */}
              {isSelectedDateToday ? ((() => {
                const activePunches = dayPunches.filter(p => p.isActive && !p.isOnBreak);
                const onBreakPunches = dayPunches.filter(p => p.isOnBreak);
                const completedPunches = dayPunches.filter(p => !p.isActive);
                const totalScheduled = dayPunches.length;

                return (
                  <>

                    {/* NOW header — always rendered so LIVE status has a home */}
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                        <Circle className={`h-2 w-2 ${activePunches.length > 0 ? 'fill-green-500 text-green-500' : 'fill-muted-foreground text-muted-foreground'}`} />
                        <span className={activePunches.length > 0 ? 'text-green-600' : 'text-muted-foreground'}>Now</span>
                        {(activePunches.length > 0 || onBreakPunches.length > 0) ? (
                          <>
                            <span className="text-muted-foreground mx-0.5">·</span>
                            <span className="text-green-600">{activePunches.length} Active</span>
                            {onBreakPunches.length > 0 && (
                              <>
                                <span className="text-muted-foreground mx-0.5">·</span>
                                <span className="text-amber-600">{onBreakPunches.length} Break</span>
                              </>
                            )}
                            <span className="text-muted-foreground mx-0.5">·</span>
                            <span className="text-muted-foreground">{totalScheduled} Total</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground font-normal normal-case tracking-normal">— no one clocked in</span>
                        )}
                        {(isAdmin || isManager) && scheduleId && (
                          <div className="ml-auto">
                            {!isPublished ? (
                              <Button size="sm" className="h-6 px-2.5 text-[10px]" onClick={onGoLive} disabled={isPublishing}>
                                {isPublishing ? '...' : 'Go Live'}
                              </Button>
                            ) : hasPendingChanges ? (
                              <button
                                type="button"
                                onClick={onSendUpdate}
                                disabled={isPublishing}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500 active:scale-95 transition"
                              >
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                </span>
                                <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Update</span>
                              </button>
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-destructive/10 border border-destructive">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.9)]"></span>
                                </span>
                                <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Live</span>
                              </div>
                            )}
                          </div>
                        )}
                      </h4>
                      {[...activePunches, ...onBreakPunches].map(punch => (
                        <MobileShiftCard
                          key={punch.id}
                          name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
                          avatarUrl={punch.profile.profile_photo_url}
                          startTime={punch.scheduledShift?.start_time || '00:00'}
                          endTime={punch.scheduledShift?.end_time || '00:00'}
                          statusIndicator={punch.isOnBreak ? 'break' : 'active'}
                          scheduledStart={punch.scheduledShift?.start_time}
                          scheduledEnd={punch.scheduledShift?.end_time}
                          isPhantom={punch.scheduledShift?.is_phantom}
                          clockInTime={punch.clockInTime}
                          clockOutTime={punch.clockOutTime}
                          breakStartTime={punch.breakStartTime}
                          breakEndTime={punch.breakEndTime}
                          hoursWorked={punch.hoursWorked}
                          createdByName={punch.createdByName}
                          timezone={timezone}
                          formatTimeDisplay={formatTimeDisplay}
                          showBreakIndicator={false}
                          onClick={() => {
                            const today = getTodayInTimezone(timezone);
                            setSelectedPunch({
                              userId: punch.user_id,
                              userName: getDisplayName(punch.profile.full_name, punch.profile.nickname),
                              userPhoto: punch.profile.profile_photo_url,
                              punchDate: today,
                              clockInId: punch.id,
                            });
                            setEditPunchOpen(true);
                          }}
                        />
                      ))}
                    </div>

                    {/* LATER section — upcoming scheduled shifts not yet punched in */}
                    {(() => {
                      const laterShifts = dayShifts
                        .filter(shift => {
                          const profile = getProfileForShift(shift);
                          if (!profile) return false;
                          return !dayPunches.some(p => p.user_id === shift.user_id);
                        })
                        .sort((a, b) => a.start_time.localeCompare(b.start_time));

                      const showLaterSection = laterShifts.length > 0 || (activePunches.length === 0 && onBreakPunches.length === 0 && completedPunches.length === 0);

                      return showLaterSection ? (
                        <div className="space-y-1.5">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                            Later
                          </h4>


                          {loadingActive ? (
                            <div className="text-center py-8 text-muted-foreground">Loading...</div>
                          ) : (
                            renderMaybeStationGrouped(
                              laterShifts,
                              (shift) => shift.user_id,
                              (shift) => {
                                const profile = getProfileForShift(shift);
                                if (!profile) return null;
                                const shiftLabel = getShiftLabel(shift);
                                return (
                                  <MobileShiftCard
                                    name={getDisplayName(profile.full_name, (profile as any).nickname)}
                                    avatarUrl={profile.profile_photo_url}
                                    startTime={shift.start_time}
                                    endTime={shift.end_time}
                                    accentColor={shift.template?.color}
                                    isPublished={isShiftPublished(shift)}
                                    positionLabel={shiftLabel}
                                    positionColor={shift.template?.color}
                                    onClick={() => {
                                      if (isAdmin || isManager) {
                                        setSelectedShift(shift);
                                        setShiftDialogOpen(true);
                                      }
                                    }}
                                  />
                                );
                              },
                              (shift) => shift.id,
                            )
                          )}
                        </div>
                      ) : null;
                    })()}

                    {/* COMPLETED section — finished punches */}
                    {completedPunches.length > 0 && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          {`Completed (${completedPunches.length})`}
                        </h4>

                        {renderMaybeStationGrouped(
                          completedPunches,
                          (punch) => punch.user_id,
                          (punch) => (
                            <MobileShiftCard
                              name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
                              avatarUrl={punch.profile.profile_photo_url}
                              startTime={punch.scheduledShift?.start_time || '00:00'}
                              endTime={punch.scheduledShift?.end_time || '00:00'}
                              statusIndicator="none"
                              scheduledStart={punch.scheduledShift?.start_time}
                              scheduledEnd={punch.scheduledShift?.end_time}
                              isPhantom={punch.scheduledShift?.is_phantom}
                              clockInTime={punch.clockInTime}
                              clockOutTime={punch.clockOutTime}
                              breakStartTime={punch.breakStartTime}
                              breakEndTime={punch.breakEndTime}
                              hoursWorked={punch.hoursWorked}
                              createdByName={punch.createdByName}
                              timezone={timezone}
                              formatTimeDisplay={formatTimeDisplay}
                              showBreakIndicator={false}
                              onClick={() => {
                                const today = getTodayInTimezone(timezone);
                                setSelectedPunch({
                                  userId: punch.user_id,
                                  userName: getDisplayName(punch.profile.full_name, punch.profile.nickname),
                                  userPhoto: punch.profile.profile_photo_url,
                                  punchDate: today,
                                  clockInId: punch.id,
                                });
                                setEditPunchOpen(true);
                              }}
                            />
                          ),
                          (punch) => punch.id,
                        )}
                      </div>
                    )}


                    {/* Day Insights — bottom of page */}
                    <Card className="overflow-hidden p-0 mt-2">
                      <button
                        onClick={() => setInsightsExpanded(!insightsExpanded)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 text-xs font-medium"
                      >
                        <span className="flex items-center gap-1.5">
                          <BarChart3 className="h-3.5 w-3.5" /> Day Insights
                        </span>
                        <span className="text-muted-foreground">{insightsExpanded ? '▲' : '▼'}</span>
                      </button>
                      {insightsExpanded && (
                        <div className="px-3 py-2.5 border-t border-border/30">
                          {(() => {
                            const totalHours = dayInsightsData?.laborHours || dayPunches.reduce((sum, p) => sum + p.hoursWorked, 0);
                            const laborCost = dayInsightsData?.laborCost || 0;
                            const sales = dayInsightsData?.sales || 0;
                            const laborPct = sales > 0 ? (laborCost / sales) * 100 : 0;
                            const salesPerLH = totalHours > 0 ? sales / totalHours : 0;
                            return (
                              <div className="grid grid-cols-5 gap-1 text-center">
                                <div>
                                  <span className="text-base font-bold">${sales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  <p className="text-[10px] text-muted-foreground">Sales</p>
                                </div>
                                <div>
                                  <span className="text-base font-bold">{totalHours.toFixed(1)}h</span>
                                  <p className="text-[10px] text-muted-foreground">Hours</p>
                                </div>
                                <div>
                                  <span className="text-base font-bold">${laborCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  <p className="text-[10px] text-muted-foreground">Labor</p>
                                </div>
                                <div>
                                  <span className={`text-base font-bold ${laborPct > 30 ? 'text-destructive' : 'text-green-600'}`}>{laborPct.toFixed(1)}%</span>
                                  <p className="text-[10px] text-muted-foreground">Labor %</p>
                                </div>
                                <div>
                                  <span className="text-base font-bold">${salesPerLH.toFixed(2)}</span>
                                  <p className="text-[10px] text-muted-foreground">$/LH</p>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </Card>
                  </>
                );
              })()) : isPastDate && dayPunches.length > 0 ? (
                /* Past days with punch data — show completed-style cards */
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    {`Completed (${dayPunches.length})`}
                    <div className="flex items-center gap-1 ml-auto">
                    </div>
                  </h4>
                  {renderMaybeStationGrouped(
                    dayPunches,
                    (punch) => punch.user_id,
                    (punch) => (
                      <MobileShiftCard
                        name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
                        avatarUrl={punch.profile.profile_photo_url}
                        startTime={punch.scheduledShift?.start_time || '00:00'}
                        endTime={punch.scheduledShift?.end_time || '00:00'}
                        statusIndicator="none"
                        scheduledStart={punch.scheduledShift?.start_time}
                        scheduledEnd={punch.scheduledShift?.end_time}
                        isPhantom={punch.scheduledShift?.is_phantom}
                        clockInTime={punch.clockInTime}
                        clockOutTime={punch.clockOutTime}
                        breakStartTime={punch.breakStartTime}
                        breakEndTime={punch.breakEndTime}
                        hoursWorked={punch.hoursWorked}
                        createdByName={punch.createdByName}
                        timezone={timezone}
                        formatTimeDisplay={formatTimeDisplay}
                        showBreakIndicator={false}
                        onClick={() => {
                          setSelectedPunch({
                            userId: punch.user_id,
                            userName: getDisplayName(punch.profile.full_name, punch.profile.nickname),
                            userPhoto: punch.profile.profile_photo_url,
                            punchDate: selectedDateStr,
                            clockInId: punch.id,
                          });
                          setEditPunchOpen(true);
                        }}
                      />
                    ),
                    (punch) => punch.id,
                  )}
                </div>
              ) : (
                /* Future days or past without punches — show all scheduled shifts */
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    Scheduled
                    <span className="text-muted-foreground">({dayShifts.filter(s => getProfileForShift(s)).length})</span>
                    <div className="flex items-center gap-1 ml-auto">
                      {(isAdmin || isManager) && scheduleId && (
                        <>
                          {!isPublished ? (
                            <Button size="sm" className="h-7 px-3 text-xs" onClick={onGoLive} disabled={isPublishing}>
                              {isPublishing ? 'Publishing...' : 'Go Live'}
                            </Button>
                          ) : hasPendingChanges ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
                              onClick={onSendUpdate}
                              disabled={isPublishing}
                            >
                              {isPublishing ? (
                                <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Updating...</>
                              ) : (
                                <><RefreshCw className="h-3 w-3 mr-1" />Update</>
                              )}
                            </Button>
                          ) : (
                            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-destructive/10 border border-destructive rounded-md">
                              <span className="relative flex items-end gap-[1px] h-3">
                                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-1" style={{ height: '25%' }}></span>
                                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-2" style={{ height: '50%' }}></span>
                                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-3" style={{ height: '75%' }}></span>
                                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-4" style={{ height: '100%' }}></span>
                              </span>
                              <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Live</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </h4>

                  {dayShifts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Circle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No shifts scheduled</p>
                    </div>
                  ) : (
                    renderMaybeStationGrouped(
                      [...dayShifts].sort((a, b) => a.start_time.localeCompare(b.start_time)),
                      (shift) => shift.user_id,
                      (shift) => {
                        const profile = getProfileForShift(shift);
                        if (!profile) return null;
                        const shiftLabel = getShiftLabel(shift);
                        return (
                          <MobileShiftCard
                            name={getDisplayName(profile.full_name, (profile as any).nickname)}
                            avatarUrl={profile.profile_photo_url}
                            startTime={shift.start_time}
                            endTime={shift.end_time}
                            accentColor={shift.template?.color}
                            isPublished={isShiftPublished(shift)}
                            positionLabel={shiftLabel}
                            positionColor={shift.template?.color}
                            onClick={() => {
                              if (isAdmin || isManager) {
                                setSelectedShift(shift);
                                setShiftDialogOpen(true);
                              }
                            }}
                          />
                        );
                      },
                      (shift) => shift.id,
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        /* Non-admin view - schedule only */
        <div className="flex-1 overflow-auto p-2">
          {renderScheduleContent()}
        </div>
      )}

      <ShiftOfferDialog
        open={offerDialogOpen}
        onOpenChange={setOfferDialogOpen}
        shift={selectedShiftForOffer}
        onOfferCreated={() => {
          // Refresh shifts if needed
        }}
      />

      {shiftDialogOpen && (
        <Suspense fallback={null}>
          <MobileShiftDialog
            open={shiftDialogOpen}
            onOpenChange={(open) => {
              setShiftDialogOpen(open);
              if (!open) setIsCreatingShift(false);
            }}
            shift={selectedShift}
            profiles={profiles}
            isAdmin={isAdmin || isManager}
            isCreating={isCreatingShift}
            scheduleId={scheduleId}
            templates={templates}
            locationId={currentLocation?.id}
            currentWeekStart={currentWeekStart}
            onShiftUpdated={() => {
              onUpdate?.();
              setShiftDialogOpen(false);
              setIsCreatingShift(false);
            }}
          />
        </Suspense>
      )}

      {addSheetOpen && (
        <Suspense fallback={null}>
          <MobileAddScheduleSheet
            open={addSheetOpen}
            onOpenChange={(o) => {
              setAddSheetOpen(o);
              if (!o) {
                setAddSheetWeekOverride(null);
                setAddSheetTab('shift');
                setAddSheetLockTab(false);
              }
            }}
            weekStart={addSheetWeekOverride ?? currentWeekStart}
            profiles={profiles}
            templates={templates}
            scheduleId={scheduleId ?? null}
            locationId={currentLocation?.id}
            shifts={shifts}
            defaultDate={selectedDate}
            defaultTab={addSheetTab}
            lockTab={addSheetLockTab}
            locationSettings={locationSettings}
            availabilityRequests={availabilityRequests}
            lastWeekShifts={lastWeekShifts}
            onCreated={() => onUpdate?.()}
          />
        </Suspense>
      )}

      {buildWizardOpen && (
        <Suspense fallback={null}>
          <MobileBuildScheduleWizard
            open={buildWizardOpen}
            onOpenChange={setBuildWizardOpen}
            currentWeekStart={currentWeekStart}
            locationId={currentLocation?.id}
            profiles={profiles}
            onWeekChange={(ws) => onWeekChange?.(ws)}
            onCompleted={() => onUpdate?.()}
            onOpenWeekEditor={(ws) => {
              setAddSheetWeekOverride(ws);
              setAddSheetTab('employee');
              setAddSheetLockTab(false);
              setAddSheetOpen(true);
            }}
          />
        </Suspense>
      )}



      <QuickPunchDialog
        open={quickPunchOpen}
        onOpenChange={setQuickPunchOpen}
        profiles={profiles}
        selectedDate={selectedDate}
        onPunchCreated={() => {
          onUpdate?.();
          if (activeTab === 'today') {
            refetchPunches();
          }
        }}
      />

      {selectedPunch && currentLocation?.id && (
        <EditPunchDialog
          open={editPunchOpen}
          onOpenChange={setEditPunchOpen}
          userId={selectedPunch.userId}
          userName={selectedPunch.userName}
          userPhoto={selectedPunch.userPhoto}
          punchDate={selectedPunch.punchDate}
          clockInId={selectedPunch.clockInId}
          timezone={timezone}
          locationId={currentLocation.id}
          onPunchUpdated={() => {
            refetchPunches();
            onUpdate?.();
          }}
        />
      )}

      {currentLocation?.id && scheduleId && (
        <MobileEventDialog
          open={eventDialogOpen}
          onOpenChange={setEventDialogOpen}
          scheduleId={scheduleId}
          locationId={currentLocation.id}
          selectedDayOfWeek={selectedDayOfWeek}
          onEventCreated={() => {
            onUpdate?.();
          }}
        />
      )}

      {/* Event Preview Dialog */}
      {previewEvent && (
        <Dialog open={!!previewEvent} onOpenChange={(open) => { if (!open) setPreviewEvent(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div
                  className="p-1.5 rounded-md"
                  style={{ backgroundColor: `${previewEvent.category?.color || '#8B5CF6'}20` }}
                >
                  <CalendarCheck className="h-4 w-4" style={{ color: previewEvent.category?.color || '#8B5CF6' }} />
                </div>
                {previewEvent.event_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{formatTime12Hour(previewEvent.event_time)}</span>
                {previewEvent.category?.name && (
                  <span
                    className="px-1.5 py-0.5 rounded text-xs"
                    style={{
                      backgroundColor: `${previewEvent.category.color || '#8B5CF6'}20`,
                      color: previewEvent.category.color || '#8B5CF6',
                    }}
                  >
                    {previewEvent.category.name}
                  </span>
                )}
              </div>
              {previewEvent.notes && (
                <p className="text-sm">{previewEvent.notes}</p>
              )}
              {previewEvent.is_recurring && (
                <p className="text-xs text-muted-foreground">Recurring event</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Share button — bottom right of page */}
      <button
        type="button"
        onClick={handleShare}
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition"
        aria-label="Share schedule"
        title="Share schedule"
      >
        <Share className="h-5 w-5" />
        {shareCopied && (
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] text-background">
            Link copied!
          </span>
        )}
      </button>
    </div>
  );
}