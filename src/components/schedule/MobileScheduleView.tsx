import { useState, useEffect } from 'react';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar as CalendarIcon, MapPin, Users, ChevronLeft, Plus, RefreshCw, Circle, Pencil } from 'lucide-react';
import { FaFistRaised } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { MobileShiftDialog } from './MobileShiftDialog';
import { QuickPunchDialog } from './QuickPunchDialog';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { formatTime12Hour } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTodayInTimezone, getTimezoneOffset, formatTimeDisplay } from '@/utils/timezoneUtils';

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

interface ActiveShift {
  id: string;
  user_id: string;
  punch_time: string;
  profile: Profile;
  hoursWorked: number;
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
  const [activeTab, setActiveTab] = useState<'today' | 'schedule'>('today');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [selectedShiftForOffer, setSelectedShiftForOffer] = useState<Shift | null>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [isCreatingShift, setIsCreatingShift] = useState(false);
  const [quickPunchOpen, setQuickPunchOpen] = useState(false);
  const [activeShifts, setActiveShifts] = useState<ActiveShift[]>([]);
  const [loadingActive, setLoadingActive] = useState(false);
  const { isAdmin, isManager } = useUserRole();
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const selectedDayOfWeek = weekDays.findIndex(day => isSameDay(day, selectedDate));

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
    const offset = getTimezoneOffset(timezone);
    const startOfDay = new Date(`${today}T00:00:00${offset}`).toISOString();
    const endOfDay = new Date(`${today}T23:59:59${offset}`).toISOString();
    
    // Get ALL punches for today ordered by time
    const { data: allPunches } = await supabase
      .from('time_punches')
      .select('id, user_id, punch_time, punch_type')
      .eq('location_id', currentLocation.id)
      .gte('punch_time', startOfDay)
      .lte('punch_time', endOfDay)
      .order('punch_time', { ascending: true });
    
    // Group by user and find those with unpaired clock-ins
    const userPunches: Record<string, Array<{id: string, punch_time: string, punch_type: string}>> = {};
    allPunches?.forEach(p => {
      if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
      userPunches[p.user_id].push(p);
    });
    
    // Find users currently clocked in (last punch is clock_in or break_start/break_end, not clock_out)
    const activeClockIns: Array<{id: string, user_id: string, punch_time: string}> = [];
    Object.entries(userPunches).forEach(([userId, punches]) => {
      // Find most recent clock_in
      const clockIns = punches.filter(p => p.punch_type === 'clock_in');
      const clockOuts = punches.filter(p => p.punch_type === 'clock_out');
      
      // If more clock-ins than clock-outs, user is still clocked in
      if (clockIns.length > clockOuts.length) {
        const lastClockIn = clockIns[clockIns.length - 1];
        activeClockIns.push({ id: lastClockIn.id, user_id: userId, punch_time: lastClockIn.punch_time });
      }
    });
    
    const activeWithProfiles: ActiveShift[] = activeClockIns.map(punch => {
      const profile = profiles.find(p => p.id === punch.user_id);
      const hoursWorked = (new Date().getTime() - new Date(punch.punch_time).getTime()) / 3600000;
      return {
        id: punch.id,
        user_id: punch.user_id,
        punch_time: punch.punch_time,
        profile: profile || { id: punch.user_id, full_name: 'Unknown', profile_photo_url: null },
        hoursWorked
      };
    }).filter(s => s.profile);
    
