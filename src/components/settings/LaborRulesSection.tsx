import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Scale, Settings2, History, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useUserRole } from '@/hooks/useUserRole';
import { useLaborRules, type LaborRulesHistoryRow } from '@/hooks/useLaborRules';
import { toForm } from '@/lib/laborRules/schema';
import { LaborRulesWizard } from './LaborRulesWizard';

interface LaborRulesSectionProps {
  locationId?: string;
}

interface LaborRulePreset {
  id: string;
  preset_name: string;
  state_code: string;
  daily_overtime_threshold: number;
  daily_double_time_threshold: number;
  weekly_overtime_threshold: number;
  overtime_multiplier: number;
  double_time_multiplier: number;
  meal_break_hours: number | null;
  meal_break_duration: number | null;
  rest_break_hours: number | null;
  rest_break_duration: number | null;
  reporting_time_enabled: boolean;
  reporting_time_min_hours: number | null;
  reporting_time_max_hours: number | null;
  meal_rule_basis: 'law' | 'company' | 'none';
  meal_break_paid: boolean;
  meal_deadline_hours: number | null;
  meal_waiver_max_hours: number | null;
  second_meal_break_hours: number | null;
  second_meal_waiver_max_hours: number | null;
  rest_break_paid: boolean;
  flag_rest_breaks: boolean;
  long_break_grace_minutes: number;
  long_shift_hours: number;
  min_hours_between_shifts: number | null;
  split_shift_enabled: boolean;
  split_shift_gap_minutes: number | null;
}

const PRESET_NUM_FIELDS: [keyof LaborRulePreset, string][] = [
  ['meal_deadline_hours', 'Meal must start by (hrs)'],
  ['meal_waiver_max_hours', 'Meal waiver up to (hrs)'],
  ['second_meal_break_hours', '2nd meal after (hrs)'],
  ['second_meal_waiver_max_hours', '2nd meal waiver up to (hrs)'],
  ['long_break_grace_minutes', 'Long-break grace (min)'],
  ['long_shift_hours', 'Long-shift limit (hrs)'],
  ['min_hours_between_shifts', 'Min hrs between shifts'],
  ['split_shift_gap_minutes', 'Split-shift gap (min)'],
];
const PRESET_BOOL_FIELDS: [keyof LaborRulePreset, string][] = [
  ['meal_break_paid', 'Meal paid'],
  ['rest_break_paid', 'Rest paid'],
  ['flag_rest_breaks', 'Flag rest breaks'],
  ['split_shift_enabled', 'Split shift'],
];

const emptyPreset: Omit<LaborRulePreset, 'id'> = {
  preset_name: '',
  state_code: '',
  daily_overtime_threshold: 8,
  daily_double_time_threshold: 12,
  weekly_overtime_threshold: 40,
  overtime_multiplier: 1.5,
  double_time_multiplier: 2.0,
  meal_break_hours: null,
  meal_break_duration: null,
  rest_break_hours: null,
  rest_break_duration: null,
  reporting_time_enabled: false,
  reporting_time_min_hours: null,
  reporting_time_max_hours: null,
  meal_rule_basis: 'law',
  meal_break_paid: false,
  meal_deadline_hours: null,
  meal_waiver_max_hours: null,
  second_meal_break_hours: null,
  second_meal_waiver_max_hours: null,
  rest_break_paid: true,
  flag_rest_breaks: false,
  long_break_grace_minutes: 5,
  long_shift_hours: 10,
  min_hours_between_shifts: null,
  split_shift_enabled: false,
  split_shift_gap_minutes: null,
};

const presetFields = (p: any): Omit<LaborRulePreset, 'id'> => {
  const out: any = {};
  (Object.keys(emptyPreset) as (keyof typeof emptyPreset)[]).forEach((k) => { out[k] = p[k] ?? (emptyPreset as any)[k]; });
  return out;
};

