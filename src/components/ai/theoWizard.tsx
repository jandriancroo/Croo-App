// THE ONE Theo action wizard (previews, tappable lists, Confirm, Undo, the action log), shared by the
// voice screen and the typed chat. The chat bubble owns the one copy, so only one preview is ever open.
// Theo never writes: every save below is the manager's tap, through src/lib/scheduleActions.ts or src/lib/quickTasks.ts.
import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Check, AlertTriangle, ChevronRight } from 'lucide-react';
import { ROLE_DISPLAY_NAMES, type AppRole } from '@/hooks/useUserRole';
import { createStandardQuickTask, deleteQuickTask, durationLabel } from '@/lib/quickTasks';
import { reassignAndNotify, applyThenUpdate, addShift, deleteShift, restoreShift, readShiftRow, ensureDraftSchedule, updateShiftTimes, swapShiftsAndNotify } from '@/lib/scheduleActions';
import { countPendingChanges } from '@/lib/scheduleDiff';
import { savePunchReturning, deletePunch, deletePlaceholderShift } from '@/lib/punches';
import { sendChatMessage, findOrCreateDm, unsendMessage } from '@/lib/chatMessages';
import { sendQuickNudge, nameList, NUDGE_ICON } from '@/lib/quickNudges';
import { createScheduleEvent, deleteScheduleEvent, createEventCategory, deleteEventCategory } from '@/lib/scheduleEvents';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';

export type TheoSource = 'voice' | 'chat';
// Text colours around the card: the voice screen sits on a dark glass, the chat on the app background.
type Colors = { fg: string; dim: string; close: string };
const VOICE_COLORS: Colors = { fg: 'text-white', dim: 'text-white/[0.78]', close: 'text-white/80' };
export const CHAT_COLORS: Colors = { fg: 'text-foreground', dim: 'text-muted-foreground', close: 'text-muted-foreground' };
// Theo hands (build 1): a proposal Theo made; saved only by the manager's Create task tap.
type TaskProposal = { id: string; action: 'create_task'; title: string; employees: { id: string; name: string }[]; roles: string[]; duration: string };
// Theo hands (build 2): cover a shift. Saved only by the manager's Confirm change tap.
type CoverProposal = {
  id: string; action: 'cover_shift'; shift_id: string; schedule_id: string; day_of_week: number; shift_date: string;
  start_time: string; end_time: string; date_label: string; time_label: string;
  covered: { id: string; name: string }; replacement: { id: string; name: string };
  checks: string[]; tag: string | null; published: boolean; day?: DayView;
};
// Theo hands (build 3): the day as it will be, shared by add, cover and delete previews.
type RowKind = 'new' | 'cover' | 'removed' | 'swapped' | 'changed';
type DayRow = { id: string; name: string; position: string; time: string; start: number; end: number; kind: RowKind | null; was?: string };
type DayView = { date: string; title: string; rows: DayRow[] };
type AddProposal = {
  id: string; action: 'add_shift'; employee: { id: string; name: string }; shift_date: string; start_time: string; end_time: string;
  template_id: string | null; position: string | null; week_start: string; schedule_id: string | null; day_of_week: number; published: boolean;
  date_label: string; time_label: string; warnings: string[]; info: string[]; day: DayView;
};
type DeleteProposal = {
  id: string; action: 'delete_shift'; shift_id: string; schedule_id: string; day_of_week: number; shift_date: string; start_time: string; end_time: string;
  template_id: string | null; position: string | null; employee: { id: string; name: string }; published: boolean;
  date_label: string; time_label: string; warnings: string[]; info: string[]; day: DayView;
};
// Theo hands (build 4): swap two shifts, change a shift's hours.
type SwapSide = { shift_id: string; schedule_id: string; day_of_week: number; shift_date: string; start_time: string; end_time: string; date_label: string; time_label: string; owner: { id: string; name: string }; published: boolean };
type SwapProposal = {
  id: string; action: 'swap_shift'; a: SwapSide; b: SwapSide; published: boolean; two_weeks: boolean; notified: string[];
  warnings: string[]; info: string[]; days: DayView[]; date_label: string; time_label: string;
};
type ChangeProposal = {
  id: string; action: 'change_shift'; shift_id: string; schedule_id: string; day_of_week: number; shift_date: string;
  start_time: string; end_time: string; old_start: string; old_end: string; template_id: string | null; position: string | null;
  employee: { id: string; name: string }; published: boolean; date_label: string; time_label: string; old_time_label: string;
  warnings: string[]; info: string[]; day: DayView;
};
// Theo hands (build 5): add a schedule event (one-time or recurring). Saved only by the Add event tap.
export type EventProposal = {
  id: string; action: 'create_event'; name: string; mode: 'one-time' | 'recurring'; event_date: string | null; day_of_week: number; days: number[];
  start_time: string; end_time: string | null; category: { id: string | null; name: string; color: string; is_new: boolean } | null;
  notes: string | null; is_daily_task: boolean; is_meeting: boolean; tagged_roles: string[]; tagged_labels: string[];
  week_start: string | null; week_end: string | null; schedule_id: string | null; needs_draft: boolean; when_label: string; warnings: string[];
};
// Theo hands (build 6A): reply in a chat or start a DM. Sent only by the Send tap.
export type MessageProposal = {
  id: string; action: 'send_message'; kind: 'dm' | 'group'; chat_id: string | null; new_dm: boolean; to: { id: string; name: string } | null;
  group_title: string | null; member_count: number; recipients: number; text: string; reply_to: { id: string; sender: string; text: string } | null; warnings: string[];
};
// Theo hands (build 6C): clock one person in or out. Saved only by the Confirm tap.
export type PunchProposal = {
  id: string; action: 'clock_punch'; kind: 'in' | 'out'; employee: { id: string; name: string }; punch_time: string; time_label: string; date_label: string;
  store: string; location_id: string; shift_id: string | null; open_clock_in_id: string | null; clock_in_label: string | null; notes: string; flags: string[];
};
// Quick Nudge: a push to everyone on the clock about one checklist, task or event. Sent only by the Send nudge tap (quick-nudge).
export type NudgeProposal = {
  id: string; action: 'quick_nudge'; target: { type: 'checklist' | 'task' | 'event'; id: string; title: string; done: number | null; total: number | null; event_time: string | null };
  recipients: { id: string; name: string }[]; recently: { name: string; minutes_ago: number }[]; template_id: string | null; message: string;
  preview_for: { name: string; text: string }; store: string; location_id: string; warnings: string[];
};
export type ShiftProposal = CoverProposal | AddProposal | DeleteProposal | SwapProposal | ChangeProposal;
export type AnyProposal = TaskProposal | ShiftProposal | EventProposal | MessageProposal | PunchProposal | NudgeProposal;
export type ActionCard = { stage: 'preview' | 'saving' | 'done' | 'undoing' | 'undone'; proposal: AnyProposal; logId: Promise<string | null>; error?: string; taskId?: string; savedAt?: string; undoOpen?: boolean; otherChanges?: number; notified?: boolean; newShiftId?: string; scheduleId?: string; removedRow?: Record<string, any>; eventId?: string; newCategoryId?: string | null; messageId?: string; punchId?: string; placeholderAdded?: boolean };
export type Acts = { create_task: boolean; cover_shift: boolean; add_shift: boolean; delete_shift: boolean; swap_shift: boolean; change_shift: boolean; create_event: boolean; send_message: boolean; clock_punch: boolean; quick_nudge: boolean };
export const NO_ACTS: Acts = { create_task: false, cover_shift: false, add_shift: false, delete_shift: false, swap_shift: false, change_shift: false, create_event: false, send_message: false, clock_punch: false, quick_nudge: false };
/** The server's actions answer, read strictly (anything not exactly true is off). */
export const readActs = (a: any): Acts => ({ create_task: a?.create_task === true, cover_shift: a?.cover_shift === true, add_shift: a?.add_shift === true, delete_shift: a?.delete_shift === true, swap_shift: a?.swap_shift === true, change_shift: a?.change_shift === true, create_event: a?.create_event === true, send_message: a?.send_message === true, clock_punch: a?.clock_punch === true, quick_nudge: a?.quick_nudge === true });
export const isShiftAction = (p: AnyProposal): p is ShiftProposal => p.action === 'cover_shift' || p.action === 'add_shift' || p.action === 'delete_shift' || p.action === 'swap_shift' || p.action === 'change_shift';
type ScreenRow = { employee_id: string; name: string; line: string; tag: string | null };
export type CoverScreen =
  | { kind: 'shifts'; purpose?: 'cover' | 'delete'; date: string; title: string; shifts: { shift_id: string; employee_id: string; name: string; time: string }[] }
  | { kind: 'people'; purpose?: 'cover' | 'delete'; date: string; title: string; people: { employee_id: string; name: string }[] }
  | { kind: 'templates'; title: string; subtitle: string; draft: { employee_id: string; date: string; start_time: string; end_time: string }; rows: { template_id: string; name: string; line: string }[] }
  | { kind: 'candidates'; shift_id: string; title: string; subtitle: string; clear: ScreenRow[]; working: ScreenRow[]; blocked_summary: string | null };

