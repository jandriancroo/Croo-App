import { Card } from "@/components/ui/card";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName, getLaborColor,
  formatCurrency, formatCurrencyFull, pctChange, pctChangeColor,
  HourlyHeatmap, LaborGauge,
} from './shared';

/** Style E: Tile Grid — Colorful tiles with prominent heatmap and metric blocks */
export function OrgCubeStyleE({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return <Card className="p-3 space-y-2 animate-pulse"><div className="h-6 bg-muted rounded w-1/2" /><div className="h-10 bg-muted rounded" /><div className="grid grid-cols-3 gap-1"><div className="h-12 bg-muted rounded" /><div className="h-12 bg-muted rounded" /><div className="h-12 bg-muted rounded" /></div><div className="h-5 bg-muted rounded" /></Card>;
  }

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all duration-200"
      onClick={onClick}
      style={{ borderTop: `3px solid ${statusColor}` }}
    >
      <div className="p-3 space-y-2">
        {/* L1: Name + Sales */}
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium text-muted-foreground truncate">{getDisplayName(data)}</span>
          <span className="text-[10px] font-bold" style={{ color: statusColor }}>{pace.label}</span>
        </div>
        <p className="text-3xl font-black tracking-tight">{formatCurrencyFull(data.salesToday)}</p>

        {/* L2+L3: Metric tiles */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded-md p-2 text-center" style={{ backgroundColor: `${statusColor}10` }}>
            <p className="text-[8px] text-muted-foreground">Pace</p>
            <p className="text-sm font-black" style={{ color: statusColor }}>
              {data.paceToday !== null ? formatCurrency(data.paceToday) : '--'}
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-center">
            <p className="text-[8px] text-muted-foreground">WTD</p>
            <p className="text-sm font-bold">{formatCurrency(data.salesWtd)}</p>
            <p className="text-[9px] font-medium" style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>
              {pctChange(data.salesWtd, data.salesPrevWeek)}
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-center">
            <p className="text-[8px] text-muted-foreground">MTD</p>
            <p className="text-sm font-bold">{formatCurrency(data.salesMtd)}</p>
            <p className="text-[9px] font-medium" style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>
              {pctChange(data.salesMtd, data.salesPrevMonth)}
            </p>
          </div>
        </div>

        {/* L4: Labor bar */}
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: laborColor }} />
            <span className="text-[10px] text-muted-foreground">Labor</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold" style={{ color: laborColor }}>
              {data.laborPercent !== null ? `${data.laborPercent.toFixed(1)}%` : '--'}
            </span>
            {data.laborCost !== null && (
              <span className="text-muted-foreground font-medium">{formatCurrency(data.laborCost)}</span>
            )}
          </div>
        </div>

        {/* L5: Heatmap */}
        <div>
          <p className="text-[8px] text-muted-foreground mb-0.5">Rush Pattern</p>
          <HourlyHeatmap data={data.hourlyData} height={18} />
        </div>
      </div>
    </Card>
  );
}
