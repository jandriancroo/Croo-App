import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  Plus, Minus, Clock, CalendarDays, ArrowRightLeft, PenLine, Send, EyeOff, RefreshCw, RotateCcw,
  ClipboardCheck, CheckCircle2, CornerUpLeft, Loader2,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useScheduleRestore, type RestorePreview, type RestoreTarget } from '@/hooks/useScheduleRestore';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleId: string | null;
  weekStartDate: Date;
  onChanged?: () => void;
}

interface LogRow {
  id: string; change_type: string; old_shift_data: any; new_shift_data: any; created_at: string;
  changed_by: string | null; user_id: string | null; is_draft: boolean; week_live: boolean; note: string | null;
  source: string; undone_at: string | null; undone_by: string | null;
}

const LIVE_TIP = 'This week is live. Edit and tap Update; every change is tracked. To revert, withdraw the week first.';

const fmtTime = (t?: string) => {
  if (!t) return '';
  const [h, m] = t.split(':'); const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
};
const fmtDay = (d?: string) => (d ? format(new Date(d + 'T12:00:00'), 'EEE, MMM d') : '');
const fmtShift = (s: any) => (s ? `${fmtDay(s.shift_date)} • ${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}` : '');

const TYPE: Record<string, { label: string; icon: any; cls: string }> = {
  added: { label: 'Added', icon: Plus, cls: 'text-primary' },
  removed: { label: 'Removed', icon: Minus, cls: 'text-destructive' },
  time_changed: { label: 'Time changed', icon: Clock, cls: 'text-foreground' },
  date_changed: { label: 'Date moved', icon: CalendarDays, cls: 'text-foreground' },
  reassigned: { label: 'Reassigned', icon: ArrowRightLeft, cls: 'text-foreground' },
  details_changed: { label: 'Details changed', icon: PenLine, cls: 'text-muted-foreground' },
  published: { label: 'Posted', icon: Send, cls: 'text-primary' },
  withdrawn: { label: 'Withdrawn', icon: EyeOff, cls: 'text-destructive' },
  update_sent: { label: 'Update sent', icon: RefreshCw, cls: 'text-primary' },
  reverted: { label: 'Reverted', icon: RotateCcw, cls: 'text-foreground' },
  approval_requested: { label: 'Sent for approval', icon: ClipboardCheck, cls: 'text-foreground' },
  approved: { label: 'Approved', icon: CheckCircle2, cls: 'text-primary' },
  sent_back: { label: 'Sent back', icon: CornerUpLeft, cls: 'text-destructive' },
};

