// Realtime voice playback helpers. The buffer is always created at the rate the
// audio was produced at (not the AudioContext's rate), so Web Audio resamples it
// and duration = samples / sourceRate even when iOS runs the context at 44.1k/48k.
export const THEO_PCM_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000];

export function pcmBuffer(ctx: Pick<BaseAudioContext, 'createBuffer'>, f: Float32Array, sourceRate: number): AudioBuffer {
  const buf = ctx.createBuffer(1, f.length, sourceRate);
  buf.getChannelData(0).set(f);
  return buf;
}

// Reads the output PCM rate the server confirmed in session.created/updated; null if absent or not PCM.
export function outputRateFrom(session: unknown): number | null {
  const fmt = (session as { audio?: { output?: { format?: { type?: string; rate?: unknown } } } } | null | undefined)?.audio?.output?.format;
  if (!fmt || (fmt.type && fmt.type !== 'audio/pcm')) return null;
  const r = Number(fmt.rate);
  return THEO_PCM_RATES.includes(r) ? r : null;
}
