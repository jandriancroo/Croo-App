import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface TheoOrbProps {
  size?: number;
  onClick?: () => void;
  className?: string;
  /** Adds a slow pulsing nudge ring (used during onboarding week). */
  nudge?: boolean;
  /** Show a red unread dot in the top-right corner of the orb. */
  unread?: boolean;
  label?: string;
  'data-tour'?: string;
  /** Draw a single still frame (no rotation, no bloom). */
  still?: boolean;
}

const BLOOM_S = 0.7;
const golden = Math.PI * (3 - Math.sqrt(5));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

type MiniState = {
  size: number;
  pts: number[][];
  color: string;
  still: boolean;
  bloomAt: number;
  bloomT0: number;
  g: CanvasRenderingContext2D;
};

function makePoints(count: number) {
  const pts: number[][] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    const seed = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r, seed]);
  }
  return pts;
}

function drawMini(g: CanvasRenderingContext2D, o: MiniState, t: number) {
  const { size } = o, c0 = size / 2, R = size * 0.37;
  const rMin = 0.5 + size * 0.007, rAdd = 0.35 + size * 0.018;
  const rot = o.still ? 0.6 : (t / 14) * Math.PI * 2;
  const tilt = 0.38;
  const cy = Math.cos(rot), sy = Math.sin(rot), cx = Math.cos(tilt), sx = Math.sin(tilt);
  let arc = 0;
  if (!o.still) {
    if (t >= o.bloomAt) { o.bloomT0 = t; o.bloomAt = t + 3 + Math.random() * 4; }
    const bp = (t - o.bloomT0) / BLOOM_S;
    if (bp >= 0 && bp < 1) arc = Math.sin(Math.PI * easeOut(bp));
  }
  g.clearRect(0, 0, size, size);
  g.fillStyle = o.color;
  const pr = o.pts.map(([x, y, z, seed]) => {
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    return [x1, y * cx - z1 * sx, y * sx + z1 * cx, seed];
  }).sort((a, b) => a[2] - b[2]);
  for (const [x, y, z, seed] of pr) {
    const depth = (z + 1) / 2;
    const m = 1 + arc * (0.05 + seed * 0.11);
    g.globalAlpha = Math.min(1, 0.34 + depth * 0.66 + arc * 0.2);
    g.beginPath();
    g.arc(c0 + x * R * m, c0 + y * R * m, rMin + depth * rAdd, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

// ── One shared ~20fps loop for every visible, moving icon ──
const running = new Set<MiniState>();
let timer: ReturnType<typeof setInterval> | null = null;
const now = () => performance.now() / 1000;
function tick() {
  const t = now();
  running.forEach((o) => drawMini(o.g, o, t));
}
function syncLoop() {
  const want = running.size > 0 && !document.hidden;
  if (want && !timer) timer = setInterval(tick, 50);
  else if (!want && timer) { clearInterval(timer); timer = null; }
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', syncLoop);
/** Debug: number of icons currently animating. */
if (typeof window !== 'undefined') (window as any).__theoOrbRunning = () => (document.hidden ? 0 : running.size);

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** TheoOrb — small particle sphere that turns slowly and blooms now and then. */
export function TheoOrb({
  size = 56,
  onClick,
  className,
  nudge = false,
  unread = false,
  label = 'Open Theo',
  still = false,
  ...rest
}: TheoOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = size <= 24 ? 26 : size <= 32 ? 36 : 64;
    const isStill = still || reducedMotion();
    const t0 = now();
    const o: MiniState = {
      size, pts: makePoints(count), color: getComputedStyle(cv).color, still: isStill,
      bloomAt: t0 + 1 + Math.random() * 4, bloomT0: -10, g,
    };
    drawMini(g, o, t0);

    // Re-read color on theme changes.
    const mo = new MutationObserver(() => {
      o.color = getComputedStyle(cv).color;
      if (!running.has(o)) drawMini(g, o, now());
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });

    let io: IntersectionObserver | null = null;
    if (!isStill) {
      io = new IntersectionObserver(([e]) => {
        const visible = e.isIntersecting && cv.offsetParent !== null;
        if (visible) running.add(o); else running.delete(o);
        syncLoop();
      });
      io.observe(cv);
    }
    return () => {
      mo.disconnect();
      io?.disconnect();
      running.delete(o);
      syncLoop();
    };
  }, [size, still]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-tour={rest['data-tour']}
      className={cn(
        'relative inline-flex items-center justify-center shrink-0 rounded-full',
        'text-accent-foreground',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-foreground/40',
        'transition-transform active:scale-95',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {nudge && (
        <span
          aria-hidden
          className="absolute inset-[-4px] rounded-full border border-current opacity-60 animate-ping"
        />
      )}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="relative block"
        style={{ width: size, height: size }}
        data-theo-orb={still ? 'still' : 'moving'}
      />
      {unread && (
        <span
          aria-hidden
          className="absolute top-0 right-0 flex items-center justify-center"
          style={{ width: Math.max(10, size * 0.22), height: Math.max(10, size * 0.22) }}
        >
          <span className="absolute inset-0 rounded-full bg-red-500/60 animate-ping" />
          <span className="relative rounded-full bg-red-500 ring-2 ring-background" style={{ width: '100%', height: '100%' }} />
        </span>
      )}
    </button>
  );
}
