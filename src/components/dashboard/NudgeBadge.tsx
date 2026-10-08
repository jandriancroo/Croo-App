import type { CSSProperties } from 'react';
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
        <span className="absolute right-[36px] rounded-full bg-card px-1 text-[9px] font-bold leading-[14px] text-muted-foreground ring-1 ring-border">
          {minutesAgo}m
        </span>
      )}
      <NUDGE_ICON size={30} muted={cooling} />
    </button>
  );
}
