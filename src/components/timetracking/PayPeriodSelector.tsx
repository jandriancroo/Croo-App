import { useMemo } from 'react';
import { ChevronRight, Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone, parseDateStringInTimezone, getDateInTimezone } from '@/utils/timezoneUtils';

/**
 * Pay period selection screen.
 *
 * Data contract (all values traced — see PART 1 report):
 *  - sales / hours / cost / laborPercent / totalShifts / approvedShifts come from
 *    periodSummaries[`${startDate}_${endDate}`] in usePayrollData.
 *  - SPLH is computed client-side as sales / hours (no new query).
 *  - Deltas compare each period to the immediately adjacent older period.
 *  - The in-progress period is EXCLUDED from every trend/sparkline/baseline.
 */

type Summary = {
  hours: number;
  cost: number;
  sales: number;
  laborPercent: number | null;
  totalShifts: number;
  approvedShifts: number;
};

interface Props {
  payPeriods: any[];
  periodSummaries: Record<string, Summary>;
  getPeriodStatus: (period: any) => any;
  timezone: string;
  onSelect: (period: any) => void;
}

const usd0 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortRange = (startDate: string, endDate: string, timezone: string, withYear: boolean) => {
  const s = formatDateTimeInTimezone(parseDateStringInTimezone(startDate, timezone), timezone, { month: 'short', day: 'numeric' });
  const e = formatDateTimeInTimezone(parseDateStringInTimezone(endDate, timezone), timezone, { month: 'short', day: 'numeric' });
  const y = withYear ? formatDateTimeInTimezone(parseDateStringInTimezone(endDate, timezone), timezone, { year: 'numeric' }) : null;
  return { range: `${s} – ${e}`, year: y };
};

const daysBetween = (a: string, b: string) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

type MetricKey = 'sales' | 'hours' | 'cost' | 'laborPercent' | 'splh';

const METRICS: { key: MetricKey; label: string; volume: boolean; invert: boolean; fmt: (n: number) => string }[] = [
  { key: 'sales', label: 'Sales', volume: true, invert: false, fmt: usd0 },
  { key: 'hours', label: 'Hours', volume: true, invert: false, fmt: (n) => n.toFixed(1) },
  { key: 'cost', label: 'Labor', volume: true, invert: false, fmt: usd0 },
  { key: 'laborPercent', label: 'Labor %', volume: false, invert: true, fmt: (n) => `${n.toFixed(1)}%` },
];

type Row = {
  period: any;
  key: string;
  summary: Summary | undefined;
  values: Record<MetricKey, number | null>;
  closed: boolean;
  isCurrent: boolean;
  deltas: Partial<Record<MetricKey, { text: string; good: boolean } | null>>;
};

