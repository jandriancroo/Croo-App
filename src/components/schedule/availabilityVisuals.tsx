import { Clock } from "lucide-react";

/**
 * Shared visual language for availability on the schedule grid.
 * - Light gray/blue-gray hatching = availability exists (unavailable day or can't-work block)
 * - The clock is a solid white filled marker (no stroke); hands read in the hatch tone
 * - Conflict = the shift keeps its full template colors with a light accent hatch striking through it
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

const HATCH_DARK = "#dde3e8";
const HATCH_BASE = "#eceef0";
const HAND_TONE = "#b8c2cb";

const hatchStripes = (stripe: string) =>
  `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 7px, transparent 7px, transparent 15px)`;

/** Solid white clock, no stroke — hands knocked out in the hatch tone. */
function WhiteClock({ className = "", handTone = HAND_TONE }: { className?: string; handTone?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.15))" }}>
      <circle cx="12" cy="12" r="9.5" fill="#ffffff" />
      <path
        d="M12 7v5l3.5 2"
        fill="none"
        stroke={handTone}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Hatched panel with the white clock centered.
 * Fill the parent with it; the parent controls rounding/borders/size.
 */
export function HatchClock({
  className = "",
  clockClassName = "h-7 w-7",
}: {
  className?: string;
  clockClassName?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${className}`}
      style={{ backgroundColor: HATCH_BASE, backgroundImage: hatchStripes(HATCH_DARK) }}
    >
      <WhiteClock className={clockClassName} />
    </div>
  );
}

// Accent hatch struck across a conflicting shift — kept light so the shift's
// template color, times, and position text stay fully readable underneath.
export const CONFLICT_HATCH_OVERLAY: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(224,106,106,0.28) 0, rgba(224,106,106,0.28) 6px, transparent 6px, transparent 13px)",
};

/** Corner stamp shown on a shift card when the day has availability noted. Top-right so it never collides with the meal-break cup (bottom-right). */
export function AvailabilityStamp({
  compact = false,
  conflict = false,
}: {
  compact?: boolean;
  conflict?: boolean;
}) {
  const size = compact ? "h-3.5 w-3.5" : "h-5 w-5";
  const clock = compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  return (
    <div
      className={`absolute top-1 right-1 z-20 rounded-[4px] overflow-hidden pointer-events-none flex items-center justify-center ${size}`}
      style={{
        backgroundColor: conflict ? "rgba(224,106,106,0.35)" : HATCH_BASE,
        backgroundImage: hatchStripes(conflict ? "rgba(205,85,85,0.55)" : HATCH_DARK),
      }}
    >
      <WhiteClock className={clock} handTone={conflict ? "rgba(205,85,85,0.8)" : HAND_TONE} />
    </div>
  );
}

/** Plain clock icon, still used inside detail popovers. */
export function ClockCutout({
  className = "",
  strokeWidth = 2.5,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return <Clock className={`text-muted-foreground ${className}`} strokeWidth={strokeWidth} />;
}
