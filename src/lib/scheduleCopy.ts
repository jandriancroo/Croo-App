// Pure helpers for Copy Week / Clear drafts / the one-schedule-per-week lookup.
// No network here: the server RPCs (copy_schedule_week, clear_schedule_drafts) do the writes;
// these mirror their rules so the UI can decide what to show and tests can pin the rules.

export interface CopySourceShift {
  user_id: string | null;
  shift_date: string; // yyyy-MM-dd
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_time_off?: boolean | null;
  template_id?: string | null;
  station_id?: string | null;
}

export interface CopyRow {
  user_id: string | null;
  shift_date: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_time_off: boolean;
  template_id: string | null;
  station_id: string | null;
}

const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole days between two yyyy-MM-dd dates (b - a), DST-proof. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Add days to a yyyy-MM-dd date. */
export function addDaysStr(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** "09:00:00" and "09:00" are the same time. */
export const hhmm = (t: string | null | undefined) => (t ?? '').slice(0, 5);

/**
 * Merge/dupe key: person + date + start + end. A null person (open slot) is a value too,
 * so two identical open slots are dupes. Station is NOT part of the key.
 */
export function shiftKey(s: { user_id: string | null; shift_date: string; start_time: string; end_time: string }): string {
  return `${s.user_id ?? '-'}|${s.shift_date}|${hhmm(s.start_time)}|${hhmm(s.end_time)}`;
}

/** Copy rows for the target week: same weekday offset, every field carried, station included (null = inherit). */
export function buildCopyRows(shifts: CopySourceShift[], sourceWeekStart: string, targetWeekStart: string): CopyRow[] {
  const offset = daysBetween(sourceWeekStart, targetWeekStart);
  return shifts.map((s) => ({
    user_id: s.user_id ?? null,
    shift_date: addDaysStr(s.shift_date, offset),
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    is_time_off: !!s.is_time_off,
    template_id: s.template_id ?? null,
    station_id: s.station_id ?? null,
  }));
}

/**
 * Merge: keep everything already on the target, add only source rows that aren't there yet.
 * Counted per key, so a source week that legitimately has two identical open slots still
 * adds the second one when the target only has one. Same rule as copy_schedule_week.
 */
export function mergeSkipDupes<T extends { user_id: string | null; shift_date: string; start_time: string; end_time: string }>(
  rows: T[],
  existing: { user_id: string | null; shift_date: string; start_time: string; end_time: string }[],
): { toAdd: T[]; skipped: number } {
  const have = new Map<string, number>();
  for (const e of existing) have.set(shiftKey(e), (have.get(shiftKey(e)) ?? 0) + 1);
  const toAdd: T[] = [];
  let skipped = 0;
  for (const r of rows) {
    const k = shiftKey(r);
    const n = have.get(k) ?? 0;
    if (n > 0) { have.set(k, n - 1); skipped++; } else toAdd.push(r);
  }
  return { toAdd, skipped };
}

export interface ScheduleCandidate {
  id: string;
  is_published: boolean | null;
  shift_count?: number | null;
  created_at?: string | null;
}

/** Canonical week row when duplicates exist: published first, then most shifts, then oldest. */
export function pickCanonicalSchedule<T extends ScheduleCandidate>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) =>
    Number(!!b.is_published) - Number(!!a.is_published)
    || (b.shift_count ?? 0) - (a.shift_count ?? 0)
    || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  )[0];
}

export type CopyDecision = 'blocked' | 'copy' | 'confirm';

/** Posted target: blocked, no popup, no write. Target with shifts: confirm (Cancel / Merge). Else copy now. */
export function decideCopy(target: { exists: boolean; isPublished: boolean; shiftCount: number }): CopyDecision {
  if (target.exists && target.isPublished) return 'blocked';
  if (target.exists && target.shiftCount > 0) return 'confirm';
  return 'copy';
}

/** Body of the Cancel / Merge popup. It says what Replace would have done. */
export function copyConfirmText(rangeLabel: string, n: number): string {
  const s = n === 1 ? '' : 's';
  return `The week of ${rangeLabel} already has ${n} draft shift${s}. Merge keeps those shifts and adds this week's shifts, skipping exact duplicates (same person, date, start, and end). Replace isn't offered here: it would have deleted all ${n} draft shift${s} in that week and copied this week on top. To start that week over, clear its drafts first, then copy.`;
}

export interface DraftShift {
  id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_date: string | null;
  day_of_week: number | null;
  station_id?: string | null;
}

/**
 * What Clear would touch. Unpublished (or no snapshot): every shift is a draft.
 * Published: adds + modifies (station included) + snapshot rows that were deleted.
 * Clear's target state is the snapshot itself (clear_schedule_drafts does the write).
 */
export function classifyDrafts(isPublished: boolean, snapshot: DraftShift[] | null | undefined, current: DraftShift[]) {
  if (!isPublished || !snapshot) return { added: current.length, modified: 0, deleted: 0, total: current.length };
  const snap = new Map(snapshot.map((s) => [s.id, s]));
  const cur = new Set(current.map((s) => s.id));
  let added = 0, modified = 0, deleted = 0;
  for (const c of current) {
    const o = snap.get(c.id);
    if (!o) added++;
    else if (shiftDiffers(o, c)) modified++;
  }
  for (const id of snap.keys()) if (!cur.has(id)) deleted++;
  return { added, modified, deleted, total: added + modified + deleted };
}

/** Same fields as the Update badge. Station counts only when both sides carry it (old snapshots / narrow selects may not). */
export function shiftDiffers(o: DraftShift, n: DraftShift): boolean {
  return o.user_id !== n.user_id
    || o.start_time !== n.start_time
    || o.end_time !== n.end_time
    || o.shift_date !== n.shift_date
    || o.day_of_week !== n.day_of_week
    || ('station_id' in o && 'station_id' in n && (o.station_id ?? null) !== (n.station_id ?? null));
}
