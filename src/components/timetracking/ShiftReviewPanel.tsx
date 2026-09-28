import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * C4/C5/C6: Time Tracking review, fed by the server's labor_shifts.
 * Does not auto-refresh (refetchInterval/refetchOnWindowFocus off) — it only
 * changes when the manager reopens it or acts on a shift.
 */
export interface LaborShiftRow {
  user_id: string;
  business_date: string;
  clock_in_punch_id: string;
  clock_in: string;
  clock_out: string | null;
  paid_hours: number;
  cost: number | null;
  premium_cost: number | null;
  ot_hours: number | null;
  dt_hours: number | null;
  missing_clock_out: boolean;
  unclosed_break: boolean;
  open_shift_live: boolean;
  resolved_zero: boolean;
  auto_clock_out: boolean;
  auto_reviewed: boolean;
  meal_break_missing: boolean;
  estimated_end: string | null;
  wage_missing: boolean;
}

const OLD_RULE_START = '2026-09-21';
const OLD_RULE_END = '2026-09-25';
export const isOldRuleDate = (d: string) => d >= OLD_RULE_START && d <= OLD_RULE_END;

export function useLaborShifts(locationId: string | undefined, start: string | undefined, end: string | undefined) {
  return useQuery({
    queryKey: ['labor-shifts', locationId, start, end],
    enabled: !!locationId && !!start && !!end,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('labor_shifts' as any, {
        _location_id: locationId, _start: start, _end: end,
      });
      if (error) throw error;
      return ((data as any[]) || []) as LaborShiftRow[];
    },
    refetchInterval: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export const unreviewedAutoOuts = (rows: LaborShiftRow[] | undefined) =>
  (rows || []).filter((r) => r.auto_clock_out && !r.auto_reviewed);

interface Props {
  locationId: string;
  start: string;
  end: string;
  timezone: string;
  names: Record<string, string>;
  canSeeDollars: boolean;
  readOnly: boolean;
}

export function ShiftReviewPanel({ locationId, start, end, timezone, names, canSeeDollars, readOnly }: Props) {
  const qc = useQueryClient();
  const { data: rows, isLoading, isError, refetch } = useLaborShifts(locationId, start, end);
  const [addFor, setAddFor] = useState<LaborShiftRow | null>(null);
  const [addTime, setAddTime] = useState('');
  const [busy, setBusy] = useState(false);

  const fmt = (iso: string | null) =>
    iso ? DateTime.fromISO(iso).setZone(timezone).toFormat('M/d h:mm a') : '—';
  const money = (n: number) => `$${n.toFixed(2)}`;

  const issues = (rows || []).filter(
    (r) => (r.missing_clock_out && !r.resolved_zero) || r.unclosed_break || (r.auto_clock_out && !r.auto_reviewed) || r.meal_break_missing,
  );

  const totalHours = (rows || []).reduce((s, r) => s + (Number(r.paid_hours) || 0), 0);
  const totalCost = (rows || []).reduce((s, r) => s + (Number(r.cost) || 0) + (Number(r.premium_cost) || 0), 0);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['labor-shifts', locationId] });
    await qc.invalidateQueries({ queryKey: ['store-labor'] });
    refetch();
  };

  const resolve = async (r: LaborShiftRow, resolution: 'zero' | 'auto_reviewed') => {
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('labor_shift_resolutions' as any).insert({
      location_id: locationId,
      user_id: r.user_id,
      clock_in_punch_id: r.clock_in_punch_id,
      resolved_by: user?.id,
      resolution,
      note: resolution === 'zero' ? 'Resolved as 0h in Time Tracking' : 'Auto clock-out reviewed',
    } as any);
    setBusy(false);
    if (error) { toast.error('Could not save'); return; }
    toast.success(resolution === 'zero' ? 'Resolved as 0 hours' : 'Marked reviewed');
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
    if (!out.isValid || out.toMillis() <= DateTime.fromISO(addFor.clock_in).toMillis()) {
      toast.error('Clock-out must be after clock-in'); return;
    }
    if (out.toMillis() > Date.now()) { toast.error('Clock-out cannot be in the future'); return; }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('time_punches').insert({
      user_id: addFor.user_id,
      punch_type: 'clock_out',
      punch_time: out.toUTC().toISO(),
      location_id: locationId,
      created_by: user?.id,
      notes: 'Manual entry by manager',
    });
    setBusy(false);
    if (error) { toast.error('Failed to add clock-out'); return; }
    toast.success('Clock-out added');
    setAddFor(null);
    refresh();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span>Shift review</span>
          <span className="text-sm font-normal text-muted-foreground">
            {isError ? '—' : `${totalHours.toFixed(2)} h`}
            {canSeeDollars && !isError ? ` · ${money(totalCost)}` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <div className="flex items-center gap-2 text-sm">
            <span>—</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}
        {!isLoading && !isError && issues.length === 0 && (
          <p className="text-sm text-muted-foreground">No open issues in this period.</p>
        )}
        {issues.map((r) => (
          <div key={r.clock_in_punch_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-3">
            <div className="space-y-1">
              <div className="font-medium">
                {names[r.user_id] || 'Team member'}{' '}
                <span className="text-muted-foreground font-normal">{r.business_date}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                In {fmt(r.clock_in)} · Out {fmt(r.clock_out)} · {Number(r.paid_hours).toFixed(2)} h
                {canSeeDollars && (r.wage_missing ? ' · wage missing' : ` · ${money((Number(r.cost) || 0) + (Number(r.premium_cost) || 0))}`)}
              </div>
              <div className="flex flex-wrap gap-1">
                {r.missing_clock_out && !r.resolved_zero && <Badge variant="destructive">Open</Badge>}
                {r.auto_clock_out && <Badge variant="secondary">Auto Out</Badge>}
                {(r.unclosed_break || r.meal_break_missing) && <Badge variant="outline">No Break</Badge>}
                {isOldRuleDate(r.business_date) && <Badge variant="outline">old rule</Badge>}
              </div>
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                {r.missing_clock_out && !r.resolved_zero && (
                  <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(r, 'zero')}>Resolve as 0h</Button>
                    <Button size="sm" disabled={busy} onClick={() => openAdd(r)}>Add clock-out</Button>
                  </>
                )}
                {r.auto_clock_out && !r.auto_reviewed && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve(r, 'auto_reviewed')}>Mark reviewed</Button>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>

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
    </Card>
  );
}
