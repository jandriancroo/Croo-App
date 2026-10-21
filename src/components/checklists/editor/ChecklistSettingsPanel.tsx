import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { FrequencyPicker } from '@/components/tasks/FrequencyPicker';
import { AssigneePicker } from '@/components/shared/AssigneePicker';
import { cn } from '@/lib/utils';
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
  wide?: boolean;
}

function SectionCard({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card px-3 py-3.5 md:px-4">
      {label && <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</h3>}
      {children}
    </section>
  );
}

/** One setting line: label + gray helper on the left, control on the right. */
function SettingRow({ label, helper, control, htmlFor, divider }: { label: string; helper: string; control: ReactNode; htmlFor?: string; divider?: boolean }) {
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-3 py-2', divider && 'border-t')}>
      <label htmlFor={htmlFor} className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{helper}</span>
      </label>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

const TYPE_LABEL: Record<TemplateType, string> = { standard: 'Standard', dynamic: 'Dynamic', training: 'Training' };

export function ChecklistSettingsPanel({ value: s, onChange, templateTypeOptions, locationId, storeToday, availablePositions, singleDayHint, wide }: Props) {
  const isTraining = s.templateType === 'training';
  const isDynamic = s.templateType === 'dynamic';
  const showTypePicker = templateTypeOptions.includes(s.templateType) && templateTypeOptions.length > 1;

  const frequency = (
    <div className="space-y-1">
      <Label>Frequency</Label>
      {isTraining && <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Scheduling is set per assignment.</div>}
      {s.templateType === 'standard' && (
        <FrequencyPicker value={s.schedule} onChange={(schedule) => onChange({ schedule })} todayStr={storeToday} />
      )}
      {isDynamic && (
        <Select value={s.frequency} onValueChange={(v: any) => onChange({ frequency: v })}>
          <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="single_day">Single Day</SelectItem>
          </SelectContent>
        </Select>
      )}
      {isDynamic && s.frequency === 'single_day' && (
        <div className="space-y-1 pt-2">
          <Label>Date</Label>
          <Input type="date" value={s.scheduledDate} onChange={(e) => onChange({ scheduledDate: e.target.value })} />
          <p className="text-sm text-muted-foreground">{singleDayHint}</p>
        </div>
      )}
      {isDynamic && s.frequency === 'monthly' && (
        <div className="space-y-1 pt-2">
          <Label>Show During Last X Days of Month</Label>
          <Select value={s.visibleDaysBeforeMonthEnd?.toString() || '7'} onValueChange={(v) => onChange({ visibleDaysBeforeMonthEnd: parseInt(v) })}>
            <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[3, 5, 7, 10, 14].map((n) => <SelectItem key={n} value={String(n)}>Last {n} days</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );

  const typePicker = showTypePicker && (
    <div className="space-y-1">
      <Label>Type</Label>
      <SegmentedControl<TemplateType>
        value={s.templateType}
        onValueChange={(templateType) => onChange({ templateType })}
        aria-label="Checklist type"
        fullWidth
        className="h-11"
        options={templateTypeOptions.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
      />
      <p className="text-sm text-muted-foreground">
        {isTraining
          ? 'Reusable training list. It only appears once you assign it to a team member for a date.'
          : isDynamic
            ? 'After creating, assign tasks to days on calendar.'
            : 'Switch to Training to assign this list per person and per date.'}
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <SectionCard label="Basics">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="checklist-title">Title</Label>
            <Input id="checklist-title" value={s.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g., Morning Kitchen Check" className="h-11" />
          </div>
          <div className={cn('gap-3', wide ? 'grid grid-cols-2 items-start' : 'space-y-3')}>
            {frequency}
            {typePicker}
          </div>
          <div className="space-y-1">
            <Label htmlFor="checklist-description">Description</Label>
            <Textarea id="checklist-description" value={s.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Brief description (optional)" rows={2} />
          </div>
        </div>
      </SectionCard>

      <SectionCard label="Timing">
        <SettingRow
          label="Alert if not done by"
          helper="Managers are alerted when it is still open at this time."
          htmlFor="checklist-alert-time"
          control={<Input id="checklist-alert-time" type="time" value={s.dueByTime} onChange={(e) => onChange({ dueByTime: e.target.value })} className="h-11 w-[132px]" />}
        />
        <SettingRow
          divider
          label="Lock until a set time"
          helper="The checklist cannot be started before then."
          control={<Switch aria-label="Lock until a set time" checked={s.lockTimeEnabled} onCheckedChange={(c) => onChange(c ? { lockTimeEnabled: true } : { lockTimeEnabled: false, lockUntilTime: '' })} />}
        />
        {s.lockTimeEnabled && (
          <div className="flex items-center justify-between gap-3 pb-1">
            <Label htmlFor="checklist-lock-time" className="text-sm text-muted-foreground">Locked until</Label>
            <Input id="checklist-lock-time" type="time" value={s.lockUntilTime} onChange={(e) => onChange({ lockUntilTime: e.target.value })} className="h-11 w-[132px]" />
          </div>
        )}
      </SectionCard>

      {!isTraining && (
        <SectionCard>
          <AssigneePicker
            sectionHeader
            locationId={locationId}
            selectedRoles={s.selectedRoles}
            onRolesChange={(selectedRoles) => onChange({ selectedRoles })}
            selectedUserIds={s.selectedUserIds}
            onUserIdsChange={(selectedUserIds) => onChange({ selectedUserIds })}
            label="Who sees it"
            helperText="Roles include everyone in that role. Add specific people to give access without changing their role."
          />
        </SectionCard>
      )}

      <SectionCard label="How tasks are grouped">
        <SettingRow
          label="AM / PM division"
          helper="Mark each task AM or PM and split the list by shift."
          control={<Switch aria-label="AM / PM division" checked={s.enableAmPmDivision} onCheckedChange={(c) => onChange({ enableAmPmDivision: c })} />}
        />
        <SettingRow
          divider
          label="Position filtering"
          helper="Assign tasks to a position so crew can show only their own."
          control={<Switch aria-label="Position filtering" checked={s.positionFilteringEnabled} onCheckedChange={(c) => onChange({ positionFilteringEnabled: c })} />}
        />
        {s.positionFilteringEnabled && (
          <p className="pb-1 text-sm text-muted-foreground">Give each task to a position or station (follows the store's station setting), a role, or one person. Everyone else can still see it with "My tasks" off.</p>
        )}
        {s.positionFilteringEnabled && availablePositions.length === 0 && (
          <p role="status" className="mt-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">No positions found. Positions come from shift templates; you can still assign tasks to a role or a person.</p>
        )}
      </SectionCard>
    </div>
  );
}
