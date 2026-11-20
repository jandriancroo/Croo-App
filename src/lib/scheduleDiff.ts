// Shared schedule diff helpers.
// A "pending change" is any add/remove/edit made to a Live (published) schedule
// after the snapshot was taken. Drafts on never-posted weeks are NOT pending changes.

import { shiftDiffers } from './scheduleCopy';

export interface DiffShift {
  id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_date: string | null;
  day_of_week: number | null;
  station_id?: string | null;
}

export function countPendingChanges(
  snapshot: DiffShift[] | null | undefined,
  current: DiffShift[] | null | undefined
): number {
  if (!snapshot || !current) return 0;
  const snapMap = new Map(snapshot.map(s => [s.id, s]));
  const curMap = new Map(current.map(s => [s.id, s]));
  let count = 0;

  // removed
  for (const [id] of snapMap) if (!curMap.has(id)) count++;
  // added + modified
  for (const [id, n] of curMap) {
    const o = snapMap.get(id);
    if (!o) { count++; continue; }
    // Station belongs to the shift: a station-only edit is a pending change (Clear agrees).
    if (shiftDiffers(o, n)) count++;
  }
  return count;
}

export type WeekStatus = 'empty' | 'draft' | 'live';

export function getWeekStatus(opts: {
  hasSchedule: boolean;
  isPublished: boolean;
  shiftCount: number;
}): WeekStatus {
  if (opts.isPublished) return 'live';
  if (!opts.hasSchedule || opts.shiftCount === 0) return 'empty';
  return 'draft';
}
