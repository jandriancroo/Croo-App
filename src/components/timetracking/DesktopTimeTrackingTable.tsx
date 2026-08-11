import { formatInTimeZone } from 'date-fns-tz';
import { getDisplayName } from '@/utils/displayName';

import {
  formatTimeDisplay,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';
import {
  PunchGroupCard,
  PunchGroupHeader,
  PunchColumnHeaders,
  PunchWeekBand,
  PunchRow,
  type PunchBreakInfo,
  type PunchFlag,
} from './PunchApprovalRow';

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

  // Format scheduled time for display (e.g., "09:00" -> "9:00 AM")
  const formatScheduledTime = (time: string | null | undefined) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const buildBreaks = (dayPunches: any[]): PunchBreakInfo[] => {
    const breakStarts = dayPunches.filter((p: any) => p.punch_type === 'break_start');
    return breakStarts.map((breakStart: any) => {
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
      const scheduledLabel = breakStart.notes?.includes('30 minute') ? '30m' : '10m';
      let minutes = 0;
      if (breakEnd) {
        minutes = Math.round((new Date(breakEnd.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000);
      }
      return {
        scheduledLabel,
        start: formatTimeDisplay(breakStart.punch_time, timezone),
        end: breakEnd ? formatTimeDisplay(breakEnd.punch_time, timezone) : null,
        minutes,
        isLong: !!breakEnd && minutes > 35,
      };
    });
  };

  return (
    <div className="space-y-4">
      {employeeData.map(({ card, weeks }) => {
        const allDays = weeks.flatMap((w) => w.days);
        const approvedCount = allDays.filter(({ dayPunches }) => dayPunches.every((p: any) => p.approved_at)).length;

        return (
          <PunchGroupCard key={card.profile.id}>
            <PunchGroupHeader
              title={getDisplayName(card.profile.full_name, card.profile.nickname)}
              approvedCount={approvedCount}
              totalCount={allDays.length}
              totalHours={card.totalHours || 0}
            />
            <PunchColumnHeaders firstLabel="Date" />
            {weeks.map((week) => (
              <div key={`${card.profile.id}-${week.weekKey}`}>
                <PunchWeekBand
                  label={`Week of ${formatInTimeZone(week.weekStart, timezone, 'MMM d')} – ${formatInTimeZone(week.weekEnd, timezone, 'MMM d')}`}
                  hours={week.weekTotalHours}
                  approvedCount={week.days.filter(({ dayPunches }) => dayPunches.every((p: any) => p.approved_at)).length}
                  totalCount={week.days.length}
                />
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

                  const dayDate = parseDateStringInTimezone(day, timezone);
                  const dayHours = calculateDayHours(dayPunches) || 0;
                  const isApproved = dayPunches.every((p: any) => p.approved_at);
                  const scheduledShift = card.shiftsByDate?.get(day);

                  const dayFlags = getDayFlags(dayPunches);
                  const isApproving = dayPunches.some((p: any) => approvingPunchIds.has(p.id));

                  const flags: PunchFlag[] = [];
                  if (dayFlags.hasBreakViolation) flags.push({ label: 'No Break', tone: 'warning' });
                  if (dayFlags.hasAutoClockOut) flags.push({ label: 'Auto Out', tone: 'warning' });
                  if (dayFlags.hasOpenShift) flags.push({ label: 'Open', tone: 'danger' });

                  return (
                    <PunchRow
                      key={`${card.profile.id}-${day}`}
                      primary={formatInTimeZone(dayDate, timezone, 'EEE')}
                      secondary={formatInTimeZone(dayDate, timezone, 'M/d')}
                      scheduledStart={scheduledShift && !scheduledShift.is_time_off ? formatScheduledTime(scheduledShift.start_time) : null}
                      scheduledEnd={scheduledShift && !scheduledShift.is_time_off ? formatScheduledTime(scheduledShift.end_time) : null}
                      scheduledIsTimeOff={!!scheduledShift?.is_time_off}
                      shifts={shifts.map((s) => ({
                        clockIn: s.clockIn ? formatTimeDisplay(s.clockIn.punch_time, timezone) : null,
                        clockOut: s.clockOut ? formatTimeDisplay(s.clockOut.punch_time, timezone) : null,
                      }))}
                      breaks={buildBreaks(dayPunches)}
                      flags={flags}
                      hours={dayHours}
                      state={dayFlags.hasOpenShift ? 'open' : isApproved ? 'approved' : 'pending'}
                      isApproving={isApproving}
                      onRowClick={() => onEditShift({ dayPunches, userId: card.profile.id, locationId: currentLocationId, shiftDate: day })}
                      onApprove={() => onApproveDay(dayPunches)}
                      onUnapprove={() => onUnapproveDay(dayPunches)}
                    />
                  );
                })}
              </div>
            ))}
          </PunchGroupCard>
        );
      })}
    </div>
  );
}
