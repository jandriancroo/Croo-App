import { useState } from 'react';
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar as CalendarIcon, MapPin, Users, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { ShiftOfferDialog } from './ShiftOfferDialog';
import { MobileShiftDialog } from './MobileShiftDialog';
import { useUserRole } from '@/hooks/useUserRole';

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
}

export function MobileScheduleView({
  currentWeekStart,
  shifts,
  events,
  profiles,
  onShiftClick,
  onWeekChange,
}: MobileScheduleViewProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [selectedShiftForOffer, setSelectedShiftForOffer] = useState<Shift | null>(null);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const { isAdmin, isManager } = useUserRole();
  
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
  const dayShifts = shifts.filter(
    s => s.day_of_week === selectedDayOfWeek && s.user_id
  );
  const dayEvents = events.filter(e => e.day_of_week === selectedDayOfWeek);

  const getProfileForShift = (shift: Shift) => {
    return profiles.find(p => p.id === shift.user_id);
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const totalPeopleScheduled = dayShifts.length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Month Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <Button variant="ghost" size="icon" onClick={handlePreviousWeek}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-lg font-semibold">{format(currentWeekStart, 'MMMM yyyy')}</h2>
        <Button variant="ghost" size="icon" onClick={handleNextWeek}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Week Calendar */}
      <div className="flex items-center justify-around p-4 border-b">
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

      {/* Restaurant Name */}
      <div className="flex items-center gap-2 p-4 border-b">
        <MapPin className="h-5 w-5 text-primary" />
        <span className="text-lg font-medium">Blaze Pizza</span>
      </div>

      {/* Selected Date Header */}
      <div className="flex items-center justify-between p-4 bg-muted/30">
        <h3 className="text-lg font-semibold">{format(selectedDate, 'EEEE, MMM d')}</h3>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-4 w-4" />
          <span className="text-sm font-medium">{totalPeopleScheduled}</span>
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

      {/* Shifts List */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {dayShifts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No shifts scheduled for this day</p>
          </div>
        ) : (
          dayShifts.map((shift) => {
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
                        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
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
        onOpenChange={setShiftDialogOpen}
        shift={selectedShift}
        profiles={profiles}
        isAdmin={isAdmin || isManager}
        onShiftUpdated={() => {
          onShiftClick?.(selectedShift!);
        }}
      />
    </div>
  );
}