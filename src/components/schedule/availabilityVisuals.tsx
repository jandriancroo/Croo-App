import { Clock, History } from "lucide-react";

/**
 * Shared visual language for availability on the schedule grid.
 * - Light gray/blue-gray hatching = availability exists (unavailable day or can't-work block)
 * - The marker is a flat history-style clock icon — line style, no fill, no shadow
 * - Conflict = the shift keeps its full template colors with a light accent hatch striking through it
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

const HATCH_DARK = "#dde3e8";
const HATCH_BASE = "#eceef0";
const ICON_TONE = "#9aa8b5";

const hatchStripes = (stripe: string) =>
  `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 7px, transparent 7px, transparent 15px)`;

/**
 * Hatched panel with the availability clock centered.
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
      <History className={clockClassName} style={{ color: ICON_TONE }} strokeWidth={2.2} />
    </div>
  );
}

// Accent hatch struck across a conflicting shift — kept light so the shift's
// template color, times, and position text stay fully readable underneath.
export const CONFLICT_HATCH_OVERLAY: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(224,106,106,0.28) 0, rgba(224,106,106,0.28) 6px, transparent 6px, transparent 13px)",
};

/** Corner clock shown on a shift card when the day has availability noted. Top-right so it never collides with the meal-break cup (bottom-right). No box — just the icon; white normally, accent red on conflicts. */
export function AvailabilityStamp({
  compact = false,
  conflict = false,
}: {
  compact?: boolean;
  conflict?: boolean;
}) {
  const clock = compact ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <History
      className={`absolute top-1 right-1 z-20 pointer-events-none ${clock}`}
      style={{ color: conflict ? ACCENT : "#ffffff" }}
      strokeWidth={2.4}
    />
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
