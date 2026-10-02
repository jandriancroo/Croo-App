import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CUE_TAPS, type TheoCue } from './theoCues';

type Phase = 'idle' | 'connecting' | 'speaking' | 'listening' | 'thinking' | 'error';

const SIZE = 280;

function makeSpherePoints(n: number) {
  const pts: [number, number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    const seed = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r, seed]);
  }
  return pts;
}

function makeHaloPoints(n: number) {
  const pts: { a: number; d: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ a: (i / n) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.4, d: 1.07 + ((Math.sin(i * 78.233) + 1) / 2) * 0.2, s: Math.random() * Math.PI * 2 });
  }
  return pts;
}

export type TheoVoiceOrbHandle = { cue: (name: TheoCue) => void };

const SPIN_KICK = 3;
const BURST_S = 0.6;

/** Big animated particle sphere for the Theo voice screen only. */
export const TheoVoiceOrb = forwardRef<TheoVoiceOrbHandle, { phase: Phase; level: number }>(function TheoVoiceOrb({ phase, level }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const impulseRef = useRef<(cue: TheoCue, n: number) => void>(() => {});
  const cueTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef(phase);
  const levelRef = useRef(level);
  phaseRef.current = phase;
  levelRef.current = level;

  useImperativeHandle(ref, () => ({
    cue(name) {
      CUE_TAPS[name].forEach(([, ,], n) => {
        const tapOffset = CUE_TAPS[name][n][0];
        const timer = setTimeout(() => impulseRef.current(name, n), (0.03 + tapOffset) * 1000);
        cueTimersRef.current.push(timer);
      });
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sphere = makeSpherePoints(150);
    const halo = makeHaloPoints(26);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const base = SIZE * 0.38;
    const c = SIZE / 2;
    let raf = 0;
    let smooth = 0;
    let breathT = 0;
    let last = performance.now();
    const start = last;
    let bursts: { t0: number; kind: 'out' | 'in' | 'twinkle'; amp: number }[] = [];
    let spinVel = 0;
    let spinAngle = 0;
    let flash = 0;
    let dim = 0;
    let dimTarget = 0;
    let sizeMul = 1;
    const dimTimers: ReturnType<typeof setTimeout>[] = [];

    impulseRef.current = (cue, n) => {
      const now = performance.now() / 1000;
      if (cue === 'ready') { flash = Math.min(1, flash + 0.55); dimTarget = 0; }
      if (cue === 'heard') { flash = Math.min(1, flash + 0.3); }
      if (cue === 'closed') {
        dimTarget = 1;
        dimTimers.push(setTimeout(() => { dimTarget = 0; }, 900));
      }
      if (reduced) return;
      if (cue === 'ready') { bursts.push({ t0: now, kind: 'out', amp: n === 0 ? 0.6 : 1 }); spinVel += SPIN_KICK; }
      if (cue === 'heard') { bursts.push({ t0: now, kind: 'twinkle', amp: 1 }); spinVel += SPIN_KICK * 0.45; }
      if (cue === 'closed') { bursts.push({ t0: now, kind: 'in', amp: n === 0 ? 0.6 : 1 }); spinVel -= SPIN_KICK; }
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = phaseRef.current;
      const still = reduced || p === 'error';
      smooth += ((p === 'speaking' ? levelRef.current : 0) - smooth) * 0.25;
      const speed = p === 'connecting' || p === 'thinking' ? 2 : p === 'listening' ? 0.6 : 1;
      if (!still) breathT += dt * speed;
      const t = still ? 0 : (now - start) / 1000;
      const breath = still ? 0 : Math.sin(breathT * 1.6) * 0.03;
      const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
      sizeMul += ((p === 'listening' ? 0.92 : 1) - sizeMul) * Math.min(1, dt * 7);
      dim += (dimTarget - dim) * Math.min(1, dt * 6);
      flash *= Math.pow(0.02, dt);
      spinAngle += spinVel * dt;
      spinVel *= Math.exp(-4.5 * dt);
      const nowS = now / 1000;
      bursts = bursts.filter((b) => nowS - b.t0 < BURST_S);
      let R = base * (1 + breath) * sizeMul;
      if (p === 'speaking') R *= 1 + smooth * 0.12;
      const alphaMul = (p === 'error' ? 0.6 : 1) * (1 - dim * 0.45);
      const lift = p === 'speaking' ? smooth * 0.2 : 0;

      const rotY = (t / 24) * Math.PI * 2 + (reduced ? 0 : spinAngle);
      const tilt = 0.38 + Math.sin(t * 0.4) * 0.05;
      const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(tilt), sx = Math.sin(tilt);

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#fff';
      for (const h of halo) {
        const a = h.a + (rotY - spinAngle) * 0.3 + spinAngle * 0.6;
        const d = h.d + (still ? 0 : Math.sin(t * 0.8 + h.s) * 0.02);
        ctx.globalAlpha = (0.4 + flash * 0.4) * alphaMul;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * R * d, c + Math.sin(a) * R * d, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      const proj = sphere.map(([x, y, z, seed]) => {
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        const y2 = y * cx - z1 * sx;
        const z2 = y * sx + z1 * cx;
        return [x1, y2, z2, seed] as const;
      }).sort((a, b) => a[2] - b[2]);
      for (const [x, y, z, seed] of proj) {
        const depth = (z + 1) / 2;
        let push = 0, bright = 0, grow = 0;
        for (const b of bursts) {
          const bp = (nowS - b.t0) / BURST_S;
          const arc = Math.sin(Math.PI * easeOut(bp));
          if (b.kind === 'out') { push += arc * b.amp * (0.05 + seed * 0.18); bright += arc * 0.25; }
          else if (b.kind === 'in') { push -= arc * b.amp * (0.05 + seed * 0.16); }
          else if (seed > 0.6) { const tw = Math.sin(Math.PI * Math.min(1, bp * 1.6)); bright += tw * 0.7; grow += tw * 1.3; }
        }
        ctx.globalAlpha = Math.min(1, 0.36 + depth * 0.64 + lift * depth + flash * 0.3 * depth + bright) * alphaMul;
        ctx.beginPath();
        ctx.arc(c + x * R * (1 + push), c + y * R * (1 + push), 1.4 + depth * 1.5 + grow, 0, Math.PI * 2);
        ctx.fill();
      }
      if (glowRef.current) {
        const opacity = Math.max(0.35, Math.min(1.6, (p === 'idle' ? 0.8 : 1) + flash * 0.9 - dim * 0.5));
        glowRef.current.style.opacity = String(opacity);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      dimTimers.forEach(clearTimeout);
      cueTimersRef.current.forEach(clearTimeout);
      cueTimersRef.current = [];
      impulseRef.current = () => {};
    };
  }, []);

  return (
    <>
      <div ref={glowRef} aria-hidden className="absolute left-10 top-10 h-[200px] w-[200px] rounded-full blur-[34px]" style={{ background: 'hsl(var(--primary-light, 190 57% 60%) / 0.32)' }} />
      <canvas ref={canvasRef} aria-hidden style={{ width: SIZE, height: SIZE }} className="relative block" />
    </>
  );
});
