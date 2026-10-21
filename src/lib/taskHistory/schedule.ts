/**
 * Standard checklist schedule rules — the ONE place the app and the server decide
 * which day a Standard checklist shows and how long its scoring period is.
 * Byte-identical copy lives in supabase/functions/_shared/taskHistory/schedule.ts
 * (parity test). SQL twins: public.checklist_shows_on / checklist_period_kind /
 * checklist_period_start / checklist_period_end — keep them in step.
 *
 * Weekdays are Mon=0..Sun=6 (same as Dynamic item days_of_week). Week = Mon–Sun.
 * Quarter = calendar quarter. Dates are store-local 'yyyy-MM-dd' strings.
 * Dynamic and Training lists are NOT decided here (they keep their own rules).
 */

export type SchedulePeriod = 'week' | 'month' | 'quarter';
export type ScheduleMode = 'days' | 'on_day' | 'last_n';
export type ScorePeriodKind = 'day' | 'week' | 'month' | 'quarter';

export interface ChecklistScheduleFields {
  template_type?: string | null;
  frequency?: string | null;
  scheduled_date?: string | null;
  visible_days_before_month_end?: number | null;
  schedule_repeats?: boolean | null;
  schedule_period?: string | null;
  schedule_mode?: string | null;
  schedule_weekdays?: number[] | null;
  /** 1..31, or -1 = last day of the month (or of the quarter's month). */
  schedule_day?: number | null;
  /** 1..3 — which month of the quarter (quarterly "On a day"). */
  schedule_quarter_month?: number | null;
  schedule_last_n?: number | null;
}

/** Columns every reader must select to honor the schedule. */
export const CHECKLIST_SCHEDULE_COLUMNS =
  'frequency, scheduled_date, visible_days_before_month_end, schedule_repeats, schedule_period, schedule_mode, schedule_weekdays, schedule_day, schedule_quarter_month, schedule_last_n';

const ymd = (s: string): [number, number, number] => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return [y, m, d];
};
const pad = (n: number) => String(n).padStart(2, '0');
const toStr = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
export const scheduleDaysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const scheduleAddDays = (s: string, n: number): string => {
  const [y, m, d] = ymd(s);
  return toStr(y, m, d + n);
};
/** Mon=0..Sun=6 for a yyyy-MM-dd date. */
export const scheduleWeekdayMon0 = (s: string): number => {
  const [y, m, d] = ymd(s);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

const isDynamic = (c: ChecklistScheduleFields) => c.template_type === 'dynamic';
const isTraining = (c: ChecklistScheduleFields) => c.template_type === 'training' || c.frequency === 'training';

/** True when the list uses the new picker fields (every Standard list after Phase B). */
export const hasScheduleFields = (c: ChecklistScheduleFields): boolean => !!c.schedule_mode || c.schedule_repeats === false;

/** How long one score lasts: a day, or the whole week/month/quarter ("Last N days" lists). */
export function checklistScorePeriodKind(c: ChecklistScheduleFields): ScorePeriodKind {
  if (isDynamic(c) || isTraining(c)) return 'day';
  if (!hasScheduleFields(c)) return c.frequency === 'monthly' ? 'month' : 'day';
  if (c.schedule_repeats !== false && c.schedule_mode === 'last_n') {
    const p = c.schedule_period;
    if (p === 'week' || p === 'month' || p === 'quarter') return p;
  }
  return 'day';
}

/** Scored once for a whole week/month/quarter (not per day). */
export const isPeriodScored = (c: ChecklistScheduleFields): boolean => checklistScorePeriodKind(c) !== 'day';

/** First and last date (inclusive) of the period of `kind` containing `dateStr`. */
export function schedulePeriodBounds(kind: ScorePeriodKind, dateStr: string): { start: string; end: string } {
  const [y, m] = ymd(dateStr);
  if (kind === 'week') {
    const start = scheduleAddDays(dateStr, -scheduleWeekdayMon0(dateStr));
    return { start, end: scheduleAddDays(start, 6) };
  }
  if (kind === 'month') return { start: toStr(y, m, 1), end: toStr(y, m, scheduleDaysInMonth(y, m)) };
  if (kind === 'quarter') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return { start: toStr(y, qm, 1), end: toStr(y, qm + 2, scheduleDaysInMonth(y, qm + 2)) };
  }
  const d = dateStr.slice(0, 10);
  return { start: d, end: d };
}

/** The scoring window for this list on `dateStr`. */
export function checklistScorePeriod(c: ChecklistScheduleFields, dateStr: string) {
  const kind = checklistScorePeriodKind(c);
  return { kind, ...schedulePeriodBounds(kind, dateStr) };
}

const targetDay = (day: number | null | undefined, dim: number) =>
  day == null || day < 1 ? dim : Math.min(day, dim);

