import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Clock, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLaborShifts, type LaborShiftRow } from './ShiftReviewPanel';

export interface UnapprovedShift {
  key: string;
  name: string;
  date: string; // yyyy-MM-dd
  hours: number;
  punchIds: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locationId: string;
  start: string;
  end: string;
  timezone: string;
  names: Record<string, string>;
  unapproved: UnapprovedShift[];
  approvingIds: Set<string>;
  onApprove: (punchIds: string[]) => Promise<void> | void;
  onClose: () => void;
  closing?: boolean;
  onPunchesChanged: () => void;
}

/**
 * Closing checklist: shows only what's left when a manager closes a pay period.
 * Must fix (missing clock-outs) and unapproved shifts block; auto clock-outs and
 * no-break shifts are heads-up only.
 */
export function ClosePeriodDialog({
  open, onOpenChange, locationId, start, end, timezone, names,
  unapproved, approvingIds, onApprove, onClose, closing, onPunchesChanged,
}: Props) {
  const qc = useQueryClient();
  const { data: rows, isLoading, refetch } = useLaborShifts(open ? locationId : undefined, start, end);
  const [busy, setBusy] = useState(false);
  const [addFor, setAddFor] = useState<LaborShiftRow | null>(null);
  const [addTime, setAddTime] = useState('');

  const mustFix = useMemo(() => (rows || []).filter((r) => r.missing_clock_out && !r.resolved_zero), [rows]);
  const headsUp = useMemo(
    () => (rows || []).filter((r) => !(r.missing_clock_out && !r.resolved_zero) && ((r.auto_clock_out && !r.auto_reviewed) || r.meal_break_missing || r.unclosed_break)),
    [rows],
  );

  const blocked = mustFix.length + unapproved.length;
  const fmt = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(timezone).toFormat('M/d h:mm a') : '—');
  const day = (d: string) => DateTime.fromFormat(d, 'yyyy-MM-dd', { zone: timezone }).toFormat('ccc M/d');
  const nm = (id: string) => names[id] || 'Team member';

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['labor-shifts', locationId] });
    await qc.invalidateQueries({ queryKey: ['store-labor'] });
    refetch();
    onPunchesChanged();
  };

  const resolve = async (r: LaborShiftRow, resolution: 'zero' | 'auto_reviewed') => {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('labor_shift_resolutions' as any).insert({
      location_id: locationId, user_id: r.user_id, clock_in_punch_id: r.clock_in_punch_id,
      resolved_by: user?.id, resolution,
      note: resolution === 'zero' ? 'Resolved as 0h at pay period close' : 'Auto clock-out reviewed at pay period close',
    } as any);
    setBusy(false);
    if (error) { toast.error('Could not save'); return; }
    refresh();
  };

  const openAdd = (r: LaborShiftRow) => {
    const base = r.estimated_end || r.clock_in;
    setAddTime(DateTime.fromISO(base).setZone(timezone).toFormat("yyyy-MM-dd'T'HH:mm"));
    setAddFor(r);
  };

  const saveAdd = async () => {
    if (!addFor || !addTime) return;
    const out = DateTime.fromFormat(addTime, "yyyy-MM-dd'T'HH:mm", { zone: timezone });
    if (!out.isValid || out.toMillis() <= DateTime.fromISO(addFor.clock_in).toMillis()) { toast.error('Clock-out must be after clock-in'); return; }
    if (out.toMillis() > Date.now()) { toast.error('Clock-out cannot be in the future'); return; }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('time_punches').insert({
      user_id: addFor.user_id, punch_type: 'clock_out', punch_time: out.toUTC().toISO(),
      location_id: locationId, created_by: user?.id, notes: 'Manual entry by manager',
    });
    setBusy(false);
    if (error) { toast.error('Failed to add clock-out'); return; }
    toast.success('Clock-out added');
    setAddFor(null);
    refresh();
  };

  const allUnapprovedIds = unapproved.flatMap((u) => u.punchIds);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Close pay period</DialogTitle>
            <DialogDescription>
              {isLoading ? 'Checking shifts…' : blocked === 0 ? 'Everything required is done.' : `${blocked} item${blocked === 1 ? '' : 's'} left before you can close.`}
            </DialogDescription>
          </DialogHeader>

          {mustFix.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertCircle className="h-4 w-4" /> Must fix · missing clock-out ({mustFix.length})
              </h3>
              {mustFix.map((r) => (
                <div key={r.clock_in_punch_id} className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <div className="text-sm"><span className="font-medium">{nm(r.user_id)}</span> <span className="text-muted-foreground">{day(r.business_date)} · in {fmt(r.clock_in)}</span></div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => openAdd(r)}>Add clock-out</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(r, 'zero')}>Resolve as 0h</Button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {unapproved.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Clock className="h-4 w-4" /> Needs approval ({unapproved.length})
                </h3>
                <Button size="sm" variant="outline" disabled={busy || allUnapprovedIds.some((id) => approvingIds.has(id))} onClick={() => onApprove(allUnapprovedIds)}>
                  Approve remaining
                </Button>
              </div>
              {unapproved.map((u) => (
                <div key={u.key} className="flex items-center justify-between rounded-md border p-2.5">
                  <div className="text-sm"><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">{day(u.date)} · {u.hours.toFixed(2)} h</span></div>
                  <Button size="sm" variant="ghost" disabled={u.punchIds.some((id) => approvingIds.has(id))} onClick={() => onApprove(u.punchIds)}>Approve</Button>
                </div>
              ))}
            </section>
          )}

          {headsUp.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                <Info className="h-4 w-4" /> Heads up · won't stop the close ({headsUp.length})
              </h3>
              {headsUp.map((r) => (
                <div key={r.clock_in_punch_id} className="flex items-center justify-between rounded-md border border-dashed p-2.5">
                  <div className="text-sm">
                    <span className="font-medium">{nm(r.user_id)}</span>{' '}
                    <span className="text-muted-foreground">
                      {day(r.business_date)} · {r.auto_clock_out && !r.auto_reviewed ? 'Auto clock-out' : 'No break'}
                    </span>
                  </div>
                  {r.auto_clock_out && !r.auto_reviewed && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => resolve(r, 'auto_reviewed')}>Mark reviewed</Button>
                  )}
                </div>
              ))}
            </section>
          )}

          {!isLoading && blocked === 0 && headsUp.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-primary" /> No flags. Ready to close.</div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Not yet</Button>
            <Button disabled={isLoading || blocked > 0 || closing} onClick={onClose}>
              {closing ? 'Closing…' : blocked > 0 ? `${blocked} left` : 'Close pay period'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addFor} onOpenChange={(o) => !o && setAddFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add clock-out</DialogTitle>
            <DialogDescription>Pre-filled with the estimated end of this shift.</DialogDescription>
          </DialogHeader>
          <Input type="datetime-local" value={addTime} onChange={(e) => setAddTime(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddFor(null)}>Cancel</Button>
            <Button disabled={busy} onClick={saveAdd}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
