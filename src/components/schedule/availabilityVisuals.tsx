import { Clock } from "lucide-react";

/**
 * Shared visual language for availability on the schedule grid.
 * - Light gray/blue-gray hatching = availability exists (unavailable day or can't-work block)
 * - The clock is a true cut-out: the stripes are masked away where the clock is,
 *   so it reads as clear space carved from the hatch, never an icon on top.
 * - Conflict = the shift keeps its full template colors with a light accent hatch striking through it
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

const HATCH_DARK = "#dde3e8";
const HATCH_BASE = "#eceef0";

const CLOCK_MASK_URL = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3.5 2'/></svg>")`;

/** Mask that punches a clock shape out of the stripes layer. */
function clockCutoutMask(clockSize: string): React.CSSProperties {
  return {
    WebkitMaskImage: `${CLOCK_MASK_URL}, linear-gradient(#fff, #fff)`,
    WebkitMaskSize: `${clockSize} ${clockSize}, 100% 100%`,
    WebkitMaskPosition: "center, center",
    WebkitMaskRepeat: "no-repeat, no-repeat",
    WebkitMaskComposite: "xor",
    maskImage: `${CLOCK_MASK_URL}, linear-gradient(#fff, #fff)`,
    maskSize: `${clockSize} ${clockSize}, 100% 100%`,
    maskPosition: "center, center",
    maskRepeat: "no-repeat, no-repeat",
    maskComposite: "exclude",
  } as React.CSSProperties;
}

const hatchStripes = (stripe: string) =>
  `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 7px, transparent 7px, transparent 15px)`;

/**
 * Hatched panel with the clock cut out of the stripes.
 * Fill the parent with it; the parent controls rounding/borders/size.
 */
export function HatchClock({
  className = "",
  clockSize = "45%",
}: {
  className?: string;
  clockSize?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ backgroundColor: HATCH_BASE }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundImage: hatchStripes(HATCH_DARK), ...clockCutoutMask(clockSize) }}
      />
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
  return (
    <div
      className={`absolute top-1 right-1 z-20 rounded-[4px] overflow-hidden pointer-events-none ${size}`}
      style={{ backgroundColor: conflict ? "rgba(224,106,106,0.35)" : HATCH_BASE }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: hatchStripes(conflict ? "rgba(205,85,85,0.55)" : HATCH_DARK),
          ...clockCutoutMask("62%"),
        }}
      />
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
