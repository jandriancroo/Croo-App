import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { NUDGE_ICON } from '@/lib/quickNudges';

/** The one Quick Nudge badge (checklist rows + quick task pills). Position is set by the parent. */
export function NudgeBadge({ onClick, minutesAgo, style }: { onClick: () => void; minutesAgo?: number; style: CSSProperties }) {
  const cooling = minutesAgo != null;
  return (
    <button
      type="button"
      aria-label={cooling ? `Nudge crew (nudged ${minutesAgo}m ago)` : 'Nudge crew'}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => e.stopPropagation()}
      className="absolute z-20 flex h-10 w-10 items-center justify-center"
      style={style}
    >
      {cooling && (
        <span className="absolute right-[34px] rounded-full bg-card px-1 text-[9px] font-bold leading-[14px] text-muted-foreground ring-1 ring-border">
          {minutesAgo}m
        </span>
      )}
      <span
        className={cn(
          'flex h-[30px] w-[30px] items-center justify-center rounded-full ring-2 ring-card',
          cooling
            ? 'bg-muted text-muted-foreground shadow-sm'
            : 'bg-primary text-primary-foreground outline outline-1 outline-primary/25 shadow-[0_2px_6px_hsl(190_54%_25%/.35)]'
        )}
      >
        {cooling ? <NUDGE_ICON size={21} muted /> : <NUDGE_ICON size={21} />}
      </span>
    </button>
  );
}
