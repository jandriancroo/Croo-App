import { useEffect, useRef } from 'react';

type Phase = 'idle' | 'connecting' | 'speaking' | 'listening' | 'thinking' | 'error';

const SIZE = 280;

function makeSpherePoints(n: number) {
  const pts: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
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

/** Big animated particle sphere for the Theo voice screen only. */
export function TheoVoiceOrb({ phase, level }: { phase: Phase; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  const levelRef = useRef(level);
  phaseRef.current = phase;
  levelRef.current = level;

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
      let R = base * (1 + breath);
      if (p === 'listening') R *= 0.92;
      if (p === 'speaking') R *= 1 + smooth * 0.12;
      const alphaMul = (p === 'error' ? 0.6 : 1) * 1;
      const lift = p === 'speaking' ? smooth * 0.2 : 0;

      const rotY = (t / 24) * Math.PI * 2;
      const tilt = 0.38 + Math.sin(t * 0.4) * 0.05;
      const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(tilt), sx = Math.sin(tilt);

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = '#fff';
      for (const h of halo) {
        const a = h.a + rotY * 0.3;
        const d = h.d + (still ? 0 : Math.sin(t * 0.8 + h.s) * 0.02);
        ctx.globalAlpha = 0.4 * alphaMul;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * R * d, c + Math.sin(a) * R * d, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      const proj = sphere.map(([x, y, z]) => {
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        const y2 = y * cx - z1 * sx;
        const z2 = y * sx + z1 * cx;
        return [x1, y2, z2] as const;
      }).sort((a, b) => a[2] - b[2]);
      for (const [x, y, z] of proj) {
        const depth = (z + 1) / 2;
        ctx.globalAlpha = Math.min(1, (0.36 + depth * 0.64 + lift * depth) ) * alphaMul;
        ctx.beginPath();
        ctx.arc(c + x * R, c + y * R, 1.4 + depth * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reduced motion: redraw once when phase/level changes is unnecessary; static sphere is fine.
  return <canvas ref={canvasRef} aria-hidden style={{ width: SIZE, height: SIZE }} className="relative block" />;
}
