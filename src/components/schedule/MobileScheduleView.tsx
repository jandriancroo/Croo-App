import { useState } from 'react';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar as CalendarIcon, MapPin, Users, ChevronLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { MobileShiftDialog } from './MobileShiftDialog';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { formatTime12Hour } from '@/lib/utils';

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
  scheduleId?: string | null;
  templates?: Array<{
    id: string;
    template_name: string;
    start_time: string;
    end_time: string;
    color: string | null;
  }>;
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
  scheduleId,
  templates = []
}: MobileScheduleViewProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [selectedShiftForOffer, setSelectedShiftForOffer] = useState<Shift | null>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [isCreatingShift, setIsCreatingShift] = useState(false);
  const { isAdmin, isManager } = useUserRole();
  const { user } = useAuth();
  
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const selectedDayOfWeek = weekDays.findIndex(day => isSameDay(day, selectedDate));

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
  const dayEvents = events.filter(e => e.day_of_week === selectedDayOfWeek);

  const getProfileForShift = (shift: Shift) => {
    return profiles.find(p => p.id === shift.user_id);
  };


  const totalPeopleScheduled = dayShifts.length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Month Header - Condensed */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <Button variant="ghost" size="icon" onClick={handlePreviousWeek}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-base font-semibold">{format(currentWeekStart, 'MMMM yyyy')}</h2>
        <Button variant="ghost" size="icon" onClick={handleNextWeek}>
          <ChevronRight className="h-5 w-5" />
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
            <span className="text-sm font-medium">{totalPeopleScheduled}</span>
          </div>
          {isAdmin && (
            <Button 
              size="sm" 
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

      {/* My Shift - if user has a shift this day */}
      {user && dayShifts.some(s => s.user_id === user.id) && (
        <div className="px-4 pt-3">
          {dayShifts.filter(s => s.user_id === user.id).map((myShift) => (
            <Card 
              key={myShift.id}
              className="bg-primary/10 border-primary/30 cursor-pointer"
              onClick={() => {
                setSelectedShift(myShift);
                setShiftDialogOpen(true);
              }}
            >
              <div className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-primary">My Shift</p>
                    <p className="text-sm font-medium">
                      {formatTime12Hour(myShift.start_time)} – {formatTime12Hour(myShift.end_time)}
                    </p>
                  </div>
                  {myShift.template?.position && (
                    <Badge variant="secondary" className="text-xs">
                      {myShift.template.position}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Shifts List - sorted by start time */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {dayShifts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No shifts scheduled for this day</p>
          </div>
        ) : (
          [...dayShifts]
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
            .map((shift) => {
              const profile = getProfileForShift(shift);
              if (!profile) return null;

              return (
                <Card 
                  key={shift.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => {
                    setSelectedShift(shift);
                    setShiftDialogOpen(true);
                  }}
                >
                  <div className="flex items-center gap-3 p-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={profile.profile_photo_url || undefined} />
                      <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    
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
                        <div className="flex items-center gap-2 mt-1">
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{ backgroundColor: shift.template.color || '#ef4444' }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {shift.template.position}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {(isAdmin || shift.user_id === user?.id) && (
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
    </div>
  );
}