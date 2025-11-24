import { useState } from 'react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Calendar as CalendarIcon, MapPin, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
}

interface MobileScheduleViewProps {
  currentWeekStart: Date;
  shifts: Shift[];
  events: Event[];
  profiles: Profile[];
  onShiftClick?: (shift: Shift) => void;
}

export function MobileScheduleView({
  currentWeekStart,
  shifts,
  events,
  profiles,
  onShiftClick,
}: MobileScheduleViewProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const selectedDayOfWeek = weekDays.findIndex(day => isSameDay(day, selectedDate));

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
        <CalendarIcon className="h-6 w-6 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{format(currentWeekStart, 'MMMM yyyy')}</h2>
        <div className="w-6" />
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
        <div className="mx-4 mt-4">
          <Card className="bg-accent/10 border-accent/20">
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <CalendarIcon className="h-5 w-5 text-accent-foreground" />
                <span className="text-sm font-medium">
                  There {dayEvents.length === 1 ? 'is' : 'are'} {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''} on this day
                </span>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
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
              <button
                key={shift.id}
                onClick={() => onShiftClick?.(shift)}
                className="w-full"
              >
                <Card className="hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3 p-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={profile.profile_photo_url || undefined} />
                      <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 text-left">
                      <h4 className="font-semibold">{profile.full_name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
                      </p>
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
                    
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  </div>
                </Card>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}