import { format } from 'date-fns';
import { CheckCircle2, Coffee } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getDisplayName } from '@/utils/displayName';
import {
  formatTimeDisplay,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';

interface DayByDayViewProps {
  filteredCards: any[];
  timezone: string;
  includeApproved: boolean;
  onApproveDay: (dayPunches: any[]) => void;
  onUnapproveDay: (dayPunches: any[]) => void;
  onEditShift: (shiftInfo: { dayPunches: any[], userId: string, locationId: string, shiftDate: string }) => void;
  calculateDayHours: (dayPunches: any[]) => number;
  sortPunches: (punches: any[]) => any[];
  currentLocationId: string;
  approvingPunchIds: Set<string>;
  periodDates: { value: string; label: string }[];
  getDayFlags: (dayPunches: any[]) => { hasAutoClockOut: boolean; hasBreakViolation: boolean; hasOpenShift: boolean; hasAnyFlag: boolean };
}

export function DayByDayView({
  filteredCards,
  timezone,
  includeApproved,
  onApproveDay,
  onUnapproveDay,
  onEditShift,
  calculateDayHours,
  sortPunches,
  currentLocationId,
  approvingPunchIds,
  periodDates,
  getDayFlags,
}: DayByDayViewProps) {
  // Flatten all shifts into a single list grouped by day
  const shiftsByDay: Map<string, {
    profile: any;
    dayPunches: any[];
    shifts: { clockIn: any; clockOut: any | null; breaks: any[] }[];
    dayHours: number;
    isApproved: boolean;
    hasAutoClockOut: boolean;
    hasBreakViolation: boolean;
    hasOpenShift: boolean;
    hasManualEdit: boolean;
    editedByName: string | null;
    scheduledShift: any;
  }[]> = new Map();

  filteredCards.forEach((card) => {
    Object.entries(card.punchesByDay).forEach(([day, dayPunches]: [string, any]) => {
      const sortedPunches = sortPunches(dayPunches);
      
      // Skip approved if not showing
      const isApproved = dayPunches.every((p: any) => p.approved_at);
      if (!includeApproved && isApproved) return;
      
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

      const dayHours = calculateDayHours(dayPunches) || 0;
      const flags = getDayFlags(dayPunches);
      const hasAutoClockOut = flags.hasAutoClockOut;
      const hasBreakViolation = flags.hasBreakViolation;
      const hasOpenShift = flags.hasOpenShift;
      
      // Check if any punch was manually edited (use edited_by_name already attached by PayrollReview)
      const editedPunch = dayPunches.find((p: any) => p.edited_by);
      const hasManualEdit = !!editedPunch;
      const editedByName = editedPunch?.edited_by_name?.split(' ')[0] || null;
      
      const scheduledShift = card.shiftsByDate?.get(day);

      if (!shiftsByDay.has(day)) {
        shiftsByDay.set(day, []);
      }
      shiftsByDay.get(day)!.push({
        profile: card.profile,
        dayPunches,
        shifts,
        dayHours,
        isApproved,
        hasAutoClockOut,
        hasBreakViolation,
        hasOpenShift,
        hasManualEdit,
        editedByName,
        scheduledShift,
      });
    });
  });

  // Sort days chronologically
  const sortedDays = Array.from(shiftsByDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  if (sortedDays.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No time entries to display
      </div>
    );
  }

  // Format scheduled time for display
  const formatScheduledTime = (time: string | null | undefined) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  // Calculate daily totals
  const getDayTotalHours = (entries: typeof shiftsByDay extends Map<string, infer V> ? V : never) => {
    return entries.reduce((sum, entry) => sum + (entry.dayHours || 0), 0);
  };

  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table className="min-w-[700px]">
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-[18%]">Employee</TableHead>
            <TableHead className="w-[14%]">Scheduled</TableHead>
            <TableHead className="w-[16%]">Actual</TableHead>
            <TableHead className="w-[24%]">Breaks</TableHead>
            <TableHead className="w-[12%]">Flags</TableHead>
            <TableHead className="w-[8%] text-right">Hours</TableHead>
            <TableHead className="w-[8%]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedDays.map(([day, entries], dayIdx) => {
            const dayDate = parseDateStringInTimezone(day, timezone);
            const dayTotal = getDayTotalHours(entries);
            
            // Sort entries by clock-in time
            const sortedEntries = [...entries].sort((a, b) => {
              const aTime = a.shifts[0]?.clockIn?.punch_time || '';
              const bTime = b.shifts[0]?.clockIn?.punch_time || '';
              return aTime.localeCompare(bTime);
            });

            return (
              <>
                {/* Spacer row before each day (except first) */}
                {dayIdx > 0 && (
                  <TableRow key={`spacer-${day}`} className="h-3 hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0 border-0" />
                  </TableRow>
                )}

                {/* Day Header */}
                <TableRow key={`day-header-${day}`} className="bg-primary/10 dark:bg-primary/20 hover:bg-primary/15 dark:hover:bg-primary/25 border-t-2 border-primary/30">
                  <TableCell colSpan={5} className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{format(dayDate, 'EEEE')}</span>
                      <span className="text-sm text-muted-foreground">{format(dayDate, 'MMM d, yyyy')}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span className="font-bold text-sm">{dayTotal.toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground ml-1">hrs</span>
                  </TableCell>
                  <TableCell />
                </TableRow>

                {/* Employee Rows for this day */}
                {sortedEntries.map((entry, idx) => {
                  const isApproving = entry.dayPunches.some((p: any) => approvingPunchIds.has(p.id));
                  const hasAnyFlag = entry.hasAutoClockOut || entry.hasBreakViolation || entry.hasOpenShift || entry.hasManualEdit;
                  const rowBg = idx % 2 === 0 ? '' : 'bg-muted/10';
                  const breakStarts = entry.dayPunches.filter((p: any) => p.punch_type === 'break_start');

                  return (
                    <TableRow 
                      key={`${day}-${entry.profile.id}`}
                      className={`cursor-pointer hover:bg-muted/30 transition-colors ${hasAnyFlag ? 'bg-amber-50/50 dark:bg-amber-950/20' : rowBg}`}
                      onClick={() => onEditShift({ dayPunches: entry.dayPunches, userId: entry.profile.id, locationId: currentLocationId, shiftDate: day })}
                    >
                      {/* Employee */}
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={entry.profile.avatar_url} />
                            <AvatarFallback className="text-[10px]">{getDisplayName(entry.profile.full_name, entry.profile.nickname)?.[0] || 'U'}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate">{getDisplayName(entry.profile.full_name, entry.profile.nickname)}</span>
                        </div>
                      </TableCell>

                      {/* Scheduled */}
                      <TableCell className="py-1.5">
                        {entry.scheduledShift && !entry.scheduledShift.is_time_off ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-muted/50 font-normal">
                            {formatScheduledTime(entry.scheduledShift.start_time)} → {formatScheduledTime(entry.scheduledShift.end_time)}
                          </Badge>
                        ) : entry.scheduledShift?.is_time_off ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">PTO</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Actual Times */}
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          {entry.shifts.map((shift, shiftIdx) => (
                            <span key={shiftIdx} className="text-sm flex items-center gap-1">
                              {entry.shifts.length > 1 && <span className="text-[10px] text-muted-foreground">#{shiftIdx + 1}</span>}
                              <span className="text-green-600 font-medium">{shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-red-600 font-medium">{shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}</span>
                            </span>
                          ))}
                        </div>
                      </TableCell>

                      {/* Breaks */}
                      <TableCell className="py-1.5">
                        {breakStarts.length > 0 ? (
                          <div className="flex items-center gap-1 flex-wrap">
                            {breakStarts.map((breakStart: any, bidx: number) => {
                              let breakEnd = entry.dayPunches.find((p: any) => 
                                p.punch_type === 'break_end' && 
                                new Date(p.punch_time) > new Date(breakStart.punch_time)
                              );
                              if (!breakEnd) {
                                breakEnd = entry.dayPunches.find((p: any) => 
                                  p.punch_type === 'clock_in' && 
                                  new Date(p.punch_time) > new Date(breakStart.punch_time)
                                );
                              }
                              const scheduledDuration = breakStart.notes?.includes('30 minute') ? '30m' : '10m';
                              
                              let actualDurationMins = 0;
                              if (breakEnd) {
                                actualDurationMins = Math.round((new Date(breakEnd.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000);
                              }
                              
                              return (
                                <span key={bidx} className="text-xs text-muted-foreground flex items-center gap-0.5">
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
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Flags */}
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          {entry.hasBreakViolation && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 font-medium whitespace-nowrap">
                              No Break
                            </Badge>
                          )}
                          {entry.hasAutoClockOut && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 font-medium whitespace-nowrap">
                              Auto Out
                            </Badge>
                          )}
                          {entry.hasOpenShift && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-red-600 border-red-400 bg-red-50 dark:bg-red-950/30 font-medium whitespace-nowrap">
                              Open
                            </Badge>
                          )}
                          {entry.hasManualEdit && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-blue-600 border-blue-400 bg-blue-50 dark:bg-blue-950/30 font-medium whitespace-nowrap">
                              Edited{entry.editedByName ? ` by ${entry.editedByName}` : ''}
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      {/* Hours */}
                      <TableCell className="py-1.5 text-right">
                        <span className="font-medium text-sm">{(entry.dayHours || 0).toFixed(1)}</span>
                      </TableCell>

                      {/* Approve */}
                      <TableCell className="p-0" onClick={(e) => e.stopPropagation()}>
                        {entry.hasOpenShift ? (
                          <button 
                            className="h-full min-h-[40px] w-full px-3 flex items-center justify-center gap-1.5 bg-muted/30 border-l border-dashed border-muted-foreground/30 text-xs text-muted-foreground cursor-not-allowed"
                            disabled
                            title="Cannot approve open shift - add clock-out first"
                          >
                            —
                          </button>
                        ) : entry.isApproved ? (
                          <button 
                            className={`h-full min-h-[40px] w-full px-3 flex items-center justify-center gap-1.5 bg-green-100 dark:bg-green-900/30 border-l border-green-500 text-green-600 text-xs font-medium hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-all duration-150 active:scale-95 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                            onClick={() => onUnapproveDay(entry.dayPunches)}
                            disabled={isApproving}
                          >
                            Approved
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button 
                            className={`h-full min-h-[40px] w-full px-3 flex items-center justify-center gap-1.5 bg-muted/50 border-l border-border text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:border-primary hover:text-primary transition-all duration-150 active:scale-95 active:bg-green-100 active:border-green-500 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                            onClick={() => onApproveDay(entry.dayPunches)}
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
