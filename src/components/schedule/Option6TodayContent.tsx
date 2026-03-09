import { Circle, UserPlus, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MobileShiftCard } from './MobileShiftCard';
import { AssignedTemporaryTasks } from '@/components/dashboard/AssignedTemporaryTasks';
import { getDisplayName } from '@/utils/displayName';
import { useState } from 'react';
import { useState } from 'react';

interface Profile {
  id: string;
  full_name: string;
  nickname?: string | null;
  profile_photo_url: string | null;
}

interface Event {
  id: string;
  event_name: string;
  event_time: string;
  notes: string | null;
  category?: {
    name: string;
    color: string;
  } | null;
}

interface DayPunch {
  id: string;
  user_id: string;
  clockInTime: string;
  clockOutTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  isActive: boolean;
  isOnBreak: boolean;
  profile: Profile;
  hoursWorked: number;
  createdByName: string | null;
  scheduledShift?: {
    id: string;
    start_time: string;
    end_time: string;
    day_of_week: number;
    shift_date: string;
  } | null;
}

interface Option6TodayContentProps {
  dayPunches: DayPunch[];
  loadingActive: boolean;
  timezone: string;
  todayEvents: Event[];
  formatTimeDisplay: (time: string, tz: string) => string;
  onQuickPunchOpen: () => void;
  onPunchClick: (punch: DayPunch) => void;
  onEventClick?: (event: Event) => void;
}

export function Option6TodayContent({
  dayPunches,
  loadingActive,
  timezone,
  todayEvents,
  formatTimeDisplay: formatTimeFn,
  onQuickPunchOpen,
  onPunchClick,
  onEventClick,
}: Option6TodayContentProps) {
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  const activePunches = dayPunches.filter(p => p.isActive && !p.isOnBreak);
  const onBreakPunches = dayPunches.filter(p => p.isOnBreak);
  const completedPunches = dayPunches.filter(p => !p.isActive);
  const totalScheduled = dayPunches.length;

  // Compute total hours worked today
  const totalHoursWorked = dayPunches.reduce((sum, p) => sum + p.hoursWorked, 0);

  return (
    <div className="space-y-3">
      {/* Date header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
        </h3>
      </div>

      {/* Events & Tasks section */}
      <div className="space-y-1">
        {/* Quick Tasks (includes events, catering, user tasks — unified row style) */}
        <AssignedTemporaryTasks showCompleted={true} includeCateringOrders={true} includeEventTasks={true} compact={true} />
      </div>

      {/* Now section — active punches */}
      {(activePunches.length > 0 || onBreakPunches.length > 0) && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
            <Circle className="h-2 w-2 fill-green-500 text-green-500" />
            <span className="text-green-600">Now</span>
            <span className="text-muted-foreground mx-0.5">·</span>
            <span className="text-green-600">{activePunches.length} Active</span>
            {onBreakPunches.length > 0 && (
              <>
                <span className="text-muted-foreground mx-0.5">·</span>
                <span className="text-amber-600">{onBreakPunches.length} Break</span>
              </>
            )}
            <span className="text-muted-foreground mx-0.5">·</span>
            <span className="text-muted-foreground">{totalScheduled} Total</span>
            <div className="ml-auto">
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onQuickPunchOpen}>
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </h4>
          {[...activePunches, ...onBreakPunches].map(punch => (
            <MobileShiftCard
              key={punch.id}
              name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
              avatarUrl={punch.profile.profile_photo_url}
              startTime={punch.scheduledShift?.start_time || '00:00'}
              endTime={punch.scheduledShift?.end_time || '00:00'}
              statusIndicator={punch.isOnBreak ? 'break' : 'active'}
              scheduledStart={punch.scheduledShift?.start_time}
              scheduledEnd={punch.scheduledShift?.end_time}
              clockInTime={punch.clockInTime}
              clockOutTime={punch.clockOutTime}
              breakStartTime={punch.breakStartTime}
              breakEndTime={punch.breakEndTime}
              hoursWorked={punch.hoursWorked}
              createdByName={punch.createdByName}
              timezone={timezone}
              formatTimeDisplay={formatTimeFn}
              showBreakIndicator={false}
              onClick={() => onPunchClick(punch)}
            />
          ))}
        </div>
      )}

      {/* Later / Completed section */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          {completedPunches.length > 0 ? `Completed (${completedPunches.length})` : 'Later'}
          <div className="flex items-center gap-1 ml-auto">
            {(activePunches.length === 0 && onBreakPunches.length === 0) && (
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onQuickPunchOpen}>
                <UserPlus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </h4>
        
        {loadingActive ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : completedPunches.length === 0 && activePunches.length === 0 && onBreakPunches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Circle className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No punches recorded today</p>
          </div>
        ) : (
          completedPunches.map(punch => (
            <MobileShiftCard
              key={punch.id}
              name={getDisplayName(punch.profile.full_name, punch.profile.nickname)}
              avatarUrl={punch.profile.profile_photo_url}
              startTime={punch.scheduledShift?.start_time || '00:00'}
              endTime={punch.scheduledShift?.end_time || '00:00'}
              statusIndicator="none"
              scheduledStart={punch.scheduledShift?.start_time}
              scheduledEnd={punch.scheduledShift?.end_time}
              clockInTime={punch.clockInTime}
              clockOutTime={punch.clockOutTime}
              breakStartTime={punch.breakStartTime}
              breakEndTime={punch.breakEndTime}
              hoursWorked={punch.hoursWorked}
              createdByName={punch.createdByName}
              timezone={timezone}
              formatTimeDisplay={formatTimeFn}
              showBreakIndicator={false}
              onClick={() => onPunchClick(punch)}
            />
          ))
        )}
      </div>

      {/* Day Insights — bottom of page */}
      <Card className="overflow-hidden p-0">
        <button
          onClick={() => setInsightsExpanded(!insightsExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 text-xs font-medium"
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Day Insights
          </span>
          <span className="text-muted-foreground">{insightsExpanded ? '▲' : '▼'}</span>
        </button>
        {insightsExpanded && (
          <div className="px-3 py-2.5 border-t border-border/30">
            <div className="flex items-center justify-between text-center">
              <div>
                <span className="text-base font-bold">{totalHoursWorked.toFixed(1)}h</span>
                <p className="text-[10px] text-muted-foreground">Hours</p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div>
                <span className="text-base font-bold">{totalScheduled}</span>
                <p className="text-[10px] text-muted-foreground">Punched</p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div>
                <span className="text-base font-bold text-green-600">{activePunches.length}</span>
                <p className="text-[10px] text-muted-foreground">Active</p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div>
                <span className="text-base font-bold text-amber-600">{onBreakPunches.length}</span>
                <p className="text-[10px] text-muted-foreground">On Break</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
