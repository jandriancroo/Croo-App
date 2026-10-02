import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Keyboard, MessageSquareText, Mic, Volume2, ArrowRight } from 'lucide-react';
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
  thinking: 'Checking the numbers…',
  error: '',
};
const PHASE_SUB: Record<Phase, string> = {
  idle: '', connecting: '', speaking: 'Tap the orb to interrupt', listening: '', thinking: '', error: 'Tap the orb to try again.',
};
const ORB_LABEL: Record<Phase, string> = {
  idle: 'Start Theo voice update', connecting: 'Connecting to Theo', speaking: 'Interrupt Theo',
  listening: 'Theo is listening', thinking: 'Theo is checking the numbers', error: 'Try Theo voice again',
};

// Final save uses fetch keepalive so it still goes out while the page is being hidden/closed.
let accessToken = '';
supabase.auth.getSession().then(({ data }) => { accessToken = data.session?.access_token || ''; });
supabase.auth.onAuthStateChange((_e, session) => { accessToken = session?.access_token || ''; });
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

export function TheoVoiceOverlay({ open, onClose, onOpenChat, onOpenAnswer, onExchange, intent = 'talk' }: { open: boolean; onClose: () => void; onOpenChat: () => void; onOpenAnswer?: () => void; onExchange?: (question: string, answer: string) => void; intent?: 'update' | 'talk' }) {
  const { currentLocation } = useLocation();
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
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

  useEffect(() => { if (!open) { teardown(); setStoppedListening(false); setLongAnswer(false); setHitLimit(false); historyRef.current = []; } }, [open, teardown]);

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

  const askTheo = async (question: string) => {
    if (logRef.current) logRef.current.questions += 1;
    setLongAnswer(false);
    const { data, error: e } = await supabase.functions.invoke('ai-assistant', {
      body: {
        messages: [{ role: 'user', content: question + VOICE_SUFFIX }],
        location_id: currentLocation?.id,
        location_name: currentLocation?.name,
        source: 'voice',
      },
    });
    if (e) return JSON.stringify({ error: 'Theo could not reach the store data right now.' });
    const answer: string = data?.content || '';
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
    setPhase('connecting');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('theo-voice', { body: { action: 'session', location_id: currentLocation.id } });
      if (fnErr || !data?.token) throw new Error(data?.error || 'Theo’s voice isn’t available right now.');
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
        const mic = ctx.createMediaStreamSource(stream);
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (ev) => {
          if (ws.readyState === WebSocket.OPEN && ctx.currentTime >= micGateUntilRef.current) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: floatToB64(ev.inputBuffer.getChannelData(0)) }));
          }
        };
        const mute = ctx.createGain();
        mute.gain.value = 0;
        mic.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
        procRef.current = proc;
        reachedListeningRef.current = true;
        setPhase('listening');
        triggerCue('ready', true);
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
          case 'conversation.item.input_audio_transcription.completed':
            userSpeakingRef.current = false;
            setSpeechTick((n) => n + 1);
            break;
          case 'response.function_call_arguments.done': {
            setPhase('thinking');
            triggerCue('heard', true);
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
    withOpenerRef.current = withOpener;
    setMode('talk');
    setError('');
    setStoppedListening(false);
    setHitLimit(false);
    if (withOpener) setCaption('');
    setPhase('connecting');
    try {
      // Audio and mic must be set up inside the tap for iPhone/iPad; the mic stays open
      // (but sends nothing) while the update plays, so going live later needs no new permission.
      const ctx = new AudioContext({ sampleRate: RATE });
      await ctx.resume();
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

      const [upd, stream] = await Promise.all([
        withOpener ? supabase.functions.invoke('theo-voice', { body: { action: 'update', location_id: currentLocation.id } }) : Promise.resolve(null),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
      ]);
      if (!ctxRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (upd && (upd.error || !upd.data?.opener)) throw new Error(upd.data?.error || 'Theo’s voice isn’t available right now.');
      const opener = upd?.data?.opener;
      setCaption(opener?.script || '');
      if (user?.id) {
        const { data: row } = await supabase.from('theo_voice_sessions')
          .insert({ user_id: user.id, location_id: currentLocation.id, opener_key: opener?.key ?? null, tts_chars: upd?.data?.audio ? upd.data.tts_chars || 0 : 0 })
          .select('id').single();
        if (row) logRef.current = { id: row.id, liveStart: null, liveMs: 0, questions: 0 };
      }
      if (opener && user?.id) localStorage.setItem(`theo-voice-seen:${user.id}:${currentLocation.id}`, opener.key || '');

      if (!withOpener) return goLive('');
      if (!upd?.data?.audio) {
        // Text-to-speech failed: show the update as text, offer "Tap to talk to Theo".
        setShowText(true);
        teardown();
        return;
      }
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

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <button aria-label={ORB_LABEL[phase]} onClick={onOrbTap}
          className="relative h-[280px] w-[280px] bg-transparent active:scale-95 transition-transform">
          <TheoVoiceOrb ref={orbRef} phase={phase} level={level} />
        </button>
        <p className="mt-[26px] text-center text-lg font-bold tracking-[-0.01em] text-white">{phase === 'error' ? error : phase === 'idle' && mode === 'talk' ? 'Tap to talk to Theo' : phase === 'connecting' && withOpenerRef.current && !caption ? 'Getting your update…' : PHASE_TEXT[phase]}</p>
        {(() => {
          const sub = phase === 'idle' && mode === 'talk'
            ? (hitLimit ? 'We hit the 3-minute limit. Tap to keep going.' : stoppedListening ? 'I stopped listening. Tap to pick up where we left off.' : 'Ask about sales, labor, the schedule or checklists')
            : PHASE_SUB[phase];
          return sub ? <p className="mt-1 text-center text-[13px] text-white/75">{sub}</p> : null;
        })()}
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
