import type { LocationStation } from "@/hooks/useLocationStations";

export interface StationSection<T> {
  station: LocationStation | null; // null = Unassigned bucket
  shifts: T[];
}

/**
 * Group a list of shifts by their station_id, preserving station sort order.
 * Shifts with no station (or a station no longer in the active list) bucket
 * into a trailing "Unassigned" section.
 */
export function groupShiftsByStation<T extends { station_id?: string | null }>(
  shifts: T[],
  stations: LocationStation[]
): StationSection<T>[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const buckets = new Map<string | null, T[]>();
  buckets.set(null, []);
  for (const s of stations) buckets.set(s.id, []);

  for (const shift of shifts) {
    const key = shift.station_id && byId.has(shift.station_id) ? shift.station_id : null;
    const arr = buckets.get(key);
    if (arr) arr.push(shift);
    else buckets.set(key, [shift]);
  }

  const sections: StationSection<T>[] = stations.map((s) => ({
    station: s,
    shifts: buckets.get(s.id) ?? [],
  }));

  const unassigned = buckets.get(null) ?? [];
  if (unassigned.length > 0 || stations.length === 0) {
    sections.push({ station: null, shifts: unassigned });
  }

  return sections;
}
