// iPad/desktop home for Quick Nudge: header icon with a late-count badge that opens the shared Nudge list.
import { useState } from 'react';
import { NudgeTapIcon } from '@/components/icons/NudgeTapIcon';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { NudgeListPanel, useNudgeList } from '@/components/dashboard/NudgeSection';
import { cn } from '@/lib/utils';

export function NudgeHeaderButton({ locationId, iconOnly = false }: { locationId: string | null | undefined; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: items = [], isLoading } = useNudgeList(locationId, true);
  const late = items.filter((i) => i.group === 'overdue').length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'relative flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-white/15 hover:bg-white/25 active:scale-95 transition-all duration-200',
          iconOnly ? 'w-9 px-0' : 'px-3.5 md:min-w-[7.5rem]',
        )}
        aria-label={late > 0 ? `Nudge, ${late} late` : 'Nudge'}
      >
        <span className="flex h-5 w-5 items-center justify-center"><NudgeTapIcon size={20} /></span>
        {!iconOnly && <span className="text-sm font-bold text-white tracking-tight hidden md:inline">Nudge</span>}
        {late > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[hsl(var(--status-overdue))] text-[11px] font-extrabold leading-[18px] text-center text-primary-foreground tabular-nums">
            {late > 99 ? '99+' : late}
          </span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-3"><SheetTitle>Nudge</SheetTitle></SheetHeader>
          {open && <NudgeListPanel locationId={locationId} items={items} isLoading={isLoading} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
