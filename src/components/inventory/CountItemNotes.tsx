import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, DollarSign, Truck } from "lucide-react";
import { DateTime } from "luxon";
import { cn } from "@/lib/utils";

/**
 * Count-sheet notes row.
 *
 * Renders ONLY when the item actually has at least one note — a row of
 * empty space is worse than no row at all on a phone. The top note shows
 * inline with no tap; anything else collapses behind a down arrow that
 * carries a live count ("2 more").
 *
 * Fixed order (most actionable first): discontinued → unpriced → last ordered.
 */

const ZONE = "America/Los_Angeles";

/** Format a stored timestamp/date as a short local date. Never `new Date(str)`. */
function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dt = value.length <= 10
    ? DateTime.fromFormat(value, "yyyy-MM-dd", { zone: ZONE })
    : DateTime.fromISO(value, { zone: ZONE });
  return dt.isValid ? dt.toFormat("MMM d") : null;
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const dt = value.length <= 10
    ? DateTime.fromFormat(value, "yyyy-MM-dd", { zone: ZONE })
    : DateTime.fromISO(value, { zone: ZONE });
  if (!dt.isValid) return null;
  return Math.max(0, Math.floor(DateTime.now().setZone(ZONE).diff(dt, "days").days));
}

export interface CountItemNotesProps {
  discontinuedAt?: string | null;
  unpricedSince?: string | null;
  lastOrderedAt?: string | null;
  /** True when the item's own cost is missing or zero. */
  hasNoCost?: boolean;
  /** Hidden while viewing a submitted count. */
  canMarkInactive?: boolean;
  /** Already switched off (e.g. marked inactive earlier in this session). */
  isInactive?: boolean;
  onMarkInactive?: () => void;
  markingInactive?: boolean;
}

type Note = {
  key: string;
  icon: typeof AlertTriangle;
  text: string;
  tone: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
};

export function CountItemNotes({
  discontinuedAt,
  unpricedSince,
  lastOrderedAt,
  hasNoCost,
  canMarkInactive,
  isInactive,
  onMarkInactive,
  markingInactive,
}: CountItemNotesProps) {
  const [expanded, setExpanded] = useState(false);

  const notes: Note[] = [];

  if (discontinuedAt) {
    const since = shortDate(discontinuedAt);
    notes.push({
      key: "discontinued",
      icon: AlertTriangle,
      tone: "text-[#993C1D]",
      text: since ? `Discontinued (since ${since})` : "Discontinued",
      action:
        canMarkInactive && onMarkInactive
          ? {
              label: isInactive ? "Marked inactive" : "Mark inactive",
              onClick: onMarkInactive,
              disabled: !!isInactive || !!markingInactive,
            }
          : undefined,
    });
  }

  if (hasNoCost) {
    const days = daysSince(unpricedSince);
    notes.push({
      key: "unpriced",
      icon: DollarSign,
      tone: "text-[#8A6100]",
      text: days != null ? `No price on file (${days}d)` : "No price on file",
    });
  }

  const ordered = shortDate(lastOrderedAt);
  if (ordered) {
    notes.push({
      key: "last-ordered",
      icon: Truck,
      tone: "text-muted-foreground",
      text: `Last ordered ${ordered}`,
    });
  }

  if (notes.length === 0) return null;

  const visible = expanded ? notes : notes.slice(0, 1);
  const hidden = notes.length - 1;

  const renderNote = (n: Note) => {
    const Icon = n.icon;
    return (
      <div key={n.key} className="flex items-center gap-1.5 min-w-0">
        <Icon className={cn("h-3 w-3 shrink-0", n.tone)} strokeWidth={2.25} />
        <span className={cn("text-[11px] leading-tight truncate", n.tone)}>{n.text}</span>
        {n.action && (
          <button
            type="button"
            onClick={n.action.onClick}
            disabled={n.action.disabled}
            className={cn(
              "ml-auto shrink-0 rounded-full border border-[#F5C4B3] bg-[#FEF3EE] px-2.5 py-1",
              "text-[10px] font-medium text-[#993C1D] active:scale-95 transition-transform",
              n.action.disabled && "opacity-60"
            )}
          >
            {n.action.label}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="px-3.5 py-2 sm:px-5 border-b border-border/60 bg-muted/40 space-y-1.5">
      {visible.map(renderNote)}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> {hidden} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default CountItemNotes;