// 1px hairline between two neighbouring PLAIN rows only (rows marked data-plain). Drawn in the 4px gap, so row heights never change.
const HAIRLINE = "[&>[data-plain]]:relative [&>[data-plain]+[data-plain]::before]:pointer-events-none [&>[data-plain]+[data-plain]::before]:absolute [&>[data-plain]+[data-plain]::before]:inset-x-3 [&>[data-plain]+[data-plain]::before]:top-[-2.5px] [&>[data-plain]+[data-plain]::before]:h-px [&>[data-plain]+[data-plain]::before]:bg-border/60 [&>[data-plain]+[data-plain]::before]:content-['']";

function CoverListScroller({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    setMoreBelow(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, []);

  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, updateFade]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    event.stopPropagation();
    updateFade();
  };

  return (
    <div className="relative flex max-h-full w-full flex-col overflow-hidden rounded-[20px] bg-card">
      <div ref={scrollRef} onScroll={onScroll} onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()}
        className={`min-h-[60px] max-h-[354px] flex-1 overflow-y-auto overscroll-contain p-3 text-foreground [-webkit-overflow-scrolling:touch] touch-pan-y md:max-h-[474px] flex flex-col gap-1 ${HAIRLINE}`}>
        {children}
      </div>
      {moreBelow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />}
    </div>
  );
}


const NEW_GREEN = 'hsl(142 70% 28%)';
const KIND_COLOR: Record<RowKind, string> = { new: NEW_GREEN, cover: NEW_GREEN, swapped: NEW_GREEN, changed: NEW_GREEN, removed: 'hsl(var(--destructive))' };
const KIND_TINT: Record<RowKind, number> = { new: 9, cover: 9, swapped: 9, changed: 9, removed: 7 };
const KIND_TAG: Record<RowKind, string> = { new: 'New', cover: 'Covering', swapped: 'Swapped', changed: 'Changed', removed: 'Removed' };
/** The day as it will be: one quiet read-only line per shift; changed rows tinted with a left edge and a chip. Rows scroll inside the card. */
function DayRows({ view }: { view: DayView }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.querySelector('[data-changed="1"]')?.scrollIntoView({ block: 'nearest' }); }, [view]);
  return (
    <div ref={boxRef} className="flex min-h-0 flex-col">
      <CoverListScroller>
        {view.rows.length === 0 && <p className="p-2 text-[14px] text-muted-foreground">No one else is on that day.</p>}
        {view.rows.map((r) => {
          const k = r.kind;
          const col = k ? KIND_COLOR[k] : '';
          const strike = k === 'removed' ? 'line-through' : '';
          return (
            <div key={r.id} data-changed={k ? '1' : undefined} data-plain={k ? undefined : ''}
              className="flex min-h-[42px] shrink-0 items-center justify-between gap-2 rounded-[10px] py-[6px] pl-[11px] pr-[10px]"
              style={k ? { background: `color-mix(in srgb, ${col} ${KIND_TINT[k]}%, transparent)`, boxShadow: `inset 3px 0 0 ${col}` } : undefined}>
              <div className="min-w-0">
                <div className={`truncate text-[14.5px] font-extrabold ${strike}`}>{r.name}</div>
                <div className="truncate text-[12px] font-semibold text-muted-foreground">{r.position}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {k && <span className="inline-flex h-5 items-center rounded-full px-2 text-[11px] font-extrabold text-white" style={{ background: col }}>{KIND_TAG[k]}</span>}
                <span className="flex flex-col items-end">
                  <span className={`whitespace-nowrap text-[13px] font-bold ${strike}`}>{r.time}</span>
                  {r.was && <span className="whitespace-nowrap text-[12px] text-muted-foreground"><span className="sr-only">was </span><span className="line-through">{r.was}</span></span>}
                </span>
              </div>
            </div>
          );
        })}
      </CoverListScroller>
    </div>
  );
}

