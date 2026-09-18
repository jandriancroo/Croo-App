/**
 * LOCKED (2026-09-18) — Availability can't-work blocks.
 *
 * Weekly availability is stored on `profiles.weekly_availability` (JSONB) as:
 *   { monday: { available: boolean, blocks?: [{ start, end }] }, ... }
 *
 * Semantics:
 *   available: false            -> off all day
 *   available: true, blocks: [] -> available all day
 *   available: true, blocks[n]  -> can work, EXCEPT those UNAVAILABLE windows
 *
 * The legacy shape ({ available, start?, end? }) meant "can ONLY work
 * start..end". It is migrated on read via `normalizeWeeklyAvailability`, using
 * the location's own store hours where available so allowed hours are preserved.
 * Never read raw `start`/`end` directly — always normalize first.
 */

export interface UnavailableBlock {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface DayAvailability {
  available: boolean;
  blocks?: UnavailableBlock[];
  /** @deprecated legacy "can only work" window — migrated on read */
  start?: string;
  /** @deprecated legacy "can only work" window — migrated on read */
  end?: string;
}

export interface WeeklyAvailability {
  monday?: DayAvailability;
  tuesday?: DayAvailability;
  wednesday?: DayAvailability;
  thursday?: DayAvailability;
  friday?: DayAvailability;
  saturday?: DayAvailability;
  sunday?: DayAvailability;
}

export type DayKey = keyof WeeklyAvailability;

export const DAY_KEYS: DayKey[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

/** date-fns / schedule grids are Monday-indexed; location_hours is Sunday=0. */
export const DAY_KEYS_SUNDAY_FIRST: DayKey[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Fallback used ONLY when the location has no stored hours for that day. */
export const FALLBACK_OPEN = '11:00';
export const FALLBACK_CLOSE = '22:00';

export interface DayHours {
  open: string;
  close: string;
}

/** Per-day store hours keyed by day name. */
export type WeeklyHours = Partial<Record<DayKey, DayHours>>;

export const DEFAULT_WEEKLY_AVAILABILITY: WeeklyAvailability = {
  monday: { available: true, blocks: [] },
  tuesday: { available: true, blocks: [] },
  wednesday: { available: true, blocks: [] },
  thursday: { available: true, blocks: [] },
  friday: { available: true, blocks: [] },
  saturday: { available: true, blocks: [] },
  sunday: { available: true, blocks: [] },
};

export function normalizeTime(time?: string | null): string {
  if (!time) return '';
  return time.substring(0, 5);
}

export function timeToMinutes(time?: string | null): number {
  const t = normalizeTime(time);
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatTime12h(time: string): string {
  const t = normalizeTime(time);
  if (!t) return '';
  const [hStr, m] = t.split(':');
  const hour = parseInt(hStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

/**
 * Migrate one day from any stored shape to can't-work blocks.
 * Legacy "can only work start..end" becomes the gaps outside that window,
 * bounded by the store's own open/close for that day.
 */
export function normalizeDayAvailability(
  raw: DayAvailability | null | undefined,
  hours?: DayHours,
): DayAvailability {
  if (!raw) return { available: true, blocks: [] };

  if (raw.available === false) return { available: false, blocks: [] };

  // Already new shape
  if (Array.isArray(raw.blocks)) {
    return { available: true, blocks: sanitizeBlocks(raw.blocks) };
  }

  const start = normalizeTime(raw.start);
  const end = normalizeTime(raw.end);
  if (!start && !end) return { available: true, blocks: [] };

  const open = normalizeTime(hours?.open) || FALLBACK_OPEN;
  const close = normalizeTime(hours?.close) || FALLBACK_CLOSE;
  const overnightStore = timeToMinutes(close) <= timeToMinutes(open);

  const blocks: UnavailableBlock[] = [];

  // Ambiguous/overnight store hours: keep it safe and add no blocks rather than
  // inventing a window that could wrongly block allowed hours.
  if (overnightStore) return { available: true, blocks: [] };

  if (start && timeToMinutes(start) > timeToMinutes(open)) {
    blocks.push({ start: open, end: start });
  }
  if (end && timeToMinutes(end) < timeToMinutes(close)) {
    blocks.push({ start: end, end: close });
  }

  return { available: true, blocks: sanitizeBlocks(blocks) };
}

/** Drop empty/invalid/zero-length blocks and sort by start. */
export function sanitizeBlocks(blocks?: UnavailableBlock[] | null): UnavailableBlock[] {
  return (blocks || [])
    .map((b) => ({ start: normalizeTime(b?.start), end: normalizeTime(b?.end) }))
    .filter((b) => b.start && b.end && timeToMinutes(b.end) > timeToMinutes(b.start))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

export function normalizeWeeklyAvailability(
  raw: WeeklyAvailability | null | undefined,
  hours?: WeeklyHours,
): WeeklyAvailability | null {
  if (!raw) return null;
  const out: WeeklyAvailability = {};
  for (const key of DAY_KEYS) {
    out[key] = normalizeDayAvailability(raw[key], hours?.[key]);
  }
  return out;
}

/** True when the day has any restriction worth surfacing on the schedule. */
export function dayHasRestriction(day?: DayAvailability | null): boolean {
  if (!day) return false;
  if (day.available === false) return true;
  return sanitizeBlocks(day.blocks).length > 0;
}

/** Blocks that a shift overlaps. Empty array = no conflict. */
export function conflictingBlocks(
  day: DayAvailability | null | undefined,
  shiftStart: string,
  shiftEnd: string,
): UnavailableBlock[] {
  if (!day || day.available === false) return [];
  const s = timeToMinutes(shiftStart);
  const e = timeToMinutes(shiftEnd);
  if (!(e > s)) return [];
  return sanitizeBlocks(day.blocks).filter(
    (b) => s < timeToMinutes(b.end) && e > timeToMinutes(b.start),
  );
}

export function shiftConflictsWithAvailability(
  day: DayAvailability | null | undefined,
  shiftStart: string,
  shiftEnd: string,
): boolean {
  if (!day) return false;
  if (day.available === false) return true;
  return conflictingBlocks(day, shiftStart, shiftEnd).length > 0;
}

export function formatBlock(block: UnavailableBlock): string {
  return `${formatTime12h(block.start)} – ${formatTime12h(block.end)}`;
}

/** Join times for one combined label: "A – B and C – D" / "A – B, C – D and E – F". */
function joinTimeRanges(blocks: UnavailableBlock[]): string {
  const times = blocks.map((b) => formatBlock(b));
  if (times.length === 0) return '';
  if (times.length === 1) return times[0];
  if (times.length === 2) return `${times[0]} and ${times[1]}`;
  return `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

/**
 * Chip label(s), e.g. "Unavailable" (full day off), or ONE combined label for
 * 1..N blocks: "Unavailable 11:00 AM – 2:00 PM and 8:30 PM – 10:00 PM".
 * The word "Unavailable" is never repeated per block.
 */
export function chipLabels(day?: DayAvailability | null): string[] {
  if (!day) return [];
  if (day.available === false) return ['Unavailable'];
  const blocks = sanitizeBlocks(day.blocks);
  if (blocks.length === 0) return [];
  return [`Unavailable ${joinTimeRanges(blocks)}`];
}

/** Long description for popovers / conflict alerts (same non-repeating copy). */
export function describeAvailability(day?: DayAvailability | null): string {
  if (!day) return '';
  if (day.available === false) return 'Unavailable all day';
  const blocks = sanitizeBlocks(day.blocks);
  if (blocks.length === 0) return 'Available all day';
  return `Unavailable ${joinTimeRanges(blocks)}`;
}
