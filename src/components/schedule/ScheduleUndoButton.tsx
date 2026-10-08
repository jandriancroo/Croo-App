import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useScheduleRestore } from '@/hooks/useScheduleRestore';
import { cn } from '@/lib/utils';

const WARNED_KEY = 'croo.undoWarned';

interface Props {
  scheduleId: string | null | undefined;
  isPublished: boolean;
  /** Changes whenever shifts change, so the undo preview refreshes. */
  version?: unknown;
  onChanged?: () => void;
  className?: string;
}

/** ↶ next to Post / Update: one step back per tap (drafts, or unsent edits on a live week). */
export function ScheduleUndoButton({ scheduleId, isPublished, version, onChanged, className }: Props) {
  const { undoPreview, undo } = useScheduleRestore(scheduleId, { version, onChanged });
  const [warnOpen, setWarnOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!scheduleId) return null;

  const run = async () => { setBusy(true); await undo(); setBusy(false); };
  const onTap = () => {
    if (sessionStorage.getItem(WARNED_KEY)) run();
    else setWarnOpen(true);
  };
  const disabledTip = isPublished ? 'Live week: changes are tracked; use Update' : 'Nothing to undo';
  const enabled = !!undoPreview && !busy;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button variant="outline" size="icon" className={cn('h-7 w-7', className)} onClick={onTap} disabled={!enabled}
              aria-label={undoPreview ? `Undo: ${undoPreview.description}` : 'Undo'}>
              <Undo2 className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{undoPreview ? `Undo: ${undoPreview.description}` : disabledTip}</TooltipContent>
      </Tooltip>
      <AlertDialog open={warnOpen} onOpenChange={setWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo</AlertDialogTitle>
            <AlertDialogDescription>Undo reverses your last change, one step at a time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { sessionStorage.setItem(WARNED_KEY, '1'); run(); }}>Undo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
