import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

/** Same circle language as the Dash checklists: hollow, red when late, pie for steps, green check when done. */
function TaskGlyph({ done, overdue, progress }: { done: boolean; overdue: boolean; progress?: { done: number; total: number } | null }) {
  if (done) {
    return (
      <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--status-on-track))]">
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
    );
  }
  const color = overdue ? 'text-[hsl(var(--status-overdue))]' : 'text-[hsl(var(--status-on-track))]';
  if (progress && progress.total > 1 && progress.done > 0) {
    const r = 3.25;
    const c = 2 * Math.PI * r;
    const wedge = Math.min(1, progress.done / progress.total) * c;
    return (
      <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" className={cn('shrink-0', color)}>
        <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth={r * 2} strokeDasharray={`${wedge} ${c}`} transform="rotate(-90 10 10)" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={cn('h-5 w-5 shrink-0 rounded-full border-2', overdue ? 'border-[hsl(var(--status-overdue))]' : 'border-border')}
    />
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
  /** Faint tint for system (teal), document (amber) and account (red) rows. Base look unchanged. */
  wash?: 'teal' | 'amber' | 'red';
}

const WASH: Record<'teal' | 'amber' | 'red', string> = {
  teal: 'bg-primary/[0.07]',
  amber: 'bg-[hsl(var(--warning)/0.10)]',
  red: 'bg-destructive/[0.07]',
};

/** Compact (~33px) quick task row for the mobile Dash Quick Tasks section. */
export function QuickTaskRow({ title, dueLabel, overdue, done, progress, onSelect, wash }: QuickTaskRowProps) {
  return (
    <div className={cn('relative', done && 'opacity-60')}>
      <button
        type="button"
        onClick={onSelect}
        className={cn('relative isolate flex h-[33px] w-full items-center gap-2 bg-card px-2.5 text-left active:bg-muted/60')}
      >
        {wash && <span aria-hidden data-wash={wash} className={cn('pointer-events-none absolute inset-0 -z-10', WASH[wash])} />}
        <TaskGlyph done={!!done} overdue={!!overdue} progress={progress} />
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
    </div>
  );
}
