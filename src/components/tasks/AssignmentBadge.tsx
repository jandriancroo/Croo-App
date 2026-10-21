import { cn } from '@/lib/utils';
import { badgeStyle, type AssignmentInfo } from '@/lib/assignmentBadge';

/** Small rounded pill showing who a task is for. The name is always shown. */
export function AssignmentBadge({ info, className }: { info: AssignmentInfo; className?: string }) {
  const none = info.kind === 'none';
  const person = info.kind === 'person';
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4',
        none && 'border-border bg-card text-muted-foreground',
        person && 'border-border bg-muted text-foreground/80',
        className,
      )}
      style={none || person ? undefined : badgeStyle(info.color)}
    >
      {person && info.initials && (
        <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-semibold">{info.initials}</span>
      )}
      <span className="min-w-0 break-words">{info.text}</span>
    </span>
  );
}
