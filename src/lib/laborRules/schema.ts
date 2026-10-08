import { z } from 'zod';

/**
 * Single source for Labor Rules wizard validation + field labels.
 * Ranges match public.save_labor_rules (the only writer of labor_rules).
 */

export type LaborRulesStep = 'start' | 'breaks' | 'shifts' | 'minors';
export type FieldKind = 'number' | 'boolean' | 'text' | 'select' | 'date' | 'json';

export interface FieldMeta {
  label: string;
  unit?: string;
  step: LaborRulesStep;
  kind: FieldKind;
  min?: number;
  max?: number;
  help?: string;
}

const num = (min?: number, max?: number) => {
  let s = z.number({ invalid_type_error: 'Enter a number' });
  if (min != null) s = s.min(min);
  if (max != null) s = s.max(max);
  return s;
};
const optNum = (min?: number, max?: number) => num(min, max).nullable();

export const minorRulesSchema = z
  .object({
    max_daily_hours: optNum(0, 24).optional(),
    max_weekly_hours: optNum(0, 80).optional(),
    latest_end_school_night: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').nullable().optional(),
    meal_after_hours: optNum(0, 12).optional(),
  })
  .nullable();

export const laborRulesSchema = z
  .object({
    rule_name: z.string().min(1).max(120),
    daily_overtime_threshold: optNum(0, 24),
    daily_double_time_threshold: optNum(0, 24),
    weekly_overtime_threshold: optNum(0, 80),
    overtime_multiplier: optNum(1, 3),
    double_time_multiplier: optNum(1, 3),
    seventh_day_rule: z.boolean(),
    daily_ot_max_wage: optNum(0, 1000),
    workweek_start_dow: z.number().int().min(0).max(6),
    daily_ot_window: z.enum(['business_day', 'rolling_24h']),
    meal_rule_basis: z.enum(['law', 'company', 'none']),
    meal_break_hours: optNum(0, 12),
    meal_break_duration: optNum(10, 60),
    meal_break_paid: z.boolean(),
    meal_deadline_hours: optNum(0, 12),
    meal_waiver_max_hours: optNum(0, 24),
    second_meal_break_hours: optNum(0, 24),
    second_meal_waiver_max_hours: optNum(0, 24),
    rest_break_hours: optNum(0, 12),
    rest_break_duration: optNum(0, 60),
    rest_break_paid: z.boolean(),
    flag_rest_breaks: z.boolean(),
    long_break_grace_minutes: num(0, 60).int(),
    long_shift_hours: num(1, 24),
    min_hours_between_shifts: optNum(0, 24),
    split_shift_enabled: z.boolean(),
    split_shift_gap_minutes: optNum(0, 720),
    reporting_time_enabled: z.boolean(),
    reporting_time_min_hours: optNum(0, 24),
    reporting_time_max_hours: optNum(0, 24),
    pay_period_type: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']),
    pay_period_start_date: z.string().nullable(),
    allow_unscheduled_clock_in: z.boolean(),
    allow_early_clock_in: z.boolean(),
    early_clock_in_minutes: num(0, 240).int(),
    minor_rules: minorRulesSchema,
  })
  .superRefine((v, ctx) => {
    const ot = v.daily_overtime_threshold ?? 0;
    const dt = v.daily_double_time_threshold ?? 0;
    if (ot > 0 && dt > 0 && dt <= ot) {
      ctx.addIssue({ code: 'custom', path: ['daily_double_time_threshold'], message: 'Double time must start after overtime' });
    }
    if (v.meal_waiver_max_hours != null && v.meal_break_hours != null && v.meal_waiver_max_hours < v.meal_break_hours) {
      ctx.addIssue({ code: 'custom', path: ['meal_waiver_max_hours'], message: 'Waiver limit must be at least the meal-after hours' });
    }
    if (v.meal_deadline_hours != null && v.meal_break_hours != null && v.meal_deadline_hours > v.meal_break_hours) {
      ctx.addIssue({ code: 'custom', path: ['meal_deadline_hours'], message: 'Meal deadline must be at or before the meal-after hours' });
    }
  });