/**
 * Does this Standard list show (and, for day-scored lists, count) on `dateStr`?
 * Dynamic → true (its items decide). Training → false (assigned per person).
 */
export function checklistShowsOn(c: ChecklistScheduleFields, dateStr: string): boolean {
  if (isDynamic(c)) return true;
  if (isTraining(c)) return false;
  const date = dateStr.slice(0, 10);
  const [y, m, d] = ymd(date);
  const dim = scheduleDaysInMonth(y, m);

  if (!hasScheduleFields(c)) {
    // Legacy rows (before the picker) — today's exact behavior.
    if (c.frequency === 'single_day') return !c.scheduled_date || c.scheduled_date.slice(0, 10) === date;
    if (c.frequency === 'monthly' && c.visible_days_before_month_end) {
      return dim - d < c.visible_days_before_month_end;
    }
    return true;
  }

  if (c.schedule_repeats === false) return !!c.scheduled_date && c.scheduled_date.slice(0, 10) === date;

  const n = Math.max(1, Math.floor(Number(c.schedule_last_n) || 1));
  if (c.schedule_period === 'week') {
    const dow = scheduleWeekdayMon0(date);
    if (c.schedule_mode === 'last_n') return dow >= 7 - n;
    return (c.schedule_weekdays ?? []).includes(dow);
  }
  if (c.schedule_period === 'month') {
    if (c.schedule_mode === 'last_n') return d > dim - n;
    return d === targetDay(c.schedule_day, dim);
  }
  if (c.schedule_period === 'quarter') {
    const { start, end } = schedulePeriodBounds('quarter', date);
    if (c.schedule_mode === 'last_n') return date > scheduleAddDays(end, -n);
    const [, qm] = ymd(start);
    const month = qm + Math.min(3, Math.max(1, c.schedule_quarter_month ?? 1)) - 1;
    if (m !== month) return false;
    return d === targetDay(c.schedule_day, dim);
  }
  return false;
}

/** The legacy `frequency` value kept filled for older readers. */
export function deriveChecklistFrequency(c: ChecklistScheduleFields): string {
  if (c.schedule_repeats === false) return 'single_day';
  if (c.schedule_period === 'quarter') return 'quarterly';
  if (c.schedule_period === 'month') return 'monthly';
  if (c.schedule_mode === 'days' && (c.schedule_weekdays ?? []).length === 7) return 'daily';
  return 'weekly';
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Short plain-language label, e.g. "Every day", "Mon, Wed", "Last 7 days of the month". */
export function describeChecklistSchedule(c: ChecklistScheduleFields): string {
  if (isDynamic(c)) return 'Dynamic weekly';
  if (isTraining(c)) return 'Training';
  if (!hasScheduleFields(c)) {
    if (c.frequency === 'single_day') return c.scheduled_date ? `Only on ${c.scheduled_date.slice(0, 10)}` : 'One day';
    if (c.frequency === 'monthly') {
      return c.visible_days_before_month_end ? `Last ${c.visible_days_before_month_end} days of the month` : 'Monthly';
    }
    return 'Every day';
  }
  if (c.schedule_repeats === false) return c.scheduled_date ? `Only on ${c.scheduled_date.slice(0, 10)}` : 'One day';
  const n = Math.max(1, Number(c.schedule_last_n) || 1);
  const days = (k: number) => (k === 1 ? 'day' : `${k} days`);
  if (c.schedule_period === 'week') {
    if (c.schedule_mode === 'last_n') return n === 1 ? 'Last day of the week' : `Last ${days(n)} of the week`;
    const wd = [...(c.schedule_weekdays ?? [])].sort((a, b) => a - b);
    if (wd.length === 7) return 'Every day';
    return wd.length ? wd.map((i) => DAY_NAMES[i]).join(', ') : 'No days picked';
  }
  const dayLabel = (day: number | null | undefined, scope: string) =>
    day == null || day < 1 ? `Last day of the ${scope}` : `${ordinal(day)} of the ${scope}`;
  if (c.schedule_period === 'month') {
    if (c.schedule_mode === 'last_n') return n === 1 ? 'Last day of the month' : `Last ${days(n)} of the month`;
    return `Monthly · ${dayLabel(c.schedule_day, 'month')}`;
  }
  if (c.schedule_period === 'quarter') {
    if (c.schedule_mode === 'last_n') return n === 1 ? 'Last day of the quarter' : `Last ${days(n)} of the quarter`;
    const qm = c.schedule_quarter_month ?? 1;
    if ((c.schedule_day == null || c.schedule_day < 1) && qm === 3) return 'Quarterly · Last day of the quarter';
    return `Quarterly · ${ordinal(qm)} month, ${dayLabel(c.schedule_day, 'month').toLowerCase()}`;
  }
  return 'Every day';
}
