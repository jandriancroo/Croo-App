import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DashSectionTitle } from '@/components/dashboard/DashSectionTitle';
import { ChecklistStat } from '@/components/dashboard/ChecklistStat';

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
}

export const ChecklistsGrid = React.memo(function ChecklistsGrid({
  checklists,
  getCompletionData,
  timezone,
  trainingRows,
  trainingRemaining = 0,
  trainingTotal = 0,
}: ChecklistsGridProps) {
  const navigate = useNavigate();

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
  const nowSeconds = nowH * 3600 + nowM * 60 + nowS;

  const formatLockTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  return (
    <div className="flex flex-col gap-1 w-full">
      <DashSectionTitle
        action={remainingCount === 0 ? 'All done ✓' : `${remainingCount} of ${totalCount} remaining`}
      >
        Checklists
      </DashSectionTitle>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {checklists.map((checklist, idx) => {
          const { expected, completed } = getCompletionData(checklist.id);

          const isLocked = !!checklist.lock_until_time && (() => {
            const [lH, lM, lS] = checklist.lock_until_time!.split(':').map(Number);
            return nowSeconds < lH * 3600 + lM * 60 + (lS || 0);
          })();

          return (
            <div
              key={checklist.id}
              onClick={() => { if (!isLocked) navigate(`/complete/${checklist.id}`); }}
              className={cn(
                'flex items-center gap-3 px-[14px] py-[13px] transition-colors duration-150',
                idx > 0 && 'border-t border-border',
                isLocked ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40'
              )}
            >
              <span className="flex-1 text-[15px] font-medium tracking-[-0.01em] text-foreground truncate">
                {checklist.title}
              </span>
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
