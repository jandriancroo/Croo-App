import { useState, useEffect } from 'react';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar as CalendarIcon, MapPin, Users, CalendarPlus, RefreshCw, Circle, Pencil, ClipboardCheck } from 'lucide-react';
import { DateNavigator } from '@/components/ui/date-navigator';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { MobileShiftDialog } from './MobileShiftDialog';
import { QuickPunchDialog } from './QuickPunchDialog';
import { EditPunchDialog } from './EditPunchDialog';
import { EventCard } from './EventCard';
import { useUserRole } from '@/hooks/useUserRole';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { useAuth } from '@/lib/auth';
import { formatTime12Hour } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTodayInTimezone, getTimezoneOffset, formatTimeDisplay, getDayOfWeekInTimezone } from '@/utils/timezoneUtils';

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
  profile: Profile;
  hoursWorked: number;
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
  const [selectedPunch, setSelectedPunch] = useState<{userId: string, userName: string, userPhoto: string | null, punchDate: string} | null>(null);
  const [dayPunches, setDayPunches] = useState<DayPunch[]>([]);
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [loadingActive, setLoadingActive] = useState(false);
  const { isAdmin, isManager } = useUserRole();
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const selectedDayOfWeek = weekDays.findIndex(day => isSameDay(day, selectedDate));

  // Persist selected tab across re-mounts (e.g., resize/breakpoint recalcs)
  useEffect(() => {
    sessionStorage.setItem('mobileScheduleTab', activeTab);
  }, [activeTab]);

  // Fetch active shifts (clocked in but not out)
  useEffect(() => {
    if (activeTab === 'today' && currentLocation?.id && timezone) {
      fetchActiveShifts();
      // Refresh every minute to update hours
      const interval = setInterval(fetchActiveShifts, 60000);
      return () => clearInterval(interval);
    }
  }, [activeTab, currentLocation?.id, timezone]);

  const fetchActiveShifts = async () => {
    if (!currentLocation?.id || !timezone) return;
    setLoadingActive(true);
    
    // Use location's timezone to determine "today"
    const today = getTodayInTimezone(timezone);
    const todayDayOfWeek = getDayOfWeekInTimezone(timezone);
    const offset = getTimezoneOffset(timezone);
    const startOfDay = new Date(`${today}T00:00:00${offset}`).toISOString();
    // Extend end of day to capture punches that roll into next UTC day
    const endOfDayPlus = new Date(`${today}T23:59:59${offset}`);
    endOfDayPlus.setHours(endOfDayPlus.getHours() + 12); // Add buffer for timezone edge cases
    const endOfDay = endOfDayPlus.toISOString();
    
    // Get ALL punches for today ordered by time
    const { data: allPunches } = await supabase
      .from('time_punches')
      .select('id, user_id, punch_time, punch_type, notes')
      .eq('location_id', currentLocation.id)
      .gte('punch_time', startOfDay)
      .lte('punch_time', endOfDay)
      .order('punch_time', { ascending: true });
    
    // Get unique user IDs from punches to fetch their profiles
    const punchUserIds = [...new Set((allPunches || []).map(p => p.user_id))];
    
    // Fetch profiles for ALL users who punched in (regardless of appears_on_schedule)
    const { data: punchProfiles } = punchUserIds.length > 0 
      ? await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .in('id', punchUserIds)
      : { data: [] };
    
    // Create a map for quick lookup
    const profileMap = new Map((punchProfiles || []).map(p => [p.id, p]));
    
    // Get today's scheduled shifts
    const { data: todayScheduledShifts } = await supabase
      .from('scheduled_shifts')
      .select('id, user_id, start_time, end_time, day_of_week, shift_date')
      .eq('shift_date', today);
    
    // Get today's events (recurring events for this location)
    const { data: eventsData } = await supabase
      .from('schedule_events')
      .select('*, event_categories(name, color)')
      .eq('location_id', currentLocation.id)
      .eq('is_recurring', true);
    
    // Filter events for today's day of week
    const filteredEvents = (eventsData || []).filter(event => {
      if (event.days_of_week && event.days_of_week.length > 0) {
        return event.days_of_week.includes(todayDayOfWeek);
      }
      return event.day_of_week === todayDayOfWeek;
    }).map(event => ({
      ...event,
      category: event.event_categories
    })).sort((a, b) => a.event_time.localeCompare(b.event_time));
    setTodayEvents(filteredEvents);
    
    // Group by user and build punch summaries for each user
    const userPunches: Record<string, Array<{id: string, punch_time: string, punch_type: string, notes: string | null}>> = {};
    allPunches?.forEach(p => {
      if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
      userPunches[p.user_id].push(p);
    });

    const punchSummaries: DayPunch[] = [];

    Object.entries(userPunches).forEach(([userId, punches]) => {
      let isClockedIn = false;
      let isOnBreak = false;
      let firstClockIn: { id: string; punch_time: string } | null = null;
      let lastClockOut: { punch_time: string } | null = null;
      let breakStart: { punch_time: string; notes: string } | null = null;
      let breakEnd: { punch_time: string } | null = null;

      // punches are already sorted by time asc
      punches.forEach((p) => {
        if (p.punch_type === 'clock_in') {
          // If on break, a clock_in ends the break
          if (isOnBreak && breakStart && !breakEnd) {
            breakEnd = { punch_time: p.punch_time };
            isOnBreak = false;
          }
          if (!isClockedIn) {
            isClockedIn = true;
            if (!firstClockIn) firstClockIn = { id: p.id, punch_time: p.punch_time };
          }
          return;
        }

        if (p.punch_type === 'clock_out') {
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
        const endTime = clockOutTime ? new Date(clockOutTime).getTime() : new Date().getTime();
        const hoursWorked = (endTime - new Date(firstClockIn.punch_time).getTime()) / 3600000;
        const scheduledShift = todayScheduledShifts?.find(s => s.user_id === userId);
        
        punchSummaries.push({
          id: firstClockIn.id,
          user_id: userId,
          clockInTime: firstClockIn.punch_time,
          clockOutTime,
          breakStartTime: breakStart?.punch_time || null,
          breakEndTime: breakEnd?.punch_time || null,
          breakType: breakStart?.notes || null,
          isActive: isClockedIn,
          profile: profile || { id: userId, full_name: 'Unknown', profile_photo_url: null },
          hoursWorked,
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
    
    // Sort: active first, then by clock-in time
    punchSummaries.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime();
    });
    
    setDayPunches(punchSummaries);
    setLoadingActive(false);
  };

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
  // Admins see all shifts, non-admins only see published shifts
  const dayShifts = shifts.filter(
    s => s.day_of_week === selectedDayOfWeek && s.user_id && (isAdmin || isManager || isPublished)
  );
  const dayEvents = events.filter(e => {
    if (e.days_of_week && e.days_of_week.length > 0) {
      return e.days_of_week.includes(selectedDayOfWeek);
    }
    return e.day_of_week === selectedDayOfWeek;
  });

  const getProfileForShift = (shift: Shift) => {
    return profiles.find(p => p.id === shift.user_id);
  };


  // Count unique employees scheduled (only those with valid profiles)
  const shiftsWithProfiles = dayShifts.filter(s => profiles.some(p => p.id === s.user_id));
  const uniqueEmployeesScheduled = new Set(shiftsWithProfiles.map(s => s.user_id)).size;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Tabs */}
      {(isAdmin || isManager) && (
        <div className="px-4 pt-3 pb-2 border-b">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'today' | 'schedule')}>
            <TabsList className="w-full">
              <TabsTrigger value="today" className="flex-1 gap-2">
                <Circle className="h-3 w-3 fill-green-500 text-green-500" />
                Today
                {dayPunches.filter(p => p.isActive).length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {dayPunches.filter(p => p.isActive).length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex-1">Schedule</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Today View - All Punches */}
      {activeTab === 'today' && (isAdmin || isManager) ? (
        <div className="flex-1 overflow-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
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
            
            {/* Assigned Tasks - includes temp tasks, catering orders, event tasks */}
            <div className="mb-4 space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Tasks</h4>
              <AssignedTemporaryTasks showCompleted={true} includeCateringOrders={true} includeEventTasks={true} />
            </div>
            
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
                      {/* Top row: Avatar, Name, Hours worked */}
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={punch.profile.profile_photo_url || undefined} />
                            <AvatarFallback>{punch.profile.full_name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          {punch.isActive && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold truncate">{punch.profile.full_name}</span>
                            <span className={`text-base font-bold shrink-0 ${punch.isActive ? "text-green-600" : "text-foreground"}`}>
                              {punch.hoursWorked.toFixed(1)}h
                            </span>
                          </div>
                          
                          {/* Scheduled shift row */}
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                            {punch.scheduledShift ? (
                              <span>{formatTime12Hour(punch.scheduledShift.start_time)} - {formatTime12Hour(punch.scheduledShift.end_time)}</span>
                            ) : (
                              <span>Not Scheduled</span>
                            )}
                          </div>
                          
                          {/* Actual In/Out row */}
                          <div className="flex items-center gap-3 text-sm">
                            <span className="text-muted-foreground">In: <span className="text-foreground font-medium">{formatTimeDisplay(punch.clockInTime, timezone)}</span></span>
                            {punch.clockOutTime && (
                              <span className="text-muted-foreground">Out: <span className="text-foreground font-medium">{formatTimeDisplay(punch.clockOutTime, timezone)}</span></span>
                            )}
                          </div>
                          
                          {/* Break row */}
                          {punch.breakStartTime && (
                            <div className="flex items-center gap-3 text-sm">
                              <span className="text-muted-foreground">Break: <span className="text-foreground font-medium">{formatTimeDisplay(punch.breakStartTime, timezone)}</span></span>
                              <span className="text-muted-foreground">- <span className="text-foreground font-medium">{punch.breakEndTime ? formatTimeDisplay(punch.breakEndTime, timezone) : 'Active'}</span></span>
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
      ) : (
        <>
          {/* Week Header - Centered */}
          <div className="px-4 py-2 border-b flex justify-center">
            <DateNavigator
              onPrev={handlePreviousWeek}
              onNext={handleNextWeek}
              label={`${format(currentWeekStart, 'MMM d')} - ${format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}`}
            />
          </div>

      {/* Week Calendar */}
      <div className="flex items-center justify-around p-3 border-b">
        {weekDays.map((day, index) => {
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());
          
          return (
            <button
              key={index}
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors ${
                isSelected
                  ? 'bg-primary text-primary-foreground'
                  : isToday
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className="text-xs font-medium">{format(day, 'EEE')}</span>
              <span className="text-lg font-semibold">{format(day, 'd')}</span>
            </button>
          );
        })}
      </div>

      {/* Selected Date Header */}
      <div className="flex items-center justify-between p-3 bg-muted/30">
        <h3 className="text-base font-semibold">{format(selectedDate, 'EEEE, MMM d')}</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-sm font-medium">{uniqueEmployeesScheduled}</span>
          </div>
          {(isAdmin || isManager) && (
            <>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => setQuickPunchOpen(true)}
                title="Quick Punch"
              >
                <UserPlus className="h-5 w-5" />
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
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
                <CalendarPlus className="h-4 w-4" />
              </Button>
              {/* Three states: Go Live (unpublished), Update (published with changes), LIVE (published, no changes) */}
              {!isPublished ? (
                <Button
                  size="sm"
                  onClick={onGoLive}
                  disabled={isPublishing}
                  className="bg-primary hover:bg-primary/90"
                >
                  {isPublishing ? "Publishing..." : "GO LIVE"}
                </Button>
              ) : hasPendingChanges ? (
                <Button
                  size="sm"
                  onClick={onSendUpdate}
                  disabled={isPublishing}
                  variant="outline"
                  className="border-amber-500 text-amber-500 hover:bg-amber-500/10"
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
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border-2 border-red-500 rounded-lg">
                  <span className="relative flex items-end gap-[2px] h-3">
                    <span className="w-0.5 bg-red-500 rounded-sm animate-wifi-bar-1" style={{ height: '25%' }}></span>
                    <span className="w-0.5 bg-red-500 rounded-sm animate-wifi-bar-2" style={{ height: '50%' }}></span>
                    <span className="w-0.5 bg-red-500 rounded-sm animate-wifi-bar-3" style={{ height: '75%' }}></span>
                    <span className="w-0.5 bg-red-500 rounded-sm animate-wifi-bar-4" style={{ height: '100%' }}></span>
                  </span>
                  <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Live</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Events for selected day - simple text style for mobile */}
      {dayEvents.length > 0 && (
        <div className="px-4 pt-3 space-y-1">
          {dayEvents.map(event => (
            <div
              key={event.id}
              className="flex items-center gap-2 text-sm py-1 px-2 bg-muted/50 rounded"
            >
              <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground text-xs">
                {formatTime12Hour(event.event_time)}
              </span>
              <span className="truncate font-medium text-sm">{event.event_name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Shifts List - sorted with user's shifts first, then by start time */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {dayShifts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No shifts scheduled for this day</p>
          </div>
        ) : (
          [...dayShifts]
            .sort((a, b) => {
              // User's shifts first
              const aIsMyShift = a.user_id === user?.id;
              const bIsMyShift = b.user_id === user?.id;
              if (aIsMyShift && !bIsMyShift) return -1;
              if (!aIsMyShift && bIsMyShift) return 1;
              // Then sort by start time
              return a.start_time.localeCompare(b.start_time);
            })
            .map((shift) => {
              const profile = getProfileForShift(shift);
              if (!profile) return null;

              const isMyShift = shift.user_id === user?.id;

              // A shift shows as "pending" if:
              // - Schedule is unpublished (never went live), OR
              // - Schedule is published WITH a snapshot but this specific shift differs from or is not in the snapshot
              const hasSnapshot = publishedSnapshot && publishedSnapshot.length > 0;
              const snapshotShift = hasSnapshot ? publishedSnapshot.find((s: any) => s.id === shift.id) : null;
              const isShiftModified = snapshotShift && (
                snapshotShift.user_id !== shift.user_id ||
                snapshotShift.start_time !== shift.start_time ||
                snapshotShift.end_time !== shift.end_time ||
                snapshotShift.shift_date !== shift.shift_date
              );
              // Show as pending only if:
              // 1. Schedule is not published, OR
              // 2. Schedule is published WITH a snapshot AND (shift is new or modified)
              const isShiftPending = !isPublished || (hasSnapshot && (!snapshotShift || isShiftModified));

              return (
              <Card 
                  key={shift.id} 
                  className={`hover:shadow-md transition-shadow cursor-pointer ${
                    isMyShift 
                      ? 'border-2 border-accent ring-1 ring-accent/30' 
                      : ''
                  } ${
                    isShiftPending && (isAdmin || isManager) ? 'opacity-60 border-2 border-dashed border-amber-500/50' : ''
                  }`}
                  onClick={() => {
                    setSelectedShift(shift);
                    setShiftDialogOpen(true);
                  }}
                >
                  <div className="flex items-center gap-3 p-3">
                    <div className="flex flex-col items-center gap-1">
                      {isMyShift && (
                        <div className="bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-0.5 rounded mb-1">
                          My Shift
                        </div>
                      )}
                      <Avatar className="h-11 w-11">
                        <AvatarImage src={profile.profile_photo_url || undefined} />
                        <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </div>
                    
                    <div className="flex-1 min-w-0 text-left">
                      <h4 className="font-semibold truncate">{profile.full_name}</h4>
                      <p className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}
                      </p>
                      {shift.template?.position && (
                        <Badge variant="outline" className="text-xs mt-1">
                          {shift.template.position.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/g, '').trim()}
                        </Badge>
                      )}
                    </div>
                    
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      {!isShiftPending && (isAdmin || shift.user_id === user?.id) && (
                        <Button
                          size="sm"
                          variant="outline"
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
        </>
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
            fetchActiveShifts();
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
            fetchActiveShifts();
            onUpdate?.();
          }}
        />
      )}
    </div>
  );
}