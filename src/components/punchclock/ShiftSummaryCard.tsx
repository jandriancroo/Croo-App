import { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Coffee, LogOut, Play, Check, ArrowLeft } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

interface ShiftSummaryCardProps {
  user: {
    id: string;
    full_name: string;
    profile_photo_url?: string;
  };
  todayShift?: {
    id: string;
    start_time: string;
    end_time: string;
    shift_date: string;
  } | null;
  lastPunch?: {
    id: string;
    punch_type: string;
    punch_time: string;
    notes?: string;
    shift_id?: string;
  } | null;
  breakStatus?: {
    canEnd: boolean;
    remaining: number;
    breakDuration: number;
  } | null;
  locationId: string;
  timezone: string;
  onClockIn: () => void;
  onBreak: (type: 'break_start' | 'break_end', duration: number) => void;
  onClockOut: () => void;
  onEndBreak: () => void;
  onBack: () => void;
  canClockIn: boolean;
  isClockedIn: boolean;
  isOnBreak: boolean;
}

interface BreakRecord {
  id: string;
  type: 'meal' | 'rest';
  startTime: Date;
  endTime?: Date;
  duration: number; // minutes
  status: 'taken' | 'in_progress' | 'missed';
}

export function ShiftSummaryCard({
  user,
  todayShift,
  lastPunch,
  breakStatus,
  locationId,
  timezone: _timezone,
  onClockIn,
  onBreak,
  onClockOut,
  onEndBreak,
  onBack,
  canClockIn,
  isClockedIn,
  isOnBreak,
}: ShiftSummaryCardProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [hoursWorked, setHoursWorked] = useState({ hours: 0, minutes: 0 });
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);

  // Update timer every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch today's punches to calculate hours and breaks
  useEffect(() => {
    const fetchTodayPunches = async () => {
      if (!user.id || !locationId) return;

      // Get all punches from today (using 16-hour lookback for overnight)
      const now = new Date();
      const lookbackTime = new Date(now.getTime() - 16 * 60 * 60 * 1000);

      const { data: punches } = await supabase
        .from('time_punches')
        .select('*')
        .eq('user_id', user.id)
        .eq('location_id', locationId)
        .gte('punch_time', lookbackTime.toISOString())
        .order('punch_time', { ascending: true });

      if (!punches || punches.length === 0) {
        setClockInTime(null);
        setBreaks([]);
        return;
      }

      // Find the first clock_in that starts the current session
      let sessionStart: Date | null = null;
      const breakRecords: BreakRecord[] = [];
      let currentBreakStart: { time: Date; notes?: string } | null = null;

      for (const punch of punches) {
        const punchTime = new Date(punch.punch_time);
        
        if (punch.punch_type === 'clock_in') {
          // Reset session if this is a new clock-in after a clock-out
          if (!sessionStart || (punches.find(p => p.punch_type === 'clock_out' && new Date(p.punch_time) > sessionStart! && new Date(p.punch_time) < punchTime))) {
            sessionStart = punchTime;
          }
        } else if (punch.punch_type === 'break_start' && sessionStart) {
          currentBreakStart = { time: punchTime, notes: punch.notes };
        } else if ((punch.punch_type === 'break_end' || punch.punch_type === 'clock_in') && currentBreakStart) {
          const notes = currentBreakStart.notes?.toLowerCase() || '';
          const isMealBreak = notes.includes('30') || notes.includes('unpaid') || notes.includes('meal');
          const duration = differenceInMinutes(punchTime, currentBreakStart.time);
          
          breakRecords.push({
            id: punch.id,
            type: isMealBreak ? 'meal' : 'rest',
            startTime: currentBreakStart.time,
            endTime: punchTime,
            duration,
            status: 'taken',
          });
          currentBreakStart = null;
        } else if (punch.punch_type === 'clock_out') {
          // Session ended - if there's an open break, mark it
          if (currentBreakStart) {
            const notes = currentBreakStart.notes?.toLowerCase() || '';
            const isMealBreak = notes.includes('30') || notes.includes('unpaid') || notes.includes('meal');
            const duration = differenceInMinutes(punchTime, currentBreakStart.time);
            
            breakRecords.push({
              id: punch.id,
              type: isMealBreak ? 'meal' : 'rest',
              startTime: currentBreakStart.time,
              endTime: punchTime,
              duration,
              status: 'taken',
            });
            currentBreakStart = null;
          }
        }
      }

      // If currently on break, add in-progress break
      if (currentBreakStart && isOnBreak) {
        const notes = currentBreakStart.notes?.toLowerCase() || '';
        const isMealBreak = notes.includes('30') || notes.includes('unpaid') || notes.includes('meal');
        const duration = differenceInMinutes(new Date(), currentBreakStart.time);
        
        breakRecords.push({
          id: 'in-progress',
          type: isMealBreak ? 'meal' : 'rest',
          startTime: currentBreakStart.time,
          duration,
          status: 'in_progress',
        });
      }

      setClockInTime(sessionStart);
      setBreaks(breakRecords);
    };

    fetchTodayPunches();
  }, [user.id, locationId, isOnBreak, lastPunch?.id]);

  // Calculate hours worked in real-time
  useEffect(() => {
    if (!clockInTime || !isClockedIn) {
      setHoursWorked({ hours: 0, minutes: 0 });
      return;
    }

    const now = new Date();
    let totalMinutes = differenceInMinutes(now, clockInTime);

    // Subtract completed break time (unpaid breaks only)
    const unpaidBreakMinutes = breaks
      .filter(b => b.type === 'meal' && b.status === 'taken')
      .reduce((acc, b) => acc + b.duration, 0);
    
    totalMinutes = Math.max(0, totalMinutes - unpaidBreakMinutes);

    // If on break, subtract current break time if it's unpaid
    if (isOnBreak && breakStatus) {
      const currentBreak = breaks.find(b => b.status === 'in_progress');
      if (currentBreak?.type === 'meal') {
        totalMinutes = Math.max(0, totalMinutes - currentBreak.duration);
      }
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    setHoursWorked({ hours, minutes });
  }, [currentTime, clockInTime, isClockedIn, breaks, isOnBreak, breakStatus]);

  const initials = user.full_name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const formatTimeWorked = () => {
    return `${hoursWorked.hours.toString().padStart(2, '0')}:${hoursWorked.minutes.toString().padStart(2, '0')}`;
  };

  const getBreakLabel = (type: 'meal' | 'rest') => {
    return type === 'meal' ? 'Meal break' : 'Rest break';
  };

  return (
    <Card className="w-full max-w-md mx-auto p-6 space-y-6 bg-background/95 backdrop-blur-sm">
      {/* Header: Profile + Hours Counter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border-2 border-primary/20">
            <AvatarImage src={user.profile_photo_url} alt={user.full_name} />
            <AvatarFallback className="text-xl font-semibold bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm text-muted-foreground">
              {format(currentTime, 'EEE, MMM d')}
            </p>
            <h2 className="text-lg font-semibold">{user.full_name}</h2>
          </div>
        </div>
        
        {/* Hours Counter */}
        {(isClockedIn || isOnBreak) && (
          <div className="text-right">
            <p className="text-3xl font-bold font-mono text-foreground">
              {formatTimeWorked()}
            </p>
            <p className="text-xs text-muted-foreground">Hours Worked</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        {!isClockedIn && !isOnBreak ? (
          <Button
            className="flex-1 h-12"
            onClick={onClockIn}
            disabled={!canClockIn}
          >
            <Play className="mr-2 h-4 w-4" />
            Clock In
          </Button>
        ) : isOnBreak ? (
          <Button
            className="flex-1 h-12"
            variant={breakStatus?.canEnd ? 'default' : 'outline'}
            onClick={onEndBreak}
            disabled={!breakStatus?.canEnd}
          >
            <Coffee className="mr-2 h-4 w-4" />
            {breakStatus?.canEnd 
              ? 'End Break' 
              : `Wait ${Math.floor((breakStatus?.remaining || 0) / 60)}:${((breakStatus?.remaining || 0) % 60).toString().padStart(2, '0')}`
            }
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              className="flex-1 h-12"
              onClick={() => onBreak('break_start', 30)}
            >
              <Coffee className="mr-2 h-4 w-4" />
              Start Break
            </Button>
            <Button
              variant="destructive"
              className="flex-1 h-12"
              onClick={onClockOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              End Shift
            </Button>
          </>
        )}
      </div>

      {/* Shift Info */}
      <div className="space-y-4 pt-4 border-t">
        {/* Started at */}
        {clockInTime && (isClockedIn || isOnBreak) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Started at {format(clockInTime, 'h:mm a')}
              </span>
            </div>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {isOnBreak ? 'On Break' : 'In progress'}
            </Badge>
          </div>
        )}

        {/* Scheduled shift time */}
        {todayShift && !isClockedIn && !isOnBreak && (
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Scheduled: {format(new Date(`2000-01-01T${todayShift.start_time}`), 'h:mm a')} - {format(new Date(`2000-01-01T${todayShift.end_time}`), 'h:mm a')}
            </span>
          </div>
        )}

        {!todayShift && !isClockedIn && !isOnBreak && (
          <div className="flex items-center gap-3 text-amber-600">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">
              ⚠ Not scheduled today - punch will be flagged
            </span>
          </div>
        )}

        {/* Break History */}
        {breaks.length > 0 && (
          <div className="space-y-2 pt-2">
            {breaks.map((breakRecord, index) => (
              <div key={breakRecord.id || index} className="flex items-center justify-between py-2 border-t border-border/50">
                <div className="flex items-center gap-3">
                  <Coffee className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{getBreakLabel(breakRecord.type)}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(breakRecord.startTime, 'h:mm a')}
                      {breakRecord.endTime && ` - ${format(breakRecord.endTime, 'h:mm a')}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {breakRecord.status === 'in_progress' 
                      ? `${breakRecord.duration}m...` 
                      : `${breakRecord.duration}m`
                    }
                  </span>
                  {breakRecord.status === 'taken' && (
                    <Check className="h-4 w-4 text-emerald-500" />
                  )}
                  {breakRecord.status === 'in_progress' && (
                    <Badge variant="secondary" className="text-xs">Active</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Back Button */}
      <Button 
        variant="ghost" 
        onClick={onBack} 
        className="w-full mt-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
    </Card>
  );
}
