import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Scale, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface LaborRulesSectionProps {
  locationId?: string;
}

interface LaborRule {
  id?: string;
  location_id?: string;
  rule_name: string;
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
  auto_punch_out_time: string | null;
  pay_period_type: string;
  pay_period_start_date: string | null;
  allow_unscheduled_clock_in: boolean;
  allow_early_clock_in: boolean;
  early_clock_in_minutes: number;
}

const EARLY_CLOCK_IN_PRESETS = [5, 10, 15, 30];

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
}

export const LaborRulesSection = ({ locationId }: LaborRulesSectionProps) => {
  const [rules, setRules] = useState<LaborRule[]>([]);
  const [presets, setPresets] = useState<LaborRulePreset[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LaborRule | null>(null);
  const [loading, setLoading] = useState(false);

  const emptyRule: LaborRule = {
    rule_name: '',
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
    auto_punch_out_time: null,
    pay_period_type: 'biweekly',
    pay_period_start_date: null,
    allow_unscheduled_clock_in: true,
    allow_early_clock_in: true,
    early_clock_in_minutes: 30,
  };

  const [formData, setFormData] = useState<LaborRule>(emptyRule);

  useEffect(() => {
    if (locationId) {
      fetchRules();
    }
    fetchPresets();
  }, [locationId]);

  const fetchPresets = async () => {
    try {
      const { data, error } = await supabase
        .from('labor_rule_presets')
        .select('*')
        .eq('is_system', true)
        .order('preset_name');
      if (error) throw error;
      setPresets(data || []);
    } catch (error: any) {
      console.error('Error fetching presets:', error);
    }
  };

  const fetchRules = async () => {
    if (!locationId) return;

    try {
      const { data, error } = await supabase
        .from('labor_rules')
        .select('*')
        .eq('location_id', locationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setRules(data || []);
    } catch (error: any) {
      console.error('Error fetching labor rules:', error);
      toast.error('Failed to load labor rules');
    }
  };

  const handleOpenDialog = (rule?: LaborRule) => {
    if (rule) {
      setEditingRule(rule);
      setFormData(rule);
    } else {
      setEditingRule(null);
      setFormData(emptyRule);
    }
    setDialogOpen(true);
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    setFormData(prev => ({
      ...prev,
      rule_name: preset.preset_name,
      state_code: preset.state_code,
      daily_overtime_threshold: preset.daily_overtime_threshold,
      daily_double_time_threshold: preset.daily_double_time_threshold,
      weekly_overtime_threshold: preset.weekly_overtime_threshold,
      overtime_multiplier: preset.overtime_multiplier,
      double_time_multiplier: preset.double_time_multiplier,
      meal_break_hours: preset.meal_break_hours,
      meal_break_duration: preset.meal_break_duration,
      rest_break_hours: preset.rest_break_hours,
      rest_break_duration: preset.rest_break_duration,
    }));
    toast.success(`Applied "${preset.preset_name}" preset`);
  };

  const handleSave = async () => {
    if (!locationId || !formData.rule_name.trim() || !formData.state_code.trim()) {
      toast.error('Please fill in rule name and state code');
      return;
    }

    try {
      setLoading(true);

      if (editingRule) {
        // Update existing rule
        const { error } = await supabase
          .from('labor_rules')
          .update({
            rule_name: formData.rule_name,
            state_code: formData.state_code,
            daily_overtime_threshold: formData.daily_overtime_threshold,
            daily_double_time_threshold: formData.daily_double_time_threshold,
            weekly_overtime_threshold: formData.weekly_overtime_threshold,
            overtime_multiplier: formData.overtime_multiplier,
            double_time_multiplier: formData.double_time_multiplier,
            meal_break_hours: formData.meal_break_hours,
            meal_break_duration: formData.meal_break_duration,
            rest_break_hours: formData.rest_break_hours,
            rest_break_duration: formData.rest_break_duration,
            auto_punch_out_time: formData.auto_punch_out_time,
            pay_period_type: formData.pay_period_type,
            pay_period_start_date: formData.pay_period_start_date,
            allow_unscheduled_clock_in: formData.allow_unscheduled_clock_in,
            allow_early_clock_in: formData.allow_early_clock_in,
            early_clock_in_minutes: formData.early_clock_in_minutes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRule.id);

        if (error) throw error;
        toast.success('Labor rule updated');
      } else {
        // Create new rule
        const { error } = await supabase
          .from('labor_rules')
          .insert({
            location_id: locationId,
            rule_name: formData.rule_name,
            state_code: formData.state_code,
            daily_overtime_threshold: formData.daily_overtime_threshold,
            daily_double_time_threshold: formData.daily_double_time_threshold,
            weekly_overtime_threshold: formData.weekly_overtime_threshold,
            overtime_multiplier: formData.overtime_multiplier,
            double_time_multiplier: formData.double_time_multiplier,
            meal_break_hours: formData.meal_break_hours,
            meal_break_duration: formData.meal_break_duration,
            rest_break_hours: formData.rest_break_hours,
            rest_break_duration: formData.rest_break_duration,
            auto_punch_out_time: formData.auto_punch_out_time,
            pay_period_type: formData.pay_period_type,
            pay_period_start_date: formData.pay_period_start_date,
            allow_unscheduled_clock_in: formData.allow_unscheduled_clock_in,
            allow_early_clock_in: formData.allow_early_clock_in,
            early_clock_in_minutes: formData.early_clock_in_minutes,
          });

        if (error) throw error;
        toast.success('Labor rule created');
      }

      setDialogOpen(false);
      fetchRules();
    } catch (error: any) {
      console.error('Error saving labor rule:', error);
      toast.error('Failed to save labor rule');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this labor rule?')) return;

    try {
      const { error } = await supabase
        .from('labor_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;
      toast.success('Labor rule deleted');
      fetchRules();
    } catch (error: any) {
      console.error('Error deleting labor rule:', error);
      toast.error('Failed to delete labor rule');
    }
  };

  if (!locationId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Labor Rules
            </CardTitle>
            <CardDescription>
              Define overtime, breaks, and labor calculation rules for this location
            </CardDescription>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 italic">
              ⚠️ Labor rules are customized by the user and should be confirmed with local jurisdiction before applying.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => handleOpenDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingRule ? 'Edit Labor Rule' : 'Create Labor Rule'}</DialogTitle>
                <DialogDescription>
                  Configure labor calculation rules based on state requirements
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {!editingRule && presets.length > 0 && (
                  <div className="space-y-2">
                    <Label>Apply a Preset</Label>
                    <Select onValueChange={handleApplyPreset}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a preset to auto-fill..." />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.preset_name} ({p.state_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Fills in all fields below — you can still customize before saving.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rule-name">Rule Name</Label>
                    <Input
                      id="rule-name"
                      placeholder="e.g., California Rules"
                      value={formData.rule_name}
                      onChange={(e) => setFormData({...formData, rule_name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state-code">State Code</Label>
                    <Input
                      id="state-code"
                      placeholder="e.g., CA"
                      value={formData.state_code}
                      onChange={(e) => setFormData({...formData, state_code: e.target.value.toUpperCase()})}
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Daily Overtime Rules</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Daily overtime calculated after unpaid meal breaks are deducted
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="daily-ot-threshold">Daily Overtime After (hours)</Label>
                      <Input
                        id="daily-ot-threshold"
                        type="number"
                        step="0.5"
                        value={formData.daily_overtime_threshold}
                        onChange={(e) => setFormData({...formData, daily_overtime_threshold: parseFloat(e.target.value)})}
                      />
                      <p className="text-xs text-muted-foreground">Typically 8 hours/day</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="daily-dt-threshold">Daily Double Time After (hours)</Label>
                      <Input
                        id="daily-dt-threshold"
                        type="number"
                        step="0.5"
                        value={formData.daily_double_time_threshold}
                        onChange={(e) => setFormData({...formData, daily_double_time_threshold: parseFloat(e.target.value)})}
                      />
                      <p className="text-xs text-muted-foreground">Typically 12 hours/day</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Weekly Overtime Rules</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Employee receives the higher of daily or weekly overtime
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="weekly-ot-threshold">Weekly Overtime After (hours)</Label>
                      <Input
                        id="weekly-ot-threshold"
                        type="number"
                        step="0.5"
                        value={formData.weekly_overtime_threshold}
                        onChange={(e) => setFormData({...formData, weekly_overtime_threshold: parseFloat(e.target.value)})}
                      />
                      <p className="text-xs text-muted-foreground">Typically 40 hours/week</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ot-multiplier">Overtime Pay Multiplier</Label>
                      <Input
                        id="ot-multiplier"
                        type="number"
                        step="0.1"
                        value={formData.overtime_multiplier}
                        onChange={(e) => setFormData({...formData, overtime_multiplier: parseFloat(e.target.value)})}
                      />
                      <p className="text-xs text-muted-foreground">Typically 1.5x</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Pay Multipliers</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="dt-multiplier">Double Time Pay Multiplier</Label>
                      <Input
                        id="dt-multiplier"
                        type="number"
                        step="0.1"
                        value={formData.double_time_multiplier}
                        onChange={(e) => setFormData({...formData, double_time_multiplier: parseFloat(e.target.value)})}
                      />
                      <p className="text-xs text-muted-foreground">Typically 2.0x</p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Meal Break Requirements (Optional)</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="meal-hours">Required After (hours)</Label>
                      <Input
                        id="meal-hours"
                        type="number"
                        step="0.5"
                        placeholder="e.g., 5"
                        value={formData.meal_break_hours || ''}
                        onChange={(e) => setFormData({...formData, meal_break_hours: e.target.value ? parseFloat(e.target.value) : null})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="meal-duration">Break Duration (minutes)</Label>
                      <Input
                        id="meal-duration"
                        type="number"
                        placeholder="e.g., 30"
                        value={formData.meal_break_duration || ''}
                        onChange={(e) => setFormData({...formData, meal_break_duration: e.target.value ? parseInt(e.target.value) : null})}
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Rest Break Requirements (Optional)</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="rest-hours">Required After (hours)</Label>
                      <Input
                        id="rest-hours"
                        type="number"
                        step="0.5"
                        placeholder="e.g., 4"
                        value={formData.rest_break_hours || ''}
                        onChange={(e) => setFormData({...formData, rest_break_hours: e.target.value ? parseFloat(e.target.value) : null})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rest-duration">Break Duration (minutes)</Label>
                      <Input
                        id="rest-duration"
                        type="number"
                        placeholder="e.g., 10"
                        value={formData.rest_break_duration || ''}
                        onChange={(e) => setFormData({...formData, rest_break_duration: e.target.value ? parseInt(e.target.value) : null})}
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Pay Period Configuration
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Define how pay periods are calculated for this location
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pay-period-type">Pay Period Type</Label>
                      <Select
                        value={formData.pay_period_type}
                        onValueChange={(value) => setFormData({...formData, pay_period_type: value})}
                      >
                        <SelectTrigger id="pay-period-type">
                          <SelectValue placeholder="Select pay period type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="biweekly">Biweekly (Every 2 Weeks)</SelectItem>
                          <SelectItem value="semimonthly">Semi-Monthly (1st & 15th)</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(formData.pay_period_type === 'weekly' || formData.pay_period_type === 'biweekly') && (
                      <div className="space-y-2">
                        <Label htmlFor="pay-period-start">Pay Period Start Date</Label>
                        <Input
                          id="pay-period-start"
                          type="date"
                          value={formData.pay_period_start_date || ''}
                          onChange={(e) => setFormData({...formData, pay_period_start_date: e.target.value || null})}
                        />
                        <p className="text-xs text-muted-foreground">First day of a pay period</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Clock-In Restrictions
                  </h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Control when employees can clock in at this location
                  </p>
                  
                  <div className="space-y-4">
                    {/* Clock In When Not Scheduled */}
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="space-y-0.5">
                        <Label htmlFor="allow-unscheduled" className="text-sm font-medium">
                          Clock In When Not Scheduled
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Allow employees to clock in without a scheduled shift (flagged for payroll review)
                        </p>
                      </div>
                      <Switch
                        id="allow-unscheduled"
                        checked={formData.allow_unscheduled_clock_in}
                        onCheckedChange={(checked) => setFormData({...formData, allow_unscheduled_clock_in: checked})}
                      />
                    </div>

                    {/* Clock In Early */}
                    <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="allow-early" className="text-sm font-medium">
                            Clock In Early
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Allow employees to clock in before their scheduled shift start time
                          </p>
                        </div>
                        <Switch
                          id="allow-early"
                          checked={formData.allow_early_clock_in}
                          onCheckedChange={(checked) => setFormData({...formData, allow_early_clock_in: checked})}
                        />
                      </div>
                      
                      {formData.allow_early_clock_in && (
                        <div className="pt-2 border-t">
                          <Label className="text-sm mb-2 block">How early can they clock in?</Label>
                          <div className="flex flex-wrap gap-2 mb-2">
                            {EARLY_CLOCK_IN_PRESETS.map((mins) => (
                              <Button
                                key={mins}
                                type="button"
                                size="sm"
                                variant={formData.early_clock_in_minutes === mins ? "default" : "outline"}
                                onClick={() => setFormData({...formData, early_clock_in_minutes: mins})}
                              >
                                {mins} min
                              </Button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <Label htmlFor="custom-early" className="text-xs text-muted-foreground whitespace-nowrap">
                              Custom:
                            </Label>
                            <Input
                              id="custom-early"
                              type="number"
                              min="1"
                              max="120"
                              className="w-20"
                              value={formData.early_clock_in_minutes}
                              onChange={(e) => setFormData({...formData, early_clock_in_minutes: parseInt(e.target.value) || 30})}
                            />
                            <span className="text-xs text-muted-foreground">minutes</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Auto Punch-Out</h4>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-sm text-muted-foreground">
                      Auto punch-out is now automatically calculated as <strong>close time + 3 hours</strong> based on your Business Hours settings.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      This ensures a unified "business day" across all systems (time tracking, checklists, logbook, etc.)
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={loading}>
                  {loading ? 'Saving...' : 'Save Rule'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No labor rules configured yet. Add your first rule to define overtime and break requirements.
          </p>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold">{rule.rule_name}</h4>
                    <p className="text-sm text-muted-foreground">State: {rule.state_code}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenDialog(rule)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(rule.id!)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Pay Period:</span> {
                      rule.pay_period_type === 'weekly' ? 'Weekly' :
                      rule.pay_period_type === 'biweekly' ? 'Biweekly' :
                      rule.pay_period_type === 'semimonthly' ? 'Semi-Monthly (1st & 15th)' :
                      rule.pay_period_type === 'monthly' ? 'Monthly' : 'Biweekly'
                    }
                  </div>
                  {rule.pay_period_start_date && (
                    <div>
                      <span className="text-muted-foreground">Start Date:</span> {format(new Date(rule.pay_period_start_date), 'MMM d, yyyy')}
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Daily OT:</span> After {rule.daily_overtime_threshold}h at {rule.overtime_multiplier}x
                  </div>
                  <div>
                    <span className="text-muted-foreground">Daily DT:</span> After {rule.daily_double_time_threshold}h at {rule.double_time_multiplier}x
                  </div>
                  <div>
                    <span className="text-muted-foreground">Weekly OT:</span> After {rule.weekly_overtime_threshold}h at {rule.overtime_multiplier}x
                  </div>
                  <div>
                    <span className="text-muted-foreground">Higher of daily/weekly applies</span>
                  </div>
                  {rule.meal_break_hours && (
                    <div>
                      <span className="text-muted-foreground">Meal Break:</span> {rule.meal_break_duration}min after {rule.meal_break_hours}h
                    </div>
                  )}
                  {rule.rest_break_hours && (
                    <div>
                      <span className="text-muted-foreground">Rest Break:</span> {rule.rest_break_duration}min after {rule.rest_break_hours}h
                    </div>
                  )}
                  <div className="col-span-2 border-t pt-2 mt-2">
                    <span className="text-muted-foreground">Clock-In:</span>{' '}
                    {rule.allow_unscheduled_clock_in ? 'Allowed without schedule' : 'Requires scheduled shift'}
                    {' • '}
                    {rule.allow_early_clock_in 
                      ? `Up to ${rule.early_clock_in_minutes} min early` 
                      : 'No early clock-in'}
                  </div>
                  <div className="col-span-2 text-xs text-muted-foreground italic">
                    Auto punch-out: Close time + 3 hours (from Business Hours)
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
