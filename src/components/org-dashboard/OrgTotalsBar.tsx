import { useMemo } from 'react';
import { OrgLocationData } from './OrgLocationCube';
import { OrgPeriod } from './cube-styles/OrgCubeStyleB';

interface OrgTotalsBarProps {
  locationData: Record<string, Partial<OrgLocationData>>;
  locationIds: string[];
  period: OrgPeriod;
}

export function OrgTotalsBar({ locationData, locationIds, period }: OrgTotalsBarProps) {
  const totals = useMemo(() => {
    let totalGoal = 0;
    let totalPace = 0;
    let totalSales = 0;
    let laborSum = 0;
    let laborCount = 0;
    let hasGoal = false;
    let hasPace = false;

    for (const id of locationIds) {
      const d = locationData[id];
      if (!d) continue;

      if (period === 'day') {
        totalSales += d.salesToday ?? 0;
        if (d.goalToday != null) { totalGoal += d.goalToday; hasGoal = true; }
        if (d.paceToday != null) { totalPace += d.paceToday; hasPace = true; }
      } else if (period === 'week') {
        totalSales += d.salesWtd ?? 0;
      } else {
        totalSales += d.salesMtd ?? 0;
      }

      if (d.laborPercent != null && d.laborPercent > 0) {
        laborSum += d.laborPercent;
        laborCount++;
      }
    }

    return {
      goal: hasGoal ? totalGoal : null,
      pace: hasPace ? totalPace : null,
      sales: totalSales,
      laborAvg: laborCount > 0 ? laborSum / laborCount : null,
    };
  }, [locationData, locationIds, period]);

  const fmt = (n: number) => {
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  if (locationIds.length < 2) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center pb-[env(safe-area-inset-bottom)] mb-20 md:mb-0">
      <div className="pointer-events-auto mx-4 mb-4 w-full max-w-3xl rounded-2xl bg-card/95 backdrop-blur-md border border-border shadow-lg px-3 py-2.5 md:px-4 md:py-3 flex items-center justify-between gap-2 md:gap-3">
        {/* Goal */}
        <div className="flex flex-col items-center min-w-0">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Goal</span>
          <span className="text-sm font-bold truncate">
            {totals.goal != null ? fmt(totals.goal) : '—'}
          </span>
        </div>

        <div className="w-px h-8 bg-border/60" />

        {/* Pace */}
        <div className="flex flex-col items-center min-w-0">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Pace</span>
          <span className="text-sm font-bold truncate">
            {totals.pace != null ? fmt(totals.pace) : '—'}
          </span>
        </div>

        <div className="w-px h-8 bg-border/60" />

        {/* Sales */}
        <div className="flex flex-col items-center min-w-0">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            {period === 'day' ? 'Sales' : period === 'week' ? 'WTD' : 'MTD'}
          </span>
          <span className="text-sm font-black text-primary truncate">
            {fmt(totals.sales)}
          </span>
        </div>

        <div className="w-px h-8 bg-border/60" />

        {/* Labor Avg */}
        <div className="flex flex-col items-center min-w-0">
          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Labor Avg</span>
          <span className={`text-sm font-bold truncate ${
            totals.laborAvg != null && totals.laborAvg > 30 ? 'text-destructive' : 'text-emerald-600'
          }`}>
            {totals.laborAvg != null ? `${totals.laborAvg.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
