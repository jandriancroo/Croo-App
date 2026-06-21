// Shared schedule diff helpers.
// A "pending change" is any add/remove/edit made to a Live (published) schedule
// after the snapshot was taken. Drafts on never-posted weeks are NOT pending changes.

export interface DiffShift {
  id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_date: string | null;
  day_of_week: number | null;
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
    if (
      o.user_id !== n.user_id ||
      o.start_time !== n.start_time ||
      o.end_time !== n.end_time ||
      o.shift_date !== n.shift_date ||
      o.day_of_week !== n.day_of_week
    ) count++;
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
