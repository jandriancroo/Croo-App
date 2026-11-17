// ONE config for thermometer bands, used by the reader (ai-extraction-service),
// the app (CompleteChecklist, typed fixes, equipment-check badge) and the
// equipment-check email. Each temp task can carry one equipment tag
// (checklist_items.equipment_type). Untagged tasks keep today's broad check.
//
// compliance  = hard pass/fail. A saved reading outside it is failed.
// possible    = what the unit can plausibly read. Outside it the reading is
//               treated as a bad photo read: nothing is saved, the crew retakes
//               or types the number (the photo stays).
// borderline  = hot tags only: just under the line gets ONE retake prompt;
//               a retake (or a typed number) still under the line saves FAILED.

export type EquipmentType = 'freezer' | 'refrigerator' | 'walk_in' | 'line' | 'hot_holding' | 'reheating';

export interface TempBand {
  label: string;
  /** Short label for the safe range, e.g. "refrigerators". */
  plural: string;
  compliance: { min: number | null; max: number | null };
  possible: { min: number; max: number };
  /** Hot tags: readings >= this and below compliance.min get one retake prompt. */
  borderlineFrom?: number;
  hot: boolean;
  /** What to check when the unit fails on two separate days. */
  tip: string;
}

export const TEMP_BANDS: Record<EquipmentType, TempBand> = {
  freezer: {
    label: 'Freezer', plural: 'freezers', hot: false,
    compliance: { min: -20, max: 20 }, possible: { min: -40, max: 45 },
    tip: 'Check the door seal and that the door closes fully, the fan is running, and the evaporator isn\'t iced. Call for service if it stays above 20°F.',
  },
  refrigerator: {
    label: 'Refrigerator', plural: 'refrigerators', hot: false,
    compliance: { min: 30, max: 41 }, possible: { min: 20, max: 60 },
    tip: 'Check the door seal and that the door closes fully, the fan is running, and the evaporator isn\'t iced. Call for service if it stays above 41°F.',
  },
  walk_in: {
    label: 'Walk-in', plural: 'walk-ins', hot: false,
    compliance: { min: 30, max: 41 }, possible: { min: 20, max: 55 },
    tip: 'Check the door seal and that the door closes fully, the fan is running, and the evaporator isn\'t iced. Call for service if it stays above 41°F.',
  },
  line: {
    label: 'Line', plural: 'line coolers', hot: false,
    compliance: { min: 30, max: 41 }, possible: { min: 20, max: 60 },
    tip: 'Check the lids and door seals, that pans aren\'t overfilled above the cold line, and the fan is running. Call for service if it stays above 41°F.',
  },
  hot_holding: {
    label: 'Hot holding', plural: 'hot holding', hot: true,
    compliance: { min: 135, max: null }, possible: { min: 60, max: 250 }, borderlineFrom: 130,
    tip: 'Check the unit is on and set high enough, lids are on, and the water level is right. Reheat food to 165°F, and throw out food held under 135°F too long.',
  },
  reheating: {
    label: 'Reheating', plural: 'reheating', hot: true,
    compliance: { min: 165, max: null }, possible: { min: 60, max: 250 }, borderlineFrom: 160,
    tip: 'Check the oven or reheat unit is at temp and food is reheated long enough. Food must reach 165°F within 2 hours.',
  },
};

export const EQUIPMENT_TYPES = Object.keys(TEMP_BANDS) as EquipmentType[];

/** Today's broad check for untagged tasks. */
export const UNTAGGED_POSSIBLE = { min: -60, max: 250 } as const;
export const isSafeTempUntagged = (t: number) => t <= 41.0 || t >= 135.0;

export const asEquipmentType = (v: unknown): EquipmentType | null =>
  typeof v === 'string' && (EQUIPMENT_TYPES as string[]).includes(v) ? (v as EquipmentType) : null;

export type TempVerdict = 'pass' | 'fail' | 'borderline' | 'implausible';

/**
 * Classify a reading for a tag.
 * - implausible: outside the possible range (not saved; retake or type).
 * - borderline: hot tags just under the line (one retake prompt).
 * - fail / pass: compliance.
 */
export function classifyTemp(tag: EquipmentType | null | undefined, t: number): TempVerdict {
  if (!Number.isFinite(t)) return 'implausible';
  const band = tag ? TEMP_BANDS[tag] : null;
  if (!band) {
    if (t < UNTAGGED_POSSIBLE.min || t > UNTAGGED_POSSIBLE.max) return 'implausible';
    return isSafeTempUntagged(t) ? 'pass' : 'fail';
  }
  if (t < band.possible.min || t > band.possible.max) return 'implausible';
  const { min, max } = band.compliance;
  const ok = (min == null || t >= min) && (max == null || t <= max);
  if (ok) return 'pass';
  if (band.borderlineFrom != null && min != null && t >= band.borderlineFrom && t < min) return 'borderline';
  return 'fail';
}

/** Saved-reading validity: borderline counts as failed once it is saved. */
export const isCompliant = (tag: EquipmentType | null | undefined, t: number) => classifyTemp(tag, t) === 'pass';

/** "30–41°F", "-20–20°F", "135°F or hotter". */
export function safeRangeText(tag: EquipmentType | null | undefined): string {
  const band = tag ? TEMP_BANDS[tag] : null;
  if (!band) return '41°F or colder, or 135°F or hotter';
  const { min, max } = band.compliance;
  if (min != null && max != null) return `${min}–${max}°F`;
  if (min != null) return `${min}°F or hotter`;
  return `${max}°F or colder`;
}

/** Plausible range the reader is told about (and checks against). */
export function possibleRange(tag: EquipmentType | null | undefined): { min: number; max: number } {
  const band = tag ? TEMP_BANDS[tag] : null;
  return band ? band.possible : UNTAGGED_POSSIBLE;
}

/** Whole degree, cut toward zero (41.7 → 41, never rounded up). */
export const cutDecimal = (t: number) => Math.trunc(t);
