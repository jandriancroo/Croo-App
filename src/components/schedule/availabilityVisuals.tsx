import { Clock } from "lucide-react";

/**
 * Shared visual language for availability on the schedule grid.
 * - Light gray/blue-gray hatching = availability exists (unavailable day or can't-work block)
 * - Clock cut-out rendered in the darker hatch tone (embossed look); no text ever renders in the grid
 * - Conflict = the shift keeps its full template colors with a light accent hatch striking through it
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

// Darker of the two hatch tones — also the clock cut-out color
const HATCH_DARK = "#dde3e8";

// Solid hatch used for the availability-only day cell and the corner stamp
export const AVAILABILITY_HATCH: React.CSSProperties = {
  backgroundColor: "#eceef0",
  backgroundImage: `repeating-linear-gradient(45deg, ${HATCH_DARK} 0, ${HATCH_DARK} 7px, #eceef0 7px, #eceef0 15px)`,
};

// Accent hatch struck across a conflicting shift — kept light so the shift's
// template color, times, and position text stay fully readable underneath.
export const CONFLICT_HATCH_OVERLAY: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(224,106,106,0.28) 0, rgba(224,106,106,0.28) 6px, transparent 6px, transparent 13px)",
};

// Stamp variant used on a conflicting shift so it reads against the accent hatch
const CONFLICT_STAMP_HATCH: React.CSSProperties = {
  backgroundColor: "rgba(224,106,106,0.55)",
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(205,85,85,0.6) 0, rgba(205,85,85,0.6) 4px, rgba(224,106,106,0.55) 4px, rgba(224,106,106,0.55) 8px)",
};

/** Clock cut-out marker, rendered in the darker hatch tone. */
export function ClockCutout({
  className = "",
  strokeWidth = 2.5,
  color = HATCH_DARK,
}: {
  className?: string;
  strokeWidth?: number;
  color?: string;
}) {
  return (
    <Clock
      className={className}
      strokeWidth={strokeWidth}
      style={{ color }}
    />
  );
}

/** Corner stamp shown on a shift card when the day has availability noted. Top-right so it never collides with the meal-break cup (bottom-right). */
export function AvailabilityStamp({
  compact = false,
  conflict = false,
}: {
  compact?: boolean;
  conflict?: boolean;
}) {
  return (
    <div
      className={`absolute top-1 right-1 z-20 rounded-[4px] flex items-center justify-center pointer-events-none ${
        compact ? "h-3.5 w-3.5" : "h-5 w-5"
      }`}
      style={conflict ? CONFLICT_STAMP_HATCH : AVAILABILITY_HATCH}
    >
      <ClockCutout
        className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"}
        color={conflict ? "#ffffff" : HATCH_DARK}
      />
    </div>
  );
}
