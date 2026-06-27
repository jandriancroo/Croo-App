import { ShiftBreak, normalizeBreaks } from '@/types/shiftBreak';

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

export interface CoveringAssignment {
  covererId: string;
  coveringUserId: string | null;
  start: string;
  end: string;
  shiftId: string;
}

/**
 * Given a flat list of shifts for one day, return overlay maps for renderers.
 * - byShiftBreaks: per-shift list of breaks (already on the shift)
 * - covering: per-user list of "you are covering X from A–B" blocks (their own row)
 */
export function getBreakOverlaysForDay(
  shifts: Array<{ id: string; user_id: string | null; breaks?: unknown }>,
): {
  covering: Record<string, CoveringAssignment[]>;
  shiftBreaks: Record<string, ShiftBreak[]>;
} {
  const covering: Record<string, CoveringAssignment[]> = {};
  const shiftBreaks: Record<string, ShiftBreak[]> = {};

  for (const s of shifts) {
    const breaks = normalizeBreaks(s.breaks);
    if (breaks.length === 0) continue;
    shiftBreaks[s.id] = breaks;

    for (const b of breaks) {
      if (b.covered_by_user_id) {
        (covering[b.covered_by_user_id] ||= []).push({
          covererId: b.covered_by_user_id,
          coveringUserId: s.user_id,
          start: b.start_time,
          end: b.end_time,
          shiftId: s.id,
        });
      }
    }
  }
  return { covering, shiftBreaks };
}

export function formatTime12(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function initialsFor(name: string | undefined | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}
