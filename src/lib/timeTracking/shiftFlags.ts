/**
 * One flag source for Time Tracking. Every chip, warning and close-period
 * list reads the server's shift_flags rows through these helpers; no view
 * computes break/meal/long-shift rules on its own.
 */

export type ShiftFlagTone = 'danger' | 'warning' | 'info';

export interface ShiftFlagBreak {
  start: string;
  end: string | null;
  min: number | null;
  long: boolean;
}

export interface ShiftFlagDetails {
  basis?: 'law' | 'company' | 'none' | string;
  rules?: {
    meal_break_hours?: number | null;
    meal_break_duration?: number | null;
    meal_waiver_max_hours?: number | null;
    second_meal_break_hours?: number | null;
    long_break_threshold?: number | null;
    long_shift_hours?: number | null;
  };
  breaks?: ShiftFlagBreak[];
  day_paid_min?: number | null;
  ot?: number | null;
  dt?: number | null;
  short_meal_min?: number | null;
}

export interface ShiftFlagRow {
  user_id: string;
  business_date: string;
  clock_in_punch_id: string;
  clock_out_punch_id: string | null;
  clock_in: string;
  clock_out: string | null;
  paid_min: number;
  flags: string[];
  details: ShiftFlagDetails | null;
}

export const FLAG_META: Record<string, { label: string; tone: ShiftFlagTone; blocking: boolean }> = {
  missing_clock_out: { label: 'Open', tone: 'danger', blocking: true },
  auto_clock_out: { label: 'Auto Out', tone: 'warning', blocking: false },
  open_break: { label: 'Break not ended', tone: 'warning', blocking: false },
  no_meal_break: { label: 'No Break', tone: 'warning', blocking: false },
  second_meal_missing: { label: '2nd Meal', tone: 'warning', blocking: false },
  meal_late: { label: 'Late Meal', tone: 'warning', blocking: false },
  long_break: { label: 'Long Break', tone: 'warning', blocking: false },
  long_shift: { label: 'Long Shift', tone: 'warning', blocking: false },
  overtime: { label: 'OT', tone: 'info', blocking: false },
  split_shift: { label: 'Split Shift', tone: 'info', blocking: false },
  short_turnaround: { label: 'Short Turnaround', tone: 'info', blocking: false },
  rest_break_missing: { label: 'No Rest Break', tone: 'warning', blocking: false },
  minor_hours: { label: 'Minor Hours', tone: 'warning', blocking: false },
  minor_late: { label: 'Minor Late', tone: 'warning', blocking: false },
};

/** Non-blocking codes shown as "heads up" when closing a pay period. */
export const HEADS_UP_CODES = ['auto_clock_out', 'no_meal_break', 'second_meal_missing', 'meal_late', 'long_break', 'open_break'];

export function labelFor(code: string, details?: ShiftFlagDetails | null): string {
  const meta = FLAG_META[code];
  if (!meta) return code;
  if (code === 'no_meal_break') {
    if (details?.short_meal_min != null) return `Short Meal (${Math.round(Number(details.short_meal_min))}m)`;
    if (details?.basis === 'company') return 'No Break (policy)';
  }
  if (code === 'long_shift') {
    const h = Number(details?.day_paid_min ?? 0) / 60;
    return `Long Shift ${h.toFixed(1)}h`;
  }
  return meta.label;
}

export function toneFor(code: string): ShiftFlagTone {
  return FLAG_META[code]?.tone ?? 'info';
}

/** Chips for a set of rows, deduped by label (first tone wins). */
export function chipsFor(rows: ShiftFlagRow[]): { label: string; tone: ShiftFlagTone }[] {
  const out: { label: string; tone: ShiftFlagTone }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const code of r.flags || []) {
      const label = labelFor(code, r.details);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ label, tone: toneFor(code) });
    }
  }
  return out;
}

export function breaksFromDetails(details?: ShiftFlagDetails | null): { start: string; end: string | null; minutes: number; isLong: boolean }[] {
  return (details?.breaks || []).map((b) => ({
    start: b.start,
    end: b.end ?? null,
    minutes: b.min == null ? 0 : Math.round(Number(b.min)),
    isLong: !!b.long,
  }));
}

export function indexByClockIn(rows: ShiftFlagRow[] | undefined | null): Map<string, ShiftFlagRow> {
  const m = new Map<string, ShiftFlagRow>();
  for (const r of rows || []) m.set(r.clock_in_punch_id, r);
  return m;
}

/** Rows whose clock-in punch is in this day's punches. No match → no row. */
export function flagsForDay(dayPunches: { id: string; punch_type: string }[], index: Map<string, ShiftFlagRow>): ShiftFlagRow[] {
  const out: ShiftFlagRow[] = [];
  for (const p of dayPunches || []) {
    if (p.punch_type !== 'clock_in') continue;
    const r = index.get(p.id);
    if (r) out.push(r);
  }
  return out;
}

export const hasCode = (rows: ShiftFlagRow[], code: string) => rows.some((r) => (r.flags || []).includes(code));
