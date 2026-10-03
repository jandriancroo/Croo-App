import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, Keyboard, MessageSquareText, Mic, Volume2, ArrowRight, Check } from 'lucide-react';
import { useUserRole, ROLE_DISPLAY_NAMES, type AppRole } from '@/hooks/useUserRole';
import { createStandardQuickTask, deleteQuickTask, durationLabel } from '@/lib/quickTasks';
import { reassignAndNotify } from '@/lib/scheduleActions';
import { countPendingChanges } from '@/lib/scheduleDiff';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';
import { TheoVoiceOrb, type TheoVoiceOrbHandle } from './TheoVoiceOrb';
import { playCue, type TheoCue } from './theoCues';

type Phase = 'idle' | 'connecting' | 'speaking' | 'listening' | 'thinking' | 'error';

const RATE = 24000;
/** Live voice is billed per minute: hang up after this much silence on the manager's turn. */
const SILENCE_HANGUP_MS = 10_000;
/** Safety net: hang up if Theo is stuck thinking/speaking with no activity and no audio playing. */
const STUCK_HANGUP_MS = 20_000;
/** Quiet time before xAI treats the manager's turn as complete. */
const SILENCE_WAIT_MS = 600;
// Hard stop for one live connection (only live time counts, not the read-aloud update).
const MAX_LIVE_MS = 180_000;
// Earlier exchanges carried into a resumed live session (this open of the voice screen only).
const CARRY_MAX = 6;
const CARRY_ANSWER_CHARS = 300;
/** One decision for "long": Theo points to the chat and the screen shows "See full answer". */
const isLongAnswer = (a: string) => a.length > 500 || a.split('\n').filter((l) => l.trim()).length > 10;
const VOICE_SUFFIX =
  '\n\n(Voice mode: answer the whole question. If the answer is a list of people, shifts or items, include every one with its key detail (for a schedule: name and shift time). Keep it compact: round numbers, short lines, no tables. You are talking to a manager with full access, so say names and details plainly.)';

const b64ToFloat = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
  return f;
};
const floatToB64 = (f: Float32Array) => {
  const pcm = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const PHASE_TEXT: Record<Phase, string> = {
  idle: 'Tap to hear your update',
  connecting: 'Connecting…',
  speaking: 'Theo is talking',
  listening: 'Listening…',
  thinking: 'Thinking…',
  error: '',
};
const PHASE_SUB: Record<Phase, string> = {
  idle: '', connecting: '', speaking: 'Tap the orb to interrupt', listening: '', thinking: '', error: 'Tap the orb to try again.',
};
const ORB_LABEL: Record<Phase, string> = {
  idle: 'Start Theo voice update', connecting: 'Connecting to Theo', speaking: 'Interrupt Theo',
  listening: 'Theo is listening', thinking: 'Theo is working on it', error: 'Try Theo voice again',
};
// Rotating "thinking" lines — one is picked each time the thinking state starts, never the same twice in a row.
const THINKING_LINES = [
  'Let me take a look and see…',
  'Checking into that now…',
  'Thinking…',
  'On it…',
  'One sec…',
  'Give me a second…',
  'Looking into it…',
  'Working on that…',
];
const pickThinkingLine = (last: string) => {
  const line = THINKING_LINES[Math.floor(Math.random() * THINKING_LINES.length)];
  return line === last ? THINKING_LINES[(THINKING_LINES.indexOf(line) + 1) % THINKING_LINES.length] : line;
};
let accessToken = '';
supabase.auth.getSession().then(({ data }) => { accessToken = data.session?.access_token || ''; });
supabase.auth.onAuthStateChange((_e, session) => { accessToken = session?.access_token || ''; });
// Theo hands (build 1): a proposal Theo made; saved only by the manager's Create task tap.
type TaskProposal = { id: string; action: 'create_task'; title: string; employees: { id: string; name: string }[]; roles: string[]; duration: string };
// Theo hands (build 2): cover a shift. Saved only by the manager's Confirm change tap.
type CoverProposal = {
  id: string; action: 'cover_shift'; shift_id: string; schedule_id: string; day_of_week: number; shift_date: string;
  start_time: string; end_time: string; date_label: string; time_label: string;
  covered: { id: string; name: string }; replacement: { id: string; name: string };
  checks: string[]; tag: string | null; published: boolean;
};
type AnyProposal = TaskProposal | CoverProposal;
type ActionCard = { stage: 'preview' | 'saving' | 'done' | 'undoing' | 'undone'; proposal: AnyProposal; logId: Promise<string | null>; error?: string; taskId?: string; savedAt?: string; undoOpen?: boolean; otherChanges?: number; notified?: boolean };
type ScreenRow = { employee_id: string; name: string; line: string; tag: string | null };
type CoverScreen =
  | { kind: 'shifts'; date: string; title: string; shifts: { shift_id: string; employee_id: string; name: string; time: string }[] }
  | { kind: 'people'; date: string; title: string; people: { employee_id: string; name: string }[] }
  | { kind: 'candidates'; shift_id: string; title: string; subtitle: string; clear: ScreenRow[]; working: ScreenRow[]; blocked_summary: string | null };

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
        className="min-h-[60px] max-h-[354px] flex-1 overflow-y-auto overscroll-contain p-3 text-foreground [-webkit-overflow-scrolling:touch] touch-pan-y md:max-h-[474px]">
        {children}
      </div>
      {moreBelow && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />}
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

function saveFinal(id: string, patch: Record<string, unknown>) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!accessToken) {
    void supabase.from('theo_voice_sessions').update(patch).eq('id', id).then(() => {});
    return;
  }
  fetch(`${base}/rest/v1/theo_voice_sessions?id=eq.${id}`, {
    method: 'PATCH',
    keepalive: true,
    headers: { apikey: key, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  }).catch((e) => console.error('[theo-voice] usage log', e));
}

