import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, MessageSquareText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'connecting' | 'speaking' | 'listening' | 'thinking' | 'error';

const RATE = 24000;
const VOICE_SUFFIX =
  '\n\n(Voice mode: answer in 1-3 short spoken sentences, round numbers, no lists or tables. Do not say individual employee names, labor grades, cash variances or lateness — say "details are on screen".)';

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

/** Animated version of Theo's three dotted rings — level (0..1) drives the breathing. */
function VoiceOrb({ phase, level }: { phase: Phase; level: number }) {
  const scale = 1 + (phase === 'speaking' ? level * 0.35 : 0);
  return (
    <div
      className={cn('relative h-56 w-56 text-primary-foreground', phase === 'thinking' && 'animate-pulse')}
      style={{ transform: `scale(${scale})`, transition: 'transform 90ms linear' }}
    >
      <div className="absolute inset-0 rounded-full bg-primary/30 blur-2xl" />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1.2} className="relative h-full w-full">
        <g className="origin-center animate-[spin_24s_linear_infinite]" style={{ transformBox: 'fill-box' }}>
          <circle cx="12" cy="12" r="9.5" strokeDasharray="0.1 3.63" />
        </g>
        <g className="origin-center animate-[spin_16s_linear_infinite_reverse]" style={{ transformBox: 'fill-box' }}>
          <circle cx="12" cy="12" r="6" strokeDasharray="0.1 3.67" />
        </g>
        <circle cx="12" cy="12" r="2.5" strokeDasharray="0.1 3.04" className={cn(phase === 'listening' && 'animate-ping origin-center')} style={{ transformBox: 'fill-box' }} />
      </svg>
    </div>
  );
}

const PHASE_TEXT: Record<Phase, string> = {
  idle: 'Tap to hear your update',
  connecting: 'Connecting…',
  speaking: 'Theo is talking — tap to interrupt',
  listening: 'Listening…',
  thinking: 'Checking the numbers…',
  error: '',
};

