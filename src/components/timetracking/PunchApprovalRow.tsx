import { ReactNode, useState } from 'react';
import { Calendar, Check, Coffee } from 'lucide-react';

/* ── Shared visual primitives for the Time / punch approval screen ─────────
   Presentation only. All data shaping stays in the calling views.        */

export interface PunchShiftTimes {
  clockIn: string | null;
  clockOut: string | null;
}

export interface PunchBreakInfo {
  scheduledLabel: string;
  start: string;
  end: string | null;
  minutes: number;
  isLong: boolean;
}

export type PunchFlagTone = 'warning' | 'danger' | 'info';

export interface PunchFlag {
  label: string;
  tone: PunchFlagTone;
}

export type PunchApproveState = 'approved' | 'pending' | 'open';

/* ── Group card ─────────────────────────────────────────────────────────── */

export function PunchGroupCard({ children }: { children: ReactNode }) {
  return <div className="punch-group-card">{children}</div>;
}

export function PunchGroupHeader({
  title,
  subtitle,
  approvedCount,
  totalCount,
  totalHours,
}: {
  title: string;
  subtitle?: string;
  approvedCount: number;
  totalCount: number;
  totalHours: number;
}) {
  const fullyApproved = totalCount > 0 && approvedCount === totalCount;
  return (
    <div className="punch-group-header">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[19px] font-extrabold leading-tight text-foreground">{title}</span>
        {subtitle && <span className="truncate text-[13px] font-semibold text-muted-foreground">{subtitle}</span>}
      </div>
      <span
        className={`punch-pill ${fullyApproved ? 'punch-pill--done' : ''}`}
      >
        {approvedCount}/{totalCount} approved
      </span>
      <span className="punch-num text-[19px] font-extrabold leading-tight text-foreground">
        {totalHours.toFixed(1)}
        <span className="ml-1 text-[13px] font-semibold text-muted-foreground">hrs</span>
      </span>
    </div>
  );
}

export function PunchWeekBand({
  label,
  hours,
  approvedCount,
  totalCount,
}: {
  label: string;
  hours: number;
  approvedCount?: number;
  totalCount?: number;
}) {
  return (
    <div className="punch-week-band">
      <span className="flex items-baseline gap-2">
        <span className="text-[15px] font-bold text-muted-foreground">{label}</span>
        {typeof approvedCount === 'number' && (
          <span className="punch-num text-[13px] font-bold text-muted-foreground/80">
            {approvedCount}/{totalCount}
          </span>
        )}
      </span>
      <span className="punch-num text-[15px] font-extrabold text-foreground">{hours.toFixed(1)} hrs</span>
    </div>
  );
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

function ScheduledBadge({
  start,
  end,
  isTimeOff,
  showIcon,
}: {
  start: string | null;
  end: string | null;
  isTimeOff?: boolean;
  showIcon?: boolean;
}) {
  if (isTimeOff) {
    return <span className="punch-badge">PTO</span>;
  }
  if (!start && !end) {
    return <span className="text-sm font-semibold text-muted-foreground">—</span>;
  }
  return (
    <span className="punch-badge punch-num">
      {start ?? '—'} → {end ?? '—'}
      {showIcon && <Calendar className="punch-badge-icon" />}
    </span>
  );
}

function ActualTimes({ shifts }: { shifts: PunchShiftTimes[] }) {
  if (shifts.length === 0) return <span className="text-sm font-semibold text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {shifts.map((s, i) => (
        <span key={i} className="punch-num flex items-center gap-1 whitespace-nowrap text-[16px] font-bold">
          {shifts.length > 1 && <span className="text-[10px] font-medium text-muted-foreground">#{i + 1}</span>}
          <span className="text-[hsl(var(--clock-in))]">{s.clockIn ?? '—'}</span>
          <span className="font-medium text-muted-foreground">→</span>
          <span className="text-[hsl(var(--clock-out))]">{s.clockOut ?? '—'}</span>
        </span>
      ))}
    </div>
  );
}

function BreakList({ breaks }: { breaks: PunchBreakInfo[] }) {
  if (breaks.length === 0) return <span className="text-sm font-semibold text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {breaks.map((b, i) => (
        <span
          key={i}
          className={`punch-num flex items-center gap-1 text-[14px] font-semibold ${
            b.isLong ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground'
          }`}
        >
          <Coffee className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="punch-break-label whitespace-nowrap">{b.scheduledLabel}:</span>
          <span className="punch-break-times whitespace-nowrap">
            {b.start}
            {b.end && ` → ${b.end}`}
          </span>
          {b.end && <span className="whitespace-nowrap opacity-70">({b.minutes}m)</span>}
        </span>
      ))}
    </div>
  );
}

