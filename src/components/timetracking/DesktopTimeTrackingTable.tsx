import { format } from 'date-fns';
import { Calendar, CheckCircle2, Coffee } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import autoPunchIcon from '@/assets/auto-punch-icon.jpg';
import {
  formatTimeDisplay,
  parseDateStringInTimezone,
  formatDateTimeInTimezone,
} from '@/utils/timezoneUtils';

interface DesktopTimeTrackingTableProps {
  filteredCards: any[];
  timezone: string;
  includeApproved: boolean;
  onApproveDay: (dayPunches: any[]) => void;
  onUnapproveDay: (dayPunches: any[]) => void;
  onEditShift: (shiftInfo: { dayPunches: any[], userId: string, locationId: string, shiftDate: string }) => void;
  calculateDayHours: (dayPunches: any[]) => number;
  hasDayIssues: (dayPunches: any[]) => boolean;
  sortPunches: (punches: any[]) => any[];
  groupPunchesByWeek: (punchesByDay: { [key: string]: any[] }) => [string, { start: Date; end: Date; days: { [day: string]: any[] } }][];
  currentLocationId: string;
  approvingPunchIds: Set<string>;
}

export function DesktopTimeTrackingTable({
  filteredCards,
  timezone,
  includeApproved,
  onApproveDay,
  onUnapproveDay,
  onEditShift,
  calculateDayHours,
  hasDayIssues,
  sortPunches,
  groupPunchesByWeek,
  currentLocationId,
  approvingPunchIds,
}: DesktopTimeTrackingTableProps) {
  
  const formatScheduleTime = (timeStr: string | null | undefined) => {
    if (!timeStr) return '—';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // Group data by employee with week groupings for hierarchical rendering
  const employeeData = filteredCards.map((card) => {
    const weekGroups = groupPunchesByWeek(card.punchesByDay);
    
    const weeks: {
      weekKey: string;
      weekStart: Date;
      weekEnd: Date;
      weekTotalHours: number;
      days: { day: string; dayPunches: any[] }[];
    }[] = [];

    weekGroups.forEach(([weekKey, weekData]) => {
      const sortedDays = Object.entries(weekData.days).sort(([a], [b]) => a.localeCompare(b));
      const filteredDays: { day: string; dayPunches: any[] }[] = [];
      let weekTotalHours = 0;
      
      sortedDays.forEach(([day, dayPunches]) => {
        const dayHrs = calculateDayHours(dayPunches);
        weekTotalHours += dayHrs;
        
        const isApproved = dayPunches.every((p: any) => p.approved_at);
        if (!includeApproved && isApproved) return;

        filteredDays.push({ day, dayPunches });
      });

      if (filteredDays.length > 0) {
        weeks.push({
          weekKey,
          weekStart: weekData.start,
          weekEnd: weekData.end,
          weekTotalHours,
          days: filteredDays,
        });
      }
    });

    return { card, weeks };
  }).filter(e => e.weeks.length > 0);

  if (employeeData.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No time entries to display
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-[200px]">Employee</TableHead>
            <TableHead className="w-[100px]">Day</TableHead>
            <TableHead className="w-[180px]">Shift Times</TableHead>
            <TableHead className="w-[180px]">Breaks</TableHead>
            <TableHead className="w-[80px] text-right">Hours</TableHead>
            <TableHead className="w-[70px] text-center">Approve</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employeeData.map(({ card, weeks }) => (
            <>
              {/* Employee header row */}
              <TableRow key={`employee-${card.profile.id}`} className="bg-muted/30 hover:bg-muted/40">
                <TableCell className="py-3">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={card.profile.avatar_url} />
                      <AvatarFallback className="text-xs">{card.profile.full_name?.[0] || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="font-medium text-sm">{card.profile.full_name}</div>
                  </div>
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell className="py-3 text-right">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Total</span>
                  <div className="font-semibold text-sm">{card.totalHours.toFixed(1)} hrs</div>
                </TableCell>
                <TableCell />
              </TableRow>
              
              {/* Week groups */}
              {weeks.map((week, weekIdx) => (
                <>
                  {/* Week separator header */}
                  <TableRow key={`week-${card.profile.id}-${week.weekKey}`} className="border-t-2 border-border/50">
                    <TableCell colSpan={4} className="py-2 bg-muted/10">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">Week of {format(week.weekStart, 'MMM d')} – {format(week.weekEnd, 'MMM d')}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right bg-muted/10">
                      <span className="font-medium text-sm">{week.weekTotalHours.toFixed(1)}</span>
                      <span className="text-xs text-muted-foreground ml-0.5">hrs</span>
                    </TableCell>
                    <TableCell className="bg-muted/10" />
                  </TableRow>
                  
                  {/* Day rows */}
                  {week.days.map(({ day, dayPunches }) => {
                    const sortedPunches = sortPunches(dayPunches);
                    
                    // Identify distinct shifts
                    const shifts: { clockIn: any; clockOut: any | null; breaks: any[] }[] = [];
                    let currentShift: { clockIn: any; clockOut: any | null; breaks: any[] } | null = null;
                    
                    sortedPunches.forEach((punch: any, punchIdx: number) => {
                      if (punch.punch_type === 'clock_in') {
                        const prevPunch = punchIdx > 0 ? sortedPunches[punchIdx - 1] : null;
                        if (!prevPunch || prevPunch.punch_type === 'clock_out') {
                          if (currentShift) shifts.push(currentShift);
                          currentShift = { clockIn: punch, clockOut: null, breaks: [] };
                        }
                      } else if (punch.punch_type === 'clock_out' && currentShift) {
                        currentShift.clockOut = punch;
                      } else if (punch.punch_type === 'break_start' && currentShift) {
                        currentShift.breaks.push(punch);
                      }
                    });
                    if (currentShift) shifts.push(currentShift);

                    const breakStarts = dayPunches.filter((p: any) => p.punch_type === 'break_start');
                    const dayDate = parseDateStringInTimezone(day, timezone);
                    const dayHours = calculateDayHours(dayPunches);
                    const isApproved = dayPunches.every((p: any) => p.approved_at);
                    const hasAutoClockOut = dayPunches.some((p: any) => p.is_auto_punched_out);
                    const scheduledShift = card.shiftsByDate?.get(day);
                    
                    // Check break violation
                    let hasBreakViolation = false;
                    shifts.forEach(shift => {
                      if (shift.clockIn && shift.clockOut) {
                        let shiftHours = (new Date(shift.clockOut.punch_time).getTime() - new Date(shift.clockIn.punch_time).getTime()) / 3600000;
                        if (shiftHours < 0) shiftHours += 24;
                        const shiftHasMealBreak = shift.breaks.some((b: any) => b.notes?.includes('30 minute'));
                        if (shiftHours > 5 && !shiftHasMealBreak) {
                          hasBreakViolation = true;
                        }
                      }
                    });

                    const hasAnyFlag = hasAutoClockOut || hasBreakViolation;
                    const isApproving = dayPunches.some((p: any) => approvingPunchIds.has(p.id));

                    return (
                      <TableRow 
                        key={`${card.profile.id}-${day}`}
                        className={`cursor-pointer hover:bg-muted/30 transition-colors ${hasAnyFlag ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
                        onClick={() => onEditShift({ dayPunches, userId: card.profile.id, locationId: currentLocationId, shiftDate: day })}
                      >
                        {/* Employee Column - empty for day rows */}
                        <TableCell className="py-2" />

                        {/* Day Column */}
                        <TableCell className="py-2">
                          <div className="text-center">
                            <div className="text-xs text-muted-foreground">{format(dayDate, 'EEE')}</div>
                            <div className="font-semibold text-sm">{format(dayDate, 'MMM d')}</div>
                          </div>
                        </TableCell>

                        {/* Shift Times Column */}
                        <TableCell className="py-2">
                          <div className="space-y-1">
                            {/* Actual times */}
                            {shifts.map((shift, shiftIdx) => (
                              <div key={shiftIdx} className="flex items-center gap-1.5 text-sm">
                                {shifts.length > 1 && (
                                  <span className="text-[10px] text-muted-foreground font-medium">#{shiftIdx + 1}</span>
                                )}
                                <span className="text-green-600 font-medium">
                                  {shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}
                                </span>
                                <span className="text-muted-foreground">→</span>
                                <span className="text-red-600 font-medium">
                                  {shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}
                                </span>
                                {shiftIdx === 0 && hasBreakViolation && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-amber-600 border-amber-300 gap-0.5">
                                    <Coffee className="h-2.5 w-2.5" />
                                    No Break
                                  </Badge>
                                )}
                                {shiftIdx === 0 && hasAutoClockOut && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-orange-600 border-orange-300 gap-0.5">
                                    <img src={autoPunchIcon} alt="Auto" className="h-3 w-3" />
                                    Auto
                                  </Badge>
                                )}
                              </div>
                            ))}
                            
                            {/* Scheduled times - tag style */}
                            {scheduledShift && !scheduledShift.is_time_off && (
                              <div className="flex items-center gap-1 mt-1">
                                <Badge variant="outline" className="text-xs px-2 py-0.5 bg-muted/50 border-dashed gap-1">
                                  <Calendar className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-muted-foreground">
                                    {formatScheduleTime(scheduledShift.start_time)} → {formatScheduleTime(scheduledShift.end_time)}
                                  </span>
                                </Badge>
                              </div>
                            )}
                            {scheduledShift?.is_time_off && (
                              <Badge variant="outline" className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 gap-1">
                                <Calendar className="h-3 w-3 text-blue-500" />
                                <span className="text-blue-600 dark:text-blue-400">Time Off</span>
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Breaks Column */}
                        <TableCell className="py-2">
                          {breakStarts.length > 0 ? (
                            <div className="space-y-1">
                              {breakStarts.map((breakStart: any, bidx: number) => {
                                let breakEnd = dayPunches.find((p: any) => 
                                  p.punch_type === 'break_end' && 
                                  new Date(p.punch_time) > new Date(breakStart.punch_time)
                                );
                                if (!breakEnd) {
                                  breakEnd = dayPunches.find((p: any) => 
                                    p.punch_type === 'clock_in' && 
                                    new Date(p.punch_time) > new Date(breakStart.punch_time)
                                  );
                                }
                                const duration = breakStart.notes?.includes('30 minute') ? '30m' : '10m';
                                
                                let isLongBreak = false;
                                if (breakEnd) {
                                  const actualDurationMins = (new Date(breakEnd.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000;
                                  isLongBreak = actualDurationMins > 35;
                                }
                                
                                return (
                                  <div 
                                    key={bidx} 
                                    className={`flex items-center gap-1 text-xs ${isLongBreak ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}
                                  >
                                    <Coffee className="h-3 w-3" />
                                    <span>{duration}:</span>
                                    <span>{formatTimeDisplay(breakStart.punch_time, timezone)}</span>
                                    {breakEnd && (
                                      <>
                                        <span>→</span>
                                        <span>{formatTimeDisplay(breakEnd.punch_time, timezone)}</span>
                                      </>
                                    )}
                                    {isLongBreak && <span>⚠️</span>}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Hours Column */}
                        <TableCell className="py-2 text-right">
                          <span className="font-semibold text-sm">{dayHours.toFixed(1)}</span>
                          <span className="text-xs text-muted-foreground ml-0.5">hrs</span>
                        </TableCell>

                        {/* Approve Column */}
                        <TableCell className="py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          {isApproved ? (
                            <button 
                              className={`h-10 w-10 rounded-lg flex items-center justify-center bg-green-100 dark:bg-green-900/30 border-2 border-green-500 text-green-600 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => onUnapproveDay(dayPunches)}
                              disabled={isApproving}
                            >
                              <CheckCircle2 className="h-5 w-5" />
                            </button>
                          ) : (hasBreakViolation || hasAutoClockOut) ? (
                            <button 
                              className={`h-10 w-10 rounded-lg flex items-center justify-center bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-400 hover:bg-amber-100 transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => onApproveDay(dayPunches)}
                              disabled={isApproving}
                              title={hasBreakViolation ? 'Missing meal break' : 'Auto punched out'}
                            >
                              {hasBreakViolation ? (
                                <Coffee className="h-5 w-5 text-amber-600" />
                              ) : (
                                <img src={autoPunchIcon} alt="Auto" className="h-5 w-5" />
                              )}
                            </button>
                          ) : (
                            <button 
                              className={`h-10 w-10 rounded-lg flex items-center justify-center bg-muted/50 border-2 border-border hover:bg-primary/10 hover:border-primary transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => onApproveDay(dayPunches)}
                              disabled={isApproving}
                            >
                              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </>
              ))}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
