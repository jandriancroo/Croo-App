import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Edit, Trash2, Scale } from 'lucide-react';

interface LaborRulesSectionProps {
  locationId?: string;
}

interface LaborRule {
  id?: string;
  location_id?: string;
  rule_name: string;
  state_code: string;
  overtime_threshold: number;
  overtime_multiplier: number;
  double_time_threshold: number | null;
  double_time_multiplier: number;
  meal_break_hours: number | null;
  meal_break_duration: number | null;
  rest_break_hours: number | null;
  rest_break_duration: number | null;
}

export const LaborRulesSection = ({ locationId }: LaborRulesSectionProps) => {
  const [rules, setRules] = useState<LaborRule[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LaborRule | null>(null);
  const [loading, setLoading] = useState(false);

  const emptyRule: LaborRule = {
    rule_name: '',
    state_code: '',
    overtime_threshold: 40,
    overtime_multiplier: 1.5,
    double_time_threshold: null,
    double_time_multiplier: 2.0,
    meal_break_hours: null,
    meal_break_duration: null,
    rest_break_hours: null,
    rest_break_duration: null,
  };

  const [formData, setFormData] = useState<LaborRule>(emptyRule);

  useEffect(() => {
    if (locationId) {
      fetchRules();
    }
  }, [locationId]);

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
            overtime_threshold: formData.overtime_threshold,
            overtime_multiplier: formData.overtime_multiplier,
            double_time_threshold: formData.double_time_threshold,
            double_time_multiplier: formData.double_time_multiplier,
            meal_break_hours: formData.meal_break_hours,
            meal_break_duration: formData.meal_break_duration,
            rest_break_hours: formData.rest_break_hours,
            rest_break_duration: formData.rest_break_duration,
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
            overtime_threshold: formData.overtime_threshold,
            overtime_multiplier: formData.overtime_multiplier,
            double_time_threshold: formData.double_time_threshold,
            double_time_multiplier: formData.double_time_multiplier,
            meal_break_hours: formData.meal_break_hours,
            meal_break_duration: formData.meal_break_duration,
            rest_break_hours: formData.rest_break_hours,
            rest_break_duration: formData.rest_break_duration,
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
                  <h4 className="font-semibold mb-3">Overtime Rules</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ot-threshold">Overtime Starts After (hours)</Label>
                      <Input
                        id="ot-threshold"
                        type="number"
                        step="0.5"
                        value={formData.overtime_threshold}
                        onChange={(e) => setFormData({...formData, overtime_threshold: parseFloat(e.target.value)})}
                      />
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
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-3">Double Time Rules (Optional)</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="dt-threshold">Double Time Starts After (hours)</Label>
                      <Input
                        id="dt-threshold"
                        type="number"
                        step="0.5"
                        placeholder="Leave empty if N/A"
                        value={formData.double_time_threshold || ''}
                        onChange={(e) => setFormData({...formData, double_time_threshold: e.target.value ? parseFloat(e.target.value) : null})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dt-multiplier">Double Time Pay Multiplier</Label>
                      <Input
                        id="dt-multiplier"
                        type="number"
                        step="0.1"
                        value={formData.double_time_multiplier}
                        onChange={(e) => setFormData({...formData, double_time_multiplier: parseFloat(e.target.value)})}
                      />
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
                    <span className="text-muted-foreground">Overtime:</span> After {rule.overtime_threshold}h at {rule.overtime_multiplier}x pay
                  </div>
                  {rule.double_time_threshold && (
                    <div>
                      <span className="text-muted-foreground">Double Time:</span> After {rule.double_time_threshold}h at {rule.double_time_multiplier}x pay
                    </div>
                  )}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
