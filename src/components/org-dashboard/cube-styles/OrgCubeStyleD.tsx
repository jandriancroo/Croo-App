import { Card } from "@/components/ui/card";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName, getLaborColor,
  formatCurrency, formatCurrencyFull, pctChange, pctChangeColor,
  Sparkline,
} from './shared';

/** Style D: Minimal List — Clean horizontal row layout, sparkline-focused */
export function OrgCubeStyleD({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return <Card className="p-3 animate-pulse"><div className="h-12 bg-muted rounded" /></Card>;
  }

  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-md hover:bg-accent/5 transition-all duration-200" onClick={onClick}>
      <div className="p-3 space-y-2">
        {/* Top: Name + status dot + sales */}
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
          <span className="text-xs font-medium text-muted-foreground truncate flex-1">{getDisplayName(data)}</span>
          <span className="text-xl font-black tracking-tight">{formatCurrencyFull(data.salesToday)}</span>
        </div>

        {/* Middle: Wide sparkline */}
        <Sparkline data={data.last7Days} color={statusColor} height={28} />

        {/* Bottom: Metrics strip */}
        <div className="flex items-center justify-between text-[10px] gap-1">
          <div className="flex items-center gap-0.5">
            <span className="text-muted-foreground">Pace</span>
            <span className="font-bold" style={{ color: statusColor }}>{data.paceToday !== null ? formatCurrency(data.paceToday) : '--'}</span>
          </div>
          <span className="text-muted-foreground/30">|</span>
          <div className="flex items-center gap-0.5">
            <span className="text-muted-foreground">WTD</span>
            <span className="font-semibold">{formatCurrency(data.salesWtd)}</span>
            <span style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>{pctChange(data.salesWtd, data.salesPrevWeek)}</span>
          </div>
          <span className="text-muted-foreground/30">|</span>
          <div className="flex items-center gap-0.5">
            <span className="text-muted-foreground">Labor</span>
            <span className="font-bold" style={{ color: laborColor }}>{data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '--'}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
