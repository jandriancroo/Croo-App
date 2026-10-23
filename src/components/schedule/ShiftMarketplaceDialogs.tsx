// Shift Marketplace manager sheets: the Confirm preview (the day as it will be, via DayRows) and the "Assign to…" picker.
import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DayRows, NEW_GREEN, type DayView } from '@/components/schedule/DayRows';
import {
  buildOfferDayView, loadAssignCandidates, loadDayShifts, loadOfferShift,
  type AssignCandidate, type OfferShift,
} from '@/lib/shiftMarketplace';

export type ConfirmTarget = { verb: 'Approve' | 'Claim' | 'Assign'; person: { id: string; name: string } };

export function ShiftOfferConfirmDialog(props: {
  shiftId: string; ownerName: string; target: ConfirmTarget | null; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const { target, shiftId, ownerName } = props;
  const [view, setView] = useState<DayView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!target) { setView(null); setErr(null); return; }
    let live = true;
    (async () => {
      try {
        const shift = await loadOfferShift(shiftId);
        const day = await loadDayShifts(shift);
        const title = DateTime.fromFormat(shift.shift_date, 'yyyy-MM-dd').toFormat('cccc, LLL d');
        if (live) setView(buildOfferDayView({ shift, dayShifts: day, ownerName, newPerson: target.person, title }));
      } catch (e: any) { if (live) setErr(e?.message || 'Could not load the day'); }
    })();
    return () => { live = false; };
  }, [target, shiftId, ownerName]);

  const first = target?.person.name.split(' ')[0] ?? '';
  const heading = !target ? '' : target.verb === 'Claim' ? 'Take this shift?' : `Give this shift to ${first}?`;
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !props.busy) props.onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{view ? `${view.title} as it will be` : err || 'Loading the day…'}</DialogDescription>
        </DialogHeader>
        {view && <DayRows view={view} />}
        <DialogFooter className="flex-row gap-2 sm:justify-stretch">
          <Button variant="outline" className="h-11 flex-1 rounded-full" onClick={props.onCancel} disabled={props.busy}>Cancel</Button>
          <Button className="h-11 flex-1 rounded-full font-extrabold text-white" style={{ background: NEW_GREEN }}
            onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignShiftDialog(props: { open: boolean; shiftId: string; onClose: () => void; onPick: (p: { id: string; name: string }) => void }) {
  const [rows, setRows] = useState<AssignCandidate[] | null>(null);
  const [shift, setShift] = useState<OfferShift | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open) return;
    let live = true;
    setRows(null); setErr(null);
    (async () => {
      try {
        const s = await loadOfferShift(props.shiftId);
        const list = await loadAssignCandidates(s);
        if (live) { setShift(s); setRows(list); }
      } catch (e: any) { if (live) setErr(e?.message || 'Could not load the crew'); }
    })();
    return () => { live = false; };
  }, [props.open, props.shiftId]);

  const section = (label: string, list: AssignCandidate[]) => list.length > 0 && (
    <div className="space-y-1">
      <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      {list.map((c) => (
        <button key={c.id} type="button" onClick={() => props.onPick({ id: c.id, name: c.name })}
          className={`flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-muted ${c.blocked ? 'opacity-70' : ''}`}>
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-extrabold">{c.name}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{c.line}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            {c.sixthDay && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">Sixth day</span>}
            {c.tag && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{c.tag}</span>}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign to…</DialogTitle>
          <DialogDescription>
            {shift ? DateTime.fromFormat(shift.shift_date, 'yyyy-MM-dd').toFormat('cccc, LLL d') : 'Store crew, checked against availability, time off and other shifts.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!rows && !err && <p className="text-sm text-muted-foreground">Loading crew…</p>}
          {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No one else on this store's schedule.</p>}
          {rows && section('Off that day', rows.filter((r) => r.group === 'clear'))}
          {rows && section('Already working that day', rows.filter((r) => r.group === 'working'))}
          {rows && section("Can't (you can still assign)", rows.filter((r) => r.group === 'blocked'))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
