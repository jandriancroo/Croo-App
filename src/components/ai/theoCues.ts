// Theo's listening cues ("Wood"). Generated with Web Audio; no files.
export type TheoCue = 'ready' | 'heard' | 'closed';
const LO = 659.25, HI = 830.61;
/** Each cue's taps: [seconds after start, pitch in Hz, level]. */
export const CUE_TAPS: Record<TheoCue, [number, number, number][]> = {
  ready: [[0, LO, 1], [0.085, HI, 1]],
  heard: [[0, HI, 0.55]],
  closed: [[0, HI, 1], [0.1, LO, 1]],
};
const buses = new WeakMap<BaseAudioContext, GainNode>();
function bus(ac: BaseAudioContext): GainNode {
  let input = buses.get(ac);
  if (input) return input;
  input = ac.createGain();
  const wet = ac.createGain(); wet.gain.value = 0.2;
  const conv = ac.createConvolver();
  const len = Math.floor(ac.sampleRate * 0.9);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  conv.buffer = ir;
  input.connect(ac.destination); input.connect(conv); conv.connect(wet); wet.connect(ac.destination);
  buses.set(ac, input);
  return input;
}
function partial(ac: BaseAudioContext, out: AudioNode, t: number, f: number, peak: number, dur: number, o: { from?: number; glide?: number; attack?: number } = {}) {
  const osc = ac.createOscillator(); osc.type = 'sine';
  if (o.from) { osc.frequency.setValueAtTime(o.from, t); osc.frequency.exponentialRampToValueAtTime(f, t + (o.glide ?? 0.02)); }
  else osc.frequency.setValueAtTime(f, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + dur + 0.05);
}
function puff(ac: BaseAudioContext, out: AudioNode, t: number, dur: number, peak: number, f0: number) {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.setValueAtTime(f0, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(out); src.start(t); src.stop(t + dur + 0.02);
}
function tap(ac: BaseAudioContext, out: AudioNode, t: number, f: number, level: number) {
  partial(ac, out, t, f, 0.35 * level, 0.32, { from: f * 1.25, glide: 0.012, attack: 0.002 });
  partial(ac, out, t, f * 4, 0.09 * level, 0.07, { attack: 0.001 });
  puff(ac, out, t, 0.014, 0.07 * level, 2600);
}
/** Plays a cue on the given context. Returns how long it lasts, in seconds. */
export function playCue(ac: AudioContext, cue: TheoCue): number {
  const out = bus(ac);
  const t0 = ac.currentTime + 0.03;
  CUE_TAPS[cue].forEach(([dt, f, level]) => tap(ac, out, t0 + dt, f, level));
  const lastTap = CUE_TAPS[cue][CUE_TAPS[cue].length - 1][0];
  return 0.03 + lastTap + 0.32;
}