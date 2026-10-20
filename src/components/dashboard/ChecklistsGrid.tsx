import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Clock, Lock, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DashSectionTitle } from '@/components/dashboard/DashSectionTitle';
import { ChecklistStat } from '@/components/dashboard/ChecklistStat';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { NudgeBadge } from '@/components/dashboard/NudgeBadge';

interface ChecklistItem {
  id: string;
  title: string;
  due_by_time: string | null;
  lock_until_time: string | null;
  frequency?: string;
}

interface ChecklistsGridProps {
  checklists: ChecklistItem[];
  getCompletionData: (id: string) => { expected: number; completed: number };
  timezone: string;
  /** Training group (header + trainee rows) appended inside the same card */
  trainingRows?: React.ReactNode;
  /** Incomplete trainee rows — added to the header's remaining count */
  trainingRemaining?: number;
  /** Total trainee rows — added to the header's total */
  trainingTotal?: number;
  /** Managers and up: show the nudge badge on unfinished, open rows */
  canNudge?: boolean;
  onNudge?: (checklist: { id: string; title: string }) => void;
  /** 'checklist:<id>' -> minutes since the last nudge at this store (last hour only) */
  recentlyNudged?: Record<string, number>;
}

export const ChecklistsGrid = React.memo(function ChecklistsGrid({
  checklists,
  getCompletionData,
  timezone,
  trainingRows,
  trainingRemaining = 0,
  trainingTotal = 0,
  canNudge = false,
  onNudge,
  recentlyNudged,
}: ChecklistsGridProps) {
  const navigate = useNavigate();
  const { getBusinessDateInTimezone } = useLocationTimezone();

  // Monthly checklists (e.g. deep cleaning) appear in the list when they're
  // close to their due date, but should NOT count toward the daily "remaining"
  // rollup — they're on their own cadence.
  const dailyChecklists = checklists.filter(cl => cl.frequency !== 'monthly');
  // Remaining = incomplete tappable rows. Zero-item lists don't count.
  const countableChecklists = dailyChecklists.filter(cl => getCompletionData(cl.id).expected > 0);
  const remainingCount =
    countableChecklists.filter(cl => {
      const { expected, completed } = getCompletionData(cl.id);
      return completed < expected;
    }).length + trainingRemaining;
  const totalCount = countableChecklists.length + trainingTotal;
  const completedCount = totalCount - remainingCount;


  // Compute current time in location timezone ONCE for all rows
  const now = new Date();
  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);
  const nowH = Number(timeParts.find(p => p.type === 'hour')?.value ?? '0');
  const nowM = Number(timeParts.find(p => p.type === 'minute')?.value ?? '0');
  const nowS = Number(timeParts.find(p => p.type === 'second')?.value ?? '0');
  // Locks/overdue must follow the same business day as the progress numbers.
  // In the after-midnight carry-over (business date still = yesterday), treat
  // the clock as 24h+ so yesterday's lists aren't shown as "locked until" today.
  const calendarDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  const inCarryOver = getBusinessDateInTimezone() !== calendarDate;
  const nowSeconds = nowH * 3600 + nowM * 60 + nowS + (inCarryOver ? 86400 : 0);

  const formatLockTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  // One green (complete), one red (overdue), teal while in progress.
  // Overdue lists show a clock inside the red ring instead of the pie.
  const renderPieGlyph = (isLocked: boolean, completed: number, expected: number, isOverdue: boolean) => {
    // a. Locked — muted circle with a lock
    if (isLocked) {
      return (
        <div aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      );
    }

    // b. Complete — solid green circle with a check
    if (expected > 0 && completed >= expected) {
      return (
        <div aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success">
          <Check className="h-4 w-4 text-white" strokeWidth={3} />
        </div>
      );
    }

    // c. Overdue — thick red arc filled to the % over a gray track, clock inside
    if (isOverdue) {
      const pct = Math.min(100, (completed / expected) * 100);
      const r = 11;
      const c = 2 * Math.PI * r;
      return (
        <div aria-hidden className="relative h-7 w-7 shrink-0">
          <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90">
            <circle cx="14" cy="14" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
            <circle
              cx="14" cy="14" r={r} fill="none"
              stroke="hsl(var(--destructive))" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c - (pct / 100) * c}
            />
          </svg>
          <Clock className="absolute inset-0 m-auto h-3 w-3 text-destructive" strokeWidth={2.5} />
        </div>
      );
    }

    // d. Not started / no items — empty ring
    if (completed === 0 || expected === 0) {
      return <div aria-hidden className="h-7 w-7 shrink-0 rounded-full border-2 border-border" />;
    }

    // e. In progress — teal pie wedge inside a ring (2px ring, 3px gap, r=9 wedge)
    const pct = Math.min(100, (completed / expected) * 100);
    const wedge = (pct / 100) * 2 * Math.PI * 4.5;
    return (
      <svg
        aria-hidden
        width="28"
        height="28"
        viewBox="0 0 28 28"
        className="shrink-0 text-primary"
      >
        <circle cx="14" cy="14" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle
          cx="14"
          cy="14"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          strokeDasharray={`${wedge} ${2 * Math.PI * 4.5}`}
          transform="rotate(-90 14 14)"
        />
      </svg>
    );
  };



  return (
    <div className="flex flex-col gap-1 w-full">
      <DashSectionTitle
        className="mb-2"
        action={
          totalCount === 0
            ? undefined
            : completedCount === totalCount
              ? 'All done ✓'
              : `${completedCount} of ${totalCount} completed`
        }
      >
        Checklists
      </DashSectionTitle>


      <div className="bg-card border border-border rounded-xl overflow-visible">
        {checklists.map((checklist, idx) => {
          const { expected, completed } = getCompletionData(checklist.id);

          const isLocked = !!checklist.lock_until_time && (() => {
            const [lH, lM, lS] = checklist.lock_until_time!.split(':').map(Number);
            return nowSeconds < lH * 3600 + lM * 60 + (lS || 0);
          })();

          const isOverdue = !isLocked && expected > 0 && completed < expected && !!checklist.due_by_time && (() => {
            const [dH, dM, dS] = checklist.due_by_time!.split(':').map(Number);
            return nowSeconds > dH * 3600 + dM * 60 + (dS || 0);
          })();

          const showNudge = canNudge && !!onNudge && !isLocked && expected > 0 && completed < expected;
          const nudgedAgo = recentlyNudged?.[`checklist:${checklist.id}`];
          const cooling = nudgedAgo != null;

          return (
            <div
              key={checklist.id}
              onClick={() => { if (!isLocked) navigate(`/complete/${checklist.id}`); }}
              className={cn(
                'relative flex items-center gap-3 px-[14px] py-[11px] transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl',
                idx > 0 && 'border-t border-border',
                isLocked ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40'
              )}
            >
              {showNudge && (
                <NudgeBadge
                  onClick={() => onNudge!({ id: checklist.id, title: checklist.title })}
                  minutesAgo={nudgedAgo}
                  style={{ top: -20, right: -1 }}
                />
              )}

              {renderPieGlyph(isLocked, completed, expected, isOverdue)}

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="min-w-0 truncate text-[15px] font-medium tracking-[-0.01em] text-foreground">
                    {checklist.title}
                  </span>
                  {showNudge && cooling && (
                    <span className="text-[11px] text-muted-foreground">Nudged {nudgedAgo}m ago</span>
                  )}
                </div>
              </div>

              <ChecklistStat
                completed={completed}
                total={expected}
                countOverride={
                  isLocked && checklist.lock_until_time
                    ? `Locked until ${formatLockTime(checklist.lock_until_time)}`
                    : undefined
                }
              />
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          );
        })}

        {trainingRows}
      </div>
    </div>
  );
});