export type LaborRulesForm = z.infer<typeof laborRulesSchema>;
export type LaborRulesField = keyof LaborRulesForm;

export const EDITABLE_FIELDS = Object.keys(laborRulesSchema.innerType().shape) as LaborRulesField[];

export const FIELD_META: Record<LaborRulesField, FieldMeta> = {
  rule_name: { label: 'Rule name', step: 'start', kind: 'text' },
  daily_overtime_threshold: { label: 'Daily overtime after', unit: 'h', step: 'shifts', kind: 'number', min: 0, max: 24, help: 'Typically 8 hours/day' },
  daily_double_time_threshold: { label: 'Daily double time after', unit: 'h', step: 'shifts', kind: 'number', min: 0, max: 24, help: 'Typically 12 hours/day' },
  weekly_overtime_threshold: { label: 'Weekly overtime after', unit: 'h', step: 'shifts', kind: 'number', min: 0, max: 80, help: 'Typically 40 hours/week' },
  overtime_multiplier: { label: 'Overtime pay multiplier', unit: '×', step: 'shifts', kind: 'number', min: 1, max: 3 },
  double_time_multiplier: { label: 'Double time pay multiplier', unit: '×', step: 'shifts', kind: 'number', min: 1, max: 3 },
  seventh_day_rule: { label: 'California 7th-day rule', step: 'shifts', kind: 'boolean' },
  daily_ot_max_wage: { label: 'No daily overtime at or above wage', unit: '$/h', step: 'shifts', kind: 'number', min: 0, help: 'Nevada: 1.5 × state minimum wage' },
  workweek_start_dow: { label: 'Workweek starts on', step: 'shifts', kind: 'select' },
  daily_ot_window: { label: 'Daily overtime counted per', step: 'shifts', kind: 'select' },
  meal_rule_basis: { label: 'Meal break required by', step: 'breaks', kind: 'select' },
  meal_break_hours: { label: 'Meal required after', unit: 'h', step: 'breaks', kind: 'number', min: 0, max: 12 },
  meal_break_duration: { label: 'Meal length', unit: 'min', step: 'breaks', kind: 'number', min: 10, max: 60 },
  meal_break_paid: { label: 'Meal break is paid', step: 'breaks', kind: 'boolean' },
  meal_deadline_hours: { label: 'Meal must start by hour', unit: 'h', step: 'breaks', kind: 'number', min: 0, max: 12 },
  meal_waiver_max_hours: { label: 'Meal waivers on file for shifts up to', unit: 'h', step: 'breaks', kind: 'number', min: 0, max: 24 },
  second_meal_break_hours: { label: '2nd meal after', unit: 'h', step: 'breaks', kind: 'number', min: 0, max: 24 },
  second_meal_waiver_max_hours: { label: '2nd meal waiver for shifts up to', unit: 'h', step: 'breaks', kind: 'number', min: 0, max: 24 },
  rest_break_hours: { label: 'Rest break every', unit: 'h', step: 'breaks', kind: 'number', min: 0, max: 12 },
  rest_break_duration: { label: 'Rest break length', unit: 'min', step: 'breaks', kind: 'number', min: 0, max: 60 },
  rest_break_paid: { label: 'Rest break is paid', step: 'breaks', kind: 'boolean' },
  flag_rest_breaks: { label: 'Flag missing rest breaks', step: 'breaks', kind: 'boolean' },
  long_break_grace_minutes: { label: 'Long-break grace', unit: 'min', step: 'breaks', kind: 'number', min: 0, max: 60, help: 'Minutes past the meal length before a break is flagged long' },
  long_shift_hours: { label: 'Long-shift limit', unit: 'h', step: 'shifts', kind: 'number', min: 1, max: 24 },
  min_hours_between_shifts: { label: 'Minimum hours between shifts', unit: 'h', step: 'shifts', kind: 'number', min: 0, max: 24 },
  split_shift_enabled: { label: 'Flag split shifts', step: 'shifts', kind: 'boolean' },
  split_shift_gap_minutes: { label: 'Split shift when gap is over', unit: 'min', step: 'shifts', kind: 'number', min: 0, max: 720 },
  reporting_time_enabled: { label: 'Reporting time pay', step: 'shifts', kind: 'boolean' },
  reporting_time_min_hours: { label: 'Reporting time min hours', unit: 'h', step: 'shifts', kind: 'number', min: 0, max: 24 },
  reporting_time_max_hours: { label: 'Reporting time max hours', unit: 'h', step: 'shifts', kind: 'number', min: 0, max: 24 },
  pay_period_type: { label: 'Pay period type', step: 'shifts', kind: 'select' },
  pay_period_start_date: { label: 'Pay period start date', step: 'shifts', kind: 'date' },
  allow_unscheduled_clock_in: { label: 'Clock in when not scheduled', step: 'shifts', kind: 'boolean' },
  allow_early_clock_in: { label: 'Clock in early', step: 'shifts', kind: 'boolean' },
  early_clock_in_minutes: { label: 'How early can they clock in', unit: 'min', step: 'shifts', kind: 'number', min: 0, max: 240 },
  minor_rules: { label: 'Minor rules', step: 'minors', kind: 'json' },
};

