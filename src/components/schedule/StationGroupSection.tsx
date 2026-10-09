import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import type { LocationStation } from "@/hooks/useLocationStations";

interface Props {
  station: LocationStation | null; // null = Unassigned
  employeeCount: number;
  totalHours: number;
  children: React.ReactNode;
}

/**
 * Outer station section (collapsible header + hours). Station belongs to each shift,
 * so there is no drag-a-person-here behavior.
 */
export function StationGroupSection({ station, employeeCount, totalHours, children }: Props) {
  const [open, setOpen] = useState(true);

  const name = station?.name ?? "Unassigned";
  const color = station?.color ?? "#94a3b8";

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        className="px-3 py-2 flex items-center justify-between gap-2 bg-muted/40"
        style={{ borderLeft: `4px solid ${color}` }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
          <MapPin className="h-3.5 w-3.5" style={{ color }} />
          <span className="font-bold text-xs uppercase tracking-wide truncate">{name}</span>
          <span className="text-[11px] text-muted-foreground font-normal">
            ({employeeCount} {employeeCount === 1 ? "employee" : "employees"})
          </span>
        </button>
        <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">
          {totalHours.toFixed(1)} hrs
        </span>
      </div>
      {open && (
        <div>
          {employeeCount === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground italic">
              No shifts at {name} this week.
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}
