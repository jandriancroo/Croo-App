import { formatInTimeZone } from 'date-fns-tz';
import { getDisplayName } from '@/utils/displayName';
import {
  formatTimeDisplay,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';
import {
  PunchGroupCard,
  PunchGroupHeader,
  PunchRow,
  type PunchBreakInfo,
  type PunchFlag,
} from './PunchApprovalRow';
import { findShiftStartClockIns } from '@/utils/payrollDayBucketing';
import { buildBreaksFromPunches } from '@/lib/timeTracking/punchBreaks';
import { chipsFor, type ShiftFlagRow } from '@/lib/timeTracking/shiftFlags';
import { TheoDayLine, useTheoDayInsights } from './TheoDayLine';

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
  getDayFlags: (dayPunches: any[]) => { hasAutoClockOut: boolean; hasBreakViolation: boolean; hasOpenShift: boolean; hasAnyFlag: boolean; flags: ShiftFlagRow[] };
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
    flagRows: ShiftFlagRow[];
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
      const shiftStarts = new Set(findShiftStartClockIns(dayPunches));
      
      sortedPunches.forEach((punch: any) => {
        if (punch.punch_type === 'clock_in') {
          if (shiftStarts.has(punch)) {
            if (currentShift) shifts.push(currentShift);
            currentShift = { clockIn: punch, clockOut: null, breaks: [] };
          }
        } else if (punch.punch_type === 'clock_out' && currentShift && !currentShift.clockOut) {
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
        flagRows: flags.flags,
        hasManualEdit,
        editedByName,
        scheduledShift,
      });
    });
  });

  // Sort days chronologically
  const sortedDays = Array.from(shiftsByDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  const { data: theo } = useTheoDayInsights(currentLocationId, sortedDays.map(([d]) => d));

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

  const buildBreaks = (dayPunches: any[]): PunchBreakInfo[] =>
    buildBreaksFromPunches(dayPunches).map((b) => ({
      scheduledLabel: 'Break',
      start: formatTimeDisplay(b.start, timezone),
      end: b.end ? formatTimeDisplay(b.end, timezone) : null,
      minutes: b.minutes,
      isLong: b.isLong,
    }));

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
        const scheduledHours = sortedEntries.reduce((sum, e) => {
          const s = e.scheduledShift;
          if (!s) return sum;
          const list = s.all ?? (s.is_time_off || s.is_phantom ? [] : [s]);
          return sum + list.reduce((acc: number, x: any) => {
            if (!x.start_time || !x.end_time) return acc;
            const [sh, sm] = String(x.start_time).split(':').map(Number);
            const [eh, em] = String(x.end_time).split(':').map(Number);
            let mins = eh * 60 + em - (sh * 60 + sm);
            if (mins < 0) mins += 24 * 60;
            return acc + mins / 60;
          }, 0);
        }, 0);

        return (
          <PunchGroupCard key={day}>
            <PunchGroupHeader
              title={formatInTimeZone(dayDate, timezone, 'EEEE')}
              shortTitle={formatInTimeZone(dayDate, timezone, 'EEE')}
              subtitle={formatInTimeZone(dayDate, timezone, 'MMM d, yyyy')}
              shortSubtitle={formatInTimeZone(dayDate, timezone, 'MMM d')}
              approvedCount={approvedCount}
              totalCount={sortedEntries.length}
              totalHours={dayTotal}
              scheduledHours={scheduledHours}
            />
            <TheoDayLine lines={theo?.[day]} />
            {sortedEntries.map((entry) => {
              const isApproving = entry.dayPunches.some((p: any) => approvingPunchIds.has(p.id));
              const flags: PunchFlag[] = chipsFor(entry.flagRows);
              if (entry.hasManualEdit) flags.push({ label: `Edited${entry.editedByName ? ` by ${entry.editedByName}` : ''}`, tone: 'info' });

              return (
                <PunchRow
                  key={`${day}-${entry.profile.id}`}
                  primary={getDisplayName(entry.profile.full_name, entry.profile.nickname)}
                  scheduledStart={entry.scheduledShift && !entry.scheduledShift.is_time_off && !entry.scheduledShift.is_phantom ? formatScheduledTime(entry.scheduledShift.start_time) : null}
                  scheduledEnd={entry.scheduledShift && !entry.scheduledShift.is_time_off && !entry.scheduledShift.is_phantom ? formatScheduledTime(entry.scheduledShift.end_time) : null}
                  scheduledExtra={(entry.scheduledShift?.all ?? []).slice(1).map((x: any) => ({ start: formatScheduledTime(x.start_time), end: formatScheduledTime(x.end_time) }))}
                  scheduledIsTimeOff={!!entry.scheduledShift?.is_time_off}
                  scheduledIsUnscheduled={!entry.scheduledShift || !!entry.scheduledShift?.is_phantom}
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
