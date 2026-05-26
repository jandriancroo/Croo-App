import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface TheoOrbProps {
  size?: number;
  onClick?: () => void;
  className?: string;
  /** Adds a slow pulsing nudge ring (used during onboarding week). */
  nudge?: boolean;
  label?: string;
  'data-tour'?: string;
}

// Pre-generated unit-sphere points using a Fibonacci spiral.
function makeSpherePoints(n: number) {
  const pts: { x: number; y: number; z: number }[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

// Wispy outer-halo particles: slightly outside the sphere radius with jitter.
function makeHaloPoints(n: number) {
  const pts: { x: number; y: number; z: number; jitter: number }[] = [];
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = 1.02 + Math.random() * 0.18;
    pts.push({
      x: Math.sin(phi) * Math.cos(theta) * radius,
      y: Math.sin(phi) * Math.sin(theta) * radius,
      z: Math.cos(phi) * radius,
      jitter: Math.random(),
    });
  }
  return pts;
}

/**
 * TheoOrb — particle-sphere orb (Jarvis / point-cloud globe vibe).
 * Renders into a small canvas; rotates slowly with a wispy halo.
 */
export function TheoOrb({
  size = 56,
  onClick,
  className,
  nudge = false,
  label = 'Open Theo',
  ...rest
}: TheoOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.38;

    const sphere = makeSpherePoints(900);
    const halo = makeHaloPoints(180);

    let start = performance.now();

    const render = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, size, size);

      // Subtle breathing
      const breath = 1 + Math.sin(t * 1.8) * 0.025;
      const rotY = t * 0.55;
      const rotX = Math.sin(t * 0.4) * 0.25;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      // Wispy halo (background layer)
      for (const p of halo) {
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y1 = p.y * cosX - z1 * sinX;
        const sx = cx + x1 * radius * breath;
        const sy = cy + y1 * radius * breath;
        const alpha = 0.08 + p.jitter * 0.18;
        ctx.fillStyle = `rgba(220,235,255,${alpha})`;
        ctx.fillRect(sx, sy, 1, 1);
      }

      // Sphere points
      for (const p of sphere) {
        // rotate Y then X
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y1 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;

        const sx = cx + x1 * radius * breath;
        const sy = cy + y1 * radius * breath;

        // Depth: -1 (back) .. 1 (front)
        const depth = (z2 + 1) / 2;
        const alpha = 0.15 + depth * 0.85;
        const dotSize = depth > 0.5 ? 1.2 : 1;
        ctx.fillStyle = `rgba(240,248,255,${alpha})`;
        ctx.fillRect(sx, sy, dotSize, dotSize);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [size]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-tour={rest['data-tour']}
      className={cn(
        'relative inline-flex items-center justify-center shrink-0 rounded-full',
        'bg-black/90 overflow-hidden',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-foreground/40',
        'transition-transform active:scale-95',
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow:
          '0 0 24px rgba(125,211,252,0.35), inset 0 0 12px rgba(0,0,0,0.6)',
      }}
    >
      {nudge && (
        <span
          aria-hidden
          className="absolute inset-[-4px] rounded-full border border-accent-foreground/60 animate-ping"
        />
      )}
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, display: 'block' }}
        aria-hidden
      />
    </button>
  );
}
