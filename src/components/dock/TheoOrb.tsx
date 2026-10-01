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
}

/** TheoOrb — static concentric dotted rings. */
export function TheoOrb({
  size = 56,
  onClick,
  className,
  nudge = false,
  unread = false,
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
        // text color drives the icon color (themed via parent).
        // Default to current foreground; parent can override with text-* class.
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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={size >= 28 ? 1.6 : 1.9}
        className="relative block h-full w-full"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9.5" strokeDasharray="0.1 3.63" />
        <circle cx="12" cy="12" r="6" strokeDasharray="0.1 3.67" />
        <circle cx="12" cy="12" r="2.5" strokeDasharray="0.1 3.04" />
      </svg>
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
