import {
  deriveChecklistFrequency,
  hasScheduleFields,
  type ChecklistScheduleFields,
  type ScheduleMode,
  type SchedulePeriod,
} from '@/lib/taskHistory/schedule';

/** Editor state for the Standard checklist frequency picker. */
export interface ScheduleFormValue {
  repeats: boolean;
  period: SchedulePeriod;
  mode: ScheduleMode;
  /** Mon=0..Sun=6 */
  weekdays: number[];
  /** 1..31, or -1 = last day */
  day: number;
  /** 1..3 */
  quarterMonth: number;
  lastN: number;
  /** One date (repeats off), yyyy-MM-dd; '' = today. */
  date: string;
}

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export const LAST_N_PRESETS: Record<SchedulePeriod, number[]> = {
  week: [1, 2, 3],
  month: [3, 5, 7, 14, 30],
  quarter: [7, 14, 21, 30],
};

export const MAX_LAST_N: Record<SchedulePeriod, number> = { week: 7, month: 31, quarter: 92 };

export const defaultScheduleForm = (): ScheduleFormValue => ({
  repeats: true,
  period: 'week',
  mode: 'days',
  weekdays: [...ALL_WEEKDAYS],
  day: 1,
  quarterMonth: 1,
  lastN: 7,
  date: '',
});

/** Load a saved checklist row into the picker (legacy rows map to their picker equivalent). */
export function scheduleFormFromRow(row: ChecklistScheduleFields): ScheduleFormValue {
  const v = defaultScheduleForm();
  if (!hasScheduleFields(row)) {
    if (row.frequency === 'single_day') return { ...v, repeats: false, date: row.scheduled_date?.slice(0, 10) ?? '' };
    if (row.frequency === 'monthly') {
      return { ...v, period: 'month', mode: 'last_n', lastN: row.visible_days_before_month_end || 7 };
    }
    return v;
  }
  if (row.schedule_repeats === false) return { ...v, repeats: false, date: row.scheduled_date?.slice(0, 10) ?? '' };
  const period = (row.schedule_period as SchedulePeriod) || 'week';
  const mode = (row.schedule_mode as ScheduleMode) || (period === 'week' ? 'days' : 'on_day');
  return {
    ...v,
    period,
    mode: period === 'week' ? (mode === 'last_n' ? 'last_n' : 'days') : mode === 'last_n' ? 'last_n' : 'on_day',
    weekdays: row.schedule_weekdays?.length ? [...row.schedule_weekdays].sort((a, b) => a - b) : [...ALL_WEEKDAYS],
    day: row.schedule_day ?? 1,
    quarterMonth: row.schedule_quarter_month ?? 1,
    lastN: row.schedule_last_n ?? (period === 'week' ? 1 : 7),
  };
}

/** Problem with the picker value, in plain words, or null when it can be saved. */
export function scheduleFormError(v: ScheduleFormValue): string | null {
  if (!v.repeats) return null;
  if (v.period === 'week' && v.mode === 'days' && v.weekdays.length === 0) return 'Pick at least one day.';
  if (v.mode === 'last_n') {
    const n = Math.floor(v.lastN);
    if (!Number.isFinite(n) || n < 1) return 'Enter how many days (1 or more).';
    if (n > MAX_LAST_N[v.period]) return `That's more days than the ${v.period} has.`;
  }
  return null;
}

/**
 * Columns to save. `frequency` and the month window are kept filled for older readers
 * (the database trigger derives them too, so both stay in step).
 */
export function scheduleFormToRow(v: ScheduleFormValue, todayStr: string) {
  if (!v.repeats) {
    return {
      frequency: 'single_day',
      scheduled_date: v.date || todayStr,
      visible_days_before_month_end: null,
      assigned_day_of_week: null,
      schedule_repeats: false,
      schedule_period: null,
      schedule_mode: null,
      schedule_weekdays: null,
      schedule_day: null,
      schedule_quarter_month: null,
      schedule_last_n: null,
    };
  }
  const isWeekDays = v.period === 'week' && v.mode !== 'last_n';
  const mode: ScheduleMode = v.period === 'week' ? (v.mode === 'last_n' ? 'last_n' : 'days') : v.mode === 'last_n' ? 'last_n' : 'on_day';
  const fields = {
    schedule_repeats: true,
    schedule_period: v.period,
    schedule_mode: mode,
    schedule_weekdays: isWeekDays ? [...v.weekdays].sort((a, b) => a - b) : null,
    schedule_day: mode === 'on_day' ? v.day : null,
    schedule_quarter_month: mode === 'on_day' && v.period === 'quarter' ? v.quarterMonth : null,
    schedule_last_n: mode === 'last_n' ? Math.floor(v.lastN) : null,
  };
  return {
    ...fields,
    frequency: deriveChecklistFrequency(fields),
    scheduled_date: null,
    assigned_day_of_week: null,
    visible_days_before_month_end: v.period === 'month' && mode === 'last_n' ? Math.floor(v.lastN) : null,
  };
}
