import React from 'react';
import { cn } from '@/lib/utils';

interface ChecklistStatProps {
  completed: number;
  total: number;
  /** Overrides the count line (e.g. "Locked until 6:00 AM") */
  countOverride?: string;
}

/**
 * Shared right-hand stat block used by both checklist rows and trainee rows,
 * so the percent column lines up straight down the dashboard card.
 * Text only — no progress bars, no rings (deliberate).
 */
export const ChecklistStat = React.memo(function ChecklistStat({
  completed,
  total,
  countOverride,
}: ChecklistStatProps) {
  const hasItems = total > 0;
  const percent = hasItems ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const isComplete = hasItems && completed >= total;

  return (
    <div className="text-right min-w-[52px] shrink-0">
      {hasItems && (
        <div
          className={cn(
            'text-[13px] font-medium leading-[1.3]',
            isComplete ? 'text-emerald-600 dark:text-emerald-500' : 'text-foreground'
          )}
        >
          {percent}%
        </div>
      )}
      <div className="text-[11px] leading-[1.3] text-muted-foreground">
        {countOverride ?? (hasItems ? `${completed} of ${total}` : 'No items')}
      </div>
    </div>
  );
});
