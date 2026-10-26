import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Coffee } from 'lucide-react';

export type ShiftCardBreak = {
  key: string;
  startTime: string;
  endTime: string;
  type: 'paid' | 'unpaid';
};

/**
 * Display-only shift card (clock in/out + breaks) shared by the Edit Shift,
 * Edit Punch and Quick Punch dialogs. No state, no validation — the parent
 * dialog keeps its own state and save handlers.
 */
export function ShiftCardFields({
  title,
  clockIn,
  clockOut,
  onClockIn,
  onClockOut,
  clockOutSlot,
  breaks,
  onBreakChange,
  onBreakRemove,
  onAddBreak,
  addBreakDisabled,
  breaksLabel = 'Breaks',
  headerAction,
}: {
  title: string;
  clockIn: string;
  clockOut: string;
  onClockIn: (value: string) => void;
  onClockOut: (value: string) => void;
  /** Replaces the whole Clock Out cell (e.g. the optional Add Clock Out UI). */
  clockOutSlot?: ReactNode;
  breaks: ShiftCardBreak[];
  onBreakChange: (index: number, patch: Partial<Omit<ShiftCardBreak, 'key'>>) => void;
  onBreakRemove: (index: number) => void;
  /** Omitted = hide the "+ Break" button. */
  onAddBreak?: () => void;
  addBreakDisabled?: boolean;
  breaksLabel?: 'Breaks' | 'Break';
  headerAction?: ReactNode;
}) {
  return (
    <div className="space-y-3 p-3 border rounded-lg bg-muted/5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        {headerAction}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Clock In
          </label>
          <Input
            type="time"
            value={clockIn}
            onChange={(e) => onClockIn(e.target.value)}
          />
        </div>
        {clockOutSlot ?? (
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Clock Out
            </label>
            <Input
              type="time"
              value={clockOut}
              onChange={(e) => onClockOut(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="border-t pt-3 space-y-3">
        {breaks.length > 0 && (
          <div className="text-sm font-medium">{breaksLabel}</div>
        )}

        {breaks.length > 0 && (
          <div className="space-y-3">
            {breaks.map((brk, bIdx) => (
              <div key={brk.key} className="rounded-lg border bg-muted/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Coffee className="h-4 w-4 text-muted-foreground" />
                    <div className="text-sm font-medium">Break {bIdx + 1}</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => onBreakRemove(bIdx)}
                  >
                    Remove
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Type</label>
                    <select
                      value={brk.type}
                      onChange={(e) => onBreakChange(bIdx, { type: e.target.value as 'paid' | 'unpaid' })}
                      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="unpaid">Unpaid (30m)</option>
                      <option value="paid">Paid (10m)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Break Start</label>
                    <Input
                      type="time"
                      value={brk.startTime}
                      onChange={(e) => onBreakChange(bIdx, { startTime: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Break End</label>
                    <Input
                      type="time"
                      value={brk.endTime}
                      onChange={(e) => onBreakChange(bIdx, { endTime: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">  </label>
                    <div className="text-xs text-muted-foreground flex items-center h-10">
                      {brk.type === 'unpaid' ? 'Meal break' : 'Paid break'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {onAddBreak && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-sm"
            onClick={onAddBreak}
            disabled={addBreakDisabled}
          >
            + Break
          </Button>
        )}
      </div>
    </div>
  );
}