export function TheoVoiceOverlay({ open, onClose, onOpenChat, onOpenAnswer, onExchange, onRecord, intent = 'talk' }: { open: boolean; onClose: () => void; onOpenChat: () => void; onOpenAnswer?: () => void; onExchange?: (question: string, answer: string) => void; onRecord?: (text: string) => void; intent?: 'update' | 'talk' }) {
  const { currentLocation } = useLocation();
  const { user } = useAuth();
  const { isSuperAdmin } = useUserRole();
  const { timezone } = useLocationTimezone();
  // Cover-a-shift lists (shift picker, which-person, who-can-cover). Showing one changes nothing.
  const [screen, setScreenState] = useState<CoverScreen | null>(null);
  const screenRef = useRef<CoverScreen | null>(null);
  const setScreen = (sc: CoverScreen | null) => { screenRef.current = sc; setScreenState(sc); };
  const [screenNote, setScreenNote] = useState('');
  const [picking, setPicking] = useState(false);
  // Action preview card: lives outside the voice line, so hang-ups and the time limit never dismiss it.
  const [action, setActionState] = useState<ActionCard | null>(null);
  const actionRef = useRef<ActionCard | null>(null);
  const setAction = (a: ActionCard | null) => { actionRef.current = a; setActionState(a); };
  const logAction = (logId: Promise<string | null>, patch: Record<string, unknown>) => {
    void logId.then((id) => { if (id) void supabase.from('theo_action_log').update(patch as any).eq('id', id).then(() => {}); });
  };
  const [phase, setPhase] = useState<Phase>('idle');
  const [thinkingLine, setThinkingLine] = useState(THINKING_LINES[0]);
  const lastThinkingRef = useRef(THINKING_LINES[0]);
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [showText, setShowText] = useState(false);
  const [level, setLevel] = useState(0);
  // Idle mode: 'update' reads the opener on tap, 'talk' just listens. After any session starts, the rest of this open is 'talk'.
  const [mode, setMode] = useState<'update' | 'talk'>(intent);
  const withOpenerRef = useRef(intent === 'update');
  useEffect(() => { if (open) { setMode(intent); withOpenerRef.current = intent === 'update'; } }, [open, intent]);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playAtRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const orbRef = useRef<TheoVoiceOrbHandle>(null);
  const rafRef = useRef<number>();
  // liveStart = when the paid live connection opened (null while only the update is playing).
  const logRef = useRef<{ id: string; liveStart: number | null; liveMs: number; questions: number; final?: Record<string, unknown> } | null>(null);
  const updateSrcRef = useRef<AudioBufferSourceNode | null>(null);
  // Mic audio captured after the tap but before the live line opens; sent as soon as it opens.
  const pendingAudioRef = useRef<string[]>([]);
  const capturingRef = useRef(false);
  const sessionRef = useRef<{ locationId: string; at: number; promise: Promise<any> } | null>(null);
  const userSpeakingRef = useRef(false);
  // Synchronous lock: set at the top of start(), cleared in teardown(). Prevents double starts.
  const startingRef = useRef(false);
  const [speechTick, setSpeechTick] = useState(0);
  const [stoppedListening, setStoppedListening] = useState(false);
  const [longAnswer, setLongAnswer] = useState(false);
  const [hitLimit, setHitLimit] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopAfterAnswerRef = useRef(false);
  const historyRef = useRef<{ q: string; a: string }[]>([]);
  const micGateUntilRef = useRef(0);
  const reachedListeningRef = useRef(false);
  const closedCuePlayedRef = useRef(false);
  const errorEndingRef = useRef(false);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* done */ } });
    sourcesRef.current = [];
    if (ctxRef.current) playAtRef.current = ctxRef.current.currentTime;
  }, []);

  /** True while Theo's voice (live answer or read-aloud update) is still coming out of the speaker. */
  const theoPlaying = () => {
    const ctx = ctxRef.current;
    return !!updateSrcRef.current || (!!ctx && playAtRef.current > ctx.currentTime + 0.02);
  };

  // Cues never play over Theo's voice: if he's talking, the cue is skipped.
  const triggerCue = useCallback((cue: TheoCue, gateMic = false) => {
    const ctx = ctxRef.current;
    if (!ctx) return 0;
    if (cue !== 'closed' && theoPlaying()) return 0;
    const duration = playCue(ctx, cue);
    orbRef.current?.cue(cue);
    if (gateMic) micGateUntilRef.current = Math.max(micGateUntilRef.current, ctx.currentTime + duration);
    return duration;
  }, []);

  const teardown = useCallback((withClosedCue = true) => {
    const ctx = ctxRef.current;
    const playClosed = withClosedCue && reachedListeningRef.current && !closedCuePlayedRef.current && !!ctx;
    const log = logRef.current;
    logRef.current = null;
    if (log) {
      const liveMs = log.liveMs + (log.liveStart ? Date.now() - log.liveStart : 0);
      const patch = {
        ended_at: new Date().toISOString(),
        seconds: Math.min(14400, Math.round(liveMs / 1000)),
        questions: log.questions,
      };
      if (log.id) saveFinal(log.id, patch);
      else log.final = patch; // usage row still being created; saved when it arrives
    }
    const u = updateSrcRef.current;
    updateSrcRef.current = null;
    if (u) { u.onended = null; try { u.stop(); } catch { /* done */ } }
    stopPlayback();
    // Closed plays after Theo's voice has been stopped, never on top of it.
    if (playClosed) {
      closedCuePlayedRef.current = true;
      triggerCue('closed');
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); }
    procRef.current?.disconnect();
    procRef.current = null;
    pendingAudioRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const resetSession = () => { try { const s = (navigator as any).audioSession; if (s) s.type = 'auto'; } catch { /* unsupported */ } };
    if (ctx) {
      if (playClosed) setTimeout(() => { void ctx.close().catch(() => {}); resetSession(); }, 700);
      else { void ctx.close().catch(() => {}); resetSession(); }
    }
    ctxRef.current = null;
    reachedListeningRef.current = false;
    micGateUntilRef.current = 0;
    userSpeakingRef.current = false;
    startingRef.current = false;
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    maxTimerRef.current = null;
    stopAfterAnswerRef.current = false;
    setPhase('idle');
    setLevel(0);
  }, [stopPlayback, triggerCue]);

  // Voice pass fetched ahead of the tap (free; expires after 5 minutes, reused for up to 4).
  const prefetchSession = useCallback(() => {
    const id = currentLocation?.id;
    if (!id) return;
    const cur = sessionRef.current;
    if (cur && cur.locationId === id && Date.now() - cur.at < 240_000) return;
    const p = supabase.functions.invoke('theo-voice', { body: { action: 'session', location_id: id } })
      .then(({ data, error }) => (error || !data?.token ? null : data));
    sessionRef.current = { locationId: id, at: Date.now(), promise: p };
    void p.then((d) => { if (!d && sessionRef.current?.promise === p) sessionRef.current = null; });
  }, [currentLocation?.id]);
  useEffect(() => { if (open) prefetchSession(); }, [open, prefetchSession]);
  const takeSession = async () => {
    prefetchSession();
    const s = sessionRef.current;
    sessionRef.current = null; // one pass per live connection
    const d = s ? await s.promise : null;
    if (d) return d;
    const { data, error } = await supabase.functions.invoke('theo-voice', { body: { action: 'session', location_id: currentLocation!.id } });
    if (error || !data?.token) throw new Error(data?.error || 'Theo’s voice isn’t available right now.');
    return data;
  };

  useEffect(() => { if (!open) { const a = actionRef.current; if (a?.stage === 'preview') logAction(a.logId, { status: 'cancelled' }); setAction(null); setScreen(null); setScreenNote(''); teardown(); setStoppedListening(false); setLongAnswer(false); setHitLimit(false); historyRef.current = []; } }, [open, teardown]);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const hardStop = useCallback(() => {
    teardown();
    setMode('talk');
    setStoppedListening(false);
    setHitLimit(true);
  }, [teardown]);
  // 3-minute limit reached mid-answer: hang up once that answer is done (back on the manager's turn).
  useEffect(() => {
    if (phase === 'listening' && stopAfterAnswerRef.current && wsRef.current) hardStop();
  }, [phase, hardStop]);
  useEffect(() => () => teardown(), [teardown]);

  // Save progress every 15s while the paid live line is open, so a swiped-away app still records its length.
  useEffect(() => {
    const t = setInterval(() => {
      const log = logRef.current;
      if (!log?.liveStart || !log.id) return;
      const secs = Math.min(14400, Math.round((log.liveMs + Date.now() - log.liveStart) / 1000));
      void supabase.from('theo_voice_sessions').update({ seconds: secs, questions: log.questions }).eq('id', log.id).then(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  // Leaving the app or tab hangs up the paid line and saves the talk.
  useEffect(() => {
    const onHide = () => { if (logRef.current || wsRef.current) teardown(); };
    const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); };
  }, [teardown]);

  // Hang up the paid live connection after SILENCE_HANGUP_MS of no speech on the manager's turn.
  // "Speech" = the server's speech-started event, never raw mic level (kitchens are loud).
  useEffect(() => {
    if (phase !== 'listening' || !wsRef.current || userSpeakingRef.current) return;
    const t = setTimeout(() => {
      if (!wsRef.current || userSpeakingRef.current) return;
      teardown();
      setMode('talk');
      setStoppedListening(true);
    }, SILENCE_HANGUP_MS);
    return () => clearTimeout(t);
  }, [phase, speechTick, teardown]);

  // Stuck-line safety net: during Theo's turn, if nothing arrives and no audio plays for STUCK_HANGUP_MS, hang up.
  const lastActivityRef = useRef(Date.now());
  useEffect(() => {
    if ((phase !== 'thinking' && phase !== 'speaking') || !wsRef.current) return;
    lastActivityRef.current = Date.now();
    const iv = setInterval(() => {
      if (!wsRef.current) return;
      if (sourcesRef.current.length > 0) { lastActivityRef.current = Date.now(); return; }
      if (Date.now() - lastActivityRef.current < STUCK_HANGUP_MS) return;
      teardown(true);
      setMode('talk');
      setStoppedListening(true);
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, teardown]);

  const playChunk = (f: Float32Array) => {
    const ctx = ctxRef.current;
    if (!ctx || !analyserRef.current) return;
    const buf = ctx.createBuffer(1, f.length, RATE);
    buf.getChannelData(0).set(f);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analyserRef.current);
    const at = Math.max(ctx.currentTime, playAtRef.current);
    src.start(at);
    playAtRef.current = at + buf.duration;
    sourcesRef.current.push(src);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
      if (sourcesRef.current.length === 0) setPhase((p) => (p === 'speaking' ? 'listening' : p));
    };
  };

  /** Put a proposal on screen and log it as previewed. False if a save is in progress. */
  const showProposal = (proposal: AnyProposal) => {
    if (!user?.id || !currentLocation?.id) return false;
    const prev = actionRef.current;
    if (prev?.stage === 'saving') return false;
    if (prev?.stage === 'preview') logAction(prev.logId, { status: 'cancelled' });
    const logId = Promise.resolve(supabase.from('theo_action_log')
      .insert({ user_id: user.id, location_id: currentLocation.id, action: proposal.action, proposal: proposal as any, status: 'previewed' })
      .select('id').single()).then(({ data: row }) => row?.id ?? null, () => null);
    setScreen(null);
    setScreenNote('');
    setAction({ stage: 'preview', proposal, logId });
    if (proposal.action === 'cover_shift' && proposal.published) {
      // Other changes already waiting on this published week go out with the Update.
      void (async () => {
        const [{ data: sch }, { data: cur }] = await Promise.all([
          supabase.from('schedules').select('published_shifts_snapshot').eq('id', proposal.schedule_id).single(),
          supabase.from('scheduled_shifts').select('id, user_id, start_time, end_time, shift_date, day_of_week').eq('schedule_id', proposal.schedule_id),
        ]);
        const snap = Array.isArray(sch?.published_shifts_snapshot) ? (sch!.published_shifts_snapshot as any[]) : [];
        const n = countPendingChanges(snap, cur as any[]);
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
        body: { messages: [], location_id: currentLocation?.id, location_name: currentLocation?.name, source: 'voice', pick },
      });
      if (e) { setScreenNote('Theo could not reach the schedule right now.'); return; }
      if (data?.proposal?.action === 'cover_shift') { showProposal(data.proposal as CoverProposal); return; }
      if (data?.screen?.kind) { setScreen(data.screen as CoverScreen); return; }
      setScreenNote(data?.content || '');
    } finally {
      setPicking(false);
    }
  };

  const askTheo = async (question: string) => {
    if (logRef.current) logRef.current.questions += 1;
    setLongAnswer(false);
    const { data, error: e } = await supabase.functions.invoke('ai-assistant', {
      body: {
        messages: [{ role: 'user', content: question + VOICE_SUFFIX }],
        location_id: currentLocation?.id,
        location_name: currentLocation?.name,
        source: 'voice',
        ...(isSuperAdmin && actionRef.current?.stage === 'preview' ? { pending_action: actionRef.current.proposal } : {}),
        ...(isSuperAdmin && screenRef.current?.kind === 'candidates' ? { list_context: { shift_id: screenRef.current.shift_id } } : {}),
      },
    });
    if (e) return JSON.stringify({ error: 'Theo could not reach the store data right now.' });
    const answer: string = data?.content || '';
    if (isSuperAdmin && data?.cancel_pending && actionRef.current?.stage === 'preview') {
      logAction(actionRef.current.logId, { status: 'cancelled' });
      setAction(null);
    }
    if (isSuperAdmin && (data?.proposal?.action === 'create_task' || data?.proposal?.action === 'cover_shift')) {
      if (showProposal(data.proposal as AnyProposal)) {
        onExchange?.(question, answer);
        return JSON.stringify({ answer, long: false, preview: true });
      }
    }
    if (isSuperAdmin && data?.screen?.kind && !actionRef.current) {
      setScreen(data.screen as CoverScreen);
      setScreenNote('');
      onExchange?.(question, answer);
      return JSON.stringify({ answer, long: false, screen: true });
    }
    const long = !!answer && isLongAnswer(answer);
    if (answer) {
      onExchange?.(question, answer);
      historyRef.current = [...historyRef.current, { q: question, a: answer.slice(0, CARRY_ANSWER_CHARS) }].slice(-CARRY_MAX);
    }
    setLongAnswer(long);
    return JSON.stringify({ answer: answer || 'No answer.', long });
  };

  const fail = (e: any) => {
    const denied = e?.name === 'NotAllowedError';
    setError(denied ? 'Microphone access is off. Allow it in your browser settings, or use text chat.' : e?.message || 'Theo’s voice isn’t available right now.');
    errorEndingRef.current = true;
    teardown(false);
    setPhase('error');
  };

  // Opens the paid live connection and goes straight to the manager's turn.
  const goLive = async (heardUpdate: string) => {
    const ctx = ctxRef.current;
    const stream = streamRef.current;
    if (!ctx || !stream || !currentLocation?.id) return;
    // Optimistic: it's the manager's turn right away. Their voice is captured now and
    // sent the moment the live line opens.
    pendingAudioRef.current = [];
    capturingRef.current = true;
    reachedListeningRef.current = true;
    setPhase('listening');
    triggerCue('ready', true);
    try {
      const data = await takeSession();
      if (!ctxRef.current) return; // closed while connecting
      const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${data.model}`, [`xai-client-secret.${data.token}`]);
      wsRef.current = ws;
      ws.onopen = () => {
        if (logRef.current) logRef.current.liveStart = Date.now();
        if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
        maxTimerRef.current = setTimeout(() => {
          if (!wsRef.current) return;
          const p = phaseRef.current;
          if (p === 'speaking' || p === 'thinking') stopAfterAnswerRef.current = true;
          else hardStop();
        }, MAX_LIVE_MS);
        const earlier = historyRef.current.length
          ? `\nEarlier in this conversation (may be out of date):\n${historyRef.current.map((h) => `Q: ${h.q}\nA: ${h.a}`).join('\n')}`
          : '';
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: data.voice,
            instructions: (heardUpdate
              ? `${data.instructions}\nThe manager just heard this update read aloud — don't repeat it, just answer what they ask next:\n${heardUpdate}`
              : data.instructions) + earlier,
            turn_detection: { type: 'server_vad', silence_duration_ms: SILENCE_WAIT_MS },
            audio: { input: { format: { type: 'audio/pcm', rate: RATE } }, output: { format: { type: 'audio/pcm', rate: RATE } } },
            tools: [{
              type: 'function',
              name: 'ask_theo',
              description: "Ask Theo's store-data brain any question about this store (sales, labor, schedule, checklists, tips, reviews, punches, crew). Returns the answer to speak.",
              parameters: { type: 'object', properties: { question: { type: 'string', description: 'The full question in plain English' } }, required: ['question'] },
            }],
          },
        }));
        const held = pendingAudioRef.current;
        pendingAudioRef.current = [];
        held.forEach((audio) => ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio })));
        setSpeechTick((n) => n + 1); // start the silence hang-up clock now that the line is open
      };
      ws.onmessage = async (msg) => {
        const ev = JSON.parse(msg.data);
        lastActivityRef.current = Date.now();
        switch (ev.type) {
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            setPhase('speaking');
            playChunk(b64ToFloat(ev.delta));
            break;
          case 'response.output_audio_transcript.delta':
          case 'response.audio_transcript.delta':
            if (ev.delta) setCaption((c) => (c.endsWith('\u200b') ? '' : c) + ev.delta);
            break;
          case 'response.done':
            setCaption((c) => c + '\u200b');
            break;
          case 'input_audio_buffer.speech_started':
            userSpeakingRef.current = true;
            stopPlayback();
            setPhase('listening');
            setSpeechTick((n) => n + 1);
            break;
          case 'input_audio_buffer.speech_stopped':
            userSpeakingRef.current = false;
            setSpeechTick((n) => n + 1);
            // "Got it" = the manager finished talking (skipped if Theo is already talking).
            triggerCue('heard', true);
            break;
          case 'conversation.item.input_audio_transcription.completed':
            userSpeakingRef.current = false;
            setSpeechTick((n) => n + 1);
            break;
          case 'response.function_call_arguments.done': {
            const nextLine = pickThinkingLine(lastThinkingRef.current);
            lastThinkingRef.current = nextLine;
            setThinkingLine(nextLine);
            setPhase('thinking');
            let q = '';
            try { q = JSON.parse(ev.arguments || '{}').question || ''; } catch { /* bad args */ }
            const output = ev.name === 'ask_theo' && q ? await askTheo(q) : JSON.stringify({ error: 'Unknown tool' });
            ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output } }));
            ws.send(JSON.stringify({ type: 'response.create' }));
            break;
          }
          case 'error':
            console.error('[theo-voice]', ev);
            errorEndingRef.current = true;
            break;
        }
      };
      ws.onerror = () => { errorEndingRef.current = true; setError('Lost connection to Theo’s voice.'); teardown(false); setPhase('error'); };
      ws.onclose = () => { teardown(!errorEndingRef.current); setMode('talk'); };
    } catch (e: any) {
      fail(e);
    }
  };

  const start = async (withOpener: boolean) => {
    if (!currentLocation?.id || startingRef.current) return;
    startingRef.current = true;
    reachedListeningRef.current = false;
    closedCuePlayedRef.current = false;
    errorEndingRef.current = false;
    micGateUntilRef.current = 0;
    capturingRef.current = false;
    pendingAudioRef.current = [];
    withOpenerRef.current = withOpener;
    setMode('talk');
    setError('');
    setStoppedListening(false);
    setHitLimit(false);
    if (withOpener) setCaption('');
    setPhase('connecting');
    try {
      // iPhone/iPad: pick "call" audio mode once, up front, so the volume doesn't drop mid-talk.
      try { const s = (navigator as any).audioSession; if (s) s.type = 'play-and-record'; } catch { /* unsupported */ }
      // Audio and mic must be set up inside the tap for iPhone/iPad.
      const ctx = new AudioContext({ sampleRate: RATE });
      void ctx.resume();
      ctxRef.current = ctx;
      playAtRef.current = ctx.currentTime;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      const levels = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(levels);
        let sum = 0;
        for (let i = 0; i < levels.length; i++) sum += levels[i];
        setLevel(Math.min(1, sum / levels.length / 90));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      if (!withOpener) prefetchSession();

      const [upd, stream] = await Promise.all([
        withOpener ? supabase.functions.invoke('theo-voice', { body: { action: 'update', location_id: currentLocation.id } }) : Promise.resolve(null),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
      ]);
      if (!ctxRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      // The mic runs from now until the talk ends (never restarted while Theo speaks),
      // and only sends audio on the manager's turn.
      const mic = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (ev) => {
        if (!capturingRef.current || ctx.currentTime < micGateUntilRef.current) return;
        const audio = floatToB64(ev.inputBuffer.getChannelData(0));
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
        else if (pendingAudioRef.current.length < 60) pendingAudioRef.current.push(audio); // ~10s
      };
      const mute = ctx.createGain();
      mute.gain.value = 0;
      mic.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);
      procRef.current = proc;

      if (upd && (upd.error || !upd.data?.opener)) throw new Error(upd.data?.error || 'Theo’s voice isn’t available right now.');
      const opener = upd?.data?.opener;
      setCaption(opener?.script || '');
      if (user?.id) {
        // Usage row is saved in the background; it never holds up the talk.
        const log: NonNullable<typeof logRef.current> = { id: '', liveStart: null, liveMs: 0, questions: 0 };
        logRef.current = log;
        void supabase.from('theo_voice_sessions')
          .insert({ user_id: user.id, location_id: currentLocation.id, opener_key: opener?.key ?? null, tts_chars: upd?.data?.audio ? upd.data.tts_chars || 0 : 0 })
          .select('id').single()
          .then(({ data: row }) => {
            if (!row) return;
            log.id = row.id;
            if (log.final) saveFinal(row.id, log.final);
          });
      }
      if (opener && user?.id) localStorage.setItem(`theo-voice-seen:${user.id}:${currentLocation.id}`, opener.key || '');

      if (!withOpener) return goLive('');
      if (!upd?.data?.audio) {
        // Text-to-speech failed: show the update as text, offer "Tap to talk to Theo".
        setShowText(true);
        teardown();
        return;
      }
      prefetchSession(); // ready for the live talk right after the update
      const bin = atob(upd.data.audio);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await ctx.decodeAudioData(bytes.buffer);
      if (!ctxRef.current) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(analyser);
      src.onended = () => { updateSrcRef.current = null; void goLive(opener.script); };
      updateSrcRef.current = src;
      src.start();
      setPhase('speaking');
    } catch (e: any) {
      fail(e);
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

  const confirmCover = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'preview' || a.proposal.action !== 'cover_shift' || !user?.id || !currentLocation?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'saving', error: undefined });
    try {
      // Re-check at the moment of the tap: anything changed since the preview means no save.
      const { data: chk, error: ce } = await supabase.functions.invoke('ai-assistant', {
        body: { messages: [], location_id: currentLocation.id, location_name: currentLocation.name, source: 'voice', pick: { kind: 'recheck', proposal: p } },
      });
      if (ce || !chk?.recheck) throw new Error('Could not re-check the shift.');
      if (!chk.recheck.ok) {
        logAction(a.logId, { status: 'failed' });
        setAction({ ...a, stage: 'preview', error: `Not saved. Something changed: ${chk.recheck.changed}` });
        return;
      }
      const res = await reassignAndNotify({ shift: { id: p.shift_id, schedule_id: p.schedule_id, day_of_week: p.day_of_week, shift_date: p.shift_date }, toUserId: p.replacement.id, changedBy: user.id, timezone });
      refreshShiftViews(currentLocation.id);
      logAction(a.logId, { status: 'confirmed', record_id: p.shift_id });
      onRecord?.(`Covered shift: ${p.date_label}, ${p.time_label}. ${p.replacement.name} takes it from ${p.covered.name}`);
      const savedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setAction({ ...a, stage: 'done', savedAt, undoOpen: true, notified: res.notified });
      setTimeout(() => { const c = actionRef.current; if (c?.proposal.id === p.id && c.stage === 'done') setAction({ ...c, undoOpen: false }); }, UNDO_MS);
    } catch (err: any) {
      logAction(a.logId, { status: 'failed' });
      setAction({ ...a, stage: 'preview', error: err?.message ? `Couldn't save: ${err.message}` : "Couldn't save the change. Try again." });
    }
  };
  const undoCover = async () => {
    const a = actionRef.current;
    if (!a || a.stage !== 'done' || a.proposal.action !== 'cover_shift' || !user?.id) return;
    const p = a.proposal;
    setAction({ ...a, stage: 'undoing', error: undefined });
    try {
      await reassignAndNotify({ shift: { id: p.shift_id, schedule_id: p.schedule_id, day_of_week: p.day_of_week, shift_date: p.shift_date }, toUserId: p.covered.id, changedBy: user.id, timezone });
      if (currentLocation?.id) refreshShiftViews(currentLocation.id);
      logAction(a.logId, { status: 'undone' });
      onRecord?.(`Undid shift cover: ${p.covered.name} has ${p.date_label}, ${p.time_label} again`);
      setAction({ ...a, stage: 'undone' });
    } catch {
      setAction({ ...a, stage: 'done', error: "Couldn't undo the change. Try again." });
    }
  };
  const confirmTask = async () => {
    const a = actionRef.current;
    if (a?.proposal.action === 'cover_shift') return confirmCover();
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
  const cancelTask = () => {
    const a = actionRef.current;
    if (a?.stage === 'preview') logAction(a.logId, { status: 'cancelled' });
    setAction(null);
  };
  const undoTask = async () => {
    const a = actionRef.current;
    if (a?.proposal.action === 'cover_shift') return undoCover();
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

  const onOrbTap = () => {
    if (phase === 'idle') { const w = mode === 'update'; setTimeout(() => start(w), 0); return; }
    if (phase === 'error') { const w = withOpenerRef.current; setTimeout(() => start(w), 0); return; }
    if (phase === 'speaking') {
      const u = updateSrcRef.current;
      if (u) { try { u.stop(); } catch { /* onended goes live */ } return; }
      stopPlayback();
      wsRef.current?.send(JSON.stringify({ type: 'response.cancel' }));
      setPhase('listening');
    }
  };

  const amberTag = (t: string) => (
    <span className="inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-extrabold" style={{ background: 'hsl(38 95% 88%)', color: 'hsl(32 90% 26%)' }}>{t}</span>
  );

  function renderCover(a: ActionCard, p: CoverProposal) {
    const label = 'text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const rf = firstName(p.replacement.name);
    const cf = firstName(p.covered.name);
    if (a.stage === 'done' || a.stage === 'undoing' || a.stage === 'undone') {
      const undone = a.stage === 'undone';
      return (
        <div className="mt-4 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary-foreground" style={{ background: undone ? 'hsl(var(--muted-foreground))' : 'hsl(142 70% 28%)' }}>
              {undone ? <X className="h-5 w-5" /> : <Check className="h-5 w-5" strokeWidth={3} />}
            </span>
            <div>
              <div className="text-[18px] font-extrabold">{undone ? 'Change undone' : 'Shift covered'}</div>
              {!undone && <div className="text-[13px] text-muted-foreground">Saved at {a.savedAt}</div>}
            </div>
          </div>
          <p className="text-[17px] font-extrabold">{undone ? `${cf} has the shift again.` : `Done. ${rf} has ${p.date_label.split(',')[0]} ${Number(p.start_time.slice(0, 2)) >= 16 ? 'night' : 'shift'}.`}</p>
          <p className="text-[14px] text-muted-foreground">{p.date_label} · {p.time_label}</p>
          <p className="text-[13px] text-muted-foreground">{p.published ? (a.notified ? 'Both were notified.' : 'No one needed a notice.') : 'No one was notified, the week is a draft.'}</p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          {!undone && a.undoOpen && (
            <div className="flex flex-col gap-1">
              <button onClick={undoTask} disabled={a.stage === 'undoing'}
                className="h-12 w-full rounded-full border-2 border-border text-[15px] font-bold disabled:opacity-60">
                {a.stage === 'undoing' ? 'Undoing…' : 'Undo'}
              </button>
              <p className="text-center text-[12px] text-muted-foreground">Undo is available for 10 minutes{p.published ? ' and notifies both again' : ''}.</p>
            </div>
          )}
          <button onClick={() => setAction(null)} className="h-11 w-full text-[14px] font-semibold text-muted-foreground">Done</button>
        </div>
      );
    }
    const saving = a.stage === 'saving';
    const others = a.otherChanges ?? 0;
    return (
      <>
        <p className="mt-3 text-center text-[22px] font-extrabold text-white">Does this look right?</p>
        <div className="mt-3 w-full max-w-[420px] rounded-[20px] bg-card p-4 text-foreground flex flex-col gap-[14px] tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[18px] font-extrabold">Cover a shift</span>
            {amberTag('Preview · not saved')}
          </div>
          <div><div className={label}>When</div><div className="text-[17px] font-extrabold">{p.date_label} · {p.time_label}</div></div>
          <div className="flex flex-col gap-2">
            <div className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'hsl(var(--destructive) / 0.12)' }}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" />
              <div><div className="text-[15px] font-extrabold">{p.covered.name}</div><div className="text-[13px] text-muted-foreground">Comes off this shift</div></div>
            </div>
            <div className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'hsl(142 70% 28% / 0.12)' }}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: 'hsl(142 70% 28%)' }} />
              <div className="flex-1"><div className="text-[15px] font-extrabold">{p.replacement.name}</div><div className="text-[13px] text-muted-foreground">Takes this shift</div></div>
              {p.tag && amberTag(p.tag)}
            </div>
          </div>
          <ul className="flex flex-col gap-1">
            {p.checks.map((c) => (
              <li key={c} className="flex items-start gap-2 text-[14px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={3} />{c}</li>
            ))}
          </ul>
          <div className="h-px w-full bg-border" />
          <p className="text-[13px] text-muted-foreground">
            {p.published
              ? `When you confirm, the schedule changes and ${cf} and ${rf} are notified.${others > 0 ? ` ${others} other ${others === 1 ? 'change' : 'changes'} on this week will also go out.` : ''}`
              : "This week isn't published yet, so no one is notified."}
          </p>
          {a.error && <p className="text-[13px] font-semibold text-destructive">{a.error}</p>}
          <button onClick={confirmTask} disabled={saving}
            className="h-[52px] w-full rounded-full text-[16px] font-extrabold text-white disabled:opacity-70" style={{ background: DEEP_PRIMARY }}>
            {saving ? 'Saving…' : 'Confirm change'}
          </button>
          <button onClick={cancelTask} disabled={saving} className="h-11 w-full text-[15px] font-semibold text-muted-foreground">Cancel</button>
        </div>
        <p className="mt-3 text-center text-[13px] text-white/[0.78]">Or tell Theo what to change.</p>
      </>
    );
  }

  function renderScreen(sc: CoverScreen) {
    const rowCls = 'flex min-h-[60px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left active:bg-muted disabled:opacity-60';
    const groupLabel = 'sticky top-0 z-10 bg-card px-1 py-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground';
    const person = (r: ScreenRow) => (
      <button key={r.employee_id} disabled={picking} className={rowCls}
        onClick={() => sc.kind === 'candidates' && pickFromScreen({ kind: 'candidate', shift_id: sc.shift_id, employee_id: r.employee_id })}>
        <div className="flex-1"><div className="text-[16px] font-extrabold">{r.name}</div><div className="text-[13px] text-muted-foreground">{r.line}</div></div>
        {r.tag && amberTag(r.tag)}
      </button>
    );
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col items-center tabular-nums">
        <p className="mt-3 shrink-0 text-center text-[22px] font-extrabold text-white">{sc.title}</p>
        {sc.kind === 'candidates' && <p className="mt-1 shrink-0 text-center text-[13px] text-white/[0.78]">{sc.subtitle}</p>}
        <div className="mt-3 flex min-h-0 w-full max-w-[420px] flex-1 items-start overflow-hidden">
          <CoverListScroller>
          {sc.kind === 'shifts' && (sc.shifts.length ? sc.shifts.map((sh) => (
            <button key={sh.shift_id} disabled={picking} className={rowCls} onClick={() => pickFromScreen({ kind: 'shift', shift_id: sh.shift_id })}>
              <div><div className="text-[16px] font-extrabold">{sh.name}</div><div className="text-[13px] text-muted-foreground">{sh.time}</div></div>
            </button>
          )) : <p className="p-3 text-[14px] text-muted-foreground">No shifts left today.</p>)}
          {sc.kind === 'people' && sc.people.map((pp) => (
            <button key={pp.employee_id} disabled={picking} className={rowCls} onClick={() => pickFromScreen({ kind: 'person', employee_id: pp.employee_id, date: sc.date })}>
              <div className="text-[16px] font-extrabold">{pp.name}</div>
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
        {sc.kind === 'candidates' && sc.blocked_summary && <p className="mt-2 shrink-0 px-1 text-center text-[13px] text-white/[0.78]">{sc.blocked_summary}.</p>}
        {screenNote && <p className="mt-2 shrink-0 px-1 text-center text-[14px] font-semibold text-white">{screenNote}</p>}
        <p className="mt-2 shrink-0 text-center text-[13px] text-white/[0.78]">{sc.kind === 'candidates' ? 'Tap a name, or just say it.' : 'Tap one, or just say it.'}</p>
        <button onClick={() => { setScreen(null); setScreenNote(''); }} className="mt-1 h-11 shrink-0 px-6 text-[14px] font-semibold text-white/80">Close list</button>
      </div>
    );
  }

  function renderAction(a: ActionCard) {
    if (a.proposal.action === 'cover_shift') return renderCover(a, a.proposal);
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
        <p className="mt-3 text-center text-[22px] font-extrabold text-white">Does this look right?</p>
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
          <button onClick={confirmTask} disabled={saving}
            className="h-[52px] w-full rounded-full text-[16px] font-extrabold text-white disabled:opacity-70" style={{ background: DEEP_PRIMARY }}>
            {saving ? 'Saving…' : 'Create task'}
          </button>
          <button onClick={cancelTask} disabled={saving} className="h-11 w-full text-[15px] font-semibold text-muted-foreground">Cancel</button>
        </div>
        <p className="mt-3 text-center text-[13px] text-white/[0.78]">Or tell Theo what to change.</p>
      </>
    );
  }

  if (!open) return null;
  const visibleCaption = caption.replace(/\u200b/g, '');

  return createPortal(
    // Sits above the dock and toasts while open (unlocked for the voice screen only).
    <div className="fixed inset-0 flex flex-col items-center bg-[rgb(15_18_21/0.8)] text-white backdrop-blur-lg [-webkit-backdrop-filter:blur(16px)] supports-[(backdrop-filter:blur(0))_or_(-webkit-backdrop-filter:blur(0))]:bg-[rgb(15_18_21/0.52)]" style={{ zIndex: 1000000000 }}>
      <div className="flex w-full items-center justify-between px-4 pt-[max(env(safe-area-inset-top),16px)]">
        <div className="text-sm font-semibold text-white/85">{currentLocation?.name}</div>
        <button aria-label="Close Theo voice" onClick={() => { teardown(); onClose(); }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.16] text-white ring-1 ring-inset ring-white/[0.28]">
          <X className="h-5 w-5" strokeWidth={2.25} />
        </button>
      </div>

      <div className={action ? "flex flex-1 flex-col items-center overflow-y-auto px-4 pt-2" : screen ? "flex min-h-0 flex-1 flex-col items-center overflow-hidden px-4 pt-2" : "flex flex-1 flex-col items-center justify-center px-6"}>
        <button aria-label={ORB_LABEL[phase]} onClick={onOrbTap}
          className={action || screen ? 'relative h-[76px] w-[76px] bg-transparent active:scale-95 transition-transform' : 'relative h-[280px] w-[280px] bg-transparent active:scale-95 transition-transform'}>
          <div className={action || screen ? 'absolute left-0 top-0 h-[280px] w-[280px] origin-top-left scale-[0.2714]' : 'h-full w-full'}>
            <TheoVoiceOrb ref={orbRef} phase={phase} level={level} />
          </div>
        </button>
        {action ? renderAction(action) : screen ? renderScreen(screen) : <>
        <p className="mt-[26px] text-center text-lg font-bold tracking-[-0.01em] text-white">{phase === 'error' ? error : phase === 'idle' && mode === 'talk' ? 'Tap to talk to Theo' : phase === 'connecting' && withOpenerRef.current && !caption ? 'Getting your update…' : PHASE_TEXT[phase]}</p>
        {(() => {
          const sub = phase === 'idle' && mode === 'talk'
            ? (hitLimit ? 'We hit the 3-minute limit. Tap to keep going.' : stoppedListening ? 'I stopped listening. Tap to pick up where we left off.' : 'Ask about sales, labor, the schedule or checklists')
            : PHASE_SUB[phase];
          return sub ? <p className="mt-1 text-center text-[13px] text-white/75">{sub}</p> : null;
        })()}
        </>}
        {longAnswer && (
          <button onClick={() => { teardown(); onClose(); (onOpenAnswer ?? onOpenChat)(); }}
            className="mt-4 flex h-11 min-h-[44px] items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-[hsl(220_25%_5%)] shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <MessageSquareText className="h-4 w-4" /> See full answer <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {showText && visibleCaption && (
        <div className="mx-4 mb-3 max-h-48 w-[calc(100%-2rem)] max-w-[720px] overflow-y-auto rounded-2xl border border-border bg-card/95 p-4 text-sm leading-relaxed text-foreground">
          {visibleCaption}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),28px)]">
        {phase === 'idle' && (
          <button onClick={() => { const w = mode === 'talk'; setTimeout(() => start(w), 0); }}
            className="flex h-11 items-center gap-2 rounded-full bg-white/[0.16] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/[0.28]">
            {mode === 'update' ? <><Mic className="h-4 w-4" /> Just talk</> : <><Volume2 className="h-4 w-4" /> Hear your update</>}
          </button>
        )}
        <button onClick={() => setShowText((s) => !s)}
          className="flex h-11 items-center gap-2 rounded-full bg-white/[0.16] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/[0.28]">
          <MessageSquareText className="h-4 w-4" /> {showText ? 'Hide text' : 'Show text'}
        </button>
        <button onClick={() => { teardown(); onClose(); onOpenChat(); }}
          className="flex h-11 items-center gap-2 rounded-full bg-white/[0.16] px-4 text-sm font-semibold text-white ring-1 ring-inset ring-white/[0.28]">
          <Keyboard className="h-4 w-4" /> Type instead
        </button>
      </div>
    </div>,
    document.body,
  );
}
