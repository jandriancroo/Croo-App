import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLaborRules } from '@/hooks/useLaborRules';
import {
  DEFAULT_FORM, EDITABLE_FIELDS, FIELD_META, diffForm, formatValue, laborRulesSchema, toForm,
  type LaborRulesField, type LaborRulesForm,
} from '@/lib/laborRules/schema';
import { labelFor } from '@/lib/timeTracking/shiftFlags';

const EARLY_CLOCK_IN_PRESETS = [5, 10, 15, 30];
const STEPS = ['Start', 'Breaks', 'Shifts & overtime', 'Minors', 'Review & save'];

interface Props {
  locationId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pre-fill the form (e.g. a snapshot or preset) instead of the current rules. */
  initial?: { values: Partial<LaborRulesForm>; source: 'manual' | 'preset' } | null;
}

const numOrNull = (v: string) => (v === '' ? null : Number(v));

export function LaborRulesWizard({ locationId, open, onOpenChange, initial }: Props) {
  const { rules, presets, canEdit, save } = useLaborRules(locationId);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LaborRulesForm>(DEFAULT_FORM);
  const [source, setSource] = useState<'manual' | 'preset'>('manual');
  const [startFrom, setStartFrom] = useState<string>('keep');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const readOnly = !canEdit;

  const current = useMemo(() => (rules ? toForm(rules) : null), [rules]);
  const stateCode: string | null = rules?.state_code ?? null;

  useEffect(() => {
    if (!open) return;
    setStep(0); setNote(''); setStartFrom('keep');
    if (initial) { setForm(toForm(initial.values, current ?? DEFAULT_FORM)); setSource(initial.source); }
    else { setForm(current ?? DEFAULT_FORM); setSource('manual'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rules]);

  const set = <K extends LaborRulesField>(k: K, v: LaborRulesForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSource('manual');
  };

  // Other stores this person can see (RLS), for "copy another store".
  const otherStoresQ = useQuery({
    queryKey: ['labor-rules', 'other-stores', locationId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from('labor_rules').select('*, locations(name)').neq('location_id', locationId);
      return (data || []) as any[];
    },
  });

  const tzQ = useQuery({
    queryKey: ['labor-rules', 'tz', locationId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from('location_settings').select('timezone').eq('location_id', locationId).maybeSingle();
      return data?.timezone || 'America/Los_Angeles';
    },
  });

  const statePreset = useMemo(
    () => presets.find((p) => p.is_system && p.state_code === stateCode) || presets.find((p) => p.preset_name === 'Federal Default') || null,
    [presets, stateCode],
  );

  const applyStart = (choice: string) => {
    setStartFrom(choice);
    if (choice === 'keep') { setForm(current ?? DEFAULT_FORM); setSource('manual'); return; }
    if (choice === 'preset' && statePreset) {
      setForm(toForm({ ...statePreset, rule_name: statePreset.preset_name }, current ?? DEFAULT_FORM));
      setSource('preset');
      return;
    }
    if (choice.startsWith('store:')) {
      const row = (otherStoresQ.data || []).find((r) => r.location_id === choice.slice(6));
      if (row) { setForm(toForm(row, current ?? DEFAULT_FORM)); setSource('manual'); }
    }
  };

  // Minors: N under 18 of M people with a birthday on file at this store.
  const minorsQ = useQuery({
    queryKey: ['labor-rules', 'minors', locationId],
    enabled: open && step === 3,
    queryFn: async () => {
      const { data: ul } = await supabase.from('user_locations').select('user_id').eq('location_id', locationId);
      const ids = (ul || []).map((r: any) => r.user_id);
      if (!ids.length) return { n: 0, m: 0 };
      const { data, error } = await supabase.from('profiles').select('id, birthday').in('id', ids).not('birthday', 'is', null);
      if (error) return null;
      const today = DateTime.now();
      const m = (data || []).length;
      const n = (data || []).filter((p: any) => today.diff(DateTime.fromFormat(p.birthday, 'yyyy-MM-dd'), 'years').years < 18).length;
      return { n, m };
    },
  });

  const patch = useMemo(() => diffForm(current, form), [current, form]);
  const parsed = laborRulesSchema.safeParse(form);
  const errors = useMemo(() => {
    const m: Partial<Record<string, string>> = {};
    if (!parsed.success) parsed.error.issues.forEach((i) => { m[String(i.path[0])] = i.message; });
    return m;
  }, [parsed]);

  // Preview: last 14 completed days, current vs proposed.
  const range = useMemo(() => {
    const tz = tzQ.data || 'America/Los_Angeles';
    const end = DateTime.now().setZone(tz).minus({ days: 1 });
    return { start: end.minus({ days: 13 }).toFormat('yyyy-MM-dd'), end: end.toFormat('yyyy-MM-dd') };
  }, [tzQ.data]);
  const previewQ = useQuery({
    queryKey: ['labor-rules', 'preview', locationId, range, JSON.stringify(patch)],
    enabled: open && step === 4 && canEdit && Object.keys(patch).length > 0,
    queryFn: async () => {
      const call = async (r: Record<string, unknown>) => {
        const { data, error } = await supabase.rpc('preview_shift_flags' as any, { _location_id: locationId, _start: range.start, _end: range.end, _rules: r });
        if (error) throw error;
        const m: Record<string, number> = {};
        ((data as any[]) || []).forEach((x) => { m[x.flag] = x.n; });
        return m;
      };
      const [before, after] = await Promise.all([call({}), call(patch as any)]);
      return { before, after };
    },
  });
  const previewLine = useMemo(() => {
    if (!previewQ.data) return null;
    const { before, after } = previewQ.data;
    const codes = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const parts = codes
      .filter((c) => (before[c] || 0) !== (after[c] || 0))
      .map((c) => {
        const b = before[c] || 0, a = after[c] || 0;
        const l = labelFor(c, c === 'long_shift' ? { day_paid_min: (form.long_shift_hours ?? 10) * 60 } : null).replace(/ \d+(\.\d+)?h$/, '');
        return b === 0 ? `${l} +${a}` : `${l} ${b} → ${a}`;
      });
    return parts.length ? parts.join(', ') : 'No change to flags in the last 14 days';
  }, [previewQ.data, form.long_shift_hours]);

  const fieldSource = (f: string) => {
    const s = rules?.field_sources?.[f]?.source as string | undefined;
    if (!s) return null;
    return s === 'preset' ? 'Preset' : s === 'manual' ? 'Manual' : s === 'migration' ? 'Migration' : s === 'ai' ? 'AI' : s;
  };

  const handleSave = async () => {
    if (!parsed.success) { setStep(1); return; }
    setSaving(true);
    const ok = await save(form, source, note);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const err = (f: string) => errors[f] ? <p className="text-xs text-destructive">{errors[f]}</p> : null;
  const numInput = (f: LaborRulesField, stepAttr = '0.5', placeholder?: string) => (
    <Input
      type="number" step={stepAttr} placeholder={placeholder} disabled={readOnly}
      value={(form[f] as any) ?? ''}
      onChange={(e) => set(f, numOrNull(e.target.value) as any)}
    />
  );
  const toggleRow = (f: LaborRulesField, help?: string) => (
    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{FIELD_META[f].label}</Label>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
      <Switch disabled={readOnly} checked={!!form[f]} onCheckedChange={(c) => set(f, c as any)} />
    </div>
  );
  const waiverRow = (f: 'meal_waiver_max_hours' | 'second_meal_waiver_max_hours', label: string, dflt: number) => (
    <div className="p-3 bg-muted/50 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Switch disabled={readOnly} checked={form[f] != null} onCheckedChange={(c) => set(f, c ? dflt : null)} />
      </div>
      {form[f] != null && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Shifts up to</span>
          <Input className="w-24" type="number" step="0.5" disabled={readOnly} value={form[f] ?? ''} onChange={(e) => set(f, numOrNull(e.target.value))} />
          <span className="text-xs text-muted-foreground">hours</span>
        </div>
      )}
      {err(f)}
    </div>
  );

  const minor = form.minor_rules || {};
  const setMinor = (k: string, v: any) => set('minor_rules', { ...(form.minor_rules || {}), [k]: v } as any);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Labor rules</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}{readOnly ? ' · view only' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1">
          {STEPS.map((s, i) => (
            <Button key={s} size="sm" variant={i === step ? 'default' : 'ghost'} onClick={() => setStep(i)}>{i + 1}. {s}</Button>
          ))}
        </div>

        <div className="space-y-4 py-2">
          {step === 0 && (
            <>
              <div className="rounded-lg border p-3 text-sm">
                <span className="text-muted-foreground">Store state:</span> <span className="font-medium">{stateCode || 'Unknown'}</span>
                <p className="text-xs text-muted-foreground mt-1">Set automatically from the store address.</p>
              </div>
              <div className="space-y-2">
                <Label>Start from</Label>
                <Select value={startFrom} onValueChange={applyStart} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Keep current rules</SelectItem>
                    {statePreset && <SelectItem value="preset">State preset: {statePreset.preset_name}</SelectItem>}
                    {(otherStoresQ.data || []).map((r) => (
                      <SelectItem key={r.location_id} value={`store:${r.location_id}`}>Copy {r.locations?.name || 'another store'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Only fills the form. Nothing saves until the last step.</p>
              </div>
              <div className="space-y-2">
                <Label>Rule name</Label>
                <Input disabled={readOnly} value={form.rule_name} onChange={(e) => set('rule_name', e.target.value)} />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label>Meal break required?</Label>
                <Select value={form.meal_rule_basis} onValueChange={(v) => set('meal_rule_basis', v as any)} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="law">Yes, by law</SelectItem>
                    <SelectItem value="company">Yes, company policy</SelectItem>
                    <SelectItem value="none">No meal rule</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.meal_rule_basis !== 'none' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Required after (hours)</Label>{numInput('meal_break_hours', '0.5', 'e.g., 5')}{err('meal_break_hours')}</div>
                    <div className="space-y-2"><Label>Break duration (minutes)</Label>{numInput('meal_break_duration', '1', 'e.g., 30')}{err('meal_break_duration')}</div>
                    <div className="space-y-2"><Label>Must start by hour</Label>{numInput('meal_deadline_hours', '0.5', 'Off')}{err('meal_deadline_hours')}</div>
                    <div className="space-y-2"><Label>2nd meal after (hours)</Label>{numInput('second_meal_break_hours', '0.5', 'Off')}</div>
                  </div>
                  {toggleRow('meal_break_paid')}
                  {waiverRow('meal_waiver_max_hours', 'Meal waivers on file', 6)}
                  {form.second_meal_break_hours != null && waiverRow('second_meal_waiver_max_hours', '2nd meal waivers on file', 12)}
                </>
              )}
              <div className="border-t pt-4 grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Rest break every (hours)</Label>{numInput('rest_break_hours', '0.5', 'e.g., 4')}</div>
                <div className="space-y-2"><Label>Rest break length (minutes)</Label>{numInput('rest_break_duration', '1', 'e.g., 10')}</div>
              </div>
              {toggleRow('rest_break_paid')}
              {toggleRow('flag_rest_breaks', 'Show a flag when a shift is missing rest breaks')}
              <div className="space-y-2">
                <Label>Long-break grace (minutes)</Label>
                {numInput('long_break_grace_minutes', '1')}
                <p className="text-xs text-muted-foreground">{FIELD_META.long_break_grace_minutes.help}</p>
              </div>
              <p className="text-xs text-muted-foreground rounded-lg bg-muted/50 p-2">
                Breaks of {rules?.unpaid_break_min_minutes ?? 30}+ min are unpaid.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Long-shift limit (hours)</Label>{numInput('long_shift_hours')}</div>
                <div className="space-y-2"><Label>Min hours between shifts</Label>{numInput('min_hours_between_shifts', '0.5', 'Off')}</div>
              </div>
              {toggleRow('split_shift_enabled')}
              {form.split_shift_enabled && (
                <div className="space-y-2"><Label>Split shift when gap is over (minutes)</Label>{numInput('split_shift_gap_minutes', '5', 'e.g., 60')}</div>
              )}

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Daily Overtime Rules</h4>
                <p className="text-sm text-muted-foreground mb-3">Daily overtime calculated after unpaid meal breaks are deducted</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Daily Overtime After (hours)</Label>{numInput('daily_overtime_threshold')}<p className="text-xs text-muted-foreground">Typically 8 hours/day</p></div>
                  <div className="space-y-2"><Label>Daily Double Time After (hours)</Label>{numInput('daily_double_time_threshold')}<p className="text-xs text-muted-foreground">Typically 12 hours/day</p>{err('daily_double_time_threshold')}</div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Weekly Overtime Rules</h4>
                <p className="text-sm text-muted-foreground mb-3">Employee receives the higher of daily or weekly overtime</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Weekly Overtime After (hours)</Label>{numInput('weekly_overtime_threshold')}<p className="text-xs text-muted-foreground">Typically 40 hours/week</p></div>
                  <div className="space-y-2"><Label>Overtime Pay Multiplier</Label>{numInput('overtime_multiplier', '0.1')}<p className="text-xs text-muted-foreground">Typically 1.5x</p>{err('overtime_multiplier')}</div>
                  <div className="space-y-2"><Label>Double Time Pay Multiplier</Label>{numInput('double_time_multiplier', '0.1')}<p className="text-xs text-muted-foreground">Typically 2.0x</p>{err('double_time_multiplier')}</div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Payroll Export Rules</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="workweek-start">Workweek starts on</Label>
                    <select id="workweek-start" disabled={readOnly}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.workweek_start_dow ?? 1}
                      onChange={(e) => set('workweek_start_dow', parseInt(e.target.value, 10))}>
                      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                        <option key={d} value={i}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ot-window">Daily overtime counted per</Label>
                    <select id="ot-window" disabled={readOnly}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.daily_ot_window ?? 'business_day'}
                      onChange={(e) => set('daily_ot_window', e.target.value as 'business_day' | 'rolling_24h')}>
                      <option value="business_day">Business day</option>
                      <option value="rolling_24h">24 hours from first clock-in (Nevada)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ot-max-wage">No daily overtime at or above wage ($/hr)</Label>
                    {numInput('daily_ot_max_wage', '0.01', 'Leave blank for no cutoff')}
                    <p className="text-xs text-muted-foreground">Nevada: 1.5 × state minimum wage. Update when the minimum wage changes.</p>
                  </div>
                  <div className="space-y-2 flex items-center gap-2 pt-6">
                    <input id="seventh-day" type="checkbox" disabled={readOnly} checked={!!form.seventh_day_rule}
                      onChange={(e) => set('seventh_day_rule', e.target.checked)} />
                    <Label htmlFor="seventh-day">California 7th-day rule</Label>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2"><Calendar className="h-4 w-4" />Pay Period Configuration</h4>
                <p className="text-sm text-muted-foreground mb-3">Define how pay periods are calculated for this location</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pay-period-type">Pay Period Type</Label>
                    <Select value={form.pay_period_type} onValueChange={(value) => set('pay_period_type', value as any)} disabled={readOnly}>
                      <SelectTrigger id="pay-period-type"><SelectValue placeholder="Select pay period type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Biweekly (Every 2 Weeks)</SelectItem>
                        <SelectItem value="semimonthly">Semi-Monthly (1st & 15th)</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(form.pay_period_type === 'weekly' || form.pay_period_type === 'biweekly') && (
                    <div className="space-y-2">
                      <Label htmlFor="pay-period-start">Pay Period Start Date</Label>
                      <Input id="pay-period-start" type="date" disabled={readOnly} value={form.pay_period_start_date || ''}
                        onChange={(e) => set('pay_period_start_date', e.target.value || null)} />
                      <p className="text-xs text-muted-foreground">First day of a pay period</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2"><Clock className="h-4 w-4" />Clock-In Restrictions</h4>
                <p className="text-sm text-muted-foreground mb-4">Control when employees can clock in at this location</p>
                <div className="space-y-4">
                  {toggleRow('allow_unscheduled_clock_in', 'Allow employees to clock in without a scheduled shift (flagged for payroll review)')}
                  <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="allow-early" className="text-sm font-medium">Clock In Early</Label>
                        <p className="text-xs text-muted-foreground">Allow employees to clock in before their scheduled shift start time</p>
                      </div>
                      <Switch id="allow-early" disabled={readOnly} checked={form.allow_early_clock_in} onCheckedChange={(c) => set('allow_early_clock_in', c)} />
                    </div>
                    {form.allow_early_clock_in && (
                      <div className="pt-2 border-t">
                        <Label className="text-sm mb-2 block">How early can they clock in?</Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                          {EARLY_CLOCK_IN_PRESETS.map((mins) => (
                            <Button key={mins} type="button" size="sm" disabled={readOnly}
                              variant={form.early_clock_in_minutes === mins ? 'default' : 'outline'}
                              onClick={() => set('early_clock_in_minutes', mins)}>{mins} min</Button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor="custom-early" className="text-xs text-muted-foreground whitespace-nowrap">Custom:</Label>
                          <Input id="custom-early" type="number" min="1" max="120" className="w-20" disabled={readOnly}
                            value={form.early_clock_in_minutes}
                            onChange={(e) => set('early_clock_in_minutes', parseInt(e.target.value) || 30)} />
                          <span className="text-xs text-muted-foreground">minutes</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Auto Clock-Out</h4>
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground space-y-1">
                  <p>Open shifts close automatically {rules?.auto_clock_out_after_close_min ?? 180} min after the store's close time.</p>
                  <p className="text-xs">Shifts left open longer than {rules?.max_open_shift_hours ?? 16} h are treated as missing a clock-out. Set by the system; not editable here.</p>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <Label className="text-sm font-medium">Rules for team members under 18</Label>
                  <p className="text-xs text-muted-foreground">
                    {minorsQ.data ? `Applies to ${minorsQ.data.n} of ${minorsQ.data.m} people with a birthday on file.` : 'Optional.'}
                  </p>
                </div>
                <Switch disabled={readOnly} checked={form.minor_rules != null} onCheckedChange={(c) => set('minor_rules', c ? {} as any : null)} />
              </div>
              {form.minor_rules != null && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Max hours per day</Label>
                    <Input type="number" step="0.5" disabled={readOnly} value={(minor as any).max_daily_hours ?? ''} onChange={(e) => setMinor('max_daily_hours', numOrNull(e.target.value))} /></div>
                  <div className="space-y-2"><Label>Max hours per week</Label>
                    <Input type="number" step="0.5" disabled={readOnly} value={(minor as any).max_weekly_hours ?? ''} onChange={(e) => setMinor('max_weekly_hours', numOrNull(e.target.value))} /></div>
                  <div className="space-y-2"><Label>Latest end on a school night</Label>
                    <Input type="time" disabled={readOnly} value={(minor as any).latest_end_school_night ?? ''} onChange={(e) => setMinor('latest_end_school_night', e.target.value || null)} /></div>
                  <div className="space-y-2"><Label>Meal after (hours)</Label>
                    <Input type="number" step="0.5" disabled={readOnly} value={(minor as any).meal_after_hours ?? ''} onChange={(e) => setMinor('meal_after_hours', numOrNull(e.target.value))} /></div>
                  {err('minor_rules')}
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              {!parsed.success && (
                <p className="text-sm text-destructive">Fix the highlighted fields before saving ({Object.values(errors)[0]}).</p>
              )}
              {Object.keys(patch).length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes.</p>
              ) : (
                <div className="rounded-lg border divide-y">
                  {(EDITABLE_FIELDS.filter((f) => f in patch)).map((f) => (
                    <div key={f} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">{FIELD_META[f].label}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {fieldSource(f) && <Badge variant="outline" className="text-[10px]">{fieldSource(f)}</Badge>}
                        <span className="text-muted-foreground">{formatValue(f, current ? (current as any)[f] : null)}</span>
                        <span>→</span>
                        <span className="font-medium">{formatValue(f, (form as any)[f])}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {canEdit && Object.keys(patch).length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Last 14 days: {previewQ.isLoading ? 'checking…' : previewQ.isError ? 'preview unavailable' : previewLine}
                </p>
              )}
              {canEdit && (
                <div className="space-y-2">
                  <Label>Note (optional)</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the change" />
                </div>
              )}
              {!canEdit && <p className="text-sm text-muted-foreground">Only admins can change labor rules.</p>}
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={() => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1))}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
          ) : (
            <Button onClick={handleSave} disabled={!canEdit || saving || !parsed.success || Object.keys(patch).length === 0}>
              {saving ? 'Saving…' : 'Save rules'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
