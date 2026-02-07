import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarIcon, Users, CalendarPlus, RefreshCw, Circle, Pencil, UserPlus } from 'lucide-react';
import { DateNavigator } from '@/components/ui/date-navigator';
import { Button } from '@/components/ui/button';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { MobileShiftDialog } from './MobileShiftDialog';
import { QuickPunchDialog } from './QuickPunchDialog';
import { EditPunchDialog } from './EditPunchDialog';
import { MobileEventDialog } from './MobileEventDialog';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamScheduleVisibility } from '@/hooks/useTeamScheduleVisibility';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { useAuth } from '@/lib/auth';
import { formatTime12Hour } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTodayInTimezone, getTimezoneOffset, formatTimeDisplay, getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { filterEventsByRole } from '@/utils/eventRoleFilter';

interface Profile {
  id: string;
  full_name: string;
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
  hasPendingChanges = false
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
  const [selectedPunch, setSelectedPunch] = useState<{userId: string, userName: string, userPhoto: string | null, punchDate: string} | null>(null);
  const [_todayEvents, setTodayEvents] = useState<Event[]>([]);
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

      // IMPORTANT: Query a window that looks BACK before midnight as well as AFTER.
      // Otherwise we can fetch a clock_out (after midnight) without its matching clock_in
      // (before midnight), which then incorrectly pairs with a later clock_in and produces
      // negative hours (e.g., Anthony Tolentino: 7:09 PM in paired with 1:00 AM out).
      const startOfDay = new Date(`${todayStr}T00:00:00${offset}`);
      const startMinus = new Date(startOfDay);
      startMinus.setHours(startMinus.getHours() - 12);
      const startOfDayTime = startMinus.toISOString();

