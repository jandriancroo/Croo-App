import { Card } from "@/components/ui/card";
import {
  CubeStyleProps, getPaceStatus, STATUS_COLORS, getDisplayName, getLaborColor,
  formatCurrency, formatCurrencyFull, pctChange, pctChangeColor,
  HourlyHeatmap,
} from './shared';

/** Style E: Mosaic Grid — Colored block tiles, each metric in its own cell */
export function OrgCubeStyleE({ data, isLoading, onClick }: CubeStyleProps) {
  const pace = getPaceStatus(data.paceToday, data.goalToday);
  const statusColor = STATUS_COLORS[pace.status];
  const laborColor = getLaborColor(data.laborPercent);

  if (isLoading) {
    return (
      <Card className="p-2 animate-pulse">
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5 h-52">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="bg-muted rounded" />)}
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all duration-200 p-2" onClick={onClick}>
      {/* Store name banner */}
      <div className="flex items-center justify-between px-2 py-1 mb-1.5">
        <span className="text-[11px] font-semibold text-muted-foreground truncate">{getDisplayName(data)}</span>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
          <span className="text-[9px] font-bold" style={{ color: statusColor }}>{pace.label}</span>
        </div>
      </div>

      {/* Mosaic grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {/* Sales - large spanning 2 cols */}
        <div className="col-span-2 rounded-lg p-2.5 flex flex-col justify-center" style={{ backgroundColor: `${statusColor}12` }}>
          <p className="text-[8px] font-medium opacity-60">Today's Sales</p>
          <p className="text-3xl font-black tracking-tighter" style={{ color: statusColor }}>
            {formatCurrencyFull(data.salesToday)}
          </p>
        </div>

        {/* Pace cell */}
        <div className="rounded-lg p-2 flex flex-col justify-center items-center bg-muted/40">
          <p className="text-[8px] text-muted-foreground">Pace</p>
          <p className="text-sm font-black" style={{ color: statusColor }}>
            {data.paceToday !== null ? formatCurrency(data.paceToday) : '—'}
          </p>
          {data.goalToday !== null && (
            <p className="text-[8px] text-muted-foreground">of {formatCurrency(data.goalToday)}</p>
          )}
        </div>

        {/* WTD */}
        <div className="rounded-lg p-2 text-center bg-muted/30">
          <p className="text-[8px] text-muted-foreground">WTD</p>
          <p className="text-xs font-black">{formatCurrency(data.salesWtd)}</p>
          <p className="text-[9px] font-bold" style={{ color: pctChangeColor(data.salesWtd, data.salesPrevWeek) }}>
            {pctChange(data.salesWtd, data.salesPrevWeek)}
          </p>
        </div>

        {/* MTD */}
        <div className="rounded-lg p-2 text-center bg-muted/30">
          <p className="text-[8px] text-muted-foreground">MTD</p>
          <p className="text-xs font-black">{formatCurrency(data.salesMtd)}</p>
          <p className="text-[9px] font-bold" style={{ color: pctChangeColor(data.salesMtd, data.salesPrevMonth) }}>
            {pctChange(data.salesMtd, data.salesPrevMonth)}
          </p>
        </div>

        {/* Labor */}
        <div className="rounded-lg p-2 text-center" style={{ backgroundColor: `${laborColor}12` }}>
          <p className="text-[8px] text-muted-foreground">Labor</p>
          <p className="text-lg font-black" style={{ color: laborColor }}>
            {data.laborPercent !== null ? `${data.laborPercent.toFixed(0)}%` : '—'}
          </p>
          {data.laborCost !== null && (
            <p className="text-[9px] text-muted-foreground">{formatCurrency(data.laborCost)}</p>
          )}
        </div>

        {/* Heatmap - spans full width */}
        <div className="col-span-3 rounded-lg bg-muted/20 p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] text-muted-foreground">Rush Pattern</span>
            <div className="flex gap-2 text-[7px] text-muted-foreground">
              <span>7a</span><span>12p</span><span>5p</span><span>10p</span>
            </div>
          </div>
          <HourlyHeatmap data={data.hourlyData} height={20} />
        </div>
      </div>
    </Card>
  );
}
