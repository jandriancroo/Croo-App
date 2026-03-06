import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus, Flame } from "lucide-react";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName,
  formatCurrency, pctChange, pctChangeColor,
  Sparkline, HourlyHeatmap, LaborGauge,
} from './shared';

/** Style A: Compact Cards — Dense info with colored left accent bar, tight spacing */
export function OrgCubeStyleA({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const icons = { fire: Flame, ahead: TrendingUp, track: Minus, behind: TrendingDown, neutral: Minus };
  const Icon = icons[pace.status];

  if (isLoading) {
    return <Card className="p-4 space-y-2 animate-pulse"><div className="h-4 bg-muted rounded w-2/3" /><div className="h-8 bg-muted rounded" /><div className="h-6 bg-muted rounded" /><div className="h-4 bg-muted rounded w-1/2" /><div className="h-4 bg-muted rounded" /></Card>;
  }

  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all duration-200 flex" onClick={onClick}>
      {/* Thick accent bar */}
      <div className="w-1.5 shrink-0 rounded-l-lg" style={{ backgroundColor: statusColor }} />
      
      <div className="p-3 flex-1 space-y-2 min-w-0">
        {/* L1: Hero */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground truncate">{getDisplayName(data)}</p>
            <p className="text-2xl font-black tracking-tight">{formatCurrency(data.salesToday)}</p>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: statusColor }}>
              <Icon className="h-3 w-3" /> {pace.label}
            </span>
            {data.paceToday !== null && (
              <span className="text-xs font-bold" style={{ color: statusColor }}>{formatCurrency(data.paceToday)}</span>
            )}
          </div>
        </div>

        {/* L2: Sparkline */}
        <Sparkline data={data.last7Days} color={statusColor} />

        {/* L3: Comparisons */}
        <div className="flex justify-between text-[10px]">
          <span className="text-muted-foreground">WTD <span className="font-semibold text-foreground">{formatCurrency(data.salesWtd)}</span>{' '}
            <span style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>{pctChange(data.salesWtd, data.salesPrevWeek)}</span>
          </span>
          <span className="text-muted-foreground">MTD <span className="font-semibold text-foreground">{formatCurrency(data.salesMtd)}</span>{' '}
            <span style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>{pctChange(data.salesMtd, data.salesPrevMonth)}</span>
          </span>
        </div>

        {/* L4: Labor */}
        <div className="flex items-center gap-2">
          <LaborGauge percent={data.laborPercent} />
          <div className="flex-1 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Labor {data.laborCost !== null && <span className="font-semibold text-foreground">{formatCurrency(data.laborCost)}</span>}</span>
            {data.laborPercent !== null && data.laborPercent > 32 && (
              <span className="px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive text-[9px] font-medium">⚠️ High</span>
            )}
          </div>
        </div>

        {/* L5: Heatmap */}
        <HourlyHeatmap data={data.hourlyData} />
      </div>
    </Card>
  );
}
