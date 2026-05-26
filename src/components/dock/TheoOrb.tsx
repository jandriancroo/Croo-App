import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TheoOrbProps {
  size?: number;
  onClick?: () => void;
  className?: string;
  /** Adds a slow pulsing nudge ring (used during onboarding week). */
  nudge?: boolean;
  /** Aria label override */
  label?: string;
  'data-tour'?: string;
}

/**
 * TheoOrb — Jarvis-style animated orb that replaces the user avatar in the
 * manager dash. Slow swirling conic gradient + breathing scale + soft halo.
 * Tap to open Theo.
 */
export function TheoOrb({
  size = 48,
  onClick,
  className,
  nudge = false,
  label = 'Open Theo',
  ...rest
}: TheoOrbProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-tour={rest['data-tour']}
      className={cn(
        'relative inline-flex items-center justify-center shrink-0 rounded-full',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-foreground/40',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* Outer breathing halo */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(125, 211, 252, 0.55), rgba(99, 102, 241, 0.25) 55%, transparent 75%)',
          filter: 'blur(6px)',
        }}
        animate={{ scale: [1, 1.18, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Onboarding-week nudge ring */}
      {nudge && (
        <motion.span
          aria-hidden
          className="absolute inset-[-6px] rounded-full border-2 border-accent-foreground/60"
          animate={{ scale: [1, 1.25, 1], opacity: [0.9, 0, 0.9] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      {/* Rotating swirl (conic gradient) */}
      <motion.span
        aria-hidden
        className="absolute inset-[3px] rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, #7dd3fc, #818cf8, #c084fc, #67e8f9, #7dd3fc)',
          filter: 'blur(2px)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
      />

      {/* Counter-rotating inner shimmer */}
      <motion.span
        aria-hidden
        className="absolute inset-[6px] rounded-full"
        style={{
          background:
            'conic-gradient(from 180deg, rgba(255,255,255,0.9), rgba(255,255,255,0.1), rgba(255,255,255,0.7), rgba(255,255,255,0.1))',
          mixBlendMode: 'overlay',
        }}
        animate={{ rotate: -360 }}
        transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
      />

      {/* Glass core */}
      <motion.span
        aria-hidden
        className="absolute inset-[8px] rounded-full bg-slate-950/70 backdrop-blur"
        animate={{ scale: [1, 0.94, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          boxShadow:
            'inset 0 1px 6px rgba(255,255,255,0.35), inset 0 -4px 10px rgba(0,0,0,0.4)',
        }}
      />

      {/* Highlight speck */}
      <span
        aria-hidden
        className="absolute rounded-full bg-white/80"
        style={{
          width: size * 0.12,
          height: size * 0.12,
          top: size * 0.22,
          left: size * 0.28,
          filter: 'blur(1px)',
        }}
      />
    </button>
  );
}
