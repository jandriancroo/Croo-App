import type { SyntheticEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Exact copy for the three schedule action tips (Clear, Copy, Withdraw). */
export const SCHEDULE_ACTION_INFO = {
  copy: "Copies this week's shifts, with stations, into a future unposted week. A posted week can't be copied into. If that week already has drafts, you pick Merge, which skips exact duplicates, or Cancel. Nothing is ever deleted.",
  clear: 'Clears drafts for this week only. If the week is posted, unpublished changes are discarded and the posted schedule is restored. Posted shifts are not removed. Shifts already worked or punched are left alone. To unpublish a live week, use Withdraw.',
  withdraw: 'Unpublishes this week so the team can no longer see it, and leaves every shift in place as a draft. It does not delete shifts. Use Clear if you want to remove drafts after withdrawing.',
} as const;

// The ? sits inside menu items / next to action buttons: it must never fire the action.
const stop = (e: SyntheticEvent) => { e.stopPropagation(); };
const stopKeys = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };

/** Small ? with the action's tip: hover shows a tooltip (pointer), tap/click/keyboard opens a popover (phone too). */
export function ScheduleActionInfo({ text, className }: { text: string; className?: string }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="What this does"
              className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
              onPointerDown={stop}
              onPointerUp={stop}
              onClick={stop}
              onKeyDown={stopKeys}
            >
              <CircleHelp className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="z-[110] max-w-xs px-3 py-2 text-sm">{text}</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="end" className="z-[110] w-72 px-3 py-2 text-sm" onClick={stop} onPointerDown={stop}>
        {text}
      </PopoverContent>
    </Popover>
  );
}
