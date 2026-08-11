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
        <span className="truncate text-sm font-extrabold text-foreground">{title}</span>
        {subtitle && <span className="truncate text-xs font-medium text-muted-foreground">{subtitle}</span>}
      </div>
      <span
        className={`punch-pill ${fullyApproved ? 'punch-pill--done' : ''}`}
      >
        {approvedCount}/{totalCount} approved
      </span>
      <span className="punch-num text-sm font-extrabold text-foreground">
        {totalHours.toFixed(1)}
        <span className="ml-1 text-[11px] font-medium text-muted-foreground">hrs</span>
      </span>
    </div>
  );
}

export function PunchWeekBand({ label, hours }: { label: string; hours: number }) {
  return (
    <div className="punch-week-band">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="punch-num text-[11px] font-bold text-foreground">{hours.toFixed(1)} hrs</span>
    </div>
  );
}

export function PunchColumnHeaders({ firstLabel }: { firstLabel: 'Employee' | 'Date' }) {
  return (
    <div className="punch-grid punch-col-headers">
      <span className="punch-cell">{firstLabel}</span>
      <span className="punch-cell hidden md:flex">Scheduled</span>
      <span className="punch-cell hidden md:flex">Actual</span>
      <span className="punch-cell hidden md:flex">
        Breaks<span className="xl:hidden"> / Flags</span>
      </span>
      <span className="punch-cell hidden xl:flex">Flags</span>
      <span className="punch-cell hidden justify-end md:flex">Hours</span>
      <span className="punch-cell punch-approve-cell justify-center">Approve</span>
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
    return <span className="text-xs font-medium text-muted-foreground">—</span>;
  }
  return (
    <span className="punch-badge punch-num">
      {start ?? '—'} → {end ?? '—'}
      {showIcon && <Calendar className="punch-badge-icon" />}
    </span>
  );
}

function ActualTimes({ shifts }: { shifts: PunchShiftTimes[] }) {
  if (shifts.length === 0) return <span className="text-xs font-medium text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {shifts.map((s, i) => (
        <span key={i} className="punch-num flex items-center gap-1 text-[13px] font-bold">
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
  if (breaks.length === 0) return <span className="text-xs font-medium text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {breaks.map((b, i) => (
        <span
          key={i}
          className={`punch-num flex items-center gap-1 text-[11px] font-semibold ${
            b.isLong ? 'text-[hsl(var(--warning))]' : 'text-muted-foreground'
          }`}
        >
          <Coffee className="h-3 w-3 shrink-0 opacity-70" />
          <span>{b.scheduledLabel}:</span>
          <span>{b.start}</span>
          {b.end && (
            <>
              <span>→</span>
              <span>{b.end}</span>
              <span className="opacity-70">({b.minutes}m)</span>
            </>
          )}
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
      <div className="punch-cell punch-mobile-body md:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-extrabold text-foreground">{primary}</span>
          <span className="punch-num shrink-0 text-[13px] font-extrabold text-foreground">{hours.toFixed(1)}</span>
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
      <div className="punch-cell hidden md:flex">
        <span className="truncate text-[13px] font-extrabold text-foreground">{primary}</span>
        {secondary && <span className="punch-num ml-1 text-xs font-medium text-muted-foreground">{secondary}</span>}
      </div>

      {/* Scheduled */}
      <div className="punch-cell hidden md:flex">
        <ScheduledBadge start={scheduledStart} end={scheduledEnd} isTimeOff={scheduledIsTimeOff} />
      </div>

      {/* Actual */}
      <div className="punch-cell hidden md:flex">
        <ActualTimes shifts={shifts} />
      </div>

      {/* Breaks (+ flags merged on tablet) */}
      <div className="punch-cell hidden md:flex md:flex-col md:items-start md:gap-1">
        <BreakList breaks={breaks} />
        <div className="xl:hidden">
          <FlagChips flags={flags} />
        </div>
      </div>

      {/* Flags (desktop only) */}
      <div className="punch-cell hidden xl:flex">
        <FlagChips flags={flags} />
      </div>

      {/* Hours */}
      <div className="punch-cell hidden justify-end md:flex">
        <span className="punch-num text-[13px] font-extrabold text-foreground">{hours.toFixed(1)}</span>
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
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="punch-approve-label">{state === 'approved' ? approvedLabel : 'Approve'}</span>
          </>
        )}
      </button>
    </div>
  );
}
