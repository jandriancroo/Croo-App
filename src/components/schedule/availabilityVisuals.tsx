import { Clock } from "lucide-react";

/**
 * Shared visual language for availability on the schedule grid.
 * - Light gray/blue-gray hatching = availability exists (unavailable day or can't-work block)
 * - White cut-out clock = the marker; no text ever renders in the grid
 * - Conflict = the shift keeps its full template colors with an accent hatch striking through it
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

// Solid hatch used for the availability-only day cell and the corner stamp
export const AVAILABILITY_HATCH: React.CSSProperties = {
  backgroundColor: "#eceef0",
  backgroundImage:
    "repeating-linear-gradient(45deg, #dde3e8 0, #dde3e8 7px, #eceef0 7px, #eceef0 15px)",
};

// Accent hatch struck across a conflicting shift — no wash, so the shift keeps
// its full template color and data; the stripes alone signal the conflict.
export const CONFLICT_HATCH_OVERLAY: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(217,68,68,0.5) 0, rgba(217,68,68,0.5) 6px, transparent 6px, transparent 13px)",
};

// Stamp variant used on a conflicting shift so it reads against the accent hatch
const CONFLICT_STAMP_HATCH: React.CSSProperties = {
  backgroundColor: "rgba(217,68,68,0.85)",
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(180,40,40,0.9) 0, rgba(180,40,40,0.9) 4px, rgba(217,68,68,0.85) 4px, rgba(217,68,68,0.85) 8px)",
};

/** White cut-out clock marker. */
export function ClockCutout({
  className = "",
  strokeWidth = 2.5,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <Clock
      className={`text-white ${className}`}
      strokeWidth={strokeWidth}
      style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.25))" }}
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
      <ClockCutout className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
    </div>
  );
}