const SOURCE_LABEL: Record<string, string> = { manual: 'Manual', preset: 'Preset', migration: 'Migration', ai: 'AI' };

export const LaborRulesSection = ({ locationId }: LaborRulesSectionProps) => {
  const { rules, presets, history, canEdit, save, refetchPresets } = useLaborRules(locationId);
  const { isSuperAdmin } = useUserRole();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitial, setWizardInitial] = useState<{ values: any; source: 'manual' | 'preset' } | null>(null);

  // Preset management state
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<LaborRulePreset | null>(null);
  const [presetForm, setPresetForm] = useState<Omit<LaborRulePreset, 'id'>>(emptyPreset);
  const [presetFormOpen, setPresetFormOpen] = useState(false);
  const [presetLoading, setPresetLoading] = useState(false);

  const reviewerQ = useQuery({
    queryKey: ['labor-rules', 'reviewer', rules?.rules_reviewed_by],
    enabled: !!rules?.rules_reviewed_by,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', rules!.rules_reviewed_by).maybeSingle();
      return data?.full_name as string | undefined;
    },
  });

  const openWizard = (initial?: { values: any; source: 'manual' | 'preset' } | null) => {
    setWizardInitial(initial ?? null);
    setWizardOpen(true);
  };

  /** Fills the wizard with a preset; nothing saves until the review step. */
  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    openWizard({ values: { ...preset, rule_name: preset.preset_name }, source: 'preset' });
  };

  const handleRevert = async (h: LaborRulesHistoryRow) => {
    if (!h.after) return;
    if (!confirm(`Revert labor rules to ${format(new Date(h.changed_at), 'MMM d, yyyy h:mm a')}?`)) return;
    await save(toForm(h.after, rules ? toForm(rules) : undefined), 'manual', `Revert to ${format(new Date(h.changed_at), 'yyyy-MM-dd HH:mm')}`);
  };

  // ========== Preset Management (super admin; writes labor_rule_presets) ==========
  const handleOpenPresetForm = (preset?: LaborRulePreset) => {
    if (preset) {
      setEditingPreset(preset);
      setPresetForm(presetFields(preset));
    } else {
      setEditingPreset(null);
      setPresetForm(emptyPreset);
    }
    setPresetFormOpen(true);
  };

  const handleSavePreset = async () => {
    if (!presetForm.preset_name.trim() || !presetForm.state_code.trim()) {
      toast.error('Please fill in preset name and state code');
      return;
    }
    try {
      setPresetLoading(true);
      if (editingPreset) {
        const { error } = await supabase
          .from('labor_rule_presets')
          .update({ ...presetForm, updated_at: new Date().toISOString() } as any)
          .eq('id', editingPreset.id);
        if (error) throw error;
        toast.success('Preset updated');
      } else {
        const { error } = await supabase
          .from('labor_rule_presets')
          .insert({ ...presetForm, is_system: true } as any);
        if (error) throw error;
        toast.success('Preset created');
      }
      setPresetFormOpen(false);
      setEditingPreset(null);
      refetchPresets();
    } catch (error: any) {
      console.error('Error saving preset:', error);
      toast.error('Failed to save preset');
    } finally {
      setPresetLoading(false);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!confirm('Are you sure you want to delete this preset? This won\'t affect locations already using these rules.')) return;
    try {
      const { error } = await supabase
        .from('labor_rule_presets')
        .delete()
        .eq('id', presetId);
      if (error) throw error;
      toast.success('Preset deleted');
      refetchPresets();
    } catch (error: any) {
      console.error('Error deleting preset:', error);
      toast.error('Failed to delete preset');
    }
  };

  if (!locationId) {
    return null;
  }

  const fs = (rules?.field_sources || {}) as Record<string, { source?: string }>;
  const sources = Array.from(new Set(Object.values(fs).map((v) => v?.source).filter(Boolean))) as string[];

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 shrink-0" />
              Labor Rules
            </CardTitle>
            <CardDescription>
              Overtime, breaks, and shift flags for this location
            </CardDescription>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 italic">
              ⚠️ Labor rules are customized by the user and should be confirmed with local jurisdiction before applying.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {isSuperAdmin && (
              <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" onClick={() => { setPresetFormOpen(false); setPresetDialogOpen(true); }}>
                    <Settings2 className="h-4 w-4 mr-2" />
                    Manage Presets
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Manage Labor Rule Presets</DialogTitle>
                    <DialogDescription>
                      Global presets available to all locations. Changes here don't affect locations already using these rules.
                    </DialogDescription>
                  </DialogHeader>

                  {presetFormOpen ? (
                    <div className="space-y-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Preset Name</Label>
                          <Input
                            placeholder="e.g., California Rules"
                            value={presetForm.preset_name}
                            onChange={(e) => setPresetForm({...presetForm, preset_name: e.target.value})}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>State Code</Label>
                          <Input
                            placeholder="e.g., CA"
                            value={presetForm.state_code}
                            onChange={(e) => setPresetForm({...presetForm, state_code: e.target.value.toUpperCase()})}
                          />
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="font-semibold mb-3 text-sm">Overtime Thresholds</h4>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Daily OT (hrs)</Label>
                            <Input type="number" step="0.5" value={presetForm.daily_overtime_threshold}
                              onChange={(e) => setPresetForm({...presetForm, daily_overtime_threshold: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Daily DT (hrs)</Label>
                            <Input type="number" step="0.5" value={presetForm.daily_double_time_threshold}
                              onChange={(e) => setPresetForm({...presetForm, daily_double_time_threshold: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Weekly OT (hrs)</Label>
                            <Input type="number" step="0.5" value={presetForm.weekly_overtime_threshold}
                              onChange={(e) => setPresetForm({...presetForm, weekly_overtime_threshold: parseFloat(e.target.value)})} />
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="font-semibold mb-3 text-sm">Pay Multipliers</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">OT Multiplier</Label>
                            <Input type="number" step="0.1" value={presetForm.overtime_multiplier}
                              onChange={(e) => setPresetForm({...presetForm, overtime_multiplier: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">DT Multiplier</Label>
                            <Input type="number" step="0.1" value={presetForm.double_time_multiplier}
                              onChange={(e) => setPresetForm({...presetForm, double_time_multiplier: parseFloat(e.target.value)})} />
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="font-semibold mb-3 text-sm">Break Requirements (Optional)</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Meal After (hrs)</Label>
                            <Input type="number" step="0.5" placeholder="e.g., 5"
                              value={presetForm.meal_break_hours || ''}
                              onChange={(e) => setPresetForm({...presetForm, meal_break_hours: e.target.value ? parseFloat(e.target.value) : null})} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Meal Duration (min)</Label>
                            <Input type="number" placeholder="e.g., 30"
                              value={presetForm.meal_break_duration || ''}
                              onChange={(e) => setPresetForm({...presetForm, meal_break_duration: e.target.value ? parseInt(e.target.value) : null})} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Rest After (hrs)</Label>
                            <Input type="number" step="0.5" placeholder="e.g., 4"
                              value={presetForm.rest_break_hours || ''}
                              onChange={(e) => setPresetForm({...presetForm, rest_break_hours: e.target.value ? parseFloat(e.target.value) : null})} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Rest Duration (min)</Label>
                            <Input type="number" placeholder="e.g., 10"
                              value={presetForm.rest_break_duration || ''}
                              onChange={(e) => setPresetForm({...presetForm, rest_break_duration: e.target.value ? parseInt(e.target.value) : null})} />
                          </div>
                        </div>
                      </div>

                      <div className="border-t pt-4">
                        <h4 className="font-semibold mb-3 text-sm">Reporting Time Pay</h4>
                        <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg mb-3">
                          <div className="space-y-0.5">
                            <Label className="text-xs font-medium">Reporting Time Pay Required</Label>
                            <p className="text-[10px] text-muted-foreground">Minimum pay when employee is called in but sent home early</p>
                          </div>
                          <Switch
                            checked={presetForm.reporting_time_enabled}
                            onCheckedChange={(checked) => setPresetForm({...presetForm, reporting_time_enabled: checked})}
                          />
                        </div>
                        {presetForm.reporting_time_enabled && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Min Hours Paid</Label>
                              <Input type="number" step="0.5" placeholder="e.g., 2"
                                value={presetForm.reporting_time_min_hours || ''}
                                onChange={(e) => setPresetForm({...presetForm, reporting_time_min_hours: e.target.value ? parseFloat(e.target.value) : null})} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Max Hours Cap</Label>
                              <Input type="number" step="0.5" placeholder="No cap"
                                value={presetForm.reporting_time_max_hours || ''}
                                onChange={(e) => setPresetForm({...presetForm, reporting_time_max_hours: e.target.value ? parseFloat(e.target.value) : null})} />
                            </div>
                          </div>
                        )}
                      </div>


                      <div className="border-t pt-4">
                        <h4 className="font-semibold mb-3 text-sm">Meal, Rest &amp; Shift Flags</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Meal rule basis</Label>
                            <select className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                              value={presetForm.meal_rule_basis}
                              onChange={(e) => setPresetForm({...presetForm, meal_rule_basis: e.target.value as any})}>
                              <option value="law">Law</option>
                              <option value="company">Company policy</option>
                              <option value="none">None</option>
                            </select>
                          </div>
                          {PRESET_NUM_FIELDS.map(([k, label]) => (
                            <div key={k} className="space-y-1">
                              <Label className="text-xs">{label}</Label>
                              <Input type="number" step="0.5" placeholder="Off"
                                value={(presetForm as any)[k] ?? ''}
                                onChange={(e) => setPresetForm({...presetForm, [k]: e.target.value === '' ? null : Number(e.target.value)})} />
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3">
                          {PRESET_BOOL_FIELDS.map(([k, label]) => (
                            <div key={k} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                              <Label className="text-xs">{label}</Label>
                              <Switch checked={!!(presetForm as any)[k]} onCheckedChange={(c) => setPresetForm({...presetForm, [k]: c})} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setPresetFormOpen(false)}>Back</Button>
                        <Button onClick={handleSavePreset} disabled={presetLoading}>
                          {presetLoading ? 'Saving...' : editingPreset ? 'Update Preset' : 'Create Preset'}
                        </Button>
                      </DialogFooter>
                    </div>
                  ) : (
                    <div className="space-y-3 py-4">
                      <Button size="sm" onClick={() => handleOpenPresetForm()} className="w-full">
                        <Plus className="h-4 w-4 mr-2" />
                        Add New Preset
                      </Button>

                      {presets.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No presets yet.</p>
                      ) : (
                        presets.map((preset) => (
                          <div key={preset.id} className="border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-semibold text-sm">{preset.preset_name}</h4>
                                <p className="text-xs text-muted-foreground">State: {preset.state_code}</p>
                              </div>
                              <div className="flex gap-1">
                                {canEdit && (
                                  <Button variant="ghost" size="sm" onClick={() => { setPresetDialogOpen(false); handleApplyPreset(preset.id); }}>
                                    Use
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" onClick={() => handleOpenPresetForm(preset)}>
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeletePreset(preset.id)}
                                  className="text-destructive hover:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-x-4 text-xs text-muted-foreground">
                              <span>Daily OT: {preset.daily_overtime_threshold}h</span>
                              <span>Daily DT: {preset.daily_double_time_threshold}h</span>
                              <span>Weekly OT: {preset.weekly_overtime_threshold}h</span>
                              <span>OT: {preset.overtime_multiplier}x</span>
                              <span>DT: {preset.double_time_multiplier}x</span>
                              {preset.meal_break_hours && (
                                <span>Meal: {preset.meal_break_duration}min/{preset.meal_break_hours}h</span>
                              )}
                              {preset.reporting_time_enabled && (
                                <span>Report: min {preset.reporting_time_min_hours}h{preset.reporting_time_max_hours ? `, max ${preset.reporting_time_max_hours}h` : ''}</span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            )}
            <Button size="sm" onClick={() => openWizard(null)}>
              <Edit className="h-4 w-4 mr-2" />
              {canEdit ? 'Edit rules' : 'View rules'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!rules ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No labor rules yet for this store.{canEdit ? ' Use Edit rules to set them up.' : ''}
          </p>
        ) : (
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold">{rules.rule_name}</h4>
                <p className="text-sm text-muted-foreground">State: {rules.state_code || '—'}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {sources.map((s) => <Badge key={s} variant="outline" className="text-[10px]">{SOURCE_LABEL[s] || s}</Badge>)}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-2 text-sm [&>div]:min-w-0 [&>div]:break-words">
              <div><span className="text-muted-foreground">Daily OT:</span> After {rules.daily_overtime_threshold}h at {rules.overtime_multiplier}x</div>
              <div><span className="text-muted-foreground">Daily DT:</span> After {rules.daily_double_time_threshold}h at {rules.double_time_multiplier}x</div>
              <div><span className="text-muted-foreground">Weekly OT:</span> After {rules.weekly_overtime_threshold}h</div>
              <div>
                <span className="text-muted-foreground">Meal:</span>{' '}
                {rules.meal_rule_basis === 'none' || rules.meal_break_hours == null
                  ? 'No meal rule'
                  : `${rules.meal_break_duration ?? 30} min after ${rules.meal_break_hours}h${rules.meal_rule_basis === 'company' ? ' (policy)' : ''}`}
                {rules.second_meal_break_hours != null && ` · 2nd after ${rules.second_meal_break_hours}h`}
              </div>
              {rules.rest_break_hours != null && (
                <div><span className="text-muted-foreground">Rest:</span> {rules.rest_break_duration} min every {rules.rest_break_hours}h</div>
              )}
              <div><span className="text-muted-foreground">Long shift:</span> over {rules.long_shift_hours}h</div>
              <div className="col-span-2 border-t pt-2 mt-2">
                <span className="text-muted-foreground">Clock-In:</span>{' '}
                {rules.allow_unscheduled_clock_in ? 'Allowed without schedule' : 'Requires scheduled shift'}
                {' • '}
                {rules.allow_early_clock_in ? `Up to ${rules.early_clock_in_minutes} min early` : 'No early clock-in'}
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                {rules.rules_reviewed_at
                  ? `Last reviewed ${format(new Date(rules.rules_reviewed_at), 'MMM d, yyyy')}${reviewerQ.data ? ` by ${reviewerQ.data}` : ''}`
                  : 'Not reviewed by a person yet'}
              </div>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" /> History</h4>
            <div className="rounded-lg border divide-y">
              {history.map((h) => {
                const changed = h.before && h.after
                  ? Object.keys(h.after).filter((k) => !['updated_at', 'field_sources', 'rules_reviewed_at', 'rules_reviewed_by'].includes(k) && JSON.stringify(h.before![k]) !== JSON.stringify(h.after![k]))
                  : [];
                return (
                  <div key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div>
                        {format(new Date(h.changed_at), 'MMM d, yyyy h:mm a')}{' '}
                        <Badge variant="outline" className="text-[10px] ml-1">{SOURCE_LABEL[h.source] || h.source}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {h.note || (h.before ? `${changed.length} field${changed.length === 1 ? '' : 's'} changed` : 'Created')}
                      </div>
                    </div>
                    {canEdit && h.after && (
                      <Button size="sm" variant="ghost" onClick={() => handleRevert(h)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Revert to this
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      <LaborRulesWizard locationId={locationId} open={wizardOpen} onOpenChange={setWizardOpen} initial={wizardInitial} />
    </Card>
  );
};
