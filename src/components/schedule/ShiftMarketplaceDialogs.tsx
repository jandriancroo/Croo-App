// Shift Marketplace sheets: the Confirm preview (the day as it will be, via DayRows, plus Theo's amber flag box)
// and the "Assign to…" picker (Theo cover-list style: claimers first, then "Everyone else").
import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { AlertTriangle, Check, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CoverListScroller, DayRows, NEW_GREEN, type DayView } from '@/components/schedule/DayRows';
import {
  assignFlags, buildOfferDayView, loadAssignCandidates, loadDayShifts, loadOfferShift, splitClaimersFirst,
  type AssignCandidate, type OfferShift,
} from '@/lib/shiftMarketplace';

export type ConfirmTarget = {
  verb: 'Approve' | 'Claim' | 'Assign';
  person: { id: string; name: string };
  /** Warnings carried from the picker (Sixth day, Seventh day, Unavailable). */
  flags?: string[];
  /** A manager claiming for themselves: show the take-over warning and look up their own flags. */
  takeOver?: boolean;
};

const AMBER_BOX = { background: 'hsl(38 95% 90%)', color: 'hsl(32 90% 22%)' };

function FlagTag({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold" style={AMBER_BOX}>{label}</span>;
}

export function ShiftOfferConfirmDialog(props: {
  shiftId: string; ownerName: string; target: ConfirmTarget | null; busy: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const { target, shiftId, ownerName } = props;
  const [view, setView] = useState<DayView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selfFlags, setSelfFlags] = useState<string[]>([]);
  useEffect(() => {
    if (!target) { setView(null); setErr(null); setSelfFlags([]); return; }
    let live = true;
    (async () => {
      try {
        const shift = await loadOfferShift(shiftId);
        const day = await loadDayShifts(shift);
        const title = DateTime.fromFormat(shift.shift_date, 'yyyy-MM-dd').toFormat('cccc, LLL d');
        if (live) setView(buildOfferDayView({ shift, dayShifts: day, ownerName, newPerson: target.person, title }));
        if (target.takeOver && !target.flags) {
          try {
            const me = (await loadAssignCandidates(shift)).find((c) => c.id === target.person.id);
            if (live && me) setSelfFlags(assignFlags(me));
          } catch { /* flags are warnings only; never block the claim */ }
        }
      } catch (e: any) { if (live) setErr(e?.message || 'Could not load the day'); }
    })();
    return () => { live = false; };
  }, [target, shiftId, ownerName]);

  const first = target?.person.name.split(' ')[0] ?? '';
  const flags = target?.flags ?? selfFlags;
  const heading = !target ? '' : target.verb === 'Claim' ? 'Claim this shift?' : `Give this shift to ${first}?`;
  const warnings: string[] = [];
  if (target?.takeOver) warnings.push(`You're taking this shift over from ${ownerName.split(' ')[0]}. It moves to your schedule right away.`);
  const who = target?.verb === 'Claim' ? 'You' : first;
  if (flags.includes('Seventh day')) warnings.push(`${who} would work a seventh day this week.`);
  if (flags.includes('Sixth day')) warnings.push(`${who} would work a sixth day this week.`);
  if (flags.includes('Unavailable')) warnings.push(`${who} ${who === 'You' ? 'are' : 'is'} marked unavailable for this time.`);
  const checks: string[] = [];
  if (target && target.verb !== 'Claim' || target?.takeOver) {
    if (!flags.includes('Unavailable')) checks.push('Available at this time');
    if (!flags.includes('Sixth day') && !flags.includes('Seventh day')) checks.push('Under six days this week');
    checks.push('Undo is available for 10 minutes');
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o && !props.busy) props.onCancel(); }}>
      <DialogContent className="max-w-md grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{view ? `${view.title} as it will be` : err || 'Loading the day…'}</DialogDescription>
        </DialogHeader>
        {view && <DayRows view={view} />}
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-xl px-3 py-2" style={AMBER_BOX}>
            {warnings.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
          </ul>
        )}
        {checks.length > 0 && (
          <ul className="flex flex-col gap-1 px-1">
            {checks.map((t) => <li key={t} className="flex items-start gap-2 text-[13px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={3} />{t}</li>)}
          </ul>
        )}
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

export function AssignShiftDialog(props: {
  open: boolean; shiftId: string; claimerIds: string[]; onClose: () => void;
  onPick: (p: { id: string; name: string }, info: { flags: string[]; claimed: boolean }) => void;
}) {
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

  const { claimers, others } = rows ? splitClaimersFirst(rows, props.claimerIds) : { claimers: [], others: [] };
  const rowCls = 'flex min-h-[60px] w-full shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-muted hover:bg-muted/60';
  const groupLabel = 'sticky top-0 z-10 shrink-0 bg-background px-1 py-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
  const person = (c: AssignCandidate, claimed: boolean) => {
    const flags = assignFlags(c);
    return (
      <button key={c.id} type="button" data-plain="" className={`${rowCls} ${c.blocked ? 'opacity-55' : ''}`}
        onClick={() => props.onPick({ id: c.id, name: c.name }, { flags, claimed })}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold">{c.name}</div>
          <div className="truncate text-[13px] text-muted-foreground">{claimed ? `Claimed · ${c.line}` : c.line}</div>
        </div>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">{flags.map((f) => <FlagTag key={f} label={f} />)}</span>
        <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      </button>
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent className="max-w-md grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Assign to…</DialogTitle>
          <DialogDescription>
            {shift ? DateTime.fromFormat(shift.shift_date, 'yyyy-MM-dd').toFormat('cccc, LLL d') : 'Store crew, checked against availability, time off and other shifts.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] min-h-0 flex-col">
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!rows && !err && <p className="text-sm text-muted-foreground">Loading crew…</p>}
          {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">No one else on this store's schedule.</p>}
          {rows && rows.length > 0 && (
            <CoverListScroller>
              {claimers.length > 0 && <div className={groupLabel}>Claimed · {claimers.length}</div>}
              {claimers.map((c) => person(c, true))}
              {claimers.length > 0 && others.length > 0 && <div className={groupLabel}>Everyone else ({others.length})</div>}
              {others.map((c) => person(c, false))}
            </CoverListScroller>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
