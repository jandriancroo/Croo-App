import { format } from 'date-fns';
import { CheckCircle2, Coffee, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getDisplayName } from '@/utils/displayName';
import {
  formatTimeDisplay,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';

interface MobileTimeTrackingCardProps {
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

export function MobileTimeTrackingCard({
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
}: MobileTimeTrackingCardProps) {
  
  const formatScheduledTime = (time: string | null | undefined) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  return (
    <div className="space-y-4">
      {filteredCards.map((card) => {
        const weekGroups = groupPunchesByWeek(card.punchesByDay);
        
        return (
          <Card key={card.profile.id} className="overflow-hidden">
            {/* Employee Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-primary/10 dark:bg-primary/20 border-b border-primary/30">
              <span className="font-bold text-base">{getDisplayName(card.profile.full_name, card.profile.nickname)}</span>
              <div className="text-right">
                <span className="font-bold text-lg">{(card.totalHours || 0).toFixed(1)}</span>
                <span className="text-muted-foreground text-sm ml-1">hrs</span>
              </div>
            </div>

            <CardContent className="p-0">
              {weekGroups.map(([weekKey, weekData]) => {
                const weekTotalHours = Object.values(weekData.days).reduce((sum: number, dayPunches: any) => {
                  return sum + (calculateDayHours(dayPunches) || 0);
                }, 0);
                
                return (
                  <div key={weekKey}>
                    {/* Week Header */}
                    <div className="px-4 py-2 bg-muted/50 border-b text-xs font-medium text-muted-foreground flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        Week of {format(weekData.start, 'MMM d')} - {format(weekData.end, 'MMM d')}
                      </div>
                      <div className="font-semibold text-foreground">
                        {weekTotalHours.toFixed(1)} hrs
                      </div>
                    </div>
                    
                    {/* Day Entries */}
                    <div className="divide-y">
                      {Object.entries(weekData.days)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([day, dayPunches]: [string, any]) => {
                          const sortedPunches = sortPunches(dayPunches);
                          
                          // Identify shifts
                          const shifts: { clockIn: any; clockOut: any | null; breaks: any[] }[] = [];
                          let currentShift: { clockIn: any; clockOut: any | null; breaks: any[] } | null = null;
                          
                          sortedPunches.forEach((punch: any, idx: number) => {
                            if (punch.punch_type === 'clock_in') {
                              const prevPunch = idx > 0 ? sortedPunches[idx - 1] : null;
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
                          const flags = getDayFlags(dayPunches);
                          const hasAnyFlag = flags.hasAnyFlag;
                          const hasAutoClockOut = flags.hasAutoClockOut;
                          const hasBreakViolation = flags.hasBreakViolation;
                          const hasOpenShift = flags.hasOpenShift;
                          const scheduledShift = card.shiftsByDate?.get(day);
                          const isApproving = dayPunches.some((p: any) => approvingPunchIds.has(p.id));

                          if (!includeApproved && isApproved) return null;

                          return (
                            <div 
                              key={day} 
                              className={`px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors ${hasAnyFlag ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
                              onClick={() => onEditShift({ dayPunches, userId: card.profile.id, locationId: currentLocationId, shiftDate: day })}
                            >
                              {/* Row 1: Day + Hours + Approve */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-sm">{format(dayDate, 'EEE')}</span>
                                  <span className="text-sm text-muted-foreground">{format(dayDate, 'MMM d')}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-sm">{dayHours.toFixed(1)} hrs</span>
                                  <div onClick={(e) => e.stopPropagation()}>
                                    {hasOpenShift ? (
                                      <button 
                                        className="h-10 w-10 rounded-lg flex items-center justify-center bg-muted/30 border border-dashed border-muted-foreground/30 cursor-not-allowed"
                                        disabled
                                        title="Cannot approve open shift"
                                      >
                                        <span className="text-muted-foreground text-xs">—</span>
                                      </button>
                                    ) : isApproved ? (
                                      <button 
                                        className={`h-10 w-10 rounded-lg flex items-center justify-center bg-green-100 dark:bg-green-900/30 border border-green-500 text-green-600 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-all duration-150 active:scale-95 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                                        onClick={() => onUnapproveDay(dayPunches)}
                                        disabled={isApproving}
                                      >
                                        <CheckCircle2 className="h-4 w-4" />
                                      </button>
                                    ) : (
                                      <button 
                                        className={`h-10 w-10 rounded-lg flex items-center justify-center bg-muted/50 border border-border hover:bg-primary/10 hover:border-primary transition-all duration-150 active:scale-95 active:bg-green-100 active:border-green-500 ${isApproving ? 'opacity-50 pointer-events-none animate-pulse' : ''}`}
                                        onClick={() => onApproveDay(dayPunches)}
                                        disabled={isApproving}
                                      >
                                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Row 2: Scheduled */}
                              <div className="flex items-start gap-3 mb-1.5">
                                <span className="text-xs text-muted-foreground w-16 shrink-0">Scheduled</span>
                                <span className="text-sm">
                                  {scheduledShift && !scheduledShift.is_time_off ? (
                                    <span>{formatScheduledTime(scheduledShift.start_time)} → {formatScheduledTime(scheduledShift.end_time)}</span>
                                  ) : scheduledShift?.is_time_off ? (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">PTO</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </span>
                              </div>

                              {/* Row 3: Actual */}
                              <div className="flex items-start gap-3 mb-1.5">
                                <span className="text-xs text-muted-foreground w-16 shrink-0">Actual</span>
                                <div className="flex flex-col gap-0.5">
                                  {shifts.map((shift, shiftIdx) => (
                                    <span key={shiftIdx} className="text-sm flex items-center gap-1">
                                      {shifts.length > 1 && <span className="text-[10px] text-muted-foreground">#{shiftIdx + 1}</span>}
                                      <span className="text-green-600 font-medium">{shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}</span>
                                      <span className="text-muted-foreground">→</span>
                                      <span className="text-red-600 font-medium">{shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {/* Row 4: Breaks */}
                              <div className="flex items-start gap-3 mb-1.5">
                                <span className="text-xs text-muted-foreground w-16 shrink-0">Breaks</span>
                                <div className="flex flex-col gap-0.5">
                                  {breakStarts.length > 0 ? breakStarts.map((breakStart: any, bidx: number) => {
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
                                    
                                    let actualDurationMins = 0;
                                    let isLongBreak = false;
                                    if (breakEnd) {
                                      actualDurationMins = Math.round((new Date(breakEnd.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000);
                                      isLongBreak = actualDurationMins > 35;
                                    }
                                    
                                    return (
                                      <span 
                                        key={bidx} 
                                        className={`text-sm flex items-center gap-1 ${isLongBreak ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}
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
                                  }) : (
                                    <span className="text-sm text-muted-foreground">—</span>
                                  )}
                                </div>
                              </div>

                              {/* Row 5: Flags */}
                              {hasAnyFlag && (
                                <div className="flex items-start gap-3">
                                  <span className="text-xs text-muted-foreground w-16 shrink-0">Flags</span>
                                  <div className="flex items-center gap-1.5 flex-wrap">
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
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
