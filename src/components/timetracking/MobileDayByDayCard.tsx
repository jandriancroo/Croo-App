import { formatInTimeZone } from 'date-fns-tz';
import { CheckCircle2, Coffee } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { getDisplayName } from '@/utils/displayName';
import {
  formatTimeDisplay,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';

interface MobileDayByDayCardProps {
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
  getDayFlags: (dayPunches: any[]) => { hasAutoClockOut: boolean; hasBreakViolation: boolean; hasOpenShift: boolean; hasAnyFlag: boolean };
}

export function MobileDayByDayCard({
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
  getDayFlags,
}: MobileDayByDayCardProps) {
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
    <div className="space-y-4">
      {sortedDays.map(([day, entries]) => {
        const dayDate = parseDateStringInTimezone(day, timezone);
        const dayTotal = getDayTotalHours(entries);
        
        // Sort entries by clock-in time
        const sortedEntries = [...entries].sort((a, b) => {
          const aTime = a.shifts[0]?.clockIn?.punch_time || '';
          const bTime = b.shifts[0]?.clockIn?.punch_time || '';
          return aTime.localeCompare(bTime);
        });

        return (
          <div key={day} className="space-y-2">
            {/* Day Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-primary/10 dark:bg-primary/20 rounded-lg border border-primary/30">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{format(dayDate, 'EEE')}</span>
                <span className="text-sm text-muted-foreground">{format(dayDate, 'MMM d')}</span>
              </div>
              <div>
                <span className="font-bold text-sm">{dayTotal.toFixed(1)}</span>
                <span className="text-xs text-muted-foreground ml-1">hrs</span>
              </div>
            </div>

            {/* Employee Cards for this day */}
            {sortedEntries.map((entry) => {
              const isApproving = entry.dayPunches.some((p: any) => approvingPunchIds.has(p.id));
              const hasAnyFlag = entry.hasAutoClockOut || entry.hasBreakViolation || entry.hasOpenShift || entry.hasManualEdit;
              const breakStarts = entry.dayPunches.filter((p: any) => p.punch_type === 'break_start');

              return (
                <Card 
                  key={`${day}-${entry.profile.id}`}
                  className={`cursor-pointer transition-colors ${hasAnyFlag ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' : ''}`}
                  onClick={() => onEditShift({ dayPunches: entry.dayPunches, userId: entry.profile.id, locationId: currentLocationId, shiftDate: day })}
                >
                  <CardContent className="p-3 space-y-2">
                    {/* Row 1: Employee + Hours + Approve */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Avatar className="h-7 w-7 flex-shrink-0">
                          <AvatarImage src={entry.profile.avatar_url} />
                          <AvatarFallback className="text-[10px]">{getDisplayName(entry.profile.full_name, entry.profile.nickname)?.[0] || 'U'}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">{getDisplayName(entry.profile.full_name, entry.profile.nickname)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{(entry.dayHours || 0).toFixed(1)}h</span>
                        <div onClick={(e) => e.stopPropagation()}>
                          {entry.hasOpenShift ? (
                            <button 
                              className="h-10 w-10 rounded-lg flex items-center justify-center bg-muted/30 border border-dashed border-muted-foreground/30 cursor-not-allowed"
                              disabled
                              title="Cannot approve open shift"
                            >
                              <span className="text-muted-foreground text-xs">—</span>
                            </button>
                          ) : entry.isApproved ? (
                            <button 
                              className={`h-10 w-10 rounded-lg flex items-center justify-center bg-green-100 dark:bg-green-900/30 border border-green-500 text-green-600 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-all duration-150 active:scale-95 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                              onClick={() => onUnapproveDay(entry.dayPunches)}
                              disabled={isApproving}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button 
                              className={`h-10 w-10 rounded-lg flex items-center justify-center bg-muted/50 border border-border hover:bg-primary/10 hover:border-primary transition-all duration-150 active:scale-95 active:bg-green-100 active:border-green-500 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                              onClick={() => onApproveDay(entry.dayPunches)}
                              disabled={isApproving}
                            >
                              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Scheduled */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground w-20">Scheduled</span>
                      <div className="flex-1 text-right">
                        {entry.scheduledShift && !entry.scheduledShift.is_time_off ? (
                          <span className="text-foreground">
                            {formatScheduledTime(entry.scheduledShift.start_time)} → {formatScheduledTime(entry.scheduledShift.end_time)}
                          </span>
                        ) : entry.scheduledShift?.is_time_off ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">PTO</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>

                    {/* Row 3: Actual */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground w-20">Actual</span>
                      <div className="flex-1 text-right">
                        {entry.shifts.map((shift, shiftIdx) => (
                          <div key={shiftIdx} className="flex items-center justify-end gap-1">
                            {entry.shifts.length > 1 && <span className="text-[10px] text-muted-foreground">#{shiftIdx + 1}</span>}
                            <span className="text-green-600 font-medium">{shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-red-600 font-medium">{shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Row 4: Breaks (stacked) */}
                    {breakStarts.length > 0 && (
                      <div className="flex items-start justify-between text-xs">
                        <span className="text-muted-foreground w-20">Breaks</span>
                        <div className="flex-1 space-y-0.5">
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
                              <div key={bidx} className="flex items-center justify-end gap-1 text-muted-foreground">
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
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Row 5: Flags */}
                    {hasAnyFlag && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground w-20">Flags</span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {entry.hasBreakViolation && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-400 bg-amber-50 dark:bg-amber-950/30 font-medium">
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
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