    setActiveShifts(activeWithProfiles);
    setLoadingActive(false);
  };

  const handlePreviousWeek = () => {
    const newWeekStart = subWeeks(currentWeekStart, 1);
    onWeekChange?.(newWeekStart);
    setSelectedDate(newWeekStart);
  };

  const handleNextWeek = () => {
    const newWeekStart = addWeeks(currentWeekStart, 1);
    onWeekChange?.(newWeekStart);
    setSelectedDate(newWeekStart);
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
                {activeShifts.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {activeShifts.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex-1">Schedule</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Today View - Active Shifts */}
      {activeTab === 'today' && (isAdmin || isManager) ? (
        <div className="flex-1 overflow-auto">
          <div className="p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {format(new Date(), 'EEEE, MMMM d')}
            </h3>
            
            {/* Today's Events */}
            {(() => {
              const todayDayOfWeek = new Date().getDay();
              const todayEvents = events.filter(event => 
                event.days_of_week?.includes(todayDayOfWeek) || event.day_of_week === todayDayOfWeek
              ).sort((a, b) => a.event_time.localeCompare(b.event_time));
              
              if (todayEvents.length > 0) {
                return (
                  <div className="mb-4 space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Events</h4>
                    {todayEvents.map(event => (
                      <Card key={event.id} className="p-3 border-l-4 border-l-primary/50">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4 text-primary" />
                          <span className="font-medium text-sm">{event.event_name}</span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatTime12Hour(event.event_time)}
                          </span>
                        </div>
                        {event.notes && (
                          <p className="text-xs text-muted-foreground mt-1 ml-6">{event.notes}</p>
                        )}
                      </Card>
                    ))}
                  </div>
                );
              }
              return null;
            })()}
            
            {/* Active Shifts Section */}
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Working Now ({activeShifts.length})
            </h4>
            
            {loadingActive ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : activeShifts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Circle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No one clocked in right now</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeShifts.map((activeShift) => (
                  <Card 
                    key={activeShift.id} 
                    className="border-l-4 border-l-green-500"
                  >
                    <div className="flex items-center gap-3 p-4">
                      <div className="relative">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={activeShift.profile.profile_photo_url || undefined} />
                          <AvatarFallback>{activeShift.profile.full_name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 border-2 border-background animate-pulse" />
                      </div>
                      
                      <div className="flex-1">
                        <h4 className="font-semibold">{activeShift.profile.full_name}</h4>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>In: {formatTimeDisplay(activeShift.punch_time, timezone)}</span>
                          <span>•</span>
                          <span className="text-green-600 font-medium">
                            {activeShift.hoursWorked.toFixed(1)}h
                          </span>
                        </div>
                      </div>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          // Navigate to payroll review for editing
                          window.location.href = '/payroll';
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          
          {/* Quick Punch FAB for Today view */}
          <div className="fixed bottom-20 right-4">
            <Button 
              size="lg" 
              className="rounded-full h-14 w-14 shadow-lg"
              onClick={() => setQuickPunchOpen(true)}
            >
              <FaFistRaised className="h-6 w-6" />
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Month Header - Condensed */}
          <div className="flex items-center justify-between px-4 py-1 border-b">
            <Button variant="ghost" size="icon" onClick={handlePreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-sm font-semibold">{format(currentWeekStart, 'MMMM yyyy')}</h2>
            <Button variant="ghost" size="icon" onClick={handleNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
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
                className="group"
              >
                <FaFistRaised className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-active:scale-110" />
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
                <Plus className="h-4 w-4" />
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

      {/* Events Summary */}
      {dayEvents.length > 0 && (
        <div className="px-4 pt-3">
          <Card className="bg-accent/30 border-accent/40">
            <div className="px-3 py-2">
              <div className="text-xs font-medium text-accent-foreground truncate">
                {dayEvents.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 && ' • '}
                    {e.event_name}
                  </span>
                ))}
              </div>
            </div>
          </Card>
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
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex flex-col items-center gap-1">
                      {isMyShift && (
                        <div className="bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-0.5 rounded mb-1">
                          My Shift
                        </div>
                      )}
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={profile.profile_photo_url || undefined} />
                        <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </div>
                    
                    <div className="flex-1 text-left">
                      <h4 className="font-semibold">{profile.full_name}</h4>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-muted-foreground">
                          {formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}
                        </p>
                        {shiftHasBreak(shift.start_time, shift.end_time) && (
                          <BreakIndicator hasBreak={true} size="sm" />
                        )}
                      </div>
                      {shift.template?.position && (
                        <Badge variant="outline" className="text-xs mt-1 w-fit">
                          {shift.template.position.replace(/\s*\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/g, '').trim()}
                        </Badge>
                      )}
                    </div>
                    
                    {!isShiftPending && (isAdmin || shift.user_id === user?.id) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedShiftForOffer(shift);
                          setOfferDialogOpen(true);
                        }}
                      >
                        Offer Up
                      </Button>
                    )}
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
    </div>
  );
}