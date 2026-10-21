import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FrequencyPicker } from '@/components/tasks/FrequencyPicker';
import { AssigneePicker } from '@/components/shared/AssigneePicker';
import type { ChecklistEditorSettings, TemplateType } from './types';

interface Props {
  value: ChecklistEditorSettings;
  onChange: (patch: Partial<ChecklistEditorSettings>) => void;
  templateTypeOptions: TemplateType[];
  locationId?: string | null;
  storeToday: string;
  availablePositions: string[];
  /** Create shows "Leave blank for today" under the dynamic single date. */
  singleDayHint: string;
}

function Section({ title, helper, children }: { title: string; helper: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{helper}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

const TYPE_LABEL: Record<TemplateType, string> = { standard: 'Standard', dynamic: 'Dynamic Calendar', training: 'Training' };

export function ChecklistSettingsPanel({ value: s, onChange, templateTypeOptions, locationId, storeToday, availablePositions, singleDayHint }: Props) {
  const isTraining = s.templateType === 'training';
  const isDynamic = s.templateType === 'dynamic';
  const showTypePicker = templateTypeOptions.includes(s.templateType) && templateTypeOptions.length > 1;

  return (
    <div className="space-y-4">
      <Section title="Basics" helper="What this list is called and what it's for.">
        <div className="space-y-1">
          <Label htmlFor="checklist-title">Title</Label>
          <Input id="checklist-title" value={s.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g., Morning Kitchen Check" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="checklist-description">Description (optional)</Label>
          <Textarea id="checklist-description" value={s.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Brief description" rows={2} />
        </div>
        {showTypePicker && (
          <div className="space-y-1">
            <Label>Template Type</Label>
            <Select value={s.templateType} onValueChange={(v: TemplateType) => onChange({ templateType: v })}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {templateTypeOptions.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {isTraining
                ? 'Reusable training list. It only appears once you assign it to a team member for a date.'
                : isDynamic
                  ? 'After creating, assign tasks to days on calendar.'
                  : 'Switch to Training to assign this list per person and per date.'}
            </p>
          </div>
        )}
      </Section>

      <Section title="When it shows" helper="Which days crew see this list, and when managers get alerted.">
        {isTraining && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Scheduling is set per assignment.</div>
        )}
        {s.templateType === 'standard' && (
          <div className="space-y-1">
            <Label>Frequency</Label>
            <FrequencyPicker value={s.schedule} onChange={(schedule) => onChange({ schedule })} todayStr={storeToday} />
          </div>
        )}
        {isDynamic && (
          <div className="space-y-1">
            <Label>Frequency</Label>
            <Select value={s.frequency} onValueChange={(v: any) => onChange({ frequency: v })}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="single_day">Single Day</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {isDynamic && s.frequency === 'single_day' && (
          <div className="space-y-1">
            <Label>Date</Label>
            <Input type="date" value={s.scheduledDate} onChange={(e) => onChange({ scheduledDate: e.target.value })} />
            <p className="text-sm text-muted-foreground">{singleDayHint}</p>
          </div>
        )}
        {isDynamic && s.frequency === 'monthly' && (
          <div className="space-y-1">
            <Label>Show During Last X Days of Month</Label>
            <Select value={s.visibleDaysBeforeMonthEnd?.toString() || '7'} onValueChange={(v) => onChange({ visibleDaysBeforeMonthEnd: parseInt(v) })}>
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[3, 5, 7, 10, 14].map((n) => <SelectItem key={n} value={String(n)}>Last {n} days</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Alert Time</Label>
            <Input type="time" value={s.dueByTime} onChange={(e) => onChange({ dueByTime: e.target.value })} />
            <p className="text-sm text-muted-foreground">Alert if incomplete after this time.</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 min-h-6">
              <Label>Lock Until Time</Label>
              <Switch aria-label="Lock until time" checked={s.lockTimeEnabled} onCheckedChange={(c) => onChange(c ? { lockTimeEnabled: true } : { lockTimeEnabled: false, lockUntilTime: '' })} />
            </div>
            {s.lockTimeEnabled && <Input type="time" value={s.lockUntilTime} onChange={(e) => onChange({ lockUntilTime: e.target.value })} />}
            <p className="text-sm text-muted-foreground">{s.lockTimeEnabled ? 'Locked until this time each day.' : 'Lock checklist until a time.'}</p>
          </div>
        </div>
      </Section>

      {isTraining ? (
        <Section title="Who sees it" helper="Training lists are seen only by the people you assign them to.">
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Visibility is controlled by who you assign it to.</div>
        </Section>
      ) : (
        <Section title="Who sees it" helper="Roles include everyone in that role; add people for one-off access.">
          <AssigneePicker
            locationId={locationId}
            selectedRoles={s.selectedRoles}
            onRolesChange={(selectedRoles) => onChange({ selectedRoles })}
            selectedUserIds={s.selectedUserIds}
            onUserIdsChange={(selectedUserIds) => onChange({ selectedUserIds })}
            label="Visible to"
            helperText="Roles auto-include everyone in that role. Add specific people to grant access without changing their role (e.g. shadowing a line check)."
          />
        </Section>
      )}

      <Section title="Task options" helper="Split tasks by shift or hand them to a position, role or person.">
        <label className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
          <span>
            <span className="block text-sm font-medium">AM/PM Division</span>
            <span className="block text-sm text-muted-foreground">Mark tasks as AM or PM shift.</span>
          </span>
          <Switch checked={s.enableAmPmDivision} onCheckedChange={(c) => onChange({ enableAmPmDivision: c })} />
        </label>
        <label className="flex items-center justify-between gap-3 min-h-11 cursor-pointer border-t pt-3">
          <span>
            <span className="block text-sm font-medium">Assign tasks</span>
            <span className="block text-sm text-muted-foreground">Give each task to a position or station, a role, or one person.</span>
          </span>
          <Switch checked={s.positionFilteringEnabled} onCheckedChange={(c) => onChange({ positionFilteringEnabled: c })} />
        </label>
        {s.positionFilteringEnabled && (
          <p className="text-sm text-muted-foreground">Give each task to a position or station (follows the store's station setting), a role, or one person. Everyone else can still see it with "My tasks" off.</p>
        )}
        {s.positionFilteringEnabled && availablePositions.length === 0 && (
          <p role="status" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No positions found. Positions come from shift templates; you can still assign tasks to a role or a person.</p>
        )}
      </Section>
    </div>
  );
}
