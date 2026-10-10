// Shared helpers for MANAGER punch edit/add screens (Time Tracking Edit Shift, Schedule Edit Punch, Quick Punch).
// Not used by the kiosk / PunchClock device code.
import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { onAppResume } from '@/lib/appResume';

type PunchLike = { id: string; punch_type: string; punch_time: string; notes?: string | null };

/** Stable signature of a set of punches: if it changes, someone else (or the kiosk) touched the shift. */
export function punchFingerprint(rows: PunchLike[]): string {
  return [...rows]
    .map((p) => `${p.id}|${p.punch_type}|${new Date(p.punch_time).getTime()}|${p.notes ?? ''}`)
    .sort()
    .join(';');
}

/**
 * Punches that belong with a shift snapshot: everything from the earliest snapshot punch up to the next
 * clock-in that wasn't in the snapshot (a different shift), or 18 hours later.
 */
export function scopeToSnapshot<T extends PunchLike>(rows: T[], snapshot: PunchLike[]): T[] {
  if (snapshot.length === 0) return [];
  const ids = new Set(snapshot.map((p) => p.id));
  const times = snapshot.map((p) => new Date(p.punch_time).getTime());
  const start = Math.min(...times);
  const lastKnown = Math.max(...times);
  const sorted = [...rows].sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());
  const nextShift = sorted.find(
    (p) => p.punch_type === 'clock_in' && !ids.has(p.id) && new Date(p.punch_time).getTime() > lastKnown,
  );
  const end = nextShift ? new Date(nextShift.punch_time).getTime() : start + 18 * 3600_000;
  return sorted.filter((p) => {
    if (ids.has(p.id)) return true;
    const t = new Date(p.punch_time).getTime();
    return t >= start - 60_000 && t < end;
  });
}

/** Re-read one person's punches at a store in a time window, straight from the database. */
export async function loadPunchWindow(userId: string, locationId: string, fromIso: string, toIso: string) {
  const { data, error } = await supabase
    .from('time_punches')
    .select('*')
    .eq('user_id', userId)
    .eq('location_id', locationId)
    .gte('punch_time', fromIso)
    .lte('punch_time', toIso)
    .order('punch_time', { ascending: true });
  if (error) throw error;
  return (data || []) as any[];
}

/** Re-read the punches around a snapshot and report whether they changed since the dialog opened. */
export async function recheckSnapshot(userId: string, locationId: string, snapshot: PunchLike[]) {
  const times = snapshot.map((p) => new Date(p.punch_time).getTime());
  const from = new Date(Math.min(...times) - 60_000).toISOString();
  const to = new Date(Math.min(...times) + 18 * 3600_000).toISOString();
  const fresh = scopeToSnapshot(await loadPunchWindow(userId, locationId, from, to), snapshot);
  return { fresh, changed: punchFingerprint(fresh) !== punchFingerprint(snapshot) };
}

export const STALE_SHIFT_MESSAGE =
  'This shift changed while you were editing (another manager or the kiosk added punches). We loaded the latest punches — please check and save again.';

/** Throw a Supabase error so a save stops at the first failure. */
export function must<T extends { error: any }>(res: T): T {
  if (res.error) throw res.error;
  return res;
}

/** Friendly text for the database duplicate guard and other save errors. */
export function friendlyPunchError(err: any, fallback = 'Something went wrong saving punches. Nothing was marked as updated — please refresh and check.'): string {
  const msg = String(err?.message || err || '');
  if (msg.includes('DUPLICATE_CLOCK_OUT')) return 'This shift already has a clock-out. Edit that one instead of adding another.';
  if (msg.includes('DUPLICATE_BREAK')) return 'That break overlaps one already on this shift. Edit the existing break instead.';
  if (/permission|row-level security|42501/i.test(msg)) return "You don't have permission to change these punches.";
  return msg ? `${fallback} (${msg})` : fallback;
}

/** Tell every manager punch view to reload (schedule clocked-in status, shift flags, payroll hours). */
export function invalidatePunchViews(queryClient: QueryClient) {
  for (const key of ['schedule-punches', 'shift-flags', 'payroll-hours', 'labor-cache-today', 'active-punches']) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** Run cb when the app resumes (shared resume signal) or the window regains focus. Throttled. */
export function usePunchViewsRefresh(cb: () => void, enabled = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    const run = () => {
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      ref.current();
    };
    const off = onAppResume(run);
    window.addEventListener('focus', run);
    return () => { off(); window.removeEventListener('focus', run); };
  }, [enabled]);
}
