import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName, getLaborColor,
  formatCurrency, formatCurrencyFull, pctChange, pctChangeColor,
  Sparkline, HourlyHeatmap,
} from './shared';

/** Style C: Terminal Analytics — Dark monospace feel, neon accents, structured rows */
export function OrgCubeStyleC({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return (
      <div className="rounded-lg p-4 space-y-2 animate-pulse border border-muted" style={{ backgroundColor: 'hsl(var(--card))' }}>
        <div className="h-4 bg-muted rounded w-1/3" /><div className="h-10 bg-muted rounded" />
      </div>
    );
  }

  const paceProgress = data.goalToday && data.goalToday > 0 
    ? Math.min((data.salesToday / data.goalToday) * 100, 100) 
    : 0;

  return (
    <div
      className="rounded-lg overflow-hidden cursor-pointer hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 border"
      onClick={onClick}
      style={{
        backgroundColor: 'hsl(220 20% 8%)',
        borderColor: `${statusColor}30`,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      }}
    >
      {/* Top status bar */}
      <div className="h-0.5" style={{ backgroundColor: statusColor }} />
      
      <div className="p-3 space-y-2">
        {/* L1: Terminal header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusColor }} />
            <span className="text-[10px] text-gray-400 truncate">{getDisplayName(data)}</span>
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded border" style={{ 
            color: statusColor, 
            borderColor: `${statusColor}40`,
            backgroundColor: `${statusColor}10`,
          }}>
            {pace.label || 'IDLE'}
          </span>
        </div>

        {/* L1: Hero number - neon glow */}
        <p className="text-3xl font-black tracking-tight text-white" style={{
          textShadow: `0 0 20px ${statusColor}40`,
        }}>
          {formatCurrencyFull(data.salesToday)}
        </p>

        {/* L2: Sparkline with grid lines */}
        <div className="relative bg-white/[0.03] rounded p-1">
          <Sparkline data={data.last7Days} color={statusColor} height={24} />
        </div>

        {/* L3: Structured data rows */}
        <div className="space-y-0.5 text-[10px]">
          {[
            { label: 'PACE', val: data.paceToday !== null ? formatCurrency(data.paceToday) : '—', color: statusColor },
            { label: 'GOAL', val: data.goalToday !== null ? formatCurrency(data.goalToday) : '—', color: '#8b8b8b' },
            { label: 'WTD ', val: `${formatCurrency(data.salesWtd)} ${pctChange(data.salesWtd, data.salesPrevWeek)}`, color: pctChangeColor(data.salesWtd, data.salesPrevWeek) },
            { label: 'MTD ', val: `${formatCurrency(data.salesMtd)} ${pctChange(data.salesMtd, data.salesPrevMonth)}`, color: pctChangeColor(data.salesMtd, data.salesPrevMonth) },
          ].map(row => (
            <div key={row.label} className="flex justify-between items-center border-b border-white/5 py-0.5">
              <span className="text-gray-500">{row.label}</span>
              <span className="font-bold" style={{ color: row.color }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* L4: Labor inline */}
        <div className="flex items-center justify-between text-[10px] bg-white/[0.03] rounded px-2 py-1">
          <span className="text-gray-500">LABOR</span>
          <div className="flex items-center gap-2">
            <span className="font-black" style={{ color: laborColor }}>
              {data.laborPercent !== null ? `${data.laborPercent.toFixed(1)}%` : '—'}
            </span>
            {data.laborCost !== null && (
              <span className="text-gray-500">{formatCurrency(data.laborCost)}</span>
            )}
          </div>
        </div>

        {/* L5: Heatmap */}
        <HourlyHeatmap data={data.hourlyData} height={10} />
      </div>
    </div>
  );
}
