import React from 'react';
import { Card } from '@/components/ui/card';
import { ChecklistCard } from '@/components/dashboard/ChecklistCard';

interface ChecklistItem {
  id: string;
  title: string;
  due_by_time: string | null;
  lock_until_time: string | null;
}

interface ChecklistsGridProps {
  checklists: ChecklistItem[];
  getCompletionData: (id: string) => { expected: number; completed: number };
  timezone: string;
}

export const ChecklistsGrid = React.memo(function ChecklistsGrid({
  checklists,
  getCompletionData,
  timezone,
}: ChecklistsGridProps) {
  const remainingCount = checklists.filter(cl => {
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
    <Card className="border-0 overflow-hidden p-0">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight">Checklists</h3>
        <span className="text-xs text-muted-foreground">
          {remainingCount === 0 ? 'All done ✓' : `${remainingCount} of ${checklists.length} remaining`}
        </span>
      </div>
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
      </div>
    </Card>
  );
});
