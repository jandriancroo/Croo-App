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
  PunchRow,
  type PunchBreakInfo,
  type PunchFlag,
} from './PunchApprovalRow';

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
  periodDates?: { value: string; label: string }[];
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
      {sortedDays.map(([day, entries]) => {
        const dayDate = parseDateStringInTimezone(day, timezone);
        const dayTotal = getDayTotalHours(entries);

        // Sort entries by clock-in time
        const sortedEntries = [...entries].sort((a, b) => {
          const aTime = a.shifts[0]?.clockIn?.punch_time || '';
          const bTime = b.shifts[0]?.clockIn?.punch_time || '';
          return aTime.localeCompare(bTime);
        });

        const approvedCount = sortedEntries.filter((e) => e.isApproved).length;

        return (
          <PunchGroupCard key={day}>
            <PunchGroupHeader
              title={formatInTimeZone(dayDate, timezone, 'EEEE')}
              subtitle={formatInTimeZone(dayDate, timezone, 'MMM d, yyyy')}
              approvedCount={approvedCount}
              totalCount={sortedEntries.length}
              totalHours={dayTotal}
            />
            <PunchColumnHeaders firstLabel="Employee" />
            {sortedEntries.map((entry) => {
              const isApproving = entry.dayPunches.some((p: any) => approvingPunchIds.has(p.id));
              const flags: PunchFlag[] = [];
              if (entry.hasBreakViolation) flags.push({ label: 'No Break', tone: 'warning' });
              if (entry.hasAutoClockOut) flags.push({ label: 'Auto Out', tone: 'warning' });
              if (entry.hasOpenShift) flags.push({ label: 'Open', tone: 'danger' });
              if (entry.hasManualEdit) flags.push({ label: `Edited${entry.editedByName ? ` by ${entry.editedByName}` : ''}`, tone: 'info' });

              return (
                <PunchRow
                  key={`${day}-${entry.profile.id}`}
                  primary={getDisplayName(entry.profile.full_name, entry.profile.nickname)}
                  scheduledStart={entry.scheduledShift && !entry.scheduledShift.is_time_off ? formatScheduledTime(entry.scheduledShift.start_time) : null}
                  scheduledEnd={entry.scheduledShift && !entry.scheduledShift.is_time_off ? formatScheduledTime(entry.scheduledShift.end_time) : null}
                  scheduledIsTimeOff={!!entry.scheduledShift?.is_time_off}
                  shifts={entry.shifts.map((s) => ({
                    clockIn: s.clockIn ? formatTimeDisplay(s.clockIn.punch_time, timezone) : null,
                    clockOut: s.clockOut ? formatTimeDisplay(s.clockOut.punch_time, timezone) : null,
                  }))}
                  breaks={buildBreaks(entry.dayPunches)}
                  flags={flags}
                  hours={entry.dayHours || 0}
                  state={entry.hasOpenShift ? 'open' : entry.isApproved ? 'approved' : 'pending'}
                  isApproving={isApproving}
                  onRowClick={() => onEditShift({ dayPunches: entry.dayPunches, userId: entry.profile.id, locationId: currentLocationId, shiftDate: day })}
                  onApprove={() => onApproveDay(entry.dayPunches)}
                  onUnapprove={() => onUnapproveDay(entry.dayPunches)}
                />
              );
            })}
          </PunchGroupCard>
        );
      })}
    </div>
  );
}
