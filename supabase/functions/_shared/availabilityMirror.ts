// SERVER MIRROR of the locked src/types/availability.ts normalizer (edge functions can't import src/).
// Logic must stay identical: src/lib/coverCandidates.test.ts checks this mirror against the locked
// original on the same records. Never edit one without the other.
export interface UnavailableBlock { start: string; end: string }
export interface DayAvailability { available: boolean; blocks?: UnavailableBlock[]; start?: string; end?: string }
export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type WeeklyAvailability = Partial<Record<DayKey, DayAvailability>>;
export interface DayHours { open: string; close: string }
export type WeeklyHours = Partial<Record<DayKey, DayHours>>;

export const DAY_KEYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const DAY_KEYS_SUNDAY_FIRST: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const FALLBACK_OPEN = '11:00';
const FALLBACK_CLOSE = '22:00';

export function normalizeTime(time?: string | null): string { return time ? time.substring(0, 5) : ''; }
export function timeToMinutes(time?: string | null): number {
  const t = normalizeTime(time);
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function sanitizeBlocks(blocks?: UnavailableBlock[] | null): UnavailableBlock[] {
  return (blocks || [])
    .map((b) => ({ start: normalizeTime(b?.start), end: normalizeTime(b?.end) }))
    .filter((b) => b.start && b.end && timeToMinutes(b.end) > timeToMinutes(b.start))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}
export function normalizeDayAvailability(raw: DayAvailability | null | undefined, hours?: DayHours): DayAvailability {
  if (!raw) return { available: true, blocks: [] };
  if (raw.available === false) return { available: false, blocks: [] };
  if (Array.isArray(raw.blocks)) return { available: true, blocks: sanitizeBlocks(raw.blocks) };
  const start = normalizeTime(raw.start);
  const end = normalizeTime(raw.end);
  if (!start && !end) return { available: true, blocks: [] };
  const open = normalizeTime(hours?.open) || FALLBACK_OPEN;
  const close = normalizeTime(hours?.close) || FALLBACK_CLOSE;
  if (timeToMinutes(close) <= timeToMinutes(open)) return { available: true, blocks: [] };
  const blocks: UnavailableBlock[] = [];
  if (start && timeToMinutes(start) > timeToMinutes(open)) blocks.push({ start: open, end: start });
  if (end && timeToMinutes(end) < timeToMinutes(close)) blocks.push({ start: end, end: close });
  return { available: true, blocks: sanitizeBlocks(blocks) };
}
export function normalizeWeeklyAvailability(raw: WeeklyAvailability | null | undefined, hours?: WeeklyHours): WeeklyAvailability | null {
  if (!raw) return null;
  const out: WeeklyAvailability = {};
  for (const key of DAY_KEYS) out[key] = normalizeDayAvailability(raw[key], hours?.[key]);
  return out;
}
export function conflictingBlocks(day: DayAvailability | null | undefined, shiftStart: string, shiftEnd: string): UnavailableBlock[] {
  if (!day || day.available === false) return [];
  const s = timeToMinutes(shiftStart);
  const e = timeToMinutes(shiftEnd);
  if (!(e > s)) return [];
  return sanitizeBlocks(day.blocks).filter((b) => s < timeToMinutes(b.end) && e > timeToMinutes(b.start));
}
