import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLaborGoals, LABOR_GOAL_SOURCE_LABEL } from '@/hooks/useLaborGoals';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface Props {
  /** 0 = Monday … 6 = Sunday; null = the weekly goal */
  dow: number | null;
  /** Projected sales for the day (or week) to show the implied labor $ */
  projectedSales: number;
  canEdit: boolean;
  children: ReactNode;
}

/** Edits the store's labor goal (store-goal Weekly Template) via useLaborGoals.setGoal. */
export function LaborGoalPopover({ dow, projectedSales, canEdit, children }: Props) {
  const goals = useLaborGoals();
  const [open, setOpen] = useState(false);
  const current = dow == null ? goals.weekly : goals.forDow(dow);
  const source = dow == null ? goals.weeklySource : goals.sourceForDow(dow);
  const [value, setValue] = useState('');
  // No goal visible (staff, or not loaded): no popover, just the content.
  const hidden = !goals.available;

  useEffect(() => {
    if (open) setValue(current == null ? '' : String(current));
  }, [open, current]);

  const save = async (pct: number | null) => {
    if (pct != null && !(pct > 0 && pct <= 100)) {
      toast.error('Enter a goal between 0 and 100%');
      return;
    }
    try {
      await goals.setGoal(dow, pct);
      toast.success(pct == null ? 'Labor goal cleared' : 'Labor goal saved');
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save labor goal');
    }
  };

  const pctNum = parseFloat(value);
  const implied = projectedSales > 0 && pctNum > 0 ? projectedSales * (pctNum / 100) : null;

  if (hidden) {
    return <div className="w-full h-full flex items-center justify-center gap-2">{children}</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="w-full h-full flex items-center justify-center gap-2 cursor-pointer" aria-label="Labor goal">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="center">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Labor goal · {dow == null ? 'whole week' : `every ${WEEKDAYS[dow]}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {current}% · from {LABOR_GOAL_SOURCE_LABEL[source]}
          </p>
        </div>
        {canEdit ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.5}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-9"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            {implied != null && (
              <p className="text-xs text-muted-foreground">
                = ${Math.round(implied).toLocaleString()} labor at ${Math.round(projectedSales).toLocaleString()} projected sales
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={goals.saving || !value} onClick={() => save(parseFloat(value))}>
                Save
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="w-full text-xs" disabled={goals.saving} onClick={() => save(null)}>
              {dow == null ? `Clear (use store default${goals.storeDefault != null ? ` ${goals.storeDefault}%` : ""})` : 'Clear (use weekly goal)'}
            </Button>
          </>
        ) : (
          implied != null && (
            <p className="text-xs text-muted-foreground">
              = ${Math.round(implied).toLocaleString()} labor at projected sales
            </p>
          )
        )}
      </PopoverContent>
    </Popover>
  );
}
