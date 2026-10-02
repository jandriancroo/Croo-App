import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Keyboard, MessageSquareText, Mic, Volume2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';
import { TheoVoiceOrb } from './TheoVoiceOrb';

type Phase = 'idle' | 'connecting' | 'speaking' | 'listening' | 'thinking' | 'error';

const RATE = 24000;
/** Live voice is billed per minute: hang up after this much silence on the manager's turn. */
const SILENCE_HANGUP_MS = 10_000;
const VOICE_SUFFIX =
  '\n\n(Voice mode: answer in 1-3 short spoken sentences, round numbers, no lists or tables. You are talking to a manager with full access, so say names and details plainly. The full answer is also saved to their Theo chat.)';

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

export function TheoVoiceOverlay({ open, onClose, onOpenChat, onExchange, intent = 'talk' }: { open: boolean; onClose: () => void; onOpenChat: () => void; onExchange?: (question: string, answer: string) => void; intent?: 'update' | 'talk' }) {
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
  const rafRef = useRef<number>();
  // liveStart = when the paid live connection opened (null while only the update is playing).
  const logRef = useRef<{ id: string; liveStart: number | null; liveMs: number; questions: number } | null>(null);
  const updateSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const userSpeakingRef = useRef(false);
  const [speechTick, setSpeechTick] = useState(0);
  const [stoppedListening, setStoppedListening] = useState(false);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* done */ } });
    sourcesRef.current = [];
    if (ctxRef.current) playAtRef.current = ctxRef.current.currentTime;
  }, []);

  const teardown = useCallback(() => {
    const log = logRef.current;
    logRef.current = null;
    if (log) {
      const liveMs = log.liveMs + (log.liveStart ? Date.now() - log.liveStart : 0);
      void supabase.from('theo_voice_sessions').update({
        ended_at: new Date().toISOString(),
        seconds: Math.min(14400, Math.round(liveMs / 1000)),
        questions: log.questions,
      }).eq('id', log.id);
    }
    const u = updateSrcRef.current;
    updateSrcRef.current = null;
    if (u) { u.onended = null; try { u.stop(); } catch { /* done */ } }
    stopPlayback();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); }
    procRef.current?.disconnect();
    procRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    userSpeakingRef.current = false;
    setPhase('idle');
    setLevel(0);
  }, [stopPlayback]);

  useEffect(() => { if (!open) { teardown(); setStoppedListening(false); } }, [open, teardown]);
  useEffect(() => () => teardown(), [teardown]);

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
    const { data, error: e } = await supabase.functions.invoke('ai-assistant', {
      body: {
        messages: [{ role: 'user', content: question + VOICE_SUFFIX }],
        location_id: currentLocation?.id,
        location_name: currentLocation?.name,
        source: 'voice',
      },
    });
    if (e) return JSON.stringify({ error: 'Theo could not reach the store data right now.' });
    if (data?.content) onExchange?.(question, data.content);
    return JSON.stringify({ answer: data?.content || 'No answer.' });
  };

  const fail = (e: any) => {
    const denied = e?.name === 'NotAllowedError';
    setError(denied ? 'Microphone access is off. Allow it in your browser settings, or use text chat.' : e?.message || 'Theo’s voice isn’t available right now.');
    teardown();
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
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: data.voice,
            instructions: heardUpdate
              ? `${data.instructions}\nThe manager just heard this update read aloud — don't repeat it, just answer what they ask next:\n${heardUpdate}`
              : data.instructions,
            turn_detection: { type: 'server_vad' },
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
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: floatToB64(ev.inputBuffer.getChannelData(0)) }));
          }
        };
        const mute = ctx.createGain();
        mute.gain.value = 0;
        mic.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
        procRef.current = proc;
        setPhase('listening');
      };
      ws.onmessage = async (msg) => {
        const ev = JSON.parse(msg.data);
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
            let q = '';
            try { q = JSON.parse(ev.arguments || '{}').question || ''; } catch { /* bad args */ }
            const output = ev.name === 'ask_theo' && q ? await askTheo(q) : JSON.stringify({ error: 'Unknown tool' });
            ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output } }));
            ws.send(JSON.stringify({ type: 'response.create' }));
            break;
          }
          case 'error':
            console.error('[theo-voice]', ev);
            break;
        }
      };
      ws.onerror = () => { setError('Lost connection to Theo’s voice.'); teardown(); setPhase('error'); };
      ws.onclose = () => { teardown(); setMode('talk'); };
    } catch (e: any) {
      fail(e);
    }
  };

  const start = async (withOpener: boolean) => {
    if (!currentLocation?.id || phase !== 'idle') return;
    withOpenerRef.current = withOpener;
    setMode('talk');
    setError('');
    setStoppedListening(false);
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
    if (phase === 'error') { const w = withOpenerRef.current; setPhase('idle'); setTimeout(() => start(w), 0); return; }
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
    <div className="fixed inset-0 flex flex-col items-center bg-[rgb(15_18_21/0.8)] text-white backdrop-blur-lg supports-[backdrop-filter]:bg-[rgb(15_18_21/0.52)]" style={{ zIndex: 1000000000 }}>
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
          <div aria-hidden className="absolute left-10 top-10 h-[200px] w-[200px] rounded-full blur-[34px]" style={{ background: 'hsl(var(--primary-light, 190 57% 60%) / 0.32)' }} />
          <TheoVoiceOrb phase={phase} level={level} />
        </button>
        <p className="mt-[26px] text-center text-lg font-bold tracking-[-0.01em] text-white">{phase === 'error' ? error : phase === 'idle' && mode === 'talk' ? 'Tap to talk to Theo' : PHASE_TEXT[phase]}</p>
        {(phase === 'idle' && mode === 'talk' ? 'Ask about sales, labor, the schedule or checklists' : PHASE_SUB[phase]) && (
          <p className="mt-1 text-center text-[13px] text-white/75">{phase === 'idle' && mode === 'talk' ? 'Ask about sales, labor, the schedule or checklists' : PHASE_SUB[phase]}</p>
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
