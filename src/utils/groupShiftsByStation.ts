import type { LocationStation } from "@/hooks/useLocationStations";

/** Anything shaped like a scheduled shift (its own station, plus the template it came from). */
export interface StationResolvable {
  station_id?: string | null;
  template?: { station_id?: string | null } | null;
}

/**
 * THE ONE place a shift's station is resolved (read time, no trigger):
 * the shift's own station, else its template's station, else null (= "Unassigned").
 */
export function effectiveStationId(shift: StationResolvable | null | undefined): string | null {
  if (!shift) return null;
  return shift.station_id ?? shift.template?.station_id ?? null;
}

/** Effective station, but only if it is one of the store's active stations (else null). */
function activeStationKey(shift: StationResolvable, byId: Map<string, LocationStation>): string | null {
  const id = effectiveStationId(shift);
  return id && byId.has(id) ? id : null;
}

export interface StationSection<T> {
  station: LocationStation | null; // null = Unassigned bucket
  shifts: T[];
}

/**
 * Group a list of shifts by their effective station, preserving station sort order.
 * Shifts with no station (or a station no longer in the active list) bucket
 * into a trailing "Unassigned" section. View-only: never mutates the input.
 */
export function groupShiftsByStation<T extends StationResolvable>(
  shifts: T[],
  stations: LocationStation[]
): StationSection<T>[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const buckets = new Map<string | null, T[]>();
  buckets.set(null, []);
  for (const s of stations) buckets.set(s.id, []);

  for (const shift of shifts) {
    buckets.get(activeStationKey(shift, byId))!.push(shift);
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

export interface StationPeopleSection<P, T> {
  station: LocationStation | null; // null = Unassigned
  rows: { person: P; shifts: T[] }[];
  shifts: T[];
}

/**
 * Desktop grid (people x days) in station mode. A person gets a row in every station
 * section where they have a shift that week; the row carries only that section's shifts.
 * Unassigned = shifts with no active station, plus everyone with no shifts this week
 * (empty row, so managers can still schedule them). People keep their input order.
 */
export function groupPeopleByStation<P extends { id: string }, T extends StationResolvable & { user_id?: string | null }>(
  people: P[],
  shifts: T[],
  stations: LocationStation[]
): StationPeopleSection<P, T>[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const keys: (string | null)[] = [...stations.map((s) => s.id), null];
  const byKeyUser = new Map<string | null, Map<string, T[]>>(keys.map((k) => [k, new Map()]));
  const sectionShifts = new Map<string | null, T[]>(keys.map((k) => [k, []]));
  const hasAny = new Set<string>();

  for (const shift of shifts) {
    const key = activeStationKey(shift, byId);
    sectionShifts.get(key)!.push(shift);
    if (!shift.user_id) continue;
    hasAny.add(shift.user_id);
    const m = byKeyUser.get(key)!;
    const list = m.get(shift.user_id) ?? [];
    list.push(shift);
    m.set(shift.user_id, list);
  }

  return keys.map((key) => {
    const m = byKeyUser.get(key)!;
    const rows = people
      .filter((p) => m.has(p.id) || (key === null && !hasAny.has(p.id)))
      .map((p) => ({ person: p, shifts: m.get(p.id) ?? [] }));
    return { station: key ? byId.get(key)! : null, rows, shifts: sectionShifts.get(key)! };
  });
}
