import { Clock } from "lucide-react";

/**
 * Shared visual language for availability on the schedule grid.
 * - Gray hatching = availability exists (unavailable day or can't-work block)
 * - White cut-out clock = the marker; no text ever renders in the grid
 * - Full hatch overlay across a shift = conflict
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

// Solid hatch used for the availability-only day cell and the corner stamp
export const AVAILABILITY_HATCH: React.CSSProperties = {
  backgroundColor: "#c4c9cc",
  backgroundImage:
    "repeating-linear-gradient(45deg, #a7adb1 0, #a7adb1 7px, #c4c9cc 7px, #c4c9cc 15px)",
};

// Translucent hatch laid over a conflicting shift so the shift stays readable underneath
export const CONFLICT_HATCH_OVERLAY: React.CSSProperties = {
  backgroundColor: "rgba(167,173,177,0.32)",
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(120,126,130,0.42) 0, rgba(120,126,130,0.42) 7px, rgba(167,173,177,0.32) 7px, rgba(167,173,177,0.32) 15px)",
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
      style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.18))" }}
    />
  );
}

/** Corner stamp shown on a shift card when the day has availability noted. Top-right so it never collides with the meal-break cup (bottom-right). */
export function AvailabilityStamp({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`absolute top-1 right-1 z-20 rounded-[4px] flex items-center justify-center pointer-events-none ${
        compact ? "h-3.5 w-3.5" : "h-5 w-5"
      }`}
      style={AVAILABILITY_HATCH}
    >
      <ClockCutout className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
    </div>
  );
}
