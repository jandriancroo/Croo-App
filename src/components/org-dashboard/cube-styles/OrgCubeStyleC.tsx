import { Card } from "@/components/ui/card";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName, getLaborColor,
  formatCurrency, formatCurrencyFull, pctChange, pctChangeColor,
  Sparkline, HourlyHeatmap,
} from './shared';

/** Style C: Dark Analytics — Dashboard panels with structured data rows */
export function OrgCubeStyleC({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return <Card className="p-4 space-y-2 animate-pulse bg-card"><div className="h-4 bg-muted rounded w-1/3" /><div className="h-10 bg-muted rounded" /><div className="h-6 bg-muted rounded" /><div className="h-4 bg-muted rounded" /><div className="h-4 bg-muted rounded" /></Card>;
  }

  // Progress bar for pace vs goal
  const paceProgress = data.goalToday && data.goalToday > 0 
    ? Math.min((data.salesToday / data.goalToday) * 100, 100) 
    : 0;

  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all duration-200 bg-card" onClick={onClick}>
      <div className="p-3 space-y-2.5">
        {/* L1: Header + hero */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground truncate">{getDisplayName(data)}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: statusColor, backgroundColor: `${statusColor}15` }}>
            {pace.label || 'No Data'}
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tracking-tight">{formatCurrencyFull(data.salesToday)}</span>
          {data.paceToday !== null && (
            <span className="text-sm font-bold" style={{ color: statusColor }}>→ {formatCurrency(data.paceToday)}</span>
          )}
        </div>

        {/* Progress bar */}
        {data.goalToday !== null && data.goalToday > 0 && (
          <div className="space-y-0.5">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${paceProgress}%`, backgroundColor: statusColor }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground">
              <span>{paceProgress.toFixed(0)}% of goal</span>
              <span>{formatCurrency(data.goalToday)}</span>
            </div>
          </div>
        )}

        {/* L2: Sparkline */}
        <Sparkline data={data.last7Days} color={statusColor} height={20} />

        {/* L3: Data rows */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">WTD</span>
            <span className="font-semibold">{formatCurrency(data.salesWtd)}{' '}
              <span style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>{pctChange(data.salesWtd, data.salesPrevWeek)}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">MTD</span>
            <span className="font-semibold">{formatCurrency(data.salesMtd)}{' '}
              <span style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>{pctChange(data.salesMtd, data.salesPrevMonth)}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Labor</span>
            <span className="font-bold" style={{ color: laborColor }}>{data.laborPercent !== null ? `${data.laborPercent.toFixed(1)}%` : '--'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Labor $</span>
            <span className="font-semibold">{data.laborCost !== null ? formatCurrency(data.laborCost) : '--'}</span>
          </div>
        </div>

        {/* L5: Heatmap */}
        <div>
          <div className="flex justify-between mb-0.5">
            <span className="text-[8px] text-muted-foreground">7a</span>
            <span className="text-[8px] text-muted-foreground">11p</span>
          </div>
          <HourlyHeatmap data={data.hourlyData} height={12} />
        </div>
      </div>
    </Card>
  );
}
