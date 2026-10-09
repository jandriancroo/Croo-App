import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LocationStation } from "@/hooks/useLocationStations";

const INHERIT = "__inherit__";

/** The station_id to save: the pick only when it differs from the template's station (null = inherit). */
export function stationIdToSave(picked: string | null, templateStationId: string | null | undefined) {
  return picked && picked !== (templateStationId ?? null) ? picked : null;
}

/**
 * Station pick for one shift (Edit Shift windows, station mode only).
 * "From template" leaves station_id empty so the shift follows its template's station.
 */
export function ShiftStationSelect({
  stations,
  value,
  templateStationId,
  onChange,
  id = "shift-station",
}: {
  stations: LocationStation[];
  value: string | null;
  templateStationId: string | null | undefined;
  onChange: (stationId: string | null) => void;
  id?: string;
}) {
  const inherited = stations.find((s) => s.id === templateStationId);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Station</Label>
      <Select value={value ?? INHERIT} onValueChange={(v) => onChange(v === INHERIT ? null : v)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={INHERIT}>
            {inherited ? `${inherited.name} (from template)` : "Unassigned (from template)"}
          </SelectItem>
          {stations.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
