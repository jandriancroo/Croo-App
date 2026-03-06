import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName,
  formatCurrency, formatCurrencyFull, pctChange,
  HourlyHeatmap,
} from './shared';

/** Style B: Glass Scoreboard — Full-bleed status color background, white text, big numbers */
export function OrgCubeStyleB({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return (
      <div className="rounded-xl p-4 space-y-3 animate-pulse bg-muted/30 h-52">
        <div className="h-6 bg-muted rounded w-1/2" />
        <div className="h-12 bg-muted rounded" />
      </div>
    );
  }

  // Goal progress
  const goalPct = data.goalToday && data.goalToday > 0
    ? Math.min((data.salesToday / data.goalToday) * 100, 120)
    : 0;

  return (
    <div
      className="rounded-xl cursor-pointer hover:scale-[1.02] transition-all duration-200 relative overflow-hidden"
      onClick={onClick}
      style={{
        background: `linear-gradient(145deg, ${statusColor}dd, ${statusColor}99)`,
        color: 'white',
      }}
    >
      {/* Decorative circles */}
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
      <div className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full bg-black/10" />
      
      <div className="relative z-10 p-4 space-y-3">
        {/* L1: Store + massive number */}
        <div className="flex items-start justify-between">
          <p className="text-xs font-medium opacity-80 truncate">{getDisplayName(data)}</p>
          <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
            {pace.label || '—'}
          </span>
        </div>
        <p className="text-5xl font-black tracking-tighter leading-none drop-shadow-sm">
          {formatCurrencyFull(data.salesToday)}
        </p>

        {/* L2: Goal progress bar */}
        <div className="space-y-1">
          <div className="h-2 bg-black/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/80 rounded-full transition-all"
              style={{ width: `${Math.min(goalPct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] opacity-70">
            <span>Pace: {data.paceToday !== null ? formatCurrency(data.paceToday) : '—'}</span>
            <span>Goal: {data.goalToday !== null ? formatCurrency(data.goalToday) : '—'}</span>
          </div>
        </div>

        {/* L3: Comparison row */}
        <div className="flex gap-2">
          <div className="flex-1 bg-white/15 rounded-lg px-2 py-1 text-center backdrop-blur-sm">
            <p className="text-[8px] opacity-70">WTD</p>
            <p className="text-xs font-black">{formatCurrency(data.salesWtd)}</p>
            <p className="text-[9px] font-semibold">{pctChange(data.salesWtd, data.salesPrevWeek)}</p>
          </div>
          <div className="flex-1 bg-white/15 rounded-lg px-2 py-1 text-center backdrop-blur-sm">
            <p className="text-[8px] opacity-70">MTD</p>
            <p className="text-xs font-black">{formatCurrency(data.salesMtd)}</p>
            <p className="text-[9px] font-semibold">{pctChange(data.salesMtd, data.salesPrevMonth)}</p>
          </div>
          <div className="flex-1 bg-white/15 rounded-lg px-2 py-1 text-center backdrop-blur-sm">
            <p className="text-[8px] opacity-70">Labor</p>
            <p className="text-xs font-black">{data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—'}</p>
            <p className="text-[9px] opacity-70">{data.laborCost !== null ? formatCurrency(data.laborCost) : ''}</p>
          </div>
        </div>

        {/* L5: Heatmap - inverted colors */}
        <div className="opacity-80">
          <HourlyHeatmap data={data.hourlyData} height={14} variant="light" />
        </div>
      </div>
    </div>
  );
}
