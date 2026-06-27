import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LocationStation } from "@/hooks/useLocationStations";
import { Check, MapPin } from "lucide-react";

interface Props {
  userId: string;
  userName: string;
  stations: LocationStation[];
  currentStationId: string | null;
  onAssign: (stationId: string | null) => void;
  /** Called when this chip starts a native HTML5 drag. */
}

/**
 * Tiny pill on each employee row when Stations are enabled.
 * - Click → popover picker (any station or Unassigned).
 * - Drag → native HTML5 drag carrying the userId; drop on a station header.
 */
export function StationAssignChip({
  userId,
  userName,
  stations,
  currentStationId,
  onAssign,
}: Props) {
  const [open, setOpen] = useState(false);
  const current = stations.find((s) => s.id === currentStationId) ?? null;
  const label = current?.name ?? "Unassigned";
  const color = current?.color ?? "#94a3b8";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-croo-user-id", userId);
            // Plain-text fallback for some browsers
            e.dataTransfer.setData("text/plain", userId);
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-background hover:bg-muted/60 transition-colors cursor-grab active:cursor-grabbing"
          style={{ borderColor: `${color}55`, color }}
          aria-label={`Assign station for ${userName}`}
          title="Drag to a station header, or click to choose"
        >
          <MapPin className="h-2.5 w-2.5" />
          <span className="truncate max-w-[80px]">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Assign {userName} to
        </div>
        <button
          type="button"
          onClick={() => { onAssign(null); setOpen(false); }}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted"
        >
          <span className="text-muted-foreground">Unassigned</span>
          {currentStationId === null && <Check className="h-3.5 w-3.5" />}
        </button>
        {stations.map((s) => (
          <button
            type="button"
            key={s.id}
            onClick={() => { onAssign(s.id); setOpen(false); }}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            {currentStationId === s.id && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
