import { format } from 'date-fns';
import { CheckCircle2, Coffee } from 'lucide-react';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getDisplayName } from '@/utils/displayName';

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
  getDayFlags: (dayPunches: any[]) => { hasAutoClockOut: boolean; hasBreakViolation: boolean; hasOpenShift: boolean; hasAnyFlag: boolean };
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
  getDayFlags,
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
        const dayHrs = calculateDayHours(dayPunches) || 0;
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
    <div className="border rounded-lg overflow-x-auto">
      <Table className="min-w-[700px]">
        <TableBody>
          {employeeData.map(({ card, weeks }) => (
            <>
              {/* Spacer row for visual separation between employees */}
              <TableRow key={`spacer-${card.profile.id}`} className="h-4 border-0 bg-transparent hover:bg-transparent">
                <TableCell colSpan={7} className="p-0 border-0" />
              </TableRow>
              
              {/* Employee header row */}
              <TableRow key={`employee-${card.profile.id}`} className="bg-primary/10 dark:bg-primary/20 border-t-2 border-primary/30 hover:bg-primary/15 dark:hover:bg-primary/25">
                <TableCell className="py-2.5" colSpan={5}>
                  <span className="font-bold text-base text-primary dark:text-primary-foreground">{getDisplayName(card.profile.full_name, card.profile.nickname)}</span>
                </TableCell>
                <TableCell className="py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs text-muted-foreground uppercase">Total</span>
                    <span className="font-semibold text-sm">{(card.totalHours || 0).toFixed(1)}</span>
                  </div>
                </TableCell>
                <TableCell />
              </TableRow>
              
              {/* Week groups */}
              {weeks.map((week) => (
                <>
                  {/* Week separator header */}
                  <TableRow key={`week-${card.profile.id}-${week.weekKey}`} className="border-t border-border/60">
                    <TableCell colSpan={5} className="py-1.5 bg-muted/20">
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
                    const dayHours = calculateDayHours(dayPunches) || 0;
                    const isApproved = dayPunches.every((p: any) => p.approved_at);

                    // Get scheduled shift for this day
                    const scheduledShift = card.shiftsByDate?.get(day);

                    const flags = getDayFlags(dayPunches);
                    const hasAutoClockOut = flags.hasAutoClockOut;
                    const hasBreakViolation = flags.hasBreakViolation;
                    const hasOpenShift = flags.hasOpenShift;
                    const hasAnyFlag = flags.hasAnyFlag;
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
                        {/* Day column */}
                        <TableCell className="py-1 pl-8 whitespace-nowrap w-[12%]">
                          <span className="text-xs text-muted-foreground">{format(dayDate, 'EEE')}</span>
                          <span className="font-medium text-sm ml-1">{format(dayDate, 'M/d')}</span>
                        </TableCell>

                        {/* Scheduled Times - tag style */}
                        <TableCell className="py-1 w-[18%]">
                          {scheduledShift && !scheduledShift.is_time_off ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-muted/50 font-normal whitespace-nowrap">
                              {formatScheduledTime(scheduledShift.start_time)} → {formatScheduledTime(scheduledShift.end_time)}
                            </Badge>
                          ) : scheduledShift?.is_time_off ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">PTO</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Actual Shift Times */}
                        <TableCell className="py-1 w-[18%]">
                          <div className="flex items-center gap-1 flex-wrap">
                            {shifts.map((shift, shiftIdx) => (
                              <span key={shiftIdx} className="text-sm flex items-center gap-1">
                                {shifts.length > 1 && <span className="text-[10px] text-muted-foreground">#{shiftIdx + 1}</span>}
                                <span className="text-green-600 font-medium">{shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="text-red-600 font-medium">{shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}</span>
                              </span>
                            ))}
                          </div>
                        </TableCell>

                        {/* Breaks - stacked */}
                        <TableCell className="py-1 w-[25%]">
                          {breakStarts.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
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

                        {/* Flags Column */}
                        <TableCell className="py-1 w-[7%]">
                          <div className="flex items-center gap-1 flex-wrap">
                            {hasBreakViolation && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 font-medium whitespace-nowrap">
                                No Break
                              </Badge>
                            )}
                            {hasAutoClockOut && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 font-medium whitespace-nowrap">
                                Auto Out
                              </Badge>
                            )}
                            {hasOpenShift && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-red-600 border-red-400 bg-red-50 dark:bg-red-950/30 font-medium whitespace-nowrap">
                                Open
                              </Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Hours */}
                        <TableCell className="py-1 text-right w-[8%]">
                          <span className="font-medium text-sm">{dayHours.toFixed(1)}</span>
                        </TableCell>

                        {/* Approve - full width button */}
                        <TableCell className="p-0" onClick={(e) => e.stopPropagation()}>
                          {hasOpenShift ? (
                            <button 
                              className="h-full min-h-[40px] w-full px-3 flex items-center justify-center gap-1.5 bg-muted/30 border-l border-dashed border-muted-foreground/30 text-xs text-muted-foreground cursor-not-allowed"
                              disabled
                              title="Cannot approve open shift - add clock-out first"
                            >
                              —
                            </button>
                          ) : isApproved ? (
                            <button 
                              className={`h-full min-h-[40px] w-full px-3 flex items-center justify-center gap-1.5 bg-green-100 dark:bg-green-900/30 border-l border-green-500 text-green-600 text-xs font-medium hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-all duration-150 active:scale-95 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                              onClick={() => onUnapproveDay(dayPunches)}
                              disabled={isApproving}
                            >
                              Approved
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button 
                              className={`h-full min-h-[40px] w-full px-3 flex items-center justify-center gap-1.5 bg-muted/50 border-l border-border text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:border-primary hover:text-primary transition-all duration-150 active:scale-95 active:bg-green-100 active:border-green-500 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                              onClick={() => onApproveDay(dayPunches)}
                              disabled={isApproving}
                            >
                              Approve
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