export function TheoVoiceOverlay({ open, onClose, onOpenChat }: { open: boolean; onClose: () => void; onOpenChat: () => void }) {
  const { currentLocation } = useLocation();
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [showText, setShowText] = useState(false);
  const [level, setLevel] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const playAtRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>();

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* done */ } });
    sourcesRef.current = [];
    if (ctxRef.current) playAtRef.current = ctxRef.current.currentTime;
  }, []);

  const teardown = useCallback(() => {
    stopPlayback();
    wsRef.current?.close();
    wsRef.current = null;
    procRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setPhase('idle');
    setLevel(0);
  }, [stopPlayback]);

  useEffect(() => { if (!open) teardown(); }, [open, teardown]);
  useEffect(() => () => teardown(), [teardown]);

  const playChunk = (f: Float32Array) => {
    const ctx = ctxRef.current;
    if (!ctx || !analyserRef.current) return;
    const buf = ctx.createBuffer(1, f.length, RATE);
    buf.copyToChannel(f, 0);
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
    const { data, error: e } = await supabase.functions.invoke('ai-assistant', {
      body: {
        messages: [{ role: 'user', content: question + VOICE_SUFFIX }],
        location_id: currentLocation?.id,
        location_name: currentLocation?.name,
      },
    });
    if (e) return JSON.stringify({ error: 'Theo could not reach the store data right now.' });
    return JSON.stringify({ answer: data?.content || 'No answer.' });
  };

  const start = async () => {
    if (!currentLocation?.id || phase !== 'idle') return;
    setError('');
    setPhase('connecting');
    try {
      // Audio must be created inside the tap for iPhone/iPad.
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

      const [{ data, error: fnErr }, stream] = await Promise.all([
        supabase.functions.invoke('theo-voice', { body: { action: 'session', location_id: currentLocation.id } }),
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
      ]);
      if (fnErr || !data?.token) throw new Error(data?.error || 'Theo’s voice isn’t available right now.');
      streamRef.current = stream;
      setCaption(data.opener?.script || '');
      if (user?.id) localStorage.setItem(`theo-voice-seen:${user.id}:${currentLocation.id}`, data.opener?.key || '');

      const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${data.model}`, [`xai-client-secret.${data.token}`]);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            voice: data.voice,
            instructions: data.instructions,
            turn_detection: { type: 'server_vad' },
            audio: { input: { format: { type: 'audio/pcm', rate: RATE } }, output: { format: { type: 'audio/pcm', rate: RATE } } },
            tools: [{
              type: 'function',
              name: 'ask_theo',
              description: "Ask Theo's store-data brain any question about this store (sales, labor, schedule, checklists, inventory, tips, reviews, punches, crew). Returns the answer to speak.",
              parameters: { type: 'object', properties: { question: { type: 'string', description: 'The full question in plain English' } }, required: ['question'] },
            }],
          },
        }));
        ws.send(JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Greet me by reading this opening update naturally, then wait for me:\n\n${data.opener?.script || ''}` }] },
        }));
        ws.send(JSON.stringify({ type: 'response.create' }));

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
            stopPlayback();
            setPhase('listening');
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
      ws.onerror = () => { setError('Lost connection to Theo’s voice.'); setPhase('error'); };
      ws.onclose = () => setPhase((p) => (p === 'error' ? p : 'idle'));
    } catch (e: any) {
      const denied = e?.name === 'NotAllowedError';
      setError(denied ? 'Microphone access is off. Allow it in your browser settings, or use text chat.' : e?.message || 'Theo’s voice isn’t available right now.');
      teardown();
      setPhase('error');
    }
  };

  const onOrbTap = () => {
    if (phase === 'idle' || phase === 'error') { setPhase('idle'); setTimeout(start, 0); return; }
    if (phase === 'speaking') {
      stopPlayback();
      wsRef.current?.send(JSON.stringify({ type: 'response.cancel' }));
      setPhase('listening');
    }
  };

  if (!open) return null;
  const visibleCaption = caption.replace(/\u200b/g, '');

  return createPortal(
    // Sits above the dock and toasts while open (unlocked for the voice screen only).
    <div className="fixed inset-0 flex flex-col items-center bg-background/95 backdrop-blur-md" style={{ zIndex: 1000000000 }}>
      <div className="flex w-full items-center justify-between px-4 pt-[max(env(safe-area-inset-top),16px)]">
        <div className="text-sm font-semibold text-muted-foreground">{currentLocation?.name}</div>
        <button aria-label="Close Theo voice" onClick={() => { teardown(); onClose(); }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-foreground">
          <X className="h-5 w-5" strokeWidth={2.25} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <button aria-label={PHASE_TEXT[phase] || 'Theo'} onClick={onOrbTap}
          className="flex h-64 w-64 items-center justify-center rounded-full bg-primary shadow-2xl active:scale-95 transition-transform">
          <VoiceOrb phase={phase} level={level} />
        </button>
        <p className="text-center text-[15px] font-semibold text-foreground">{phase === 'error' ? error : PHASE_TEXT[phase]}</p>
        {phase === 'error' && <p className="text-xs text-muted-foreground">Tap the orb to try again.</p>}
      </div>

      {showText && visibleCaption && (
        <div className="mx-4 mb-3 max-h-48 w-[calc(100%-2rem)] max-w-[720px] overflow-y-auto rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground">
          {visibleCaption}
        </div>
      )}
      <div className="flex gap-2 pb-[max(env(safe-area-inset-bottom),20px)]">
        <button onClick={() => setShowText((s) => !s)}
          className="flex items-center gap-1.5 rounded-full bg-muted px-4 py-2.5 text-sm font-semibold text-foreground">
          <MessageSquareText className="h-4 w-4" /> {showText ? 'Hide text' : 'Show text'}
        </button>
        <button onClick={() => { teardown(); onClose(); onOpenChat(); }}
          className="flex items-center gap-1.5 rounded-full bg-muted px-4 py-2.5 text-sm font-semibold text-foreground">
          <Mic className="h-4 w-4" /> Type instead
        </button>
      </div>
    </div>,
    document.body,
  );
}
