import { Card } from "@/components/ui/card";
import { Flame, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName,
  formatCurrencyFull, formatCurrency, pctChange, pctChangeColor,
  Sparkline, HourlyHeatmap, LaborGauge,
} from './shared';

/** Style B: Gradient Panels — Bold gradient backgrounds, oversized hero numbers */
export function OrgCubeStyleB({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];

  if (isLoading) {
    return <Card className="p-4 space-y-3 animate-pulse h-56"><div className="h-6 bg-muted rounded w-1/2" /><div className="h-12 bg-muted rounded" /><div className="h-8 bg-muted rounded" /></Card>;
  }

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:scale-[1.01] transition-all duration-200 relative"
      onClick={onClick}
      style={{
        background: `linear-gradient(135deg, ${statusColor}12 0%, ${statusColor}06 40%, transparent 100%)`,
      }}
    >
      {/* Decorative circle */}
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-10" style={{ backgroundColor: statusColor }} />

      <div className="relative z-10 p-4 space-y-3">
        {/* L1: Giant hero */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">{getDisplayName(data)}</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-4xl font-black tracking-tighter">{formatCurrencyFull(data.salesToday)}</span>
            {pace.label && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: statusColor, backgroundColor: `${statusColor}15` }}>
                {pace.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {data.paceToday !== null && <span>Pace: <span className="font-bold" style={{ color: statusColor }}>{formatCurrency(data.paceToday)}</span></span>}
            {data.goalToday !== null && <span>Goal: <span className="font-semibold">{formatCurrency(data.goalToday)}</span></span>}
          </div>
        </div>

        {/* L2: Sparkline — taller */}
        <Sparkline data={data.last7Days} color={statusColor} height={32} />

        {/* L3: Comparison pills */}
        <div className="flex gap-2">
          <div className="flex-1 rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">WTD</p>
            <p className="text-xs font-bold">{formatCurrency(data.salesWtd)}</p>
            <p className="text-[10px] font-medium" style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>
              {pctChange(data.salesWtd, data.salesPrevWeek)}
            </p>
          </div>
          <div className="flex-1 rounded-md bg-muted/50 px-2 py-1.5 text-center">
            <p className="text-[9px] text-muted-foreground">MTD</p>
            <p className="text-xs font-bold">{formatCurrency(data.salesMtd)}</p>
            <p className="text-[10px] font-medium" style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>
              {pctChange(data.salesMtd, data.salesPrevMonth)}
            </p>
          </div>
          {data.salesLastYearDay !== null && (
            <div className="flex-1 rounded-md bg-muted/50 px-2 py-1.5 text-center">
              <p className="text-[9px] text-muted-foreground">vs LY</p>
              <p className="text-[10px] font-bold" style={{ color: pctChangeColor(data.salesToday, data.salesLastYearDay) }}>
                {pctChange(data.salesToday, data.salesLastYearDay)}
              </p>
            </div>
          )}
        </div>

        {/* L4 + L5: Labor + Heatmap side by side */}
        <div className="flex items-center gap-3">
          <LaborGauge percent={data.laborPercent} size={40} />
          <div className="flex-1">
            <p className="text-[9px] text-muted-foreground mb-0.5">Hourly Activity</p>
            <HourlyHeatmap data={data.hourlyData} />
          </div>
        </div>
      </div>
    </Card>
  );
}
