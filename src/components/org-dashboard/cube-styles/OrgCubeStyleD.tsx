import { Card } from "@/components/ui/card";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName, getLaborColor,
  formatCurrency, formatCurrencyFull, pctChange, pctChangeColor,
  Sparkline,
} from './shared';

/** Style D: Horizontal Ticker — Single wide row per store, stock-ticker inspired */
export function OrgCubeStyleD({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return <Card className="p-3 animate-pulse"><div className="h-16 bg-muted rounded" /></Card>;
  }

  const wtdChange = pctChange(data.salesWtd, data.salesPrevWeek);
  const mtdChange = pctChange(data.salesMtd, data.salesPrevMonth);

  return (
    <Card
      className="overflow-hidden cursor-pointer hover:bg-accent/5 transition-all duration-150 border-l-4"
      onClick={onClick}
      style={{ borderLeftColor: statusColor }}
    >
      {/* Row 1: Name + big number + sparkline */}
      <div className="px-3 pt-3 pb-1 flex items-center gap-3">
        <div className="min-w-0 shrink-0" style={{ width: '35%' }}>
          <p className="text-[11px] font-medium text-muted-foreground truncate">{getDisplayName(data)}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-black tracking-tight">{formatCurrencyFull(data.salesToday)}</span>
            <span className="text-[10px] font-bold" style={{ color: statusColor }}>{pace.label}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <Sparkline data={data.last7Days} color={statusColor} height={36} />
        </div>
      </div>

      {/* Row 2: Scrolling metrics strip */}
      <div className="px-3 pb-2 flex items-center gap-4 text-[10px] overflow-x-auto">
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">Pace</span>
          <span className="font-bold" style={{ color: statusColor }}>
            {data.paceToday !== null ? formatCurrency(data.paceToday) : '—'}
          </span>
        </div>
        <div className="w-px h-3 bg-border shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">Goal</span>
          <span className="font-semibold">{data.goalToday !== null ? formatCurrency(data.goalToday) : '—'}</span>
        </div>
        <div className="w-px h-3 bg-border shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">WTD</span>
          <span className="font-semibold">{formatCurrency(data.salesWtd)}</span>
          <span className="font-bold" style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>{wtdChange}</span>
        </div>
        <div className="w-px h-3 bg-border shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">MTD</span>
          <span className="font-semibold">{formatCurrency(data.salesMtd)}</span>
          <span className="font-bold" style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>{mtdChange}</span>
        </div>
        <div className="w-px h-3 bg-border shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-muted-foreground">Labor</span>
          <span className="font-black" style={{ color: laborColor }}>
            {data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—'}
          </span>
          {data.laborCost !== null && (
            <span className="text-muted-foreground">{formatCurrency(data.laborCost)}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
