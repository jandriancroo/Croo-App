import { useState } from 'react';
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName,
  formatCurrency, formatCurrencyFull, pctChange,
  HourlyHeatmap,
} from './shared';

type Period = 'day' | 'week' | 'month';

/** Daily bar chart for week/month views */
function DailyBarChart({ data, labels, variant = 'light' }: { data: number[]; labels?: string[]; variant?: 'default' | 'light' }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex gap-[3px] items-end" style={{ height: 28 }}>
        {data.map((val, i) => {
          const intensity = max > 0 ? val / max : 0;
          let bg: string;
          if (variant === 'light') {
            bg = intensity > 0.7 ? 'rgba(255,255,255,0.9)'
              : intensity > 0.4 ? 'rgba(255,255,255,0.5)'
              : intensity > 0.05 ? 'rgba(255,255,255,0.2)'
              : 'rgba(255,255,255,0.08)';
          } else {
            bg = intensity > 0.7 ? '#22c55e'
              : intensity > 0.4 ? '#eab308'
              : intensity > 0.05 ? 'hsl(var(--muted-foreground)/0.3)'
              : 'hsl(var(--muted))';
          }
          return (
            <div
              key={i}
              className="flex-1 rounded-[2px]"
              style={{ backgroundColor: bg, height: `${Math.max(10, intensity * 100)}%`, minWidth: 8 }}
            />
          );
        })}
      </div>
      {labels && (
        <div className="flex gap-[3px]">
          {labels.map((label, i) => (
            <div key={i} className="flex-1 text-center">
              <span className={`text-[9px] font-bold ${variant === 'light' ? 'opacity-70' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Style B: Glass Scoreboard — Full-bleed status color background, white text, compact */
export function OrgCubeStyleB({ data, isLoading, onClick }: CubeStyleProps) {
  const [period, setPeriod] = useState<Period>('day');
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];

  if (isLoading) {
    return (
      <div className="rounded-xl p-3 space-y-2 animate-pulse bg-muted/30 h-24">
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-8 bg-muted rounded" />
      </div>
    );
  }

  // Derived values per period
  const heroSales = period === 'day' ? data.salesToday
    : period === 'week' ? data.salesWtd
    : data.salesMtd;

  const heroLabel = period === 'day' ? 'Today'
    : period === 'week' ? 'WTD'
    : 'MTD';

  const goalPct = period === 'day'
    ? (data.goalToday && data.goalToday > 0 ? Math.min((data.salesToday / data.goalToday) * 100, 120) : 0)
    : 0;

  // Pace/Goal display per period
  const showPaceGoal = period === 'day';
  const compPrev = period === 'week' ? data.salesPrevWeek
    : period === 'month' ? data.salesPrevMonth
    : null;
  const compLabel = period === 'week' ? 'Prev Wk'
    : period === 'month' ? 'Prev Mo'
    : '';

  // Metric cubes per period
  const metricCubes = period === 'day' ? [
    { label: 'WTD', val: formatCurrency(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'MTD', val: formatCurrency(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'Labor', val: data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—', sub: data.laborCost !== null ? formatCurrency(data.laborCost) : '' },
  ] : period === 'week' ? [
    { label: 'Prev Wk', val: data.salesPrevWeek !== null ? formatCurrency(data.salesPrevWeek) : '—', sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'MTD', val: formatCurrency(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'Labor', val: data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—', sub: data.laborCost !== null ? formatCurrency(data.laborCost) : '' },
  ] : [
    { label: 'Prev Mo', val: data.salesPrevMonth !== null ? formatCurrency(data.salesPrevMonth) : '—', sub: pctChange(data.salesMtd, data.salesPrevMonth) },
    { label: 'WTD', val: formatCurrency(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
    { label: 'Labor', val: data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—', sub: data.laborCost !== null ? formatCurrency(data.laborCost) : '' },
  ];

  return (
    <div
      className="rounded-xl cursor-pointer hover:scale-[1.005] transition-all duration-200 relative overflow-hidden"
      onClick={onClick}
      style={{
        background: `linear-gradient(145deg, ${statusColor}dd, ${statusColor}99)`,
        color: 'white',
      }}
    >
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
      <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-black/10" />

      <div className="relative z-10 px-4 py-2.5 space-y-1.5">
        {/* Row 1: Name + status + period toggle + hero number */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <p className="text-base font-bold truncate drop-shadow-sm">{getDisplayName(data)}</p>
            <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full shrink-0">
              {pace.label || '—'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Period toggle */}
            <div
              className="flex bg-black/20 rounded-full p-[2px] gap-[2px]"
              onClick={e => e.stopPropagation()}
            >
              {(['day', 'week', 'month'] as Period[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full transition-all ${
                    period === p ? 'bg-white/30 text-white' : 'text-white/60 hover:text-white/80'
                  }`}
                >
                  {p === 'day' ? 'D' : p === 'week' ? 'W' : 'M'}
                </button>
              ))}
            </div>
            <p className="text-3xl font-black tracking-tighter leading-none drop-shadow-sm">
              {formatCurrencyFull(heroSales)}
            </p>
          </div>
        </div>

        {/* Row 2: Pace/Goal or Comparison + graph + metric cubes */}
        <div className="flex items-stretch gap-3">
          {/* Left: Pace & Goal (day) or Comparison (week/month) */}
          <div className="shrink-0 space-y-1" style={{ minWidth: '140px' }}>
            {showPaceGoal ? (
              <>
                <div className="flex items-baseline gap-3">
                  <div>
                    <p className="text-[9px] opacity-60">Pace</p>
                    <p className="text-lg font-black leading-tight">{data.paceToday !== null ? formatCurrency(data.paceToday) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] opacity-60">Goal</p>
                    <p className="text-lg font-black leading-tight">{data.goalToday !== null ? formatCurrency(data.goalToday) : '—'}</p>
                  </div>
                </div>
                <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
                  <div className="h-full bg-white/80 rounded-full transition-all" style={{ width: `${Math.min(goalPct, 100)}%` }} />
                </div>
                <p className="text-[9px] opacity-50">{goalPct.toFixed(0)}% of goal</p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-3">
                  <div>
                    <p className="text-[9px] opacity-60">{heroLabel}</p>
                    <p className="text-lg font-black leading-tight">{formatCurrency(heroSales)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] opacity-60">{compLabel}</p>
                    <p className="text-lg font-black leading-tight">{compPrev !== null ? formatCurrency(compPrev) : '—'}</p>
                  </div>
                </div>
                <div className="text-[10px] font-bold opacity-80">
                  {compPrev !== null ? pctChange(heroSales, compPrev) : '—'} vs {compLabel.toLowerCase()}
                </div>
              </>
            )}
          </div>

          {/* Center: Graph — hourly (day), daily bars (week), daily bars (month) */}
          <div className="flex-1 flex flex-col justify-center opacity-90">
            {period === 'day' ? (
              <HourlyHeatmap data={data.hourlyData} height={28} variant="light" showLabels />
            ) : (
              <DailyBarChart data={data.last7Days} labels={DAY_LABELS_SHORT} variant="light" />
            )}
          </div>

          {/* Right: Metric cubes */}
          <div className="flex gap-1.5 shrink-0 items-center">
            {metricCubes.map(m => (
              <div key={m.label} className="bg-white/15 rounded-lg px-3 py-1.5 text-center backdrop-blur-sm min-w-[60px]">
                <p className="text-[8px] opacity-60">{m.label}</p>
                <p className="text-sm font-black leading-tight">{m.val}</p>
                {m.sub && <p className="text-[9px] font-semibold opacity-80">{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
