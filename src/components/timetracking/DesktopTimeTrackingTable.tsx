import { format } from 'date-fns';
import { CheckCircle2, Coffee } from 'lucide-react';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import autoPunchIcon from '@/assets/auto-punch-icon.jpg';
import {
  formatTimeDisplay,
  parseDateStringInTimezone,
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
  hasDayIssues: _hasDayIssues,
  sortPunches,
  groupPunchesByWeek,
  currentLocationId,
  approvingPunchIds,
}: DesktopTimeTrackingTableProps) {

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
        <TableBody>
          {employeeData.map(({ card, weeks }) => (
            <>
              {/* Employee header row */}
              <TableRow key={`employee-${card.profile.id}`} className="bg-muted/40 hover:bg-muted/50">
                <TableCell className="py-2" colSpan={4}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={card.profile.avatar_url} />
                      <AvatarFallback className="text-xs font-bold">{card.profile.full_name?.[0] || 'U'}</AvatarFallback>
                    </Avatar>
                    <span className="font-bold text-base">{card.profile.full_name}</span>
                  </div>
                </TableCell>
                <TableCell className="py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs text-muted-foreground uppercase">Total</span>
                    <span className="font-semibold text-sm">{card.totalHours.toFixed(1)}</span>
                  </div>
                </TableCell>
                <TableCell />
              </TableRow>
              
              {/* Week groups */}
              {weeks.map((week) => (
                <>
                  {/* Week separator header */}
                  <TableRow key={`week-${card.profile.id}-${week.weekKey}`} className="border-t border-border/60">
                    <TableCell colSpan={4} className="py-1.5 bg-muted/20">
                      <span className="text-xs text-muted-foreground font-medium">
                        Week of {format(week.weekStart, 'MMM d')} – {format(week.weekEnd, 'MMM d')}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 text-right bg-muted/20">
                      <span className="font-medium text-xs">{week.weekTotalHours.toFixed(1)} hrs</span>
                    </TableCell>
                    <TableCell className="bg-muted/20" />
                  </TableRow>
                  
                  {/* Day rows */}
                  {week.days.map(({ day, dayPunches }, dayIdx) => {
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
                    
                    // Get scheduled shift for this day
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
                    
                    // Alternating row colors for visual separation
                    const rowBg = dayIdx % 2 === 0 ? '' : 'bg-muted/10';

                    // Format scheduled time for display (e.g., "09:00" -> "9:00 AM")
                    const formatScheduledTime = (time: string | null | undefined) => {
                      if (!time) return null;
                      const [hours, minutes] = time.split(':').map(Number);
                      const ampm = hours >= 12 ? 'PM' : 'AM';
                      const hour12 = hours % 12 || 12;
                      return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
                    };

                    return (
                      <TableRow 
                        key={`${card.profile.id}-${day}`}
                        className={`cursor-pointer hover:bg-muted/30 transition-colors ${hasAnyFlag ? 'bg-amber-50/50 dark:bg-amber-950/20' : rowBg}`}
                        onClick={() => onEditShift({ dayPunches, userId: card.profile.id, locationId: currentLocationId, shiftDate: day })}
                      >
                        {/* Day column - indented under week header */}
                        <TableCell className="py-1.5 pl-12 whitespace-nowrap">
                          <span className="text-xs text-muted-foreground">{format(dayDate, 'EEE')}</span>
                          <span className="font-medium text-sm ml-1.5">{format(dayDate, 'M/d')}</span>
                        </TableCell>

                        {/* Scheduled Times - muted, compact */}
                        <TableCell className="py-1.5">
                          {scheduledShift && !scheduledShift.is_time_off ? (
                            <span className="text-xs text-muted-foreground">
                              {formatScheduledTime(scheduledShift.start_time)} → {formatScheduledTime(scheduledShift.end_time)}
                            </span>
                          ) : scheduledShift?.is_time_off ? (
                            <span className="text-xs text-muted-foreground italic">PTO</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Actual Shift Times - compact single line */}
                        <TableCell className="py-1.5">
                          <div className="flex items-center gap-1 flex-wrap">
                            {shifts.map((shift, shiftIdx) => (
                              <span key={shiftIdx} className="text-sm flex items-center gap-1">
                                {shifts.length > 1 && <span className="text-[10px] text-muted-foreground">#{shiftIdx + 1}</span>}
                                <span className="text-green-600 font-medium">{shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="text-red-600 font-medium">{shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}</span>
                              </span>
                            ))}
                            {hasBreakViolation && <Coffee className="h-3.5 w-3.5 text-amber-600" />}
                            {hasAutoClockOut && <img src={autoPunchIcon} alt="Auto" className="h-3.5 w-3.5" />}
                          </div>
                        </TableCell>

                        {/* Breaks - compact */}
                        <TableCell className="py-0.5 px-2">
                          {breakStarts.length > 0 ? (
                            <div className="flex items-center gap-1 flex-wrap">
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
                                const scheduledDuration = breakStart.notes?.includes('30 minute') ? '30m' : '10m';
                                
                                let isLongBreak = false;
                                let actualDurationMins = 0;
                                if (breakEnd) {
                                  actualDurationMins = Math.round((new Date(breakEnd.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000);
                                  isLongBreak = actualDurationMins > 35;
                                }
                                
                                return (
                                  <span 
                                    key={bidx} 
                                    className={`text-xs flex items-center gap-0.5 ${isLongBreak ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}
                                  >
                                    <Coffee className="h-3 w-3" />
                                    <span>{scheduledDuration}:</span>
                                    <span>{formatTimeDisplay(breakStart.punch_time, timezone)}</span>
                                    {breakEnd && (
                                      <>
                                        <span>→</span>
                                        <span>{formatTimeDisplay(breakEnd.punch_time, timezone)}</span>
                                        <span className="text-[10px] opacity-70">({actualDurationMins}m)</span>
                                      </>
                                    )}
                                    {isLongBreak && <span>⚠️</span>}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Hours */}
                        <TableCell className="py-0.5 px-2 text-right">
                          <span className="font-medium text-sm">{dayHours.toFixed(1)}</span>
                        </TableCell>

                        {/* Approve */}
                        <TableCell className="py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {isApproved ? (
                            <button 
                              className={`h-8 w-8 rounded-md flex items-center justify-center bg-green-100 dark:bg-green-900/30 border border-green-500 text-green-600 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => onUnapproveDay(dayPunches)}
                              disabled={isApproving}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          ) : (hasBreakViolation || hasAutoClockOut) ? (
                            <button 
                              className={`h-8 w-8 rounded-md flex items-center justify-center bg-amber-50 dark:bg-amber-900/30 border border-amber-400 hover:bg-amber-100 transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => onApproveDay(dayPunches)}
                              disabled={isApproving}
                              title={hasBreakViolation ? 'Missing meal break' : 'Auto punched out'}
                            >
                              {hasBreakViolation ? (
                                <Coffee className="h-4 w-4 text-amber-600" />
                              ) : (
                                <img src={autoPunchIcon} alt="Auto" className="h-4 w-4" />
                              )}
                            </button>
                          ) : (
                            <button 
                              className={`h-8 w-8 rounded-md flex items-center justify-center bg-muted/50 border border-border hover:bg-primary/10 hover:border-primary transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                              onClick={() => onApproveDay(dayPunches)}
                              disabled={isApproving}
                            >
                              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
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