export const DEFAULT_FORM: LaborRulesForm = {
  rule_name: 'Labor Rules',
  daily_overtime_threshold: 8,
  daily_double_time_threshold: 12,
  weekly_overtime_threshold: 40,
  overtime_multiplier: 1.5,
  double_time_multiplier: 2,
  seventh_day_rule: false,
  daily_ot_max_wage: null,
  workweek_start_dow: 1,
  daily_ot_window: 'business_day',
  meal_rule_basis: 'law',
  meal_break_hours: null,
  meal_break_duration: null,
  meal_break_paid: false,
  meal_deadline_hours: null,
  meal_waiver_max_hours: null,
  second_meal_break_hours: null,
  second_meal_waiver_max_hours: null,
  rest_break_hours: null,
  rest_break_duration: null,
  rest_break_paid: true,
  flag_rest_breaks: false,
  long_break_grace_minutes: 5,
  long_shift_hours: 10,
  min_hours_between_shifts: null,
  split_shift_enabled: false,
  split_shift_gap_minutes: null,
  reporting_time_enabled: false,
  reporting_time_min_hours: null,
  reporting_time_max_hours: null,
  pay_period_type: 'biweekly',
  pay_period_start_date: null,
  allow_unscheduled_clock_in: true,
  allow_early_clock_in: true,
  early_clock_in_minutes: 30,
  minor_rules: null,
};

const NUMERIC = new Set(EDITABLE_FIELDS.filter((f) => FIELD_META[f].kind === 'number' || f === 'workweek_start_dow'));

/** Take a labor_rules / preset row (any shape) and return only editable fields, typed. */
export function toForm(row: Record<string, any> | null | undefined, base: LaborRulesForm = DEFAULT_FORM): LaborRulesForm {
  const out: any = { ...base };
  if (!row) return out;
  for (const f of EDITABLE_FIELDS) {
    if (!(f in row)) continue;
    const v = row[f];
    out[f] = NUMERIC.has(f) && v != null && v !== '' ? Number(v) : v ?? null;
  }
  return out as LaborRulesForm;
}

/** Only fields whose value differs. */
export function diffForm(before: Partial<LaborRulesForm> | null, after: LaborRulesForm): Partial<LaborRulesForm> {
  const patch: any = {};
  for (const f of EDITABLE_FIELDS) {
    const a = before ? (before as any)[f] ?? null : undefined;
    const b = (after as any)[f] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) patch[f] = b;
  }
  return patch;
}

export function formatValue(f: LaborRulesField, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Off';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (f === 'workweek_start_dow') return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(v)] ?? String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  const u = FIELD_META[f]?.unit;
  return u ? `${v}${u === '×' ? '×' : ' ' + u}` : String(v);
}
