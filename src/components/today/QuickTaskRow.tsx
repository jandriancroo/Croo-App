import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NudgeBadge } from '@/components/dashboard/NudgeBadge';

export function ProgressRing({ done, total, size = 18, overdue = false }: { done: number; total: number; size?: number; overdue?: boolean }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} className={overdue ? 'stroke-[hsl(var(--status-overdue))]' : 'stroke-muted'} />
      {pct > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} strokeLinecap="round"
          className={overdue ? 'stroke-[hsl(var(--status-overdue))]' : 'stroke-[hsl(var(--status-on-track))]'} strokeDasharray={`${c * pct} ${c}`} />
      )}
    </svg>
  );
}

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
        {dueLabel ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{dueLabel}</span>
        ) : null}
        {progress && progress.total > 1 && (
          <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{progress.done}/{progress.total}</span>
        )}
        <ProgressRing done={done ? 1 : progress?.done ?? 0} total={done ? 1 : progress?.total ?? 1} overdue={!!overdue && !done} />
      </button>
      {nudge && !done && <NudgeBadge onClick={nudge.onClick} minutesAgo={nudge.minutesAgo} style={{ top: -4, right: 0 }} />}
    </div>
  );
}
