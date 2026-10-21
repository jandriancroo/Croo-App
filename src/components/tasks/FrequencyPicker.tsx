import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DayToggleRow } from '@/components/ui/day-toggle-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ALL_WEEKDAYS,
  LAST_N_PRESETS,
  MAX_LAST_N,
  scheduleFormError,
  scheduleFormToRow,
  type ScheduleFormValue,
} from '@/lib/checklistScheduleForm';
import { describeChecklistSchedule, type ScheduleMode, type SchedulePeriod } from '@/lib/taskHistory/schedule';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, value) => ({ value, label: label.slice(0, 2) }));
const DAYS_1_31 = Array.from({ length: 31 }, (_, i) => i + 1);

/** Pill chip — same shape and colors as the weekday toggles. */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.06] text-foreground',
      )}
    >
      {children}
    </button>
  );
}

interface FrequencyPickerProps {
  value: ScheduleFormValue;
  onChange: (v: ScheduleFormValue) => void;
  /** Store's today (yyyy-MM-dd) — used for the one-date default and the summary. */
  todayStr: string;
}

/** Standard checklist frequency (Create + Edit). Dynamic and Training never use this. */
export function FrequencyPicker({ value: v, onChange, todayStr }: FrequencyPickerProps) {
  const set = (patch: Partial<ScheduleFormValue>) => onChange({ ...v, ...patch });
  const error = scheduleFormError(v);
  const summary = error ? null : describeChecklistSchedule({ template_type: 'standard', ...scheduleFormToRow(v, todayStr) });
  const everyDay = v.weekdays.length === 7;

  const toggleDay = (d: number) =>
    set({ weekdays: v.weekdays.includes(d) ? v.weekdays.filter((x) => x !== d) : [...v.weekdays, d].sort((a, b) => a - b) });

  const setPeriod = (period: SchedulePeriod) => {
    const mode: ScheduleMode = period === 'week' ? (v.mode === 'last_n' ? 'last_n' : 'days') : v.mode === 'last_n' ? 'last_n' : 'on_day';
    const lastN = Math.min(v.lastN, MAX_LAST_N[period]);
    set({ period, mode, lastN: lastN || LAST_N_PRESETS[period][0] });
  };

  const lastNField = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm">Last</span>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LAST_N[v.period]}
          value={Number.isFinite(v.lastN) && v.lastN > 0 ? String(v.lastN) : ''}
          onChange={(e) => set({ lastN: e.target.value === '' ? NaN : Number(e.target.value) })}
          className="h-9 w-20 text-center"
          aria-label="Number of days"
        />
        <span className="text-sm">days of the {v.period}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LAST_N_PRESETS[v.period].map((n) => (
          <Chip key={n} on={v.lastN === n} onClick={() => set({ lastN: n })}>{n}</Chip>
        ))}
      </div>
    </div>
  );

  const daySelect = (lastLabel: string) => (
    <Select value={String(v.day)} onValueChange={(s) => set({ day: Number(s) })}>
      <SelectTrigger className="h-9" aria-label="Day"><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        {DAYS_1_31.map((d) => (
          <SelectItem key={d} value={String(d)}>{d}</SelectItem>
        ))}
        <SelectItem value="-1">{lastLabel}</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Repeating</Label>
        <Switch checked={v.repeats} onCheckedChange={(repeats) => set({ repeats })} aria-label="Repeating" />
      </div>

      {!v.repeats ? (
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} />
          <p className="text-[10px] text-muted-foreground">Shows only on this date, then moves to history. Leave blank for today.</p>
        </div>
      ) : (
        <>
          <SegmentedControl
            fullWidth
            aria-label="Repeats"
            itemClassName="px-2"
            value={v.period}
            onValueChange={setPeriod}
            options={[
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
              { value: 'quarter', label: 'Quarterly' },
            ]}
          />

          {v.period === 'week' ? (
            <>
              <SegmentedControl
                fullWidth
                aria-label="Weekly mode"
                value={v.mode === 'last_n' ? 'last_n' : 'days'}
                onValueChange={(mode) => set({ mode, lastN: mode === 'last_n' ? Math.min(v.lastN || 1, 7) : v.lastN })}
                options={[
                  { value: 'days', label: 'On certain days' },
                  { value: 'last_n', label: 'Last ___ days' },
                ]}
              />
              {v.mode === 'last_n' ? lastNField : (
                <div className="space-y-2">
                  <DayToggleRow className="[&>button]:h-9 [&>button]:w-9" value={v.weekdays} onToggle={toggleDay} days={WEEKDAYS} />
                  <Chip on={everyDay} onClick={() => set({ weekdays: everyDay ? [] : [...ALL_WEEKDAYS] })}>Every day</Chip>
                </div>
              )}
            </>
          ) : (
            <>
              <SegmentedControl
                fullWidth
                aria-label={`${v.period === 'month' ? 'Monthly' : 'Quarterly'} mode`}
                value={v.mode === 'last_n' ? 'last_n' : 'on_day'}
                onValueChange={(mode) => set({ mode })}
                options={[
                  { value: 'on_day', label: 'On a day' },
                  { value: 'last_n', label: 'Last ___ days' },
                ]}
              />
              {v.mode === 'last_n' ? lastNField : v.period === 'month' ? (
                <div className="space-y-1">
                  <Label className="text-xs">Day of the month</Label>
                  {daySelect('Last day of month')}
                  {v.day > 28 && <p className="text-[10px] text-muted-foreground">Shorter months use their last day.</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs">Month of the quarter</Label>
                  <SegmentedControl
                    fullWidth
                    aria-label="Month of the quarter"
                    value={String(v.quarterMonth) as '1' | '2' | '3'}
                    onValueChange={(s) => set({ quarterMonth: Number(s) })}
                    options={[
                      { value: '1', label: '1st' },
                      { value: '2', label: '2nd' },
                      { value: '3', label: '3rd' },
                    ]}
                  />
                  <Label className="text-xs">Day</Label>
                  {daySelect(v.quarterMonth === 3 ? 'Last day of the quarter' : 'Last day of that month')}
                  {v.day > 28 && <p className="text-[10px] text-muted-foreground">Shorter months use their last day.</p>}
                </div>
              )}
            </>
          )}
        </>
      )}

      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">{summary}{v.repeats && v.mode === 'last_n' ? ' · scored once for the whole ' + v.period : ''}</p>
      )}
    </div>
  );
}