/** Schedule history (every change, draft and live) + Revert tools for draft weeks. */
export function ScheduleHistoryPanel({ open, onOpenChange, scheduleId, weekStartDate, onChanged }: Props) {
  const { restorePreview, restore } = useScheduleRestore(scheduleId, { onChanged });
  const [confirm, setConfirm] = useState<{ target: RestoreTarget; preview: RestorePreview } | null>(null);
  const [busy, setBusy] = useState(false);

  const schedQ = useQuery({
    queryKey: ['schedule-history', scheduleId, 'schedule'],
    enabled: open && !!scheduleId,
    queryFn: async () => {
      const { data } = await supabase.from('schedules')
        .select('is_published, original_shifts_snapshot, original_published_at, original_published_by')
        .eq('id', scheduleId!).maybeSingle();
      return data;
    },
  });

  const logQ = useQuery({
    queryKey: ['schedule-history', scheduleId],
    enabled: open && !!scheduleId,
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_change_log')
        .select('id, change_type, old_shift_data, new_shift_data, created_at, changed_by, user_id, is_draft, week_live, note, source, undone_at, undone_by')
        .eq('schedule_id', scheduleId!)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      const rows = (data || []) as LogRow[];
      const ids = new Set<string>();
      rows.forEach((r) => {
        [r.changed_by, r.user_id, r.undone_by, r.new_shift_data?.user_id, r.old_shift_data?.user_id].forEach((x) => x && ids.add(x));
      });
      const op = schedQ.data?.original_published_by; if (op) ids.add(op);
      const { data: people } = ids.size
        ? await supabase.from('profiles').select('id, full_name').in('id', [...ids])
        : { data: [] as any[] };
      const names: Record<string, string> = Object.fromEntries((people || []).map((p: any) => [p.id, p.full_name]));
      return { rows, names };
    },
  });

  const isLive = !!schedQ.data?.is_published;
  const hasOriginal = !!schedQ.data?.original_shifts_snapshot;
  const names = logQ.data?.names || {};
  const nm = (id?: string | null) => (id ? names[id] || 'Unknown' : 'Open shift');

  const openConfirm = async (target: RestoreTarget) => {
    setBusy(true);
    const preview = await restorePreview(target);
    setBusy(false);
    if (preview) setConfirm({ target, preview });
  };
  const doRestore = async () => {
    if (!confirm) return;
    setBusy(true);
    await restore(confirm.target);
    setBusy(false);
    setConfirm(null);
  };

  const detail = (r: LogRow) => {
    const o = r.old_shift_data, n = r.new_shift_data;
    switch (r.change_type) {
      case 'added': return `${nm(n?.user_id)} — ${fmtShift(n)}`;
      case 'removed': return `${nm(o?.user_id)} — ${fmtShift(o)}`;
      case 'time_changed': return `${nm(n?.user_id)} — ${fmtDay(n?.shift_date)}: ${fmtTime(o?.start_time)}–${fmtTime(o?.end_time)} → ${fmtTime(n?.start_time)}–${fmtTime(n?.end_time)}`;
      case 'date_changed': return `${nm(n?.user_id)} — ${fmtDay(o?.shift_date)} → ${fmtDay(n?.shift_date)}`;
      case 'reassigned': return `${nm(o?.user_id)} → ${nm(n?.user_id)} — ${fmtShift(n)}`;
      case 'details_changed': return `${nm(n?.user_id)} — ${fmtShift(n)}`;
      case 'withdrawn': return r.note === 'Cleared' ? 'Cleared' : null;
      default: return r.note && r.note !== 'Original' ? r.note : null;
    }
  };

  const revertButton = (target: RestoreTarget, label: string, sub?: string | null) => {
    const disabled = busy || isLive || (target === 'original' && !hasOriginal);
    const tip = isLive ? LIVE_TIP : target === 'original' && !hasOriginal ? "No original yet: this week hasn't been posted" : null;
    const btn = (
      <span className="inline-flex w-full">
        <Button variant="outline" className="h-auto w-full flex-col items-start py-2" disabled={disabled} onClick={() => openConfirm(target)}>
          <span className="flex items-center gap-2"><RotateCcw className="h-4 w-4" />{label}</span>
          {sub && <span className="text-[11px] font-normal text-muted-foreground">{sub}</span>}
        </Button>
      </span>
    );
    return tip ? <Tooltip><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent className="max-w-xs">{tip}</TooltipContent></Tooltip> : btn;
  };

  const origSub = schedQ.data?.original_published_at
    ? `posted ${format(new Date(schedQ.data.original_published_at), "EEE h:mm a")}${schedQ.data.original_published_by ? ` by ${names[schedQ.data.original_published_by] || '…'}` : ''}`
    : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              History
              <Badge variant="outline" className="text-xs font-normal">Week of {format(weekStartDate, 'MMM d, yyyy')}</Badge>
            </SheetTitle>
          </SheetHeader>

          <div className="grid gap-2 py-3">
            {revertButton('start_of_today', 'Revert to start of today')}
            {revertButton('original', 'Revert to original publish', origSub)}
          </div>

          {logQ.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !logQ.data?.rows.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No changes recorded for this week yet.</p>
          ) : (
            <ScrollArea className="flex-1 -mr-4 pr-4">
              <div className="space-y-2 pb-6">
                {logQ.data.rows.map((r) => {
                  const t = TYPE[r.change_type] || { label: r.change_type, icon: PenLine, cls: '' };
                  const Icon = t.icon;
                  const d = detail(r);
                  return (
                    <div key={r.id} className={cn('rounded-lg border bg-card p-3', r.undone_at && 'opacity-50')}>
                      <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        <Icon className={cn('h-4 w-4', t.cls)} />
                        <span className="font-medium">{r.change_type === 'withdrawn' && r.note === 'Cleared' ? 'Cleared' : t.label}</span>
                        {r.change_type === 'published' && r.note === 'Original' && <Badge variant="secondary" className="text-[10px]">Original</Badge>}
                        {r.source === 'shift_offer' && <Badge variant="outline" className="text-[10px]">Shift swap</Badge>}
                        {r.source === 'undo' && <Badge variant="outline" className="text-[10px]">Undo</Badge>}
                        {(r.source === 'revert_original' || r.source === 'revert_today') && r.change_type !== 'reverted' && <Badge variant="outline" className="text-[10px]">Revert</Badge>}
                        {!r.week_live && <Badge variant="outline" className="text-[10px]">Draft</Badge>}
                        {r.week_live && ['added','removed','time_changed','date_changed','reassigned','details_changed'].includes(r.change_type) && (
                          <Badge variant="outline" className={cn('text-[10px]', r.is_draft ? 'border-amber-500 text-amber-600' : 'border-primary text-primary')}>
                            {r.is_draft ? 'Not sent yet' : 'Sent'}
                          </Badge>
                        )}
                      </div>
                      {d && <p className="mt-1 text-sm text-muted-foreground">{d}</p>}
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {r.changed_by ? `Changed by ${names[r.changed_by] || 'Unknown'}` : 'System'} • {format(new Date(r.created_at), "MMM d 'at' h:mm a")}
                        {r.undone_at && ` • Undone by ${names[r.undone_by || ''] || 'someone'}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.target === 'original' ? 'Revert to original publish?' : 'Revert to start of today?'}</AlertDialogTitle>
            <AlertDialogDescription>
              This changes {confirm?.preview.shifts_affected} shift{confirm?.preview.shifts_affected === 1 ? '' : 's'} ({confirm?.preview.people} {confirm?.preview.people === 1 ? 'person' : 'people'}).
              {confirm && confirm.preview.skipped_past + confirm.preview.skipped_punched > 0 &&
                ` Skips ${confirm.preview.skipped_past + confirm.preview.skipped_punched} past-day / punched shift${confirm.preview.skipped_past + confirm.preview.skipped_punched === 1 ? '' : 's'}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); doRestore(); }}>{busy ? 'Reverting…' : 'Revert'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
