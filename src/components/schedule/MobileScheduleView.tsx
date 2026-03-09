import { useState, useEffect, useMemo, useCallback } from 'react';
import { getDisplayName } from '@/utils/displayName';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Users, CalendarPlus, RefreshCw, Circle, UserPlus, CalendarCheck, Clock, LayoutGrid, BarChart3 } from 'lucide-react';
import { DateNavigator } from '@/components/ui/date-navigator';
import { Button } from '@/components/ui/button';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { MobileShiftDialog } from './MobileShiftDialog';
import { MobileShiftCard } from './MobileShiftCard';
import { QuickPunchDialog } from './QuickPunchDialog';
import { EditPunchDialog } from './EditPunchDialog';
import { MobileEventDialog } from './MobileEventDialog';
// Option6TodayContent kept as standalone component for potential reuse
import { useScheduleLayoutFlag } from '@/hooks/useScheduleLayoutFlag';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamScheduleVisibility } from '@/hooks/useTeamScheduleVisibility';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { useAuth } from '@/lib/auth';
import { formatTime12Hour } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTodayInTimezone, getTimezoneOffset, formatTimeDisplay, getDayOfWeekInTimezone, parseDateStringInTimezone, getEndOfDateStringInTimezone } from '@/utils/timezoneUtils';
import { filterEventsByRole } from '@/utils/eventRoleFilter';

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
  } | null;
}

