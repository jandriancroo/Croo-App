import type { PromoBorder } from './promoTrackers';

export const PROMO_BORDER_STYLES = [
  { style: 'christmas-garland', label: 'Christmas garland', group: 'Seasonal' },
  { style: 'string-lights-multi', label: 'String lights · multicolor', group: 'Seasonal' },
  { style: 'string-lights', label: 'String lights · picked colors', group: 'Seasonal' },
  { style: 'halloween', label: 'Halloween', group: 'Seasonal' },
  { style: 'fall-leaves', label: 'Fall leaves', group: 'Seasonal' },
  { style: 'hearts', label: "Valentine’s hearts", group: 'Seasonal' },
  { style: 'st-patricks', label: "St. Patrick’s", group: 'Seasonal' },
  { style: 'spring-bunting', label: 'Spring bunting', group: 'Seasonal' },
  { style: 'fourth-july', label: '4th of July', group: 'Seasonal' },
  { style: 'summer-rope', label: 'Summer rope', group: 'Seasonal' },
  { style: 'new-year', label: "New Year’s", group: 'Seasonal' },
  { style: 'marquee', label: 'Marquee bulbs', group: 'Event' },
  { style: 'confetti', label: 'Confetti corners', group: 'Event' },
  { style: 'game-day', label: 'Game day', group: 'Event' },
  { style: 'flame', label: 'Flame edge', group: 'Brand' },
  { style: 'neon', label: 'Neon tube', group: 'Brand' },
  { style: 'gingham', label: 'Gingham', group: 'Brand' },
] as const;

export const BORDER_COLORS = [
  { value: 'ivory', label: 'Off-white' }, { value: 'red', label: 'Red' },
  { value: 'gold', label: 'Yellow' }, { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' }, { value: 'purple', label: 'Purple' },
  { value: 'orange', label: 'Orange' }, { value: 'pink', label: 'Pink' },
] as const;

export function borderColor(value: string | undefined, fallback = 'ivory'): string {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value;
  const key = BORDER_COLORS.some(c => c.value === value) ? value : fallback;
  return `hsl(var(--promo-border-${key}))`;
}

export function borderTitleOffset(border?: PromoBorder | null): 0 | 8 | 24 {
  return border?.style === 'spring-bunting' || border?.style === 'fourth-july' ? 24 : border?.style === 'gingham' ? 8 : 0;
}

interface BorderRank { locationId: string; rank: number; units: number; itemStats?: Record<string, { units: number }> }
/** Presentation only: reuse the existing order, never sort or fetch ranking. */
export function promoBorderReactions(rows: BorderRank[], locationId: string | undefined, activeRef: string, pending: boolean) {
  const off = { winner: false, closing: false };
  if (pending || !locationId) return off;
  const mine = rows.find(r => r.locationId === locationId);
  if (!mine) return off;
  const winner = mine.rank === 1;
  const above = rows.find(r => r.rank === mine.rank - 1);
  const units = (r: BorderRank) => !activeRef || activeRef === '__ALL__' ? r.units : r.itemStats?.[activeRef]?.units;
  const myUnits = units(mine);
  const aboveUnits = above ? units(above) : undefined;
  const gap = myUnits !== undefined && aboveUnits !== undefined ? aboveUnits - myUnits : NaN;
  return { winner, closing: !winner && Number.isFinite(gap) && gap >= 0 && gap <= 2 };
}