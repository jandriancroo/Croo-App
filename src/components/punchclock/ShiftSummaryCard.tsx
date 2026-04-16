import { useState, useEffect } from 'react';
import { useClock } from '@/hooks/useClock';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

import { Badge } from '@/components/ui/badge';
import { Clock, Coffee, LogOut, Play, Check, ArrowLeft, Monitor } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  isDayMode: boolean;
  /** When provided, shows an "Exit Kiosk" button (admin-only). */
  onExitKiosk?: () => void;
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
  isDayMode,
  onExitKiosk,
}: ShiftSummaryCardProps) {
  const currentTime = useClock(1000);
  const [hoursWorked, setHoursWorked] = useState({ hours: 0, minutes: 0 });
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [breaks, setBreaks] = useState<BreakRecord[]>([]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

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
    <div className="w-full grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-4 pt-2">
      {/* Left column: Back button aligned to the card edge */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          onClick={onBack}
          className={`mt-6 shrink-0 h-12 px-5 text-lg border ${
            isDayMode
              ? 'border-border/60 bg-background/80 text-foreground hover:bg-muted'
              : 'border-white/15 bg-white/10 text-white hover:bg-white/15'
          }`}
        >
          <ArrowLeft className="mr-2 h-6 w-6" />
          Back
        </Button>
      </div>

      {/* White Card Container - Square, Two Column Layout */}
      <div className="bg-white dark:bg-card rounded-2xl shadow-neumorphic-lg border border-border/30 p-12 min-h-[480px] min-w-[720px] max-w-4xl">
        <div className="flex gap-12 h-full">
          {/* Left Column - Profile, Name, Status */}
          <div className="flex flex-col items-center justify-center min-w-[260px] space-y-6 border-r border-border pr-12">
            <Avatar className="h-40 w-40 border-4 border-primary/20 shadow-neumorphic">
              <AvatarImage src={user.profile_photo_url} alt={user.full_name} />
              <AvatarFallback className="text-5xl font-semibold bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="text-center space-y-1">
              <h2 className="text-xl font-semibold text-foreground">{user.full_name}</h2>
              <p className="text-base text-muted-foreground">
                {format(currentTime, 'EEEE, MMMM d')}
              </p>
            </div>

            {/* Status Badge - Below Name */}
            {(isClockedIn || isOnBreak) && (
              <Badge variant="secondary" className="text-base px-4 py-1 bg-primary/10 text-primary">
                {isOnBreak ? 'On Break' : 'Clocked In'}
              </Badge>
            )}
          </div>

          {/* Right Column - Status, Actions, Break History */}
          <div className="flex-1 flex flex-col justify-center space-y-6">
            {/* Hours Worked - Above Started At */}
            {(isClockedIn || isOnBreak) && (
              <div className="text-center">
                <p className="text-5xl font-bold font-mono text-foreground tracking-tight">
                  {formatTimeWorked()}
                </p>
                <p className="text-sm text-muted-foreground mt-2">Hours Worked</p>
              </div>
            )}

            {/* Schedule/Status Info */}
            <div className="w-full text-center p-4 rounded-xl bg-muted/50">
              {clockInTime && (isClockedIn || isOnBreak) ? (
                <div className="flex items-center justify-center gap-2 text-base text-muted-foreground">
                  <Clock className="h-5 w-5" />
                  <span>Started at {format(clockInTime, 'h:mm a')}</span>
                </div>
              ) : todayShift ? (
                <div className="flex items-center justify-center gap-2 text-base text-muted-foreground">
                  <Clock className="h-5 w-5" />
                  <span>
                    Scheduled: {format(new Date(`2000-01-01T${todayShift.start_time}`), 'h:mm a')} - {format(new Date(`2000-01-01T${todayShift.end_time}`), 'h:mm a')}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-amber-600 text-base font-medium">
                  <span>⚠️ Not scheduled today</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="w-full">
              {!isClockedIn && !isOnBreak ? (
                <Button
                  className="w-full h-18 text-2xl py-6"
                  onClick={onClockIn}
                  disabled={!canClockIn}
                >
                  <Play className="mr-3 h-7 w-7" />
                  Clock In
                </Button>
              ) : isOnBreak ? (
                <Button
                  className="w-full h-18 text-2xl py-6"
                  variant={breakStatus?.canEnd ? 'default' : 'outline'}
                  onClick={onEndBreak}
                  disabled={!breakStatus?.canEnd}
                >
                  <Coffee className="mr-3 h-7 w-7" />
                  {breakStatus?.canEnd 
                    ? 'End Break' 
                    : `Wait ${Math.floor((breakStatus?.remaining || 0) / 60)}:${((breakStatus?.remaining || 0) % 60).toString().padStart(2, '0')}`
                  }
                </Button>
              ) : (
                <div className="space-y-5">
                  <div className="flex gap-5">
                    <Button
                      variant="secondary"
                      className="flex-1 h-16 text-lg font-semibold bg-amber-500/20 hover:bg-amber-500/30 border-2 border-amber-500/50 text-amber-700 dark:text-amber-300"
                      onClick={() => onBreak('break_start', 30)}
                    >
                      <Coffee className="mr-2 h-6 w-6" />
                      30m Meal
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1 h-16 text-lg font-semibold bg-blue-500/20 hover:bg-blue-500/30 border-2 border-blue-500/50 text-blue-700 dark:text-blue-300"
                      onClick={() => onBreak('break_start', 10)}
                    >
                      <Coffee className="mr-2 h-6 w-6" />
                      10m Rest
                    </Button>
                  </div>
                  <Button
                    variant="destructive"
                    className="w-full h-16 text-lg"
                    onClick={onClockOut}
                  >
                    <LogOut className="mr-2 h-6 w-6" />
                    End Shift
                  </Button>
                </div>
              )}
            </div>

            {/* Break History */}
            {breaks.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Break History</p>
                {breaks.map((breakRecord, index) => (
                  <div key={breakRecord.id || index} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
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
        </div>
      </div>
      {/* Right column: Exit Kiosk button (admin-only, kiosk mode only) */}
      <div className="flex justify-start">
        {onExitKiosk && (
          <Button
            variant="ghost"
            onClick={() => setShowExitConfirm(true)}
            className={`mt-6 shrink-0 h-12 px-5 text-lg border ${
              isDayMode
                ? 'border-border/60 bg-background/80 text-foreground hover:bg-muted'
                : 'border-white/15 bg-white/10 text-white hover:bg-white/15'
            }`}
          >
            <Monitor className="mr-2 h-6 w-6" />
            Exit Kiosk
          </Button>
        )}
      </div>

      <AlertDialog open={showExitConfirm} onOpenChange={setShowExitConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit Kiosk Mode?</AlertDialogTitle>
            <AlertDialogDescription>
              This tablet will leave kiosk mode and return to the regular app.
              You'll need to set up the kiosk again before employees can use it
              to clock in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onExitKiosk}>
              Exit Kiosk
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
