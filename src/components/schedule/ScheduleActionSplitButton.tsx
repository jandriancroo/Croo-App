import { useState } from 'react';
import { CalendarPlus, CheckCircle, ChevronDown, FileDown, LayoutGrid, Loader2, UserPlus, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ActionKey = 'quickPunch' | 'newShift' | 'buildWeek' | 'newEvent' | 'sharePdf';

interface Props {
  isToastLaborStore: boolean;
  isToday: boolean;
  hasSchedule: boolean;
  onQuickPunch: () => void;
  onNewShift: () => void;
  onBuildWeek: () => void;
  onNewEvent: () => void;
  onSharePdf?: () => Promise<void> | void;
}

interface Action {
  key: ActionKey;
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
  disabled?: boolean;
}

/** Default action rule: Quick Punch (non-Toast store, today) → New Shift (schedule exists) → Build Week. */
export function pickDefaultAction(o: { isToastLaborStore: boolean; isToday: boolean; hasSchedule: boolean }): ActionKey {
  if (!o.isToastLaborStore && o.isToday) return 'quickPunch';
  if (o.hasSchedule) return 'newShift';
  return 'buildWeek';
}

/** Manager-only split button for the phone Schedule (callers gate the role). */
export function ScheduleActionSplitButton(p: Props) {
  const [sharing, setSharing] = useState(false);
  const sharePdf = async () => {
    if (!p.onSharePdf || sharing) return;
    setSharing(true);
    try { await p.onSharePdf(); } finally { setSharing(false); }
  };

  const all: Action[] = [];
  if (!p.isToastLaborStore) all.push({ key: 'quickPunch', label: 'Quick Punch', icon: UserPlus, run: p.onQuickPunch, disabled: !p.isToday });
  if (p.hasSchedule) all.push({ key: 'newShift', label: 'New Shift', icon: CalendarPlus, run: p.onNewShift });
  all.push({ key: 'buildWeek', label: 'Build Week', icon: LayoutGrid, run: p.onBuildWeek });
  if (p.hasSchedule) all.push({ key: 'newEvent', label: 'New Event', icon: CheckCircle, run: p.onNewEvent });
  if (p.onSharePdf) all.push({ key: 'sharePdf', label: 'Share PDF', icon: FileDown, run: sharePdf });

  const defKey = pickDefaultAction(p);
  const primary = all.find(a => a.key === defKey)!;
  const rest = all.filter(a => a.key !== defKey);
  const PrimaryIcon = primary.icon;

  return (
    <div className="flex shrink-0 items-stretch overflow-hidden rounded-full bg-accent text-accent-foreground shadow-sm">
      <button
        type="button"
        onClick={() => primary.run()}
        className="flex h-10 items-center gap-1.5 pl-3.5 pr-3 text-[13px] font-semibold active:bg-accent-foreground/10 transition"
      >
        <PrimaryIcon className="h-4 w-4" />
        {primary.label}
      </button>
      <div className="my-2 w-px bg-accent-foreground/25" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More schedule actions"
            className="flex h-10 w-10 items-center justify-center active:bg-accent-foreground/10 transition"
          >
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {rest.map(a => {
            const Icon = a.icon;
            return (
              <DropdownMenuItem key={a.key} disabled={a.disabled} onSelect={() => { void a.run(); }} className="gap-2">
                <Icon className="h-4 w-4" />
                {a.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
