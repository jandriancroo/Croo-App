import React from 'react';
import { Card } from '@/components/ui/card';
import { ChecklistCard } from '@/components/dashboard/ChecklistCard';
import { DashSectionTitle } from '@/components/dashboard/DashSectionTitle';

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
  /** Training assignment rows appended to the bottom of the same card */
  trainingRows?: React.ReactNode;
}

export const ChecklistsGrid = React.memo(function ChecklistsGrid({
  checklists,
  getCompletionData,
  timezone,
  trainingRows,
}: ChecklistsGridProps) {
  // Monthly checklists (e.g. deep cleaning) appear in the list when they're
  // close to their due date, but should NOT count toward the daily "remaining"
  // rollup — they're on their own cadence.
  const dailyChecklists = checklists.filter(cl => cl.frequency !== 'monthly');
  const remainingCount = dailyChecklists.filter(cl => {
    const { expected, completed } = getCompletionData(cl.id);
    return expected === 0 || completed < expected;
  }).length;

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
  const nowMinutes = nowH * 60 + nowM;
  const nowSeconds = nowH * 3600 + nowM * 60 + nowS;

  const formatLockTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  return (
    <div className="flex flex-col gap-1 w-full">
      <DashSectionTitle action={remainingCount === 0 ? 'All done ✓' : `${remainingCount} of ${dailyChecklists.length} remaining`}>
        Checklists
      </DashSectionTitle>
      <Card className="border-0 overflow-hidden p-0">
        <div className="divide-y divide-border/30">
          {checklists.map(checklist => {
            const { expected, completed } = getCompletionData(checklist.id);
            const completionRate = expected > 0 ? Math.min(100, Math.round(completed / expected * 100)) : 0;
            const isComplete = completionRate === 100;

            const isOverdue = !isComplete && !!checklist.due_by_time && (() => {
              const [dueH, dueM] = checklist.due_by_time!.split(':').map(Number);
              return nowMinutes > dueH * 60 + dueM;
            })();

            const isLocked = !!checklist.lock_until_time && (() => {
              const [lH, lM, lS] = checklist.lock_until_time!.split(':').map(Number);
              return nowSeconds < lH * 3600 + lM * 60 + (lS || 0);
            })();

            return (
              <ChecklistCard
                key={checklist.id}
                checklistId={checklist.id}
                title={checklist.title}
                completed={completed}
                expected={expected}
                isOverdue={isOverdue}
                isLocked={isLocked}
                lockUntilTime={isLocked && checklist.lock_until_time ? formatLockTime(checklist.lock_until_time) : undefined}
                variant="row"
              />
            );
          })}
          {trainingRows}
        </div>
      </Card>
    </div>
  );
});