function Sparkline({
  series,
  provisional,
  invert,
  height,
}: {
  series: number[];
  provisional?: number | null;
  invert: boolean;
  height: number;
}) {
  if (series.length < 3) return null;
  const pts = provisional != null ? [...series, provisional] : series;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const W = 100;
  const H = height;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);

  const closedPath = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const lastI = series.length - 1;

  const first = series[0];
  const last = series[lastI];
  const rising = last >= first;
  const good = invert ? !rising : rising;
  const stroke = good ? 'hsl(var(--down))' : 'hsl(var(--up))';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }} aria-hidden="true">
      <path d={closedPath} fill="none" stroke={stroke} strokeWidth={1.9} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
      <circle cx={x(lastI)} cy={y(last)} r={2.1} fill={stroke} vectorEffect="non-scaling-stroke" />
      {provisional != null && (
        <>
          <path
            d={`M${x(lastI).toFixed(2)},${y(last).toFixed(2)} L${x(pts.length - 1).toFixed(2)},${y(provisional).toFixed(2)}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.9}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={x(pts.length - 1)} cy={y(provisional)} r={2.4} fill="none" stroke={stroke} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

const Delta = ({ d, className = '' }: { d: { text: string; good: boolean } | null | undefined; className?: string }) =>
  d ? (
    <span
      className={`tabular-nums ${className}`}
      style={{ fontSize: '11.5px', fontWeight: 700, color: d.good ? 'hsl(var(--down))' : 'hsl(var(--up))' }}
    >
      {d.text}
    </span>
  ) : null;

const SoFar = () => (
  <span className="text-muted-foreground" style={{ fontSize: '11.5px', fontWeight: 600 }}>
    so far
  </span>
);

const VsLast = () => (
  <span className="text-muted-foreground" style={{ fontSize: '11.5px', fontWeight: 600 }}>
    vs last
  </span>
);

export function PayPeriodSelector({ payPeriods, periodSummaries, getPeriodStatus, timezone, onSelect }: Props) {
  const rows: Row[] = useMemo(() => {
    const base = payPeriods.map((period, index) => {
      const key = `${period.startDate}_${period.endDate}`;
      const summary = periodSummaries?.[key];
      const splh = summary && summary.hours > 0 ? summary.sales / summary.hours : null;
      return {
        period,
        key,
        summary,
        isCurrent: index === 0,
        closed: getPeriodStatus(period)?.status === 'closed',
        values: {
          sales: summary ? summary.sales : null,
          hours: summary ? summary.hours : null,
          cost: summary ? summary.cost : null,
          laborPercent: summary?.laborPercent ?? null,
          splh,
        } as Record<MetricKey, number | null>,
        deltas: {},
      } as Row;
    });

    // Deltas vs the immediately adjacent older period (list is newest-first).
    base.forEach((row, i) => {
      const prev = base[i + 1];
      (['sales', 'hours', 'cost', 'laborPercent', 'splh'] as MetricKey[]).forEach((k) => {
        const cur = row.values[k];
        const before = prev?.values[k];
        const meta = k === 'splh'
          ? { volume: false, invert: false }
          : METRICS.find((m) => m.key === k)!;

        if (!prev || cur == null || before == null || before === 0) {
          row.deltas[k] = null;
          return;
        }
        // Volume metrics are never trended for the in-progress period.
        if (row.isCurrent && meta.volume) {
          row.deltas[k] = null;
          return;
        }
        if (k === 'laborPercent') {
          const pt = cur - before;
          const good = meta.invert ? pt < 0 : pt > 0;
          row.deltas[k] = { text: `${pt >= 0 ? '▲' : '▼'} ${Math.abs(pt).toFixed(1)}pt`, good };
          return;
        }
        const pct = ((cur - before) / before) * 100;
        row.deltas[k] = { text: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`, good: pct >= 0 };
      });
    });

    return base;
  }, [payPeriods, periodSummaries, getPeriodStatus]);

  const current = rows[0];
  const earlier = rows.slice(1);

  // Sparkline series: closed periods only, oldest → newest.
  const closedSeries = useMemo(() => {
    const closedRows = rows.filter((r) => !r.isCurrent && r.summary).slice().reverse();
    const pick = (k: MetricKey) => closedRows.map((r) => r.values[k]).filter((v): v is number => v != null);
    return {
      sales: pick('sales'),
      hours: pick('hours'),
      cost: pick('cost'),
      laborPercent: pick('laborPercent'),
      splh: pick('splh'),
    } as Record<MetricKey, number[]>;
  }, [rows]);

  const needsReview = earlier.reduce((sum, r) => {
    if (r.closed || !r.summary) return sum;
    return sum + (r.summary.totalShifts - r.summary.approvedShifts > 0 ? 1 : 0);
  }, 0);

  const todayStr = getDateInTimezone(new Date(), timezone);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-extrabold tracking-tight" style={{ fontWeight: 800 }}>
          <span className="text-[22px] sm:text-[24px]">Time Tracking</span>
        </h1>
        <p className="text-muted-foreground" style={{ fontSize: '13.5px', fontWeight: 600 }}>
          Select a pay period to review time cards
        </p>
      </div>

      {/* ── Hero: current period ─────────────────────────────── */}
      {current && (() => {
        const { period, summary, values, deltas } = current;
        const totalDays = daysBetween(period.startDate, period.endDate) + 1;
        const elapsed = Math.min(totalDays, Math.max(1, daysBetween(period.startDate, todayStr) + 1));
        const pct = Math.min(100, Math.round((elapsed / totalDays) * 100));
        const { range, year } = shortRange(period.startDate, period.endDate, timezone, true);

        return (
          <div className="rounded-[var(--radius)] border bg-card" style={{ overflow: 'clip' }}>
            <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
              <div className="min-w-0">
                <span
                  className="inline-flex items-center rounded-full bg-primary px-2.5 py-1 text-primary-foreground"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  This period
                </span>
                <div className="mt-2 tabular-nums" style={{ fontSize: '19px', fontWeight: 800, lineHeight: 1.2 }}>
                  {range}
                  {year && <span className="text-muted-foreground" style={{ fontWeight: 600 }}>, {year}</span>}
                </div>
                <div className="mt-1 tabular-nums text-muted-foreground" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                  Day <span style={{ fontWeight: 800 }} className="text-foreground">{elapsed}</span> of {totalDays}
                </div>
                <div className="mt-1.5 h-[3px] w-[112px] rounded-full bg-muted" style={{ overflow: 'clip' }}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="uppercase text-muted-foreground" style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '.09em' }}>
                  SPLH
                </div>
                <div className="tabular-nums" style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1.1 }}>
                  {values.splh != null ? usd2(values.splh) : '—'}
                </div>
                <div className="flex items-center justify-end gap-1.5" style={{ minHeight: 15 }}>
                  <Delta d={deltas.splh} />
                  {deltas.splh && <VsLast />}
                </div>
                <div className="mt-1 hidden w-[140px] sm:block">
                  <Sparkline series={closedSeries.splh} provisional={values.splh} invert={false} height={20} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 border-t sm:grid-cols-4">
              {METRICS.map((m, i) => (
                <div
                  key={m.key}
                  className={`border-t px-4 py-3 sm:border-t-0 ${i % 2 === 1 ? '' : 'border-r'} sm:border-r sm:last:border-r-0`}
                >
                  <div className="uppercase text-muted-foreground" style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '.09em' }}>
                    {m.label}
                  </div>
                  <div className="tabular-nums" style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.15 }}>
                    {values[m.key] != null ? m.fmt(values[m.key] as number) : '—'}
                  </div>
                  <div className="flex items-center gap-1.5" style={{ minHeight: 15 }}>
                    {m.volume ? <SoFar /> : (
                      <>
                        <Delta d={deltas[m.key]} />
                        {deltas[m.key] && <VsLast />}
                      </>
                    )}
                  </div>
                  <div className="mt-1 hidden sm:block">
                    <Sparkline
                      series={closedSeries[m.key]}
                      provisional={m.volume ? null : values[m.key]}
                      invert={m.invert}
                      height={22}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden border-t bg-muted/30 px-4 py-2 text-muted-foreground sm:block" style={{ fontSize: '11px', fontWeight: 600 }}>
              Sparklines: last closed periods · hollow marker = where this period sits now
            </div>

            <div className="border-t p-4">
              <div className="flex sm:justify-end">
                <Button className="w-full sm:w-auto" onClick={() => onSelect(period)}>
                  Review
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Ledger: earlier periods ──────────────────────────── */}
      {earlier.length > 0 && (
        <div className="rounded-[var(--radius)] border bg-card" style={{ overflow: 'clip' }}>
          <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: '15px', fontWeight: 800 }}>Earlier periods</span>
              <span
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 tabular-nums"
                style={{ fontSize: '11px', fontWeight: 700 }}
              >
                {earlier.length}
              </span>
            </div>
            {needsReview > 0 && (
              <span
                className="inline-flex items-center rounded-full px-2.5 py-1 tabular-nums"
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'hsl(var(--warning))',
                  background: 'hsl(var(--warning-soft))',
                  border: '1px solid hsl(var(--warning-line))',
                }}
              >
                {needsReview} needs review
              </span>
            )}
          </div>

          {/* Desktop column headers */}
          <div className="hidden border-b sm:grid" style={{ gridTemplateColumns: '1.5fr repeat(5, 1fr) 108px' }}>
            <div
              className="border-r uppercase text-muted-foreground"
              style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.09em', padding: '10px 18px 10px 16px', background: 'hsl(var(--anchor) / .8)' }}
            >
              Pay period
            </div>
            {['Sales', 'Hours', 'Labor', 'Labor %', 'SPLH'].map((h) => (
              <div key={h} className="uppercase text-muted-foreground" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.09em', padding: '10px 12px' }}>
                {h}
              </div>
            ))}
            <div className="border-l uppercase text-muted-foreground" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.09em', padding: '10px 12px' }}>
              Open
            </div>
          </div>

          {earlier.map((row, i) => {
            const { period, summary, values, deltas, closed } = row;
            const { range, year } = shortRange(period.startDate, period.endDate, timezone, true);
            const unapproved = summary ? summary.totalShifts - summary.approvedShifts : 0;
            const subLine = i === 0 ? (summary ? `Last period${summary.totalShifts > 0 ? ` · ${summary.approvedShifts}/${summary.totalShifts} approved` : ''}` : 'Last period') : closed ? 'Closed' : summary && summary.totalShifts > 0 ? `${summary.approvedShifts}/${summary.totalShifts} approved` : 'Open';

            return (
              <div
                key={row.key}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(period)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(period); }}
                className="group cursor-pointer border-b last:border-b-0 hover:bg-primary/5"
              >
                {/* Desktop row */}
                <div className="hidden sm:grid" style={{ gridTemplateColumns: '1.5fr repeat(5, 1fr) 108px' }}>
                  <div
                    className="border-r group-hover:bg-primary/10"
                    style={{ padding: '12px 18px 12px 16px', background: 'hsl(var(--anchor))' }}
                  >
                    <div className="tabular-nums" style={{ fontSize: '15px', fontWeight: 700 }}>
                      {range}
                      {year && <span className="text-muted-foreground" style={{ fontWeight: 600 }}>, {year}</span>}
                    </div>
                    <div className="text-muted-foreground" style={{ fontSize: '11.5px', fontWeight: 600 }}>
                      {subLine}
                    </div>
                  </div>
                  {(['sales', 'hours', 'cost', 'laborPercent', 'splh'] as MetricKey[]).map((k) => {
                    const fmt = k === 'splh' ? usd2 : METRICS.find((m) => m.key === k)!.fmt;
                    return (
                      <div key={k} style={{ padding: '12px' }}>
                        <div className="tabular-nums" style={{ fontSize: '15px', fontWeight: 800 }}>
                          {values[k] != null ? fmt(values[k] as number) : '—'}
                        </div>
                        <div style={{ minHeight: 15 }}>
                          <Delta d={deltas[k]} />
                        </div>
                      </div>
                    );
                  })}
                  <div
                    className="flex items-center justify-center gap-1 border-l"
                    style={{ background: closed ? undefined : 'hsl(var(--success-soft))' }}
                  >
                    <span
                      className="uppercase"
                      style={{ fontSize: '12.5px', fontWeight: 700, color: closed ? 'hsl(var(--muted-foreground))' : 'hsl(var(--success))' }}
                    >
                      {closed ? 'View' : 'Review'}
                    </span>
                    <ChevronRight className="h-4 w-4" style={{ color: closed ? 'hsl(var(--muted-foreground))' : 'hsl(var(--success))' }} />
                  </div>
                </div>

                {/* Mobile row */}
                <div className="grid sm:hidden" style={{ gridTemplateColumns: '1fr 64px' }}>
                  <div className="min-w-0 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="tabular-nums" style={{ fontSize: '15px', fontWeight: 700 }}>{range}</span>
                      <span className="tabular-nums whitespace-nowrap" style={{ fontSize: '17px', fontWeight: 800 }}>
                        {values.splh != null ? usd2(values.splh) : '—'}
                        <span className="ml-1 text-muted-foreground" style={{ fontSize: '11px', fontWeight: 600 }}>splh</span>
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                      {METRICS.map((m) => (
                        <div key={m.key} className="min-w-0">
                          <div className="whitespace-nowrap uppercase text-muted-foreground" style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '.09em' }}>
                            {m.label}
                          </div>
                          <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                            <span className="tabular-nums" style={{ fontSize: '13.5px', fontWeight: 800 }}>
                              {values[m.key] != null ? m.fmt(values[m.key] as number) : '—'}
                            </span>
                            <Delta d={deltas[m.key]} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {closed ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-muted-foreground"
                          style={{ fontSize: '11px', fontWeight: 700 }}
                        >
                          <Lock className="h-3 w-3" /> Closed
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1"
                          style={{ fontSize: '11px', fontWeight: 700, color: 'hsl(var(--primary))', borderColor: 'hsl(var(--primary) / .35)', background: 'hsl(var(--primary) / .08)' }}
                        >
                          <Clock className="h-3 w-3" /> Open
                        </span>
                      )}
                      {summary && summary.totalShifts > 0 && unapproved > 0 && (
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-1 tabular-nums"
                          style={{ fontSize: '11px', fontWeight: 700, color: 'hsl(var(--warning))', background: 'hsl(var(--warning-soft))', border: '1px solid hsl(var(--warning-line))' }}
                        >
                          {summary.approvedShifts}/{summary.totalShifts} approved
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex flex-col items-center justify-center border-l"
                    style={{ background: closed ? undefined : 'hsl(var(--success-soft))' }}
                  >
                    <span
                      className="uppercase"
                      style={{ fontSize: '9px', fontWeight: 800, color: closed ? 'hsl(var(--muted-foreground))' : 'hsl(var(--success))' }}
                    >
                      {closed ? 'View' : 'Review'}
                    </span>
                    <ChevronRight className="h-4 w-4" style={{ color: closed ? 'hsl(var(--muted-foreground))' : 'hsl(var(--success))' }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
