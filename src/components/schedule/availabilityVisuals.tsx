import React from "react";
import { Clock, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime12h } from "@/types/availability";
import type { TimeOffDetail } from "./BlockedDayDetails";

/**
 * Shared visual language for availability on the schedule grid.
 * - Light gray/blue-gray hatching = availability exists (unavailable day or can't-work block)
 * - The marker is a flat history-style clock icon — line style, no fill, no shadow
 * - Conflict = the shift keeps its full template colors with a light accent hatch striking through it
 * Details are only revealed on the first tap (popover); the second tap opens the shift menu.
 */

const HATCH_DARK = "#dde3e8";
const HATCH_BASE = "#eceef0";

const hatchStripes = (stripe: string) =>
  `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 7px, transparent 7px, transparent 15px)`;

export const timeOffHatch = (compact: boolean) => compact
  ? "repeating-linear-gradient(45deg, rgba(150,150,150,0.15), rgba(150,150,150,0.15) 10px, rgba(150,150,150,0.05) 10px, rgba(150,150,150,0.05) 20px)"
  : "repeating-linear-gradient(45deg, rgba(150,150,150,0.1), rgba(150,150,150,0.1) 10px, transparent 10px, transparent 20px)";

export const SplitBlockedCell = React.forwardRef<HTMLButtonElement, {
  compact?: boolean;
  requests: TimeOffDetail[];
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}>(function SplitBlockedCell({ compact = false, requests, onClick }, ref) {
  const request = requests[0];
  const label = requests.length > 1 ? `Time Off ×${requests.length}`
    : request?.time_scope === "partial_day" && request.start_time && request.end_time
      ? `${formatTime12h(request.start_time)} - ${formatTime12h(request.end_time)}` : "Time Off";
  return <Button ref={ref} type="button" variant="ghost" data-availability-box data-timeoff-box data-split-blocked-cell
    aria-label="Weekly availability and time off details" onClick={onClick}
    className={`relative overflow-hidden flex-1 h-auto p-0 rounded whitespace-normal ${compact ? 'min-h-[26px]' : 'min-h-[55px]'} hover:opacity-90`}>
    <span className="absolute inset-0" style={{ clipPath: 'polygon(0 0,100% 0,100% 100%)', backgroundColor: HATCH_BASE, backgroundImage: hatchStripes(HATCH_DARK) }}>
      <History className={`absolute top-1 right-1 ${compact ? 'h-4 w-4' : 'h-6 w-6'}`} style={{ color: '#c3c9d1' }} strokeWidth={2.2} />
    </span>
    <span className="absolute inset-0 bg-muted/50" style={{ clipPath: 'polygon(0 0,0 100%,100% 100%)', backgroundImage: timeOffHatch(compact) }} />
    {!compact && <span className="absolute bottom-1 left-1 text-left max-w-[85%] text-[10px] leading-3 font-medium text-muted-foreground">
      {label}
      {requests.some(r => r.status === 'pending') && <span className="block text-[9px] font-semibold text-[hsl(var(--warning))]">PENDING</span>}
    </span>}
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="0" x2="100" y2="100" stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
  </Button>;
});

/**
 * Hatched panel with the availability clock centered.
 * Fill the parent with it; the parent controls rounding/borders/size.
 */
export const HatchClock = React.forwardRef<
  HTMLDivElement,
  {
    className?: string;
    clockClassName?: string;
    onClick?: (e: React.MouseEvent) => void;
  }
>(function HatchClock({ className = "", clockClassName = "h-7 w-7", onClick }, ref) {
  return (
    <div
      ref={ref}
      data-availability-box
      className={`relative overflow-hidden flex items-center justify-center ${className}`}
      style={{ backgroundColor: HATCH_BASE, backgroundImage: hatchStripes(HATCH_DARK) }}
      onClick={onClick}
    >
      <History className={clockClassName} style={{ color: "#c3c9d1" }} strokeWidth={2.2} />
    </div>
  );
});

// Accent hatch struck across a conflicting shift — kept light so the shift's
// template color, times, and position text stay fully readable underneath.
export const CONFLICT_HATCH_OVERLAY: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(224,106,106,0.28) 0, rgba(224,106,106,0.28) 6px, transparent 6px, transparent 13px)",
};

/** Corner clock shown on a shift card when the day has availability noted. Top-right so it never collides with the meal-break cup (bottom-right). No box — just the icon; it inherits the shift's accent (template) color. */
export function AvailabilityStamp({
  compact = false,
  accent = "#ef4444",
}: {
  compact?: boolean;
  /** The shift's template/accent color — the clock inherits it */
  accent?: string;
}) {
  const clock = compact ? "h-3.5 w-3.5" : "h-5 w-5";
  return (
    <History
      className={`absolute top-1 right-1 z-20 pointer-events-none ${clock}`}
      style={{ color: accent }}
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
