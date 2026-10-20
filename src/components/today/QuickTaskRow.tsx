import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NudgeBadge } from '@/components/dashboard/NudgeBadge';


interface QuickTaskRowProps {
  title: string;
  icon: LucideIcon;
  dueLabel?: string | null;
  overdue?: boolean;
  done?: boolean;
  progress?: { done: number; total: number } | null;
  onSelect: () => void;
  nudge?: { onClick: () => void; minutesAgo?: number };
}

/** Compact (~33px) quick task row for the mobile Dash Quick Tasks section. */
export function QuickTaskRow({ title, icon: Icon, dueLabel, overdue, done, progress, onSelect, nudge }: QuickTaskRowProps) {
  return (
    <div className={cn('relative', done && 'opacity-60')}>
      <button
        type="button"
        onClick={onSelect}
        className={cn('flex h-[33px] w-full items-center gap-2 bg-card px-2.5 text-left active:bg-muted/60', nudge && 'pr-11')}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <Icon className="h-3 w-3" />
        </span>
        <span className={cn('flex-1 truncate text-[13px] font-medium text-foreground', done && 'line-through')}>{title}</span>
        {overdue && !done ? (
          <span className="shrink-0 text-[11px] font-semibold text-[hsl(var(--status-overdue))]">{dueLabel ?? 'Overdue'}</span>
        ) : dueLabel ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{dueLabel}</span>
        ) : null}
        {progress && progress.total > 1 && (
          <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{progress.done}/{progress.total}</span>
        )}
      </button>

      {nudge && !done && <NudgeBadge onClick={nudge.onClick} minutesAgo={nudge.minutesAgo} style={{ top: -4, right: 0 }} />}
    </div>
  );
}