export function MobileScheduleView({
  currentWeekStart,
  shifts,
  events,
  profiles,
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
  isLoading = false
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
  const [quickPunchOpen, setQuickPunchOpen] = useState(false);
  const [editPunchOpen, setEditPunchOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [previewEvent, setPreviewEvent] = useState<Event | null>(null);
  const [selectedPunch, setSelectedPunch] = useState<{userId: string, userName: string, userPhoto: string | null, punchDate: string} | null>(null);
  const [_todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [insightsExpanded, setInsightsExpanded] = useState(false);
  const { isV2, toggleLayout } = useScheduleLayoutFlag();
  const { isAdmin, isManager, role } = useUserRole();
  const { canSeeFullSchedule, loading: scheduleVisibilityLoading } = useTeamScheduleVisibility();
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  
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

  // Use React Query for active shifts with 1-minute refetch
  const { data: dayPunches = [], isLoading: loadingActive, refetch: refetchPunches } = useQuery({
    queryKey: ['today-punches', currentLocation?.id, todayStr],
    queryFn: async () => {
      if (!currentLocation?.id || !timezone || !todayStr) return [];
      
      const todayDayOfWeek = getDayOfWeekInTimezone(timezone);
      const offset = getTimezoneOffset(timezone);

      // Use DST-safe parseDateStringInTimezone for day boundaries
      // (getTimezoneOffset may return wrong offset on DST transition days)
      const startOfDay = parseDateStringInTimezone(todayStr, timezone);
      const startMinus = new Date(startOfDay);
      startMinus.setHours(startMinus.getHours() - 12);
      const startOfDayTime = startMinus.toISOString();

      const endOfDay = getEndOfDateStringInTimezone(todayStr, timezone);
      const endOfDayPlus = new Date(endOfDay);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);
      const endOfDayTime = endOfDayPlus.toISOString();
      
      // Parallel queries for all data
      const punchesQuery = supabase
        .from('time_punches')
        .select('id, user_id, punch_time, punch_type, notes, created_by')
        .eq('location_id', currentLocation.id)
        .gte('punch_time', startOfDayTime)
        .lte('punch_time', endOfDayTime)
        .order('punch_time', { ascending: true });
      
      const scheduledQuery = supabase
        .from('scheduled_shifts')
        .select('id, user_id, start_time, end_time, day_of_week, shift_date')
        .eq('shift_date', todayStr);
      
      const eventsQuery = supabase
        .from('schedule_events')
        .select('*, event_categories(name, color)')
        .eq('location_id', currentLocation.id)
        .eq('is_recurring', true);
      
      const [punchesRes, scheduledRes, eventsRes] = await Promise.all([
        punchesQuery,
        scheduledQuery,
        eventsQuery
      ]);

      const allPunches = punchesRes.data || [];
      const todayScheduledShifts = (scheduledRes.data || []) as { id: string; user_id: string; start_time: string; end_time: string; day_of_week: number; shift_date: string }[];
      const eventsData = eventsRes.data || [];
      
      // Filter events for today
      const eventsForToday = eventsData.filter(event => {
        if (event.days_of_week && event.days_of_week.length > 0) {
          return event.days_of_week.includes(todayDayOfWeek);
        }
        return event.day_of_week === todayDayOfWeek;
      }).map(event => ({
        ...event,
        tagged_roles: event.tagged_roles as string[] | null,
        category: event.event_categories
      })).sort((a, b) => a.event_time.localeCompare(b.event_time));
      
      // Filter by user role visibility
      const roleFilteredEvents = filterEventsByRole(eventsForToday, role);
      setTodayEvents(roleFilteredEvents);
      
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

        Object.entries(userPunches).forEach(([userId, punches]) => {
        let isClockedIn = false;
        let isOnBreak = false;
        let firstClockIn: { id: string; punch_time: string; created_by: string | null } | null = null;
        let lastClockOut: { punch_time: string } | null = null;
        let breakStart: { punch_time: string; notes: string } | null = null;
        let breakEnd: { punch_time: string } | null = null;

        punches.forEach((p) => {
          if (p.punch_type === 'clock_in') {
            if (isOnBreak && breakStart && !breakEnd) {
              breakEnd = { punch_time: p.punch_time };
              isOnBreak = false;
            }
            if (!isClockedIn) {
              isClockedIn = true;
                // Always treat a new clock_in (after being clocked out) as a new shift.
                // This prevents an earlier clock_out (e.g., 1:00 AM) from being paired with
                // a later clock_in (e.g., 7:09 PM) for the same user.
                firstClockIn = { id: p.id, punch_time: p.punch_time, created_by: p.created_by };
                lastClockOut = null;
                breakStart = null;
                breakEnd = null;
            }
            return;
          }
          if (p.punch_type === 'clock_out') {
              // Ignore clock_outs that happen before we've seen the matching clock_in in this window.
              // Those belong to a shift that started before our query window and should not be paired
              // with a later clock_in (which creates negative hours).
              if (!firstClockIn) return;

              isClockedIn = false;
              isOnBreak = false;
              lastClockOut = { punch_time: p.punch_time };
            return;
          }
          if (p.punch_type === 'break_start') {
            breakStart = { punch_time: p.punch_time, notes: p.notes || '' };
            breakEnd = null; // Reset so we don't show stale end time from a previous break
            isOnBreak = true;
            return;
          }
          if (p.punch_type === 'break_end') {
            breakEnd = { punch_time: p.punch_time };
            isOnBreak = false;
            return;
          }
        });

        if (firstClockIn) {
          const profile = profileMap.get(userId) || profiles.find(p => p.id === userId);
          const clockOutTime = lastClockOut?.punch_time || null;
          const clockInMs = new Date(firstClockIn.punch_time).getTime();
          const endTime = clockOutTime ? new Date(clockOutTime).getTime() : new Date().getTime();
          // Deduct unpaid break time (30-min meal breaks)
          let breakDeductionMs = 0;
          if (breakStart?.punch_time) {
            const isUnpaidBreak = breakStart.notes?.includes('30') || 
              breakStart.notes?.toLowerCase().includes('unpaid') || 
              breakStart.notes?.toLowerCase().includes('meal');
            if (isUnpaidBreak) {
              const breakStartMs = new Date(breakStart.punch_time).getTime();
              const breakEndMs = breakEnd?.punch_time 
                ? new Date(breakEnd.punch_time).getTime() 
                : (isOnBreak ? new Date().getTime() : breakStartMs + 30 * 60000);
              breakDeductionMs = breakEndMs - breakStartMs;
            }
          }
          // Defensive clamp: if we ever get a negative due to missing/odd punch ordering, show 0.
          const hoursWorked = Math.max(0, (endTime - clockInMs - breakDeductionMs) / 3600000);
          const scheduledShift = todayScheduledShifts.find(s => s.user_id === userId);
          
          const createdByOther = firstClockIn.created_by && firstClockIn.created_by !== userId;
          const createdByName = createdByOther ? creatorMap.get(firstClockIn.created_by!) || null : null;
          
          punchSummaries.push({
            id: firstClockIn.id,
            user_id: userId,
            clockInTime: firstClockIn.punch_time,
            clockOutTime,
            breakStartTime: breakStart?.punch_time || null,
            breakEndTime: breakEnd?.punch_time || null,
            breakType: breakStart?.notes || null,
            isActive: isClockedIn,
            isOnBreak,
            profile: profile || { id: userId, full_name: 'Unknown', nickname: null, profile_photo_url: null },
            hoursWorked,
            createdByName,
            scheduledShift: scheduledShift ? { 
              id: scheduledShift.id, 
              start_time: scheduledShift.start_time, 
              end_time: scheduledShift.end_time, 
              day_of_week: scheduledShift.day_of_week, 
              shift_date: scheduledShift.shift_date 
            } : null
          });
        }
      });
      
      // Filter punches: always show ACTIVE punches (even if clocked in yesterday),
      // but only show COMPLETED punches if clock-in was today
      const todayOnlyPunches = punchSummaries.filter(punch => {
        // Active/on-break punches always show (matches manager dashboard behavior)
        if (punch.isActive || punch.isOnBreak) return true;
        // Completed punches: only show if clock-in was today
        const clockInDate = new Date(punch.clockInTime);
        const clockInLocalDate = clockInDate.toLocaleDateString('en-CA', { timeZone: timezone });
        return clockInLocalDate === todayStr;
      });
      
      // Sort: active first, then by clock-in time
      todayOnlyPunches.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime();
      });
      
      return todayOnlyPunches;
    },
    enabled: (activeTab === 'today' || isV2) && !!currentLocation?.id && !!timezone,
    staleTime: 30 * 1000,
    refetchInterval: (activeTab === 'today' || isV2) ? 60 * 1000 : false,
  });

  // Fetch sales + labor for Day Insights (V2)
  const { data: dayInsightsData } = useQuery({
    queryKey: ['day-insights', currentLocation?.id, todayStr],
    queryFn: async () => {
      if (!currentLocation?.id || !todayStr) return null;
      const [salesRes, laborRes] = await Promise.all([
        supabase.from('sales_cache').select('net_sales').eq('location_id', currentLocation.id).eq('sale_date', todayStr).maybeSingle(),
        supabase.from('labor_cache').select('labor_cost, labor_hours, source').eq('location_id', currentLocation.id).eq('labor_date', todayStr),
      ]);
      const sales = salesRes.data?.net_sales || 0;
      // Prefer punch_clock source over qubeyond
      const laborRows = laborRes.data || [];
      const punchClockRow = laborRows.find(r => r.source === 'punch_clock');
      const best = punchClockRow || laborRows[0];
      const laborCost = best?.labor_cost || 0;
      const laborHours = best?.labor_hours || 0;
      return { sales, laborCost, laborHours };
    },
    enabled: isV2 && !!currentLocation?.id && !!todayStr,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
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

  const activePunchCount = dayPunches.filter(p => p.isActive).length;
  const todayTabLabel = activePunchCount > 0 ? `Today (${activePunchCount})` : 'Today';

  // Content for Today tab
  const renderTodayContent = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
        </h3>
        <Button 
          size="sm" 
          variant="outline"
          onClick={() => setQuickPunchOpen(true)}
          className="gap-1"
        >
          <UserPlus className="h-4 w-4" />
          Quick Punch
        </Button>
      </div>
      
      {/* Assigned Tasks */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Tasks</h4>
        <AssignedTemporaryTasks showCompleted={true} includeCateringOrders={true} includeEventTasks={true} compact={true} />
      </div>
      
      <div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Today's Punches ({dayPunches.length})
        </h4>
        
        {loadingActive ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : dayPunches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Circle className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No punches recorded today</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dayPunches.map((punch) => (
              <MobileShiftCard
                key={punch.id}
                name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
                avatarUrl={punch.profile.profile_photo_url}
                startTime={punch.scheduledShift?.start_time || '00:00'}
                endTime={punch.scheduledShift?.end_time || '00:00'}
                statusIndicator={punch.isOnBreak ? 'break' : punch.isActive ? 'active' : 'none'}
                scheduledStart={punch.scheduledShift?.start_time}
                scheduledEnd={punch.scheduledShift?.end_time}
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
                    punchDate: today
                  });
                  setEditPunchOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Content for Schedule tab
  const renderScheduleContent = () => (
    <div className="space-y-4">
      {/* Week Header - Centered with week label */}
      <div className="flex flex-col items-center gap-1">
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
      <div className="bg-muted rounded-xl p-1.5 flex items-center justify-around border border-border/40 overflow-hidden">
        {weekDays.map((day, index) => {
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());
          
          return (
            <button
              key={index}
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center flex-1 py-1.5 rounded-lg transition-all ${
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
                  className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 py-1.5 min-w-0 cursor-pointer active:bg-muted transition-colors"
                  style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                >
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
          {(isAdmin || isManager) && scheduleId && (
            <div className="flex gap-1 items-center">
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
                onClick={() => {
                  setSelectedShift({
                    id: '',
                    user_id: null,
                    day_of_week: selectedDayOfWeek,
                    start_time: '09:00',
                    end_time: '17:00',
                    shift_date: format(selectedDate, 'yyyy-MM-dd'),
                  });
                  setIsCreatingShift(true);
                  setShiftDialogOpen(true);
                }}
              >
                <UserPlus className="h-4 w-4" />
              </Button>
              {/* Publish/Update Button - styled like desktop */}
              {!isPublished ? (
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
              )}
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
                    actionButton={!isAdmin && !isManager ? (
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
    <div className="flex flex-col h-full bg-background">
      {/* Admin/Manager view */}
      {(isAdmin || isManager) ? (
        isV2 ? (
          /* V2: Combined single-scroll view — no tabs */
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-auto px-2 py-3 space-y-3">
              {/* Date header */}
              <div className="flex items-center justify-center">
                <DateNavigator
                  onPrev={handlePreviousWeek}
                  onNext={handleNextWeek}
                  label={`${format(selectedDate, 'EEEE, MMMM d')}`}
                />
              </div>
              </div>

              {/* Week Calendar Strip */}
              <div className="bg-muted rounded-xl p-1.5 flex items-center justify-around border border-border/40 overflow-hidden">
                {weekDays.map((day, index) => {
                  const isSelected = isSameDay(day, selectedDate);
                  const isDayToday = isSameDay(day, new Date());
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(day)}
                      className={`flex flex-col items-center flex-1 py-1.5 rounded-lg transition-all ${
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
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg min-w-[calc(50%-2px)] max-w-full flex-grow cursor-pointer active:bg-muted transition-colors"
                          style={{ backgroundColor: `${color}10` }}
                        >
                          <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-xs font-medium truncate">{event.event_name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatTime12Hour(event.event_time)}</span>
                          <div className="h-5 w-5 rounded-full border border-border/60 flex items-center justify-center shrink-0 text-muted-foreground/50 ml-auto">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <rect x="3" y="4" width="18" height="18" rx="2" />
                              <path d="M16 2v4M8 2v4M3 10h18" />
                            </svg>
                          </div>
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

              {/* 5. NOW section — active punches */}
              {((() => {
                const activePunches = dayPunches.filter(p => p.isActive && !p.isOnBreak);
                const onBreakPunches = dayPunches.filter(p => p.isOnBreak);
                const completedPunches = dayPunches.filter(p => !p.isActive);
                const totalScheduled = dayPunches.length;

                return (
                  <>
                    {(activePunches.length > 0 || onBreakPunches.length > 0) && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                          <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                          <span className="text-green-600">Now</span>
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
                          <div className="ml-auto">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setQuickPunchOpen(true)}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
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
                                punchDate: today
                              });
                              setEditPunchOpen(true);
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* 6. LATER section — scheduled shifts + actions */}
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        {completedPunches.length > 0 ? `Completed (${completedPunches.length})` : 'Later'}
                        <div className="flex items-center gap-1 ml-auto">
                          {(activePunches.length === 0 && onBreakPunches.length === 0) && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setQuickPunchOpen(true)}>
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(isAdmin || isManager) && scheduleId && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEventDialogOpen(true)}>
                                <CalendarPlus className="h-4 w-4" />
                              </Button>
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

                      {loadingActive ? (
                        <div className="text-center py-8 text-muted-foreground">Loading...</div>
                      ) : (
                        <>
                          {completedPunches.map(punch => (
                            <MobileShiftCard
                              key={punch.id}
                              name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
                              avatarUrl={punch.profile.profile_photo_url}
                              startTime={punch.scheduledShift?.start_time || '00:00'}
                              endTime={punch.scheduledShift?.end_time || '00:00'}
                              statusIndicator="none"
                              scheduledStart={punch.scheduledShift?.start_time}
                              scheduledEnd={punch.scheduledShift?.end_time}
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
                                  punchDate: today
                                });
                                setEditPunchOpen(true);
                              }}
                            />
                          ))}

                          {/* Scheduled shifts not yet punched in */}
                          {dayShifts
                            .filter(shift => {
                              const profile = getProfileForShift(shift);
                              if (!profile) return false;
                              // Don't show shifts for people who already have punches
                              return !dayPunches.some(p => p.user_id === shift.user_id);
                            })
                            .sort((a, b) => a.start_time.localeCompare(b.start_time))
                            .map(shift => {
                              const profile = getProfileForShift(shift);
                              if (!profile) return null;
                              const shiftLabel = getShiftLabel(shift);
                              return (
                                <MobileShiftCard
                                  key={shift.id}
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
                            })}
                        </>
                      )}
                    </div>
                    {/* Day Insights — bottom of page */}
                    <Card className="overflow-hidden p-0 mt-3">
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
                              <div className="flex items-center justify-between text-center">
                                <div>
                                  <span className="text-base font-bold">{totalHours.toFixed(1)}h</span>
                                  <p className="text-[10px] text-muted-foreground">Hours</p>
                                </div>
                                <div className="w-px h-7 bg-border" />
                                <div>
                                  <span className="text-base font-bold">${laborCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                  <p className="text-[10px] text-muted-foreground">Labor</p>
                                </div>
                                <div className="w-px h-7 bg-border" />
                                <div>
                                  <span className={`text-base font-bold ${laborPct > 30 ? 'text-destructive' : 'text-green-600'}`}>{laborPct.toFixed(1)}%</span>
                                  <p className="text-[10px] text-muted-foreground">Labor %</p>
                                </div>
                                <div className="w-px h-7 bg-border" />
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
              })())}
            </div>
          </div>
        ) : (
          /* Classic: Tabbed Today / Schedule */
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'today' | 'schedule')} className="flex flex-col h-full">
            <div className="px-4 pt-3 pb-2 border-b border-border flex items-center gap-2">
              <TabsList className="w-full grid grid-cols-2 flex-1">
                <TabsTrigger value="today" className="gap-1.5">
                  {activePunchCount > 0 && (
                    <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                  )}
                  {todayTabLabel}
                </TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
              </TabsList>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={toggleLayout}
                title="Switch to new layout"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto px-2 py-3">
              <TabsContent value="today" className="mt-0 h-full">
                {renderTodayContent()}
              </TabsContent>
              <TabsContent value="schedule" className="mt-0 h-full">
                {renderScheduleContent()}
              </TabsContent>
            </div>
          </Tabs>
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
    </div>
  );
}