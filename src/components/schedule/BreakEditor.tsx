import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Coffee, Plus, Trash2 } from 'lucide-react';
import { ShiftBreak, makeBreakId } from '@/types/shiftBreak';
import { rangesOverlap } from '@/utils/breakCoverage';

interface CovererOption {
  id: string;
  full_name: string;
  role?: string | null;
}

interface BreakEditorProps {
  value: ShiftBreak[];
  onChange: (next: ShiftBreak[]) => void;
  /** Show the "Covered By" dropdown. Templates pass false. */
  showCoverer?: boolean;
  /** Coverer options; required when showCoverer = true. */
  coverers?: CovererOption[];
  /** Shift bounds, used for soft warnings. */
  shiftStart?: string;
  shiftEnd?: string;
}

const ROLE_GROUPS: Array<{ label: string; roles: string[] }> = [
  { label: 'Admins', roles: ['super_admin', 'admin'] },
  { label: 'Managers', roles: ['manager', 'shift_lead', 'shift_manager', 'shift_manager_in_training'] },
  { label: 'Team', roles: ['team_member', 'crew', 'employee', 'staff'] },
];

function groupCoverers(coverers: CovererOption[]) {
  const groups: Array<{ label: string; people: CovererOption[] }> = ROLE_GROUPS.map((g) => ({
    label: g.label,
    people: [] as CovererOption[],
  }));
  const other: CovererOption[] = [];
  for (const p of coverers) {
    const r = (p.role || '').toLowerCase();
    const idx = ROLE_GROUPS.findIndex((g) => g.roles.includes(r));
    if (idx >= 0) groups[idx].people.push(p);
    else other.push(p);
  }
  if (other.length) groups.push({ label: 'Other', people: other });
  return groups.filter((g) => g.people.length > 0);
}

export function BreakEditor({
  value,
  onChange,
  showCoverer = true,
  coverers = [],
  shiftStart,
  shiftEnd,
}: BreakEditorProps) {
  const breaks = Array.isArray(value) ? value : [];

  const addBreak = () => {
    const next: ShiftBreak = {
      id: makeBreakId(),
      start_time: shiftStart ?? '12:00',
      end_time: shiftEnd ?? '12:30',
      covered_by_user_id: null,
    };
    onChange([...breaks, next]);
  };

  const updateBreak = (id: string, patch: Partial<ShiftBreak>) => {
    onChange(breaks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBreak = (id: string) => {
    onChange(breaks.filter((b) => b.id !== id));
  };

  const grouped = groupCoverers(coverers);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <Coffee className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          Breaks
          {breaks.length > 0 && (
            <span className="text-xs text-muted-foreground">({breaks.length})</span>
          )}
        </Label>
        <Button type="button" variant="ghost" size="sm" onClick={addBreak} className="h-7 px-2">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add break
        </Button>
      </div>

      {breaks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No scheduled breaks. Tap "Add break" to add one.</p>
      ) : (
        <div className="space-y-2">
          {breaks.map((b) => {
            const outOfBounds =
              shiftStart && shiftEnd
                ? !rangesOverlap(b.start_time, b.end_time, shiftStart, shiftEnd)
                : false;
            return (
              <div
                key={b.id}
                className="rounded-md border bg-muted/30 p-2 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={b.start_time}
                    onChange={(e) => updateBreak(b.id, { start_time: e.target.value })}
                    className="h-8 flex-1 min-w-0"
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input
                    type="time"
                    value={b.end_time}
                    onChange={(e) => updateBreak(b.id, { end_time: e.target.value })}
                    className="h-8 flex-1 min-w-0"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeBreak(b.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>

                {showCoverer && (
                  <Select
                    value={b.covered_by_user_id || 'none'}
                    onValueChange={(v) =>
                      updateBreak(b.id, { covered_by_user_id: v === 'none' ? null : v })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Covered by…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— No coverer assigned —</SelectItem>
                      {grouped.map((g) => (
                        <div key={g.label}>
                          <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {g.label}
                          </div>
                          {g.people.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.full_name}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {outOfBounds && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Break is outside the shift window.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