function FlagChips({ flags }: { flags: PunchFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {flags.map((f, i) => (
        <span key={i} className={`punch-flag punch-flag--${f.tone}`}>
          {f.label}
        </span>
      ))}
    </div>
  );
}

/* ── Row ────────────────────────────────────────────────────────────────── */

export interface PunchRowProps {
  primary: string;
  secondary?: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduledIsTimeOff?: boolean;
  shifts: PunchShiftTimes[];
  breaks: PunchBreakInfo[];
  flags: PunchFlag[];
  hours: number;
  state: PunchApproveState;
  isApproving?: boolean;
  approvedLabel?: string;
  onRowClick?: () => void;
  onApprove?: () => void;
  onUnapprove?: () => void;
}

export function PunchRow({
  primary,
  secondary,
  scheduledStart,
  scheduledEnd,
  scheduledIsTimeOff,
  shifts,
  breaks,
  flags,
  hours,
  state,
  isApproving,
  approvedLabel = 'Approved',
  onRowClick,
  onApprove,
  onUnapprove,
}: PunchRowProps) {
  const [sweeping, setSweeping] = useState(false);

  const handleApproveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isApproving || state === 'open') return;
    if (state === 'approved') {
      onUnapprove?.();
      return;
    }
    setSweeping(true);
    window.setTimeout(() => setSweeping(false), 340);
    onApprove?.();
  };

  return (
    <div
      className={`punch-grid punch-row ${state === 'approved' ? 'is-approved' : ''} ${
        sweeping ? 'punch-sweep' : ''
      } ${isApproving ? 'is-busy' : ''}`}
      onClick={onRowClick}
      role="button"
      tabIndex={0}
    >
      {/* Mobile body — stacked lines in fixed column order */}
      <div className="punch-cell punch-mobile-body punch-only-narrow">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[17px] font-extrabold text-foreground">{primary}</span>
            {secondary && <span className="punch-num shrink-0 text-[14px] font-bold text-muted-foreground">{secondary}</span>}
          </span>
          <span className="punch-num shrink-0 text-[17px] font-extrabold text-foreground">{hours.toFixed(1)}</span>
        </div>
        <div className="mt-1">
          <ScheduledBadge start={scheduledStart} end={scheduledEnd} isTimeOff={scheduledIsTimeOff} showIcon />
        </div>
        <div className="mt-1 punch-mobile-indent">
          <ActualTimes shifts={shifts} />
        </div>
        <div className="mt-0.5 punch-mobile-indent">
          <BreakList breaks={breaks} />
        </div>
        {flags.length > 0 && (
          <div className="mt-1 punch-mobile-indent">
            <FlagChips flags={flags} />
          </div>
        )}
      </div>

      {/* Employee / Date */}
      <div className="punch-cell punch-from-md">
        <span className="truncate text-[17px] font-extrabold text-foreground">{primary}</span>
        {secondary && <span className="punch-num ml-1 text-[14px] font-semibold text-muted-foreground">{secondary}</span>}
      </div>

      {/* Scheduled */}
      <div className="punch-cell punch-from-md">
        <ScheduledBadge start={scheduledStart} end={scheduledEnd} isTimeOff={scheduledIsTimeOff} />
      </div>

      {/* Actual */}
      <div className="punch-cell punch-from-md">
        <ActualTimes shifts={shifts} />
      </div>

      {/* Breaks (+ flags merged on tablet) */}
      <div className="punch-cell punch-from-md punch-breaks-cell">
        <BreakList breaks={breaks} />
        <div className="punch-below-lg">
          <FlagChips flags={flags} />
        </div>
      </div>

      {/* Flags (desktop only) */}
      <div className="punch-cell punch-from-lg">
        <FlagChips flags={flags} />
      </div>

      {/* Hours */}
      <div className="punch-cell punch-from-md justify-end">
        <span className="punch-num text-[17px] font-extrabold text-foreground">{hours.toFixed(1)}</span>
      </div>

      {/* Approve — full-height last column */}
      <button
        type="button"
        onClick={handleApproveClick}
        disabled={state === 'open' || isApproving}
        title={state === 'open' ? 'Cannot approve open shift — add clock-out first' : undefined}
        className={`punch-approve ${state === 'approved' ? 'is-approved' : ''} ${
          state === 'open' ? 'is-open' : ''
        }`}
      >
        {state === 'open' ? (
          <span className="text-xs font-bold text-muted-foreground">—</span>
        ) : (
          <>
            <span className="punch-tick">
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
            <span className="punch-approve-label">{state === 'approved' ? approvedLabel : 'Approve'}</span>
          </>
        )}
      </button>
    </div>
  );
}
