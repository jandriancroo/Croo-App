import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import type { LocationStation } from "@/hooks/useLocationStations";

interface Props {
  station: LocationStation | null; // null = Unassigned
  employeeCount: number;
  totalHours: number;
  onDropUser: (userId: string) => void;
  children: React.ReactNode;
}

/**
 * Outer station section. Header is a native HTML5 drop zone — drag an
 * employee's StationAssignChip onto it to reassign.
 */
export function StationGroupSection({ station, employeeCount, totalHours, onDropUser, children }: Props) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const name = station?.name ?? "Unassigned";
  const color = station?.color ?? "#94a3b8";

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-croo-user-id") || e.dataTransfer.types.includes("text/plain")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (!dragOver) setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const userId =
            e.dataTransfer.getData("application/x-croo-user-id") ||
            e.dataTransfer.getData("text/plain");
          if (userId) onDropUser(userId);
        }}
        className={`px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
          dragOver ? "bg-primary/10 ring-1 ring-primary/40" : "bg-muted/40"
        }`}
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
              Drag a person here to assign them to {name}.
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}
