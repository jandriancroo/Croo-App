import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName,
  formatCurrency, formatCurrencyFull, pctChange,
  HourlyHeatmap,
} from './shared';

/** Style B: Glass Scoreboard — Full-bleed status color background, white text, compact */
export function OrgCubeStyleB({ data, isLoading, onClick }: CubeStyleProps) {
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

  const goalPct = data.goalToday && data.goalToday > 0
    ? Math.min((data.salesToday / data.goalToday) * 100, 120)
    : 0;

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
        {/* Row 1: Name + status + hero number */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <p className="text-base font-bold truncate drop-shadow-sm">{getDisplayName(data)}</p>
            <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full shrink-0">
              {pace.label || '—'}
            </span>
          </div>
          <p className="text-3xl font-black tracking-tighter leading-none drop-shadow-sm shrink-0">
            {formatCurrencyFull(data.salesToday)}
          </p>
        </div>

        {/* Row 2: Pace/Goal large + progress bar | Heatmap + metric cubes */}
        <div className="flex items-stretch gap-3">
          {/* Left: Pace & Goal */}
          <div className="shrink-0 space-y-1" style={{ minWidth: '140px' }}>
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
          </div>

          {/* Center: Hourly heatmap */}
          <div className="flex-1 flex flex-col justify-center opacity-90">
            <HourlyHeatmap data={data.hourlyData} height={28} variant="light" showLabels />
          </div>

          {/* Right: Metric cubes */}
          <div className="flex gap-1.5 shrink-0 items-center">
            {[
              { label: 'WTD', val: formatCurrency(data.salesWtd), sub: pctChange(data.salesWtd, data.salesPrevWeek) },
              { label: 'MTD', val: formatCurrency(data.salesMtd), sub: pctChange(data.salesMtd, data.salesPrevMonth) },
              { label: 'Labor', val: data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—', sub: data.laborCost !== null ? formatCurrency(data.laborCost) : '' },
            ].map(m => (
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