const firstName = (n: string) => n.split(' ')[0];
const UNDO_MS = 10 * 60 * 1000;
const roleLabel = (r: string) => ROLE_DISPLAY_NAMES[r as AppRole] ?? r;
const whoText = (p: TaskProposal) => [...p.employees.map((e) => e.name), ...p.roles.map(roleLabel)].join(', ');
const notifyText = (p: TaskProposal) => {
  const parts = [...p.employees.map((e) => e.name.split(' ')[0]), ...p.roles.map((r) => `${roleLabel(r)}s`)];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${list} ${parts.length === 1 && p.roles.length === 0 ? 'is' : 'are'} notified`;
};
const DEEP_PRIMARY = 'color-mix(in srgb, hsl(var(--primary)) 75%, black)';

export function useTheoWizard({ onRecord }: { onRecord?: (text: string) => void }) {
  const { currentLocation } = useLocation();
  const { user } = useAuth();
  const { timezone } = useLocationTimezone();
  // Which screen opened what is on show now (written to the action log; used for list taps and the re-check).
  const ownerRef = useRef<TheoSource>('voice');
  // Cover-a-shift lists (shift picker, which-person, who-can-cover). Showing one changes nothing.
  const [screen, setScreenState] = useState<CoverScreen | null>(null);
  const screenRef = useRef<CoverScreen | null>(null);
  const setScreen = (sc: CoverScreen | null, source?: TheoSource) => { if (source) ownerRef.current = source; screenRef.current = sc; setScreenState(sc); };
  const [screenNote, setScreenNote] = useState('');
  const [picking, setPicking] = useState(false);
  // Action preview card: lives outside the voice line, so hang-ups and the time limit never dismiss it.
  const [action, setActionState] = useState<ActionCard | null>(null);
  const actionRef = useRef<ActionCard | null>(null);
  const setAction = (a: ActionCard | null) => { actionRef.current = a; setActionState(a); };
  const logAction = (logId: Promise<string | null>, patch: Record<string, unknown>) => {
    void logId.then((id) => { if (id) void supabase.from('theo_action_log').update(patch as any).eq('id', id).then(() => {}); });
  };
  /** Close everything (a screen closed, or the other screen opened): an open preview is logged cancelled. */
  const dropAll = () => { const a = actionRef.current; if (a?.stage === 'preview') logAction(a.logId, { status: 'cancelled' }); setAction(null); setScreen(null); setScreenNote(''); };
  /** The preview to send up with the next message: only an open preview, never a dropped or saved one. */
  const openPreview = () => (actionRef.current?.stage === 'preview' ? actionRef.current.proposal : null);

  /** Put a proposal on screen and log it as previewed. False if a save is in progress. */
  const showProposal = (proposal: AnyProposal, source: TheoSource) => {
    if (!user?.id || !currentLocation?.id) return false;
    const prev = actionRef.current;
    if (prev?.stage === 'saving') return false;
    if (prev?.stage === 'preview') logAction(prev.logId, { status: 'cancelled' });
    const logId = Promise.resolve(supabase.from('theo_action_log')
      .insert({ user_id: user.id, location_id: currentLocation.id, action: proposal.action, proposal: proposal as any, status: 'previewed', source } as any)
      .select('id').single()).then(({ data: row }) => row?.id ?? null, () => null);
    ownerRef.current = source;
    setScreen(null);
    setScreenNote('');
    setAction({ stage: 'preview', proposal, logId });
    const pubWeeks = !isShiftAction(proposal) ? [] : proposal.action === 'swap_shift'
      ? [...new Set([proposal.a, proposal.b].filter((s) => s.published).map((s) => s.schedule_id))]
      : proposal.published && proposal.schedule_id ? [proposal.schedule_id] : [];
    if (pubWeeks.length) {
      // Other changes already waiting on the published week(s) go out with the Update.
      void (async () => {
        let n = 0;
        for (const sid of pubWeeks) {
          const [{ data: sch }, { data: cur }] = await Promise.all([
            supabase.from('schedules').select('published_shifts_snapshot').eq('id', sid).single(),
            supabase.from('scheduled_shifts').select('id, user_id, start_time, end_time, shift_date, day_of_week').eq('schedule_id', sid),
          ]);
          const snap = Array.isArray(sch?.published_shifts_snapshot) ? (sch!.published_shifts_snapshot as any[]) : [];
          n += countPendingChanges(snap, cur as any[]);
        }
        const c = actionRef.current;
        if (c?.proposal.id === proposal.id) setAction({ ...c, otherChanges: n });
      })();
    }
    return true;
  };

  /** A tap on a list row: answered by the app's code, never by the AI. Saves nothing. */
  const pickFromScreen = async (pick: Record<string, unknown>) => {
    if (picking) return;
    setPicking(true);
    setScreenNote('');
    try {
      const { data, error: e } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation?.id, location_name: currentLocation?.name, source: ownerRef.current, pick },
      });
      if (e) { setScreenNote('Theo could not reach the schedule right now.'); return; }
      if (data?.proposal?.action && isShiftAction(data.proposal)) { showProposal(data.proposal as ShiftProposal, ownerRef.current); return; }
      if (data?.screen?.kind) { setScreen(data.screen as CoverScreen); return; }
      setScreenNote(data?.content || '');
    } finally {
      setPicking(false);
    }
  };


  // After Theo moves a shift (Confirm or Undo), throw away every saved copy that shows shifts,
  // so the Schedule page and the shift cards reload fresh (and Update never re-sends Theo's change).
  const queryClient = useQueryClient();
  const refreshShiftViews = (locationId: string) => {
    for (const key of [['schedule', locationId], ['compact-dash-shifts', locationId], ['manager-dash-shifts', locationId], ['watch-today-schedule', locationId], ['manager-shifts-org']]) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  // Confirm for every schedule action (add, cover, delete): re-check at the tap, then the shared
  // "apply the change, then Update if published" path. Nothing here decides anything; the server re-check does.
  const confirmShift = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'preview' || !isShiftAction(a.proposal) || !user?.id || !currentLocation?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'saving', error: undefined });
    try {
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'recheck', proposal: p } },
      });
      if (ce || !chk?.recheck) throw new Error('Could not re-check the shift.');
      if (!chk.recheck.ok) {
        logAction(a.logId, { status: 'failed' });
        setAction({ ...a, stage: 'preview', error: `Not saved. Something changed: ${chk.recheck.changed}` });
        return;
      }
      const opts = (scheduleId: string) => ({ scheduleId, changedBy: user.id, timezone });
      let next: Partial<ActionCard> = {};
      let notified = false;
      let record = '';
      if (p.action === 'cover_shift') {
        const res = await reassignAndNotify({ shift: { id: p.shift_id, schedule_id: p.schedule_id, day_of_week: p.day_of_week, shift_date: p.shift_date }, toUserId: p.replacement.id, changedBy: user.id, timezone });
        notified = res.notified; record = p.shift_id;
        onRecord?.(`Covered shift: ${p.date_label}, ${p.time_label}. ${p.replacement.name} takes it from ${p.covered.name}`);
      } else if (p.action === 'swap_shift') {
        const res = await swapShiftsAndNotify({
          a: { id: p.a.shift_id, schedule_id: p.a.schedule_id, day_of_week: p.a.day_of_week, shift_date: p.a.shift_date, fromUserId: p.a.owner.id, toUserId: p.b.owner.id },
          b: { id: p.b.shift_id, schedule_id: p.b.schedule_id, day_of_week: p.b.day_of_week, shift_date: p.b.shift_date, fromUserId: p.b.owner.id, toUserId: p.a.owner.id },
          changedBy: user.id, timezone,
        });
        notified = res.notified; record = p.a.shift_id;
        onRecord?.(`Swapped shifts: ${p.b.owner.name} takes ${p.a.date_label}, ${p.a.time_label}; ${p.a.owner.name} takes ${p.b.date_label}, ${p.b.time_label}`);
      } else if (p.action === 'change_shift') {
        const res = await applyThenUpdate(opts(p.schedule_id), () => updateShiftTimes(p.shift_id, p.start_time, p.end_time));
        notified = res.notified; record = p.shift_id;
        onRecord?.(`Changed hours: ${p.employee.name}, ${p.date_label}, now ${p.time_label} (was ${p.old_time_label})`);
      } else if (p.action === 'add_shift') {
        const weekEnd = new Date(`${p.week_start}T12:00:00Z`); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        const sch = p.schedule_id ? { id: p.schedule_id } : await ensureDraftSchedule(currentLocation.id, p.week_start, weekEnd.toISOString().slice(0, 10));
        const res = await applyThenUpdate(opts(sch.id), () => addShift({ schedule_id: sch.id, template_id: p.template_id, user_id: p.employee.id, day_of_week: p.day_of_week, shift_date: p.shift_date, start_time: p.start_time, end_time: p.end_time }));
        notified = res.notified; record = res.result.id;
        next = { newShiftId: res.result.id, scheduleId: sch.id };
        onRecord?.(`Added shift: ${p.employee.name}, ${p.date_label}, ${p.time_label}${p.position ? ` (${p.position})` : ''}`);
      } else {
        const row = await readShiftRow(p.shift_id); // every column, kept for Undo
        const res = await applyThenUpdate(opts(p.schedule_id), () => deleteShift(p.shift_id));
        notified = res.notified; record = p.shift_id;
        next = { removedRow: row, scheduleId: p.schedule_id };
        onRecord?.(`Deleted shift: ${p.employee.name}, ${p.date_label}, ${p.time_label}`);
      }
      refreshShiftViews(currentLocation.id);
      logAction(a.logId, { status: 'confirmed', record_id: record });
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, ...next, stage: 'done', savedAt, undoOpen: true, notified });
      setTimeout(() => { const cur = actionRef.current; if (cur?.proposal.id === p.id && cur.stage === 'done') setAction({ ...cur, undoOpen: false }); }, UNDO_MS);
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: err?.message === 'Not saved' ? 'Not saved. The swap could not be finished, so nothing changed.' : err?.message ? `Couldn't save: ${err.message}` : "Couldn't save the change. Try again." });
    }
  };
  // Undo (10 minutes): the same shared path in reverse, then Update if published.
  const undoShift = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'done' || !isShiftAction(a.proposal) || !user?.id || !currentLocation?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'undoing', error: undefined });
    try {
      // Server store + role check first (same switch as the request and the Confirm re-check).
      const weekIds = p.action === 'swap_shift' ? [p.a.schedule_id, p.b.schedule_id] : [a.scheduleId || p.schedule_id];
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'undo_shift', action: p.action, schedule_ids: weekIds } },
      });
      if (ce || !chk?.undo) throw new Error('check');
      if (!chk.undo.ok) { setAction({ ...a, stage: 'done', error: `Not undone: ${chk.undo.reason}` }); return; }
      if (p.action === 'cover_shift') {
        await reassignAndNotify({ shift: { id: p.shift_id, schedule_id: p.schedule_id, day_of_week: p.day_of_week, shift_date: p.shift_date }, toUserId: p.covered.id, changedBy: user.id, timezone });
        onRecord?.(`Undid shift cover: ${p.covered.name} has ${p.date_label}, ${p.time_label} again`);
      } else if (p.action === 'swap_shift') {
        await swapShiftsAndNotify({
          a: { id: p.a.shift_id, schedule_id: p.a.schedule_id, day_of_week: p.a.day_of_week, shift_date: p.a.shift_date, fromUserId: p.b.owner.id, toUserId: p.a.owner.id },
          b: { id: p.b.shift_id, schedule_id: p.b.schedule_id, day_of_week: p.b.day_of_week, shift_date: p.b.shift_date, fromUserId: p.a.owner.id, toUserId: p.b.owner.id },
          changedBy: user.id, timezone,
        });
        onRecord?.(`Undid shift swap: ${p.a.owner.name} and ${p.b.owner.name} have their own shifts again`);
      } else if (p.action === 'change_shift') {
        await applyThenUpdate({ scheduleId: p.schedule_id, changedBy: user.id, timezone }, () => updateShiftTimes(p.shift_id, p.old_start, p.old_end));
        onRecord?.(`Undid hours change: ${p.employee.name}, ${p.date_label}, back to ${p.old_time_label}`);
      } else if (p.action === 'add_shift') {
        if (!a.newShiftId || !a.scheduleId) throw new Error('missing shift');
        const id = a.newShiftId;
        await applyThenUpdate({ scheduleId: a.scheduleId, changedBy: user.id, timezone }, () => deleteShift(id));
        onRecord?.(`Undid added shift: ${p.employee.name}, ${p.date_label}, ${p.time_label}`);
      } else {
        if (!a.removedRow || !a.scheduleId) throw new Error('missing shift');
        const row = a.removedRow;
        await applyThenUpdate({ scheduleId: a.scheduleId, changedBy: user.id, timezone }, () => restoreShift(row));
        onRecord?.(`Undid deleted shift: ${p.employee.name} has ${p.date_label}, ${p.time_label} again`);
      }
      if (currentLocation?.id) refreshShiftViews(currentLocation.id);
      logAction(a.logId, { status: 'undone' });
      setAction({ ...a, stage: 'undone' });
    } catch {
      setAction({ ...a, stage: 'done', error: "Couldn't undo the change. Try again." });
    }
  };
  const confirmTask = async () => {
    const a = actionRef.current;
    if (a && isShiftAction(a.proposal)) return confirmShift();
    if (a?.proposal.action === 'create_event') return confirmEvent();
    if (a?.proposal.action === 'send_message') return confirmMessage();
    if (a?.proposal.action === 'clock_punch') return confirmPunch();
    if (a?.proposal.action === 'quick_nudge') return confirmNudge();
    if (!a || a.stage !== 'preview' || a.proposal.action !== 'create_task' || !user?.id || !currentLocation?.id) return;
    setAction({ ...a, stage: 'saving', error: undefined }); // disables the button: no double save
    try {
      const task = await createStandardQuickTask({
        locationId: currentLocation.id, createdBy: user.id, title: a.proposal.title,
        employeeIds: a.proposal.employees.map((e) => e.id), roles: a.proposal.roles, duration: a.proposal.duration,
      });
      logAction(a.logId, { status: 'confirmed', record_id: task.id });
      onRecord?.(`Created quick task: ${a.proposal.title}, for ${whoText(a.proposal)}`);
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, stage: 'done', taskId: task.id, savedAt, undoOpen: true });
      setTimeout(() => { const c = actionRef.current; if (c?.taskId === task.id && c.stage === 'done') setAction({ ...c, undoOpen: false }); }, UNDO_MS);
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: err?.message ? `Couldn't save: ${err.message}` : "Couldn't save the task. Try again." });
    }
  };
  // Events show on the schedule pages, the punch clock and (daily tasks) the dashboard: reload every saved copy that holds events.
  const refreshEventViews = () => queryClient.invalidateQueries({ predicate: (q) => /event/i.test(JSON.stringify(q.queryKey)) });
  // Add event: re-check at the tap, then the ONE shared save (src/lib/scheduleEvents.ts). Category first, then the event.
  const confirmEvent = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'preview' || a.proposal.action !== 'create_event' || !user?.id || !currentLocation?.id) return;
    const p = a.proposal;
    const locationId = currentLocation.id;
    setAction({ ...a, stage: 'saving', error: undefined });
    let newCategoryId: string | null = null;
    try {
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: locationId, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'recheck', proposal: p } },
      });
      if (ce || !chk?.recheck) throw new Error('Could not re-check the event.');
      if (!chk.recheck.ok) {
        logAction(a.logId, { status: 'failed' });
        setAction({ ...a, stage: 'preview', error: `Not saved. Something changed: ${chk.recheck.changed}` });
        return;
      }
      let scheduleId: string | null = chk.recheck.schedule_id ?? null;
      if (p.mode === 'one-time' && !scheduleId) scheduleId = (await ensureDraftSchedule(locationId, p.week_start!, p.week_end!)).id;
      let categoryId = p.category?.id ?? null;
      if (p.category?.is_new) { newCategoryId = (await createEventCategory({ locationId, name: p.category.name, color: p.category.color })).id; categoryId = newCategoryId; }
      let eventId: string;
      try {
        const common = { locationId, name: p.name, startTime: p.start_time, endTime: p.end_time, notes: p.notes, taggedRoles: p.tagged_roles, categoryId, isDailyTask: p.is_daily_task, isMeeting: p.is_meeting };
        eventId = p.mode === 'one-time'
          ? await createScheduleEvent({ ...common, mode: 'one-time', scheduleId: scheduleId!, eventDate: p.event_date!, dayOfWeek: p.day_of_week })
          : await createScheduleEvent({ ...common, mode: 'recurring', days: p.days });
      } catch (err) {
        if (newCategoryId) { try { await deleteEventCategory(newCategoryId); } catch { /* reported below */ } }
        throw new Error('Not saved');
      }
      refreshEventViews();
      logAction(a.logId, { status: 'confirmed', record_id: eventId });
      onRecord?.(`Added event: ${p.name}, ${p.when_label}${p.category ? ` (${p.category.name})` : ''}`);
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, stage: 'done', savedAt, undoOpen: true, eventId, newCategoryId });
      setTimeout(() => { const cur = actionRef.current; if (cur?.proposal.id === p.id && cur.stage === 'done') setAction({ ...cur, undoOpen: false }); }, UNDO_MS);
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: err?.message === 'Not saved' ? 'Not saved. The event could not be added, so nothing changed.' : err?.message ? `Couldn't save: ${err.message}` : "Couldn't save the event. Try again." });
    }
  };
  // Undo (10 minutes): refused if someone ticked the daily task or an attendee was added; the new category goes only if unused.
  const undoEvent = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'done' || a.proposal.action !== 'create_event' || !a.eventId || !currentLocation?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'undoing', error: undefined });
    try {
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'undo_event', event_id: a.eventId, category_id: a.newCategoryId ?? null } },
      });
      if (ce || !chk?.undo) throw new Error('check');
      if (!chk.undo.ok) { setAction({ ...a, stage: 'done', error: chk.undo.reason }); return; }
      await deleteScheduleEvent(a.eventId);
      if (a.newCategoryId && !chk.undo.category_in_use) { try { await deleteEventCategory(a.newCategoryId); } catch { /* category stays; harmless */ } }
      refreshEventViews();
      logAction(a.logId, { status: 'undone' });
      onRecord?.(`Removed event: ${p.name}, ${p.when_label}`);
      setAction({ ...a, stage: 'undone' });
    } catch {
      setAction({ ...a, stage: 'done', error: "Couldn't undo the event. Try again." });
    }
  };
  // Send message: re-check at the tap, then the ONE shared send (src/lib/chatMessages.ts), which also sends the chat push.
  const confirmMessage = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'preview' || a.proposal.action !== 'send_message' || !user?.id || !currentLocation?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'saving', error: undefined });
    try {
      await a.logId; // the preview must be in the action log: the re-check compares the words against it
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'recheck', proposal: p } },
      });
      if (ce || !chk?.recheck) throw new Error('Could not re-check the message.');
      if (!chk.recheck.ok) {
        logAction(a.logId, { status: 'failed' });
        setAction({ ...a, stage: 'preview', error: `Not sent. Something changed: ${chk.recheck.changed}` });
        return;
      }
      let chatId: string | null = chk.recheck.chat_id ?? null;
      if (!chatId && p.to) chatId = (await findOrCreateDm({ userId: user.id, otherUserId: p.to.id, locationId: currentLocation.id })).chatId;
      if (!chatId) throw new Error('no chat');
      const sent = await sendChatMessage({ chatId, senderId: user.id, content: p.text, parentMessageId: p.reply_to?.id ?? null });
      queryClient.invalidateQueries({ queryKey: ['chat-messages', chatId] });
      logAction(a.logId, { status: 'confirmed', record_id: sent.id });
      onRecord?.(`Sent message to ${p.kind === 'group' ? p.group_title : p.to?.name}: "${p.text}"`);
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, stage: 'done', savedAt, undoOpen: true, messageId: sent.id });
      setTimeout(() => { const cur = actionRef.current; if (cur?.proposal.id === p.id && cur.stage === 'done') setAction({ ...cur, undoOpen: false }); }, UNDO_MS);
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: err?.message ? `Couldn't send: ${err.message}` : "Couldn't send the message. Try again." });
    }
  };
  // Unsend (10 minutes): the chat window's own unsend. The notification may already have been seen.
  const undoMessage = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'done' || a.proposal.action !== 'send_message' || !a.messageId || !user?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'undoing', error: undefined });
    try {
      await unsendMessage(a.messageId, user.id);
      logAction(a.logId, { status: 'undone' });
      onRecord?.(`Unsent message to ${p.kind === 'group' ? p.group_title : p.to?.name}`);
      setAction({ ...a, stage: 'undone' });
    } catch {
      setAction({ ...a, stage: 'done', error: "Couldn't unsend the message. Try again." });
    }
  };
  // Nudge: the ONE send path (src/lib/quickNudges.ts); the server re-checks everything and picks the recipients. No Undo.
  const confirmNudge = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'preview' || a.proposal.action !== 'quick_nudge' || !currentLocation?.id) return;
    const p = a.proposal;
    if (p.location_id !== currentLocation.id) { setAction({ ...a, error: 'Not sent. You switched stores.' }); return; }
    setAction({ ...a, stage: 'saving', error: undefined });
    try {
      const res = await sendQuickNudge({ targetType: p.target.type, targetId: p.target.id, message: p.message, templateId: p.template_id, source: ownerRef.current === 'voice' ? 'theo_voice' : 'theo_chat', theoProposalId: p.id });
      if (res.ok !== true) { logAction(a.logId, { status: 'failed' }); setAction({ ...a, stage: 'preview', error: `Not sent: ${(res as { error: string }).error}` }); return; }
      logAction(a.logId, { status: 'confirmed', record_id: res.batch_id });
      const names = nameList(res.sent.map((x) => firstName(x.name)));
      onRecord?.(`Nudged ${names} about ${p.target.title}`);
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, stage: 'done', savedAt, error: `Nudged ${names}` });
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: `Not sent: ${err?.message || 'try again.'}` });
    }
  };
  // Clock in / out: re-check at the tap, then the ONE shared punch save (src/lib/punches.ts) as the signed-in manager. No one is notified.
  const refreshPunchViews = () => queryClient.invalidateQueries({ predicate: (q) => /punch|timecard|labor|schedule|shift/i.test(JSON.stringify(q.queryKey)) });
  const confirmPunch = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'preview' || a.proposal.action !== 'clock_punch' || !user?.id || !currentLocation?.id) return;
    const p = a.proposal;
    if (p.location_id !== currentLocation.id) { setAction({ ...a, error: 'Not saved. You switched stores.' }); return; }
    setAction({ ...a, stage: 'saving', error: undefined });
    try {
      await a.logId; // the re-check compares against the logged preview
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'recheck', proposal: p } },
      });
      if (ce || !chk?.recheck) throw new Error('Could not re-check the punch.');
      if (!chk.recheck.ok) { logAction(a.logId, { status: 'failed' }); setAction({ ...a, stage: 'preview', error: `Not saved. Something changed: ${chk.recheck.changed}` }); return; }
      const saved = await savePunchReturning({
        user_id: p.employee.id, punch_type: p.kind === 'in' ? 'clock_in' : 'clock_out', punch_time: p.punch_time,
        location_id: currentLocation.id, created_by: user.id, notes: p.notes,
        ...(p.kind === 'in' && p.shift_id ? { shift_id: p.shift_id } : {}), // clock-out never attaches a shift
      });
      refreshPunchViews();
      logAction(a.logId, { status: 'confirmed', record_id: saved.id });
      onRecord?.(`Clocked ${p.kind} ${p.employee.name}: ${p.date_label}, ${p.time_label}`);
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, stage: 'done', savedAt, undoOpen: true, punchId: saved.id, placeholderAdded: p.kind === 'in' && !p.shift_id && !!saved.shift_id });
      setTimeout(() => { const cur = actionRef.current; if (cur?.proposal.id === p.id && cur.stage === 'done') setAction({ ...cur, undoOpen: false }); }, UNDO_MS);
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: err?.message ? `Couldn't save: ${err.message}` : "Couldn't save the punch. Try again." });
    }
  };
  // Undo (10 minutes): deletes only Theo's punch; the placeholder shift goes only when the server verified it is safe.
  const undoPunch = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'done' || a.proposal.action !== 'clock_punch' || !a.punchId || !currentLocation?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'undoing', error: undefined });
    try {
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: ownerRef.current, pick: { kind: 'undo_punch', punch_id: a.punchId } },
      });
      if (ce || !chk?.undo) throw new Error('check');
      if (!chk.undo.ok) { setAction({ ...a, stage: 'done', error: chk.undo.reason }); return; }
      await deletePunch(a.punchId);
      let left = chk.undo.placeholder_left === true;
      if (chk.undo.remove_shift_id) left = !(await deletePlaceholderShift(chk.undo.remove_shift_id));
      refreshPunchViews();
      logAction(a.logId, { status: 'undone' });
      onRecord?.(`Undid clock ${p.kind}: ${p.employee.name}, ${p.date_label}, ${p.time_label}`);
      setAction({ ...a, stage: 'undone', error: left ? 'Undone. A placeholder shift was left on the schedule.' : undefined });
    } catch {
      setAction({ ...a, stage: 'done', error: "Couldn't undo the punch. Try again." });
    }
  };
  const cancelTask = () => {
    const a = actionRef.current;
    if (a?.stage === 'preview') logAction(a.logId, { status: 'cancelled' });
    setAction(null);
  };
  const undoTask = async () => {
    const a = actionRef.current;
    if (a && isShiftAction(a.proposal)) return undoShift();
    if (a?.proposal.action === 'create_event') return undoEvent();
    if (a?.proposal.action === 'send_message') return undoMessage();
    if (a?.proposal.action === 'clock_punch') return undoPunch();
    if (!a || a.stage !== 'done' || !a.taskId || a.proposal.action !== 'create_task') return;
    setAction({ ...a, stage: 'undoing', error: undefined });
    try {
      await deleteQuickTask(a.taskId);
      logAction(a.logId, { status: 'undone' });
      onRecord?.(`Removed quick task: ${a.proposal.title}`);
      setAction({ ...a, stage: 'undone' });
    } catch {
      setAction({ ...a, stage: 'done', error: "Couldn't remove the task. Try again." });
    }
  };

  const amberTag = (t: string) => (
    <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-extrabold" style={{ background: 'hsl(38 95% 88%)', color: 'hsl(32 90% 26%)' }}>{t}</span>
  );

  function renderShift(a: ActionCard, p: ShiftProposal, c: Colors) {
    const who = p.action === 'cover_shift' ? p.replacement.name : p.action === 'swap_shift' ? p.b.owner.name : p.employee.name;
    const wf = firstName(who);
    const day = p.date_label.split(',')[0];
    // Swap: who the Update notifies is decided by the server from the published week(s); say exactly that.
    const swapWho = p.action === 'swap_shift' ? p.notified.map(firstName).join(' and ') : '';
    if (a.stage === 'done' || a.stage === 'undoing' || a.stage === 'undone') {
      const undone = a.stage === 'undone';
      const head = p.action === 'add_shift' ? (undone ? 'Shift removed' : 'Shift added') : p.action === 'delete_shift' ? (undone ? 'Shift put back' : 'Shift deleted')
        : p.action === 'swap_shift' ? (undone ? 'Swap undone' : 'Shifts swapped') : p.action === 'change_shift' ? (undone ? 'Hours put back' : 'Hours changed')
        : (undone ? 'Change undone' : 'Shift covered');
      const line = p.action === 'add_shift'
        ? (undone ? `${wf} is off ${day} again.` : `Done. ${wf} is on ${day} ${p.time_label}.`)
        : p.action === 'delete_shift'
          ? (undone ? `${wf} has ${day} ${p.time_label} again.` : `Done. ${wf}'s ${day} shift is removed.`)
          : p.action === 'swap_shift'
            ? (undone ? `${firstName(p.a.owner.name)} and ${firstName(p.b.owner.name)} have their own shifts again.` : `Done. ${firstName(p.b.owner.name)} has ${p.a.date_label.split(',')[0]} ${p.a.time_label}, ${firstName(p.a.owner.name)} has ${p.b.date_label.split(',')[0]} ${p.b.time_label}.`)
            : p.action === 'change_shift'
              ? (undone ? `${wf} is back to ${p.old_time_label}.` : `Done. ${wf} now works ${day} ${p.time_label}.`)
              : (undone ? `${firstName(p.covered.name)} has the shift again.` : `Done. ${wf} has ${day} ${Number(p.start_time.slice(0, 2)) >= 16 ? 'night' : 'shift'}.`);
      const notice = p.published
        ? (a.notified ? (p.action === 'cover_shift' ? 'Both were notified.' : p.action === 'swap_shift' ? `${swapWho} ${p.notified.length > 1 ? 'were' : 'was'} notified.` : `${wf} was notified.`) : 'No one needed a notice.')
        : 'No one was notified, the week is a draft.';
      const when = p.action === 'swap_shift' ? `${p.a.date_label} · ${p.a.time_label}${p.b.shift_date !== p.a.shift_date || p.b.time_label !== p.a.time_label ? ` and ${p.b.date_label} · ${p.b.time_label}` : ''}` : `${p.date_label} · ${p.time_label}`;
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: undone ? 'hsl(var(--muted-foreground))' : NEW_GREEN }}>
              {undone ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
            <div>
              <div className="text-[18px] font-extrabold">{head}</div>
              {!undone && <div className="text-[13px] text-muted-foreground">Saved at {a.savedAt}</div>}
            </div>
          </div>
          <p className="text-[17px] font-extrabold">{line}</p>
          <p className="text-[14px] text-muted-foreground">{when}</p>
          <p className="text-[13px] text-muted-foreground">{notice}</p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          {!undone && a.undoOpen && (
            <div className="flex flex-col gap-1">
              <button onClick={undoTask} disabled={a.stage === 'undoing'}
                className="h-12 w-full rounded-full border-2 border-border text-[15px] font-bold disabled:opacity-60">
                {a.stage === 'undoing' ? 'Undoing…' : 'Undo'}
              </button>
              <p className="text-center text-[12px] text-muted-foreground">Undo is available for 10 minutes{p.published ? ' and sends the update again' : ''}.</p>
            </div>
          )}
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    const others = a.otherChanges ?? 0;
    const othersLine = others > 0 ? ` ${others} other ${others === 1 ? 'change' : 'changes'} on this week will also go out.` : '';
    const name = p.action === 'cover_shift' ? 'Cover a shift' : p.action === 'add_shift' ? 'Add a shift' : p.action === 'swap_shift' ? 'Swap shifts' : p.action === 'change_shift' ? 'Change hours' : 'Delete a shift';
    const button = p.action === 'cover_shift' ? 'Confirm change' : p.action === 'add_shift' ? 'Add shift' : p.action === 'swap_shift' ? 'Swap shifts' : p.action === 'change_shift' ? 'Change hours' : 'Delete shift';
    const warnings = p.action === 'cover_shift' ? (p.tag ? [`${wf} is tagged: ${p.tag}`] : []) : p.warnings;
    const info = p.action === 'cover_shift' ? p.checks : p.info;
    const swapNote = () => {
      if (p.action !== 'swap_shift') return '';
      if (!p.published) return p.two_weeks ? "Neither week is published yet, so no one is notified." : "This week isn't published yet, so no one is notified.";
      if (!p.two_weeks) return `When you confirm, the schedule changes and ${swapWho} are notified.${othersLine}`;
      const draftSide = [p.a, p.b].find((s) => !s.published);
      return `When you confirm, the schedule changes and ${swapWho} are notified${draftSide ? ` (the ${draftSide.date_label.split(',')[0]} week is a draft, so only the published week sends a notice)` : ''}.${othersLine}`;
    };
    const note = p.action === 'add_shift'
      ? (p.published ? `When you confirm, the shift is added and ${wf} is notified.${othersLine}` : "This week isn't published yet, so the shift goes into the draft and no one is notified.")
      : p.action === 'delete_shift'
        ? (p.published ? `When you confirm, the shift is removed and ${wf} is notified.${othersLine}` : "This week isn't published yet, so the shift is removed from the draft and no one is notified.")
        : p.action === 'swap_shift' ? swapNote()
        : p.action === 'change_shift'
          ? (p.published ? `When you confirm, the hours change and ${wf} is notified.${othersLine}` : "This week isn't published yet, so no one is notified.")
          : (p.published ? `When you confirm, the schedule changes and ${firstName(p.covered.name)} and ${wf} are notified.${othersLine}` : "This week isn't published yet, so no one is notified.");
    const views: DayView[] = p.action === 'swap_shift' ? p.days : p.day ? [p.day] : [];
    const dv = views.length === 1 ? views[0] : undefined;
    return (
      <>
        <p className={`mt-3 shrink-0 text-center text-[22px] font-extrabold ${c.fg}`}>Does this look right?</p>
        {dv ? <p className={`mt-1 shrink-0 text-center text-[13px] ${c.dim}`}>{dv.title}</p> : views.length > 1 ? <p className={`mt-1 shrink-0 text-center text-[13px] ${c.dim}`}>Both days after the change</p> : null}
        <div className="mt-3 flex min-h-0 w-full max-w-[420px] flex-col gap-2 rounded-[20px] bg-card p-3 text-foreground tabular-nums">
          <div className="flex shrink-0 items-center justify-between gap-2 px-1">
            <span className="text-[18px] font-extrabold">{name}</span>
            {amberTag('Preview · not saved')}
          </div>
          {views.length === 1 && <DayRows view={views[0]} />}
          {views.length > 1 && views.map((v) => (
            <div key={v.date} className="flex min-h-0 flex-col gap-1">
              <div className="shrink-0 px-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{v.title.split(' · ')[0]}</div>
              <DayRows view={v} />
            </div>
          ))}
          {warnings.length > 0 && (
            <ul className="flex shrink-0 flex-col gap-1 rounded-xl px-3 py-2" style={{ background: 'hsl(38 95% 90%)', color: 'hsl(32 90% 22%)' }}>
              {warnings.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          {info.length > 0 && (
            <ul className="flex shrink-0 flex-col gap-1 px-1">
              {info.map((t) => <li key={t} className="flex items-start gap-2 text-[13px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={3} />{t}</li>)}
            </ul>
          )}
          <p className="shrink-0 px-1 text-[13px] text-muted-foreground">{note}</p>
          {a.error && <p className="shrink-0 px-1 text-[13px] font-semibold text-destructive">{a.error}</p>}
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={cancelTask} disabled={saving} className="h-[52px] min-w-[96px] px-4 text-[15px] font-semibold text-muted-foreground">Cancel</button>
            <button onClick={confirmTask} disabled={saving}
              className={`h-[52px] flex-1 rounded-full text-[16px] font-extrabold disabled:opacity-70 ${p.action === 'delete_shift' ? 'bg-destructive text-destructive-foreground' : 'text-primary-foreground'}`}
              style={p.action === 'delete_shift' ? undefined : { background: p.action === 'add_shift' || p.action === 'swap_shift' || p.action === 'change_shift' ? NEW_GREEN : DEEP_PRIMARY }}>
              {saving ? 'Saving…' : button}
            </button>
          </div>
        </div>
        <p className={`mt-3 shrink-0 text-center text-[13px] ${c.dim}`}>Or tell Theo what to change.</p>
      </>
    );
  }
  function renderScreen(sc: CoverScreen, c: Colors = VOICE_COLORS) {
    const rowCls = 'flex min-h-[60px] w-full shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-muted disabled:opacity-60';
    const groupLabel = 'sticky top-0 z-10 shrink-0 bg-card px-1 py-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const chev = <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />;
    const person = (r: ScreenRow) => (
      <button key={r.employee_id} data-plain="" disabled={picking} className={rowCls}
        onClick={() => sc.kind === 'candidates' && pickFromScreen({ kind: 'candidate', shift_id: sc.shift_id, employee_id: r.employee_id })}>
        <div className="flex-1"><div className="text-[16px] font-extrabold">{r.name}</div><div className="text-[13px] text-muted-foreground">{r.line}</div></div>
        {r.tag && amberTag(r.tag)}
        {chev}
      </button>
    );
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col items-center tabular-nums">
        <p className={`mt-3 shrink-0 text-center text-[22px] font-extrabold ${c.fg}`}>{sc.title}</p>
        {(sc.kind === 'candidates' || sc.kind === 'templates') && <p className={`mt-1 shrink-0 text-center text-[13px] ${c.dim}`}>{sc.subtitle}</p>}
        <div className="mt-3 flex min-h-0 w-full max-w-[420px] flex-1 items-start overflow-hidden">
          <CoverListScroller>
          {sc.kind === 'shifts' && (sc.shifts.length ? sc.shifts.map((sh) => (
            <button key={sh.shift_id} data-plain="" disabled={picking} className={rowCls} onClick={() => pickFromScreen({ kind: 'shift', shift_id: sh.shift_id, purpose: sc.purpose })}>
              <div className="flex-1"><div className="text-[16px] font-extrabold">{sh.name}</div><div className="text-[13px] text-muted-foreground">{sh.time}</div></div>
              {chev}
            </button>
          )) : <p className="p-3 text-[14px] text-muted-foreground">No shifts left today.</p>)}
          {sc.kind === 'people' && sc.people.map((pp) => (
            <button key={pp.employee_id} data-plain="" disabled={picking} className={rowCls} onClick={() => pickFromScreen({ kind: 'person', employee_id: pp.employee_id, date: sc.date, purpose: sc.purpose })}>
              <div className="flex-1 text-[16px] font-extrabold">{pp.name}</div>
              {chev}
            </button>
          ))}
          {sc.kind === 'templates' && sc.rows.map((t) => (
            <button key={t.template_id} data-plain="" disabled={picking} className={rowCls} onClick={() => pickFromScreen({ kind: 'template', ...sc.draft, template_id: t.template_id })}>
              <div className="flex-1"><div className="text-[16px] font-extrabold">{t.name}</div><div className="text-[13px] text-muted-foreground">{t.line}</div></div>
              {chev}
            </button>
          ))}
          {sc.kind === 'candidates' && <>
            {sc.clear.length > 0 && <div className={groupLabel}>Clear to cover · {sc.clear.length}</div>}
            {sc.clear.map(person)}
            {sc.working.length > 0 && <div className={groupLabel}>Already working that day · {sc.working.length}</div>}
            {sc.working.map(person)}
            {!sc.clear.length && !sc.working.length && <p className="p-3 text-[14px] text-muted-foreground">Nobody passes the checks for this shift.</p>}
          </>}
          </CoverListScroller>
        </div>
        {sc.kind === 'candidates' && sc.blocked_summary && <p className={`mt-2 shrink-0 px-1 text-center text-[13px] ${c.dim}`}>{sc.blocked_summary}.</p>}
        {screenNote && <p className={`mt-2 shrink-0 px-1 text-center text-[14px] font-semibold ${c.fg}`}>{screenNote}</p>}
        <p className={`mt-2 shrink-0 text-center text-[13px] ${c.dim}`}>{sc.kind === 'candidates' ? 'Tap a name, or just say it.' : 'Tap one, or just say it.'}</p>
        <button onClick={() => { setScreen(null); setScreenNote(''); }} className={`mt-1 h-11 shrink-0 px-6 text-[14px] font-semibold ${c.close}`}>Close list</button>
      </div>
    );
  }

  function renderEvent(a: ActionCard, p: EventProposal, c: Colors) {
    const label = 'text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const chip = p.category ? (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px] font-bold">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: p.category.color }} />
        {p.category.name}
        {p.category.is_new && <span className="ml-0.5 inline-flex h-5 items-center rounded-full px-2 text-[11px] font-extrabold text-white" style={{ background: NEW_GREEN }}>New</span>}
      </span>
    ) : <span className="text-[15px] font-semibold text-muted-foreground">No category</span>;
    const details = (
      <>
        <div><div className={label}>Event</div><div className="text-[17px] font-extrabold">{p.name}</div></div>
        <div><div className={label}>When</div><div className="text-[15px] font-semibold">{p.when_label}</div></div>
        <div><div className={label}>Category</div><div className="mt-0.5">{chip}</div></div>
        {p.notes && <div><div className={label}>Notes</div><div className="text-[15px]">{p.notes}</div></div>}
        {p.tagged_labels.length > 0 && <p className="text-[14px] font-semibold">Tagged: {p.tagged_labels.map((l) => `${l}s`).join(', ')}</p>}
        {p.is_daily_task && <p className="text-[14px] font-semibold">Daily task: shows as a task on the dashboard.</p>}
        {p.is_meeting && <p className="text-[14px] font-semibold">Meeting: attendees can punch in. Add attendees on the Schedule page after saving.</p>}
      </>
    );
    if (a.stage === 'done' || a.stage === 'undoing' || a.stage === 'undone') {
      const undone = a.stage === 'undone';
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: undone ? 'hsl(var(--muted-foreground))' : NEW_GREEN }}>
              {undone ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
            <div>
              <div className="text-[18px] font-extrabold">{undone ? 'Event removed' : 'Event added'}</div>
              {!undone && <div className="text-[13px] text-muted-foreground">Saved at {a.savedAt}</div>}
            </div>
          </div>
          <div><div className={label}>Event</div><div className="text-[17px] font-extrabold">{p.name}</div></div>
          <p className="text-[14px] text-muted-foreground">{p.when_label}</p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          {!undone && a.undoOpen && (
            <div className="flex flex-col gap-1">
              <button onClick={undoTask} disabled={a.stage === 'undoing'}
                className="h-12 w-full rounded-full border-2 border-border text-[15px] font-bold disabled:opacity-60">
                {a.stage === 'undoing' ? 'Removing…' : 'Undo'}
              </button>
              <p className="text-center text-[12px] text-muted-foreground">Undo is available for 10 minutes, until someone completes it.</p>
            </div>
          )}
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    return (
      <>
        <p className={`mt-3 text-center text-[22px] font-extrabold ${c.fg}`}>Does this look right?</p>
        <div className="mt-3 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[18px] font-extrabold">Add event</span>
            {amberTag('Preview · not saved')}
          </div>
          {details}
          {p.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl px-3 py-2" style={{ background: 'hsl(38 95% 90%)', color: 'hsl(32 90% 22%)' }}>
              {p.warnings.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          <div className="h-px w-full bg-border" />
          <p className="text-[13px] text-muted-foreground">
            {p.needs_draft ? "That week has no schedule yet, so a draft week will be created. " : ''}No one is notified. It shows on the schedule and punch clock, and on the dashboard if it's a daily task.
          </p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={cancelTask} disabled={saving} className="h-[52px] min-w-[96px] px-4 text-[15px] font-semibold text-muted-foreground">Cancel</button>
            <button onClick={confirmTask} disabled={saving}
              className="h-[52px] flex-1 rounded-full text-[16px] font-extrabold text-primary-foreground disabled:opacity-70" style={{ background: NEW_GREEN }}>
              {saving ? 'Saving…' : 'Add event'}
            </button>
          </div>
        </div>
        <p className={`mt-3 text-center text-[13px] ${c.dim}`}>Or tell Theo what to change.</p>
      </>
    );
  }
  function renderMessage(a: ActionCard, p: MessageProposal, c: Colors) {
    const label = 'text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const toLine = p.kind === 'group' ? `${p.group_title} (group, ${p.member_count} people)` : p.to?.name ?? '';
    const first = firstName(p.to?.name ?? '');
    const notify = `${p.kind === 'group' ? `${p.recipients} ${p.recipients === 1 ? 'person' : 'people'}` : first} will get a notification, unless one went out for this chat in the last 3 minutes or they've turned chat alerts off.`;
    const bubble = <div className="self-end max-w-[88%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-[6px] bg-primary px-3.5 py-2 text-[15px] text-primary-foreground">{p.text}</div>;
    if (a.stage === 'done' || a.stage === 'undoing' || a.stage === 'undone') {
      const undone = a.stage === 'undone';
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: undone ? 'hsl(var(--muted-foreground))' : NEW_GREEN }}>
              {undone ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
            <div>
              <div className="text-[18px] font-extrabold">{undone ? 'Message unsent' : 'Message sent'}</div>
              {!undone && <div className="text-[13px] text-muted-foreground">Sent at {a.savedAt}</div>}
            </div>
          </div>
          <div><div className={label}>To</div><div className="text-[15px] font-semibold">{toLine}</div></div>
          {!undone && bubble}
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          {!undone && a.undoOpen && (
            <div className="flex flex-col gap-1">
              <button onClick={undoTask} disabled={a.stage === 'undoing'}
                className="h-12 w-full rounded-full border-2 border-border text-[15px] font-bold disabled:opacity-60">
                {a.stage === 'undoing' ? 'Unsending…' : 'Unsend'}
              </button>
              <p className="text-center text-[12px] text-muted-foreground">Unsending removes the message. People may already have seen the notification.</p>
            </div>
          )}
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    return (
      <>
        <p className={`mt-3 text-center text-[22px] font-extrabold ${c.fg}`}>Does this look right?</p>
        <div className="mt-3 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[18px] font-extrabold">Send message</span>
            {amberTag('Preview · not sent')}
          </div>
          <div><div className={label}>To</div><div className="text-[15px] font-semibold">{toLine}</div></div>
          {p.new_dm && <p className="text-[14px] font-semibold">You don't have a chat with {first} yet. I'll start one.</p>}
          {p.reply_to && <p className="truncate text-[13px] text-muted-foreground">Replying to {firstName(p.reply_to.sender)}: "{p.reply_to.text}"</p>}
          {bubble}
          {p.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl px-3 py-2" style={{ background: 'hsl(38 95% 90%)', color: 'hsl(32 90% 22%)' }}>
              {p.warnings.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          <div className="h-px w-full bg-border" />
          <p className="text-[13px] text-muted-foreground">{notify}</p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={cancelTask} disabled={saving} className="h-[52px] min-w-[96px] px-4 text-[15px] font-semibold text-muted-foreground">Cancel</button>
            <button onClick={confirmTask} disabled={saving}
              className="h-[52px] flex-1 rounded-full text-[16px] font-extrabold text-primary-foreground disabled:opacity-70" style={{ background: DEEP_PRIMARY }}>
              {saving ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
        <p className={`mt-3 text-center text-[13px] ${c.dim}`}>Or tell Theo what to change.</p>
      </>
    );
  }
  function renderPunch(a: ActionCard, p: PunchProposal, c: Colors) {
    const label = 'text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const first = firstName(p.employee.name);
    const title = p.kind === 'in' ? 'Clock in' : 'Clock out';
    const details = (
      <>
        <div><div className={label}>Who</div><div className="text-[17px] font-extrabold">{p.employee.name}</div></div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className={label}>{p.kind === 'in' ? 'Clock in' : 'Clock out'}</div><div className="text-[15px] font-semibold">{p.time_label}</div></div>
          <div><div className={label}>Date</div><div className="text-[15px] font-semibold">{p.date_label}</div></div>
        </div>
        {p.clock_in_label && <div><div className={label}>Clocked in</div><div className="text-[15px] font-semibold">{p.clock_in_label}</div></div>}
        <div><div className={label}>Store</div><div className="text-[15px] font-semibold">{p.store}</div></div>
      </>
    );
    if (a.stage === 'done' || a.stage === 'undoing' || a.stage === 'undone') {
      const undone = a.stage === 'undone';
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: undone ? 'hsl(var(--muted-foreground))' : NEW_GREEN }}>
              {undone ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
            <div>
              <div className="text-[18px] font-extrabold">{undone ? 'Punch removed' : p.kind === 'in' ? 'Clocked in' : 'Clocked out'}</div>
              {!undone && <div className="text-[13px] text-muted-foreground">Saved at {a.savedAt}</div>}
            </div>
          </div>
          <p className="text-[17px] font-extrabold">{undone ? `${first}'s ${p.time_label} punch is removed.` : `Done. ${first} is clocked ${p.kind} at ${p.time_label}.`}</p>
          <p className="text-[14px] text-muted-foreground">{p.date_label} · {p.store}</p>
          {a.error && <p className={`text-[13px] font-semibold ${undone ? 'text-muted-foreground' : 'text-destructive'}`}>{a.error}</p>}
          {!undone && a.undoOpen && (
            <div className="flex flex-col gap-1">
              <button onClick={undoTask} disabled={a.stage === 'undoing'}
                className="h-12 w-full rounded-full border-2 border-border text-[15px] font-bold disabled:opacity-60">
                {a.stage === 'undoing' ? 'Undoing…' : 'Undo'}
              </button>
              <p className="text-center text-[12px] text-muted-foreground">Undo is available for 10 minutes, until a newer punch or an approval.</p>
            </div>
          )}
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    return (
      <>
        <p className={`mt-3 text-center text-[22px] font-extrabold ${c.fg}`}>Does this look right?</p>
        <div className="mt-3 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[18px] font-extrabold">{title}</span>
            {amberTag('Preview · not saved')}
          </div>
          {details}
          {p.flags.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl px-3 py-2" style={{ background: 'hsl(38 95% 90%)', color: 'hsl(32 90% 22%)' }}>
              {p.flags.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          <div className="h-px w-full bg-border" />
          <p className="text-[13px] text-muted-foreground">No one is notified. This is a time record that payroll reads.</p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={cancelTask} disabled={saving} className="h-[52px] min-w-[96px] px-4 text-[15px] font-semibold text-muted-foreground">Cancel</button>
            <button onClick={confirmTask} disabled={saving}
              className="h-[52px] flex-1 rounded-full text-[16px] font-extrabold text-primary-foreground disabled:opacity-70" style={{ background: NEW_GREEN }}>
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </div>
        <p className={`mt-3 text-center text-[13px] ${c.dim}`}>Or tell Theo what to change.</p>
      </>
    );
  }
  function renderNudge(a: ActionCard, p: NudgeProposal, c: Colors) {
    const label = 'text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const Icon = NUDGE_ICON;
    if (a.stage === 'done') {
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: NEW_GREEN }}><Check className="h-5 w-5" strokeWidth={3} /></span>
            <div><div className="text-[18px] font-extrabold">Nudge sent</div><div className="text-[13px] text-muted-foreground">Sent at {a.savedAt}</div></div>
          </div>
          <p className="text-[17px] font-extrabold">{a.error}.</p>
          <p className="text-[14px] text-muted-foreground">{p.target.title} · {p.store}</p>
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    return (
      <>
        <p className={`mt-3 text-center text-[22px] font-extrabold ${c.fg}`}>Does this look right?</p>
        <div className="mt-3 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[18px] font-extrabold"><Icon className="h-5 w-5 text-primary" />Nudge</span>
            {amberTag('Preview · not sent')}
          </div>
          <div>
            <div className={label}>{p.target.type === 'checklist' ? 'Checklist' : p.target.type === 'task' ? 'Task' : `Event${p.target.event_time ? ` at ${p.target.event_time}` : ''}`}</div>
            <div className="text-[17px] font-extrabold">{p.target.title}</div>
            {p.target.total != null && p.target.total > 0 && <div className="text-[13px] text-muted-foreground">{p.target.done ?? 0} of {p.target.total} done</div>}
          </div>
          <div>
            <div className={label}>Going to (everyone on the clock)</div>
            <div className="mt-1 flex flex-wrap gap-1.5">{p.recipients.map((r) => <span key={r.id} className="rounded-full bg-muted px-2 py-1 text-[13px] font-semibold">{r.name}</span>)}</div>
            {p.recently.length > 0 && <p className="mt-1 text-[12px] text-muted-foreground">Skipped, nudged recently: {p.recently.map((r) => `${firstName(r.name)} (${r.minutes_ago}m ago)`).join(', ')}</p>}
          </div>
          <div><div className={label}>Message</div><p className="text-[15px]">{p.preview_for.text}</p><p className="text-[12px] text-muted-foreground">What {p.preview_for.name} will see</p></div>
          {p.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-xl px-3 py-2" style={{ background: 'hsl(38 95% 90%)', color: 'hsl(32 90% 22%)' }}>
              {p.warnings.map((w) => <li key={w} className="flex items-start gap-2 text-[13px] font-semibold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={cancelTask} disabled={saving} className="h-[52px] min-w-[96px] px-4 text-[15px] font-semibold text-muted-foreground">Cancel</button>
            <button onClick={confirmTask} disabled={saving}
              className="h-[52px] flex-1 rounded-full text-[16px] font-extrabold text-primary-foreground disabled:opacity-70" style={{ background: NEW_GREEN }}>
              {saving ? 'Sending…' : 'Send nudge'}
            </button>
          </div>
        </div>
        <p className={`mt-3 text-center text-[13px] ${c.dim}`}>Or tell Theo what to change.</p>
      </>
    );
  }
  function renderAction(a: ActionCard, c: Colors = VOICE_COLORS) {
    if (a.proposal.action === 'quick_nudge') return renderNudge(a, a.proposal, c);
    if (isShiftAction(a.proposal)) return renderShift(a, a.proposal, c);
    if (a.proposal.action === 'send_message') return renderMessage(a, a.proposal, c);
    if (a.proposal.action === 'clock_punch') return renderPunch(a, a.proposal, c);
    if (a.proposal.action === 'create_event') return renderEvent(a, a.proposal, c);
    const p = a.proposal;
    const label = 'text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    if (a.stage === 'done' || a.stage === 'undoing' || a.stage === 'undone') {
      const undone = a.stage === 'undone';
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: undone ? 'hsl(var(--muted-foreground))' : 'hsl(142 70% 28%)' }}>
              {undone ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
            <div>
              <div className="text-[18px] font-extrabold">{undone ? 'Task removed' : 'Task created'}</div>
              {!undone && <div className="text-[13px] text-muted-foreground">Saved at {a.savedAt}</div>}
            </div>
          </div>
          <div><div className={label}>Task</div><div className="text-[17px] font-extrabold">{p.title}</div></div>
          <div><div className={label}>For</div><div className="text-[15px] font-semibold">{whoText(p)}</div></div>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          {!undone && a.undoOpen && (
            <div className="flex flex-col gap-1">
              <button onClick={undoTask} disabled={a.stage === 'undoing'}
                className="h-12 w-full rounded-full border-2 border-border text-[15px] font-bold disabled:opacity-60">
                {a.stage === 'undoing' ? 'Removing…' : 'Undo'}
              </button>
              <p className="text-center text-[12px] text-muted-foreground">Undo is available for 10 minutes.</p>
            </div>
          )}
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    return (
      <>
        <p className={`mt-3 text-center text-[22px] font-extrabold ${c.fg}`}>Does this look right?</p>
        <div className="mt-3 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[18px] font-extrabold">New quick task</span>
            <span className="flex h-6 items-center rounded-full px-2.5 text-[12px] font-extrabold" style={{ background: 'hsl(38 95% 88%)', color: 'hsl(32 90% 26%)' }}>Preview · not saved</span>
          </div>
          <div><div className={label}>Task</div><div className="text-[17px] font-extrabold">{p.title}</div></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className={label}>For</div><div className="text-[15px] font-semibold">{whoText(p)}</div></div>
            <div><div className={label}>Stays up</div><div className="text-[15px] font-semibold">{durationLabel(p.duration)}</div></div>
          </div>
          <div className="h-px w-full bg-border" />
          <p className="text-[13px] text-muted-foreground">When you confirm, the task appears in Quick Tasks and {notifyText(p)}.</p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={cancelTask} disabled={saving} className="h-[52px] min-w-[96px] px-4 text-[15px] font-semibold text-muted-foreground">Cancel</button>
            <button onClick={confirmTask} disabled={saving}
              className="h-[52px] flex-1 rounded-full text-[16px] font-extrabold text-white disabled:opacity-70" style={{ background: DEEP_PRIMARY }}>
              {saving ? 'Saving…' : 'Create task'}
            </button>
          </div>
        </div>
        <p className={`mt-3 text-center text-[13px] ${c.dim}`}>Or tell Theo what to change.</p>
      </>
    );
  }

  return { action, actionRef, setAction, screen, screenRef, setScreen, screenNote, setScreenNote, picking, ownerRef, logAction, dropAll, openPreview, showProposal, pickFromScreen, renderAction, renderScreen };
}
export type TheoWizard = ReturnType<typeof useTheoWizard>;