      const endOfDayPlus = new Date(`${todayStr}T23:59:59${offset}`);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);
      const endOfDayTime = endOfDayPlus.toISOString();
      
      // Parallel queries for all data
      const [punchesRes, scheduledRes, eventsRes] = await Promise.all([
        supabase
          .from('time_punches')
          .select('id, user_id, punch_time, punch_type, notes, created_by')
          .eq('location_id', currentLocation.id)
          .gte('punch_time', startOfDayTime)
          .lte('punch_time', endOfDayTime)
          .order('punch_time', { ascending: true }),
        supabase
          .from('scheduled_shifts')
          .select('id, user_id, start_time, end_time, day_of_week, shift_date')
          .eq('shift_date', todayStr),
        supabase
          .from('schedule_events')
          .select('*, event_categories(name, color)')
          .eq('location_id', currentLocation.id)
          .eq('is_recurring', true)
      ]);

      const allPunches = punchesRes.data || [];
      const todayScheduledShifts = scheduledRes.data || [];
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
          ? supabase.from('profiles').select('id, full_name').in('id', createdByIds)
          : Promise.resolve({ data: [] }),
        punchUserIds.length > 0
          ? supabase.from('profiles').select('id, full_name, profile_photo_url').in('id', punchUserIds)
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
          // Defensive clamp: if we ever get a negative due to missing/odd punch ordering, show 0.
          const hoursWorked = Math.max(0, (endTime - clockInMs) / 3600000);
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
            profile: profile || { id: userId, full_name: 'Unknown', profile_photo_url: null },
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
      
      // Filter to only include punches where clock-in occurred on today's business date
      const todayOnlyPunches = punchSummaries.filter(punch => {
        const clockInDate = new Date(punch.clockInTime);
        // Convert to location timezone and extract date
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
    enabled: activeTab === 'today' && !!currentLocation?.id && !!timezone,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: activeTab === 'today' ? 60 * 1000 : false, // Refresh every minute when on today tab
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

  const isShiftModified = (_shift: Shift) => {
    // For mobile view, we don't track modifications the same way desktop does
    return false;
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
        <AssignedTemporaryTasks showCompleted={true} includeCateringOrders={true} includeEventTasks={true} />
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
              <Card 
                key={punch.id} 
                className={`cursor-pointer hover:bg-muted/50 transition-colors ${punch.isActive ? "border-l-3 border-l-green-500" : ""}`}
                onClick={() => {
                  const today = getTodayInTimezone(timezone);
                  setSelectedPunch({
                    userId: punch.user_id,
                    userName: punch.profile.full_name,
                    userPhoto: punch.profile.profile_photo_url,
                    punchDate: today
                  });
                  setEditPunchOpen(true);
                }}
              >
                <div className="px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={punch.profile.profile_photo_url || undefined} />
                        <AvatarFallback>{punch.profile.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {punch.isOnBreak ? (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 border-2 border-background" title="On Break" />
                      ) : punch.isActive ? (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
                      ) : null}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold truncate">{punch.profile.full_name}</span>
                          {punch.isOnBreak && (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs shrink-0">
                              On Break
                            </Badge>
                          )}
                        </div>
                        <span className={`text-base font-bold shrink-0 ${punch.isOnBreak ? "text-amber-600" : punch.isActive ? "text-green-600" : "text-foreground"}`}>
                          {punch.hoursWorked.toFixed(1)}h
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                        {punch.scheduledShift ? (
                          <span>{formatTime12Hour(punch.scheduledShift.start_time)} - {formatTime12Hour(punch.scheduledShift.end_time)}</span>
                        ) : (
                          <span>Not Scheduled</span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">In: <span className="text-foreground font-medium">{formatTimeDisplay(punch.clockInTime, timezone)}</span></span>
                        {punch.clockOutTime && (
                          <span className="text-muted-foreground">Out: <span className="text-foreground font-medium">{formatTimeDisplay(punch.clockOutTime, timezone)}</span></span>
                        )}
                      </div>
                      
                      {punch.breakStartTime && (
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="text-muted-foreground whitespace-nowrap">Break: <span className="text-foreground font-medium">{formatTimeDisplay(punch.breakStartTime, timezone)}</span></span>
                          <span className="text-muted-foreground whitespace-nowrap">- <span className="text-foreground font-medium">{punch.breakEndTime ? formatTimeDisplay(punch.breakEndTime, timezone) : 'Active'}</span></span>
                        </div>
                      )}
                      
                      {punch.createdByName && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Pencil className="h-3 w-3" />
                          <span>Entered by {punch.createdByName}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
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

      {/* Events for selected day */}
      {dayEvents.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Events</h4>
          {dayEvents.map(event => (
            <Card key={event.id} className="p-3">
              <div className="flex items-center gap-2">
                <div 
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: event.category?.color || '#8B5CF6' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{event.event_name}</div>
                  <div className="text-xs text-muted-foreground">{formatTime12Hour(event.event_time)}</div>
                </div>
              </div>
            </Card>
          ))}
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
            <div className="flex gap-1">
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
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['schedule'] })}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {dayShifts.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No shifts scheduled</p>
          </Card>
        ) : (
          dayShifts
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
            .map(shift => {
              const profile = getProfileForShift(shift);
              if (!profile) return null;
              
              const shiftLabel = getShiftLabel(shift);
              const isModified = isShiftModified(shift);
              
              return (
                <Card 
                  key={shift.id} 
                  className={`cursor-pointer hover:bg-muted/50 transition-colors ${isModified ? 'border-l-3 border-l-amber-500' : ''}`}
                  onClick={() => {
                    if (isAdmin || isManager) {
                      setSelectedShift(shift);
                      setShiftDialogOpen(true);
                    }
                  }}
                >
                  <div className="p-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarImage src={profile.profile_photo_url || undefined} />
                        <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{profile.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                        </div>
                        {shiftLabel && (
                          <Badge 
                            variant="secondary" 
                            className="mt-1 text-xs"
                            style={{ 
                              backgroundColor: shift.template?.color ? `${shift.template.color}20` : undefined,
                              borderColor: shift.template?.color || undefined,
                              color: shift.template?.color || undefined
                            }}
                          >
                            {shiftLabel}
                          </Badge>
                        )}
                      </div>
                      {!isAdmin && !isManager && (
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
                      )}
                      {shiftHasBreak(shift.start_time, shift.end_time) && (
                        <BreakIndicator hasBreak={true} size="sm" />
                      )}
                    </div>
                  </div>
                </Card>
              );
            })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Standard Tabs for Admin/Manager */}
      {(isAdmin || isManager) ? (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'today' | 'schedule')} className="flex flex-col h-full">
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="today" className="gap-1.5">
                {activePunchCount > 0 && (
                  <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                )}
                {todayTabLabel}
              </TabsTrigger>
              <TabsTrigger value="schedule">Schedule</TabsTrigger>
            </TabsList>
          </div>
          <div className="flex-1 overflow-auto px-4 py-3">
            <TabsContent value="today" className="mt-0 h-full">
              {renderTodayContent()}
            </TabsContent>
            <TabsContent value="schedule" className="mt-0 h-full">
              {renderScheduleContent()}
            </TabsContent>
          </div>
        </Tabs>
      ) : (
        /* Non-admin view - schedule only */
        <div className="flex-1 overflow-auto p-4">
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
    </div>
  );
}