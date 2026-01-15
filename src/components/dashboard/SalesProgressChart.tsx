import { Skeleton } from '@/components/ui/skeleton';

interface SalesData {
  actual: number;
  projected: number;
  pacing: number;
  lastYear?: number;
}

interface SalesProgressChartProps {
  data: SalesData;
  period: 'daily' | 'weekly' | 'monthly';
  compact?: boolean;
}

const formatCurrencyCompact = (amount: number) => {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

const formatLastYearComparison = (actual: number, lastYear: number) => {
  if (!lastYear || lastYear === 0) return null;
  const diff = actual - lastYear;
  const percent = ((diff / lastYear) * 100).toFixed(1);
  const isPositive = diff >= 0;
  return { diff, percent, isPositive, lastYear };
};

export function SalesProgressChart({ data, period, compact = false }: SalesProgressChartProps) {
  const lyComparison = data.lastYear ? formatLastYearComparison(data.actual, data.lastYear) : null;
  const maxVal = Math.max(data.actual, data.projected, data.pacing, 1);

  return (
    <div className="w-full">
      <div className={`flex items-center gap-4 ${compact ? 'mb-1.5' : 'mb-2'}`}>
        {/* Actual */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-3 h-3 rounded-sm bg-orange-500" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Actual</span>
          </div>
          <p className={`font-bold ${compact ? 'text-base' : 'text-lg'}`}>{formatCurrencyCompact(data.actual)}</p>
        </div>
        {/* Projected */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-3 h-0.5 bg-amber-700 rounded" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Projected</span>
          </div>
          <p className={`font-semibold text-muted-foreground ${compact ? 'text-base' : 'text-lg'}`}>{formatCurrencyCompact(data.projected)}</p>
        </div>
        {/* Pace */}
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Pace</span>
          </div>
          <p className={`font-bold ${compact ? 'text-base' : 'text-lg'} ${data.pacing >= data.projected ? 'text-emerald-600' : 'text-amber-600'}`}>
            {formatCurrencyCompact(data.pacing)}
          </p>
        </div>
      </div>
      
      {/* Progress bar visualization */}
      <div className="space-y-1.5">
        {/* Actual bar */}
        <div className="flex items-center gap-2">
          <div className="w-16 text-[10px] text-muted-foreground">Actual</div>
          <div className={`flex-1 bg-muted/30 rounded-full overflow-hidden relative ${compact ? 'h-3' : 'h-4'}`}>
            <div 
              className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (data.actual / maxVal) * 100)}%` }}
            />
            {/* Projected line marker */}
            <div 
              className="absolute top-0 h-full w-0.5 bg-amber-700"
              style={{ left: `${Math.min(100, (data.projected / maxVal) * 100)}%` }}
            />
          </div>
        </div>
        {/* Pace bar */}
        <div className="flex items-center gap-2">
          <div className="w-16 text-[10px] text-muted-foreground">Pace</div>
          <div className={`flex-1 bg-muted/30 rounded-full overflow-hidden relative ${compact ? 'h-3' : 'h-4'}`}>
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                data.pacing >= data.projected 
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' 
                  : 'bg-gradient-to-r from-amber-500 to-amber-400'
              }`}
              style={{ width: `${Math.min(100, (data.pacing / maxVal) * 100)}%` }}
            />
            {/* Projected line marker */}
            <div 
              className="absolute top-0 h-full w-0.5 bg-amber-700"
              style={{ left: `${Math.min(100, (data.projected / maxVal) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {lyComparison && (
        <p className={`text-xs mt-2 font-medium ${lyComparison.isPositive ? 'text-green-600' : 'text-red-600'}`}>
          vs LY: {formatCurrencyCompact(lyComparison.lastYear)} ({lyComparison.isPositive ? '+' : ''}{lyComparison.percent}%)
        </p>
      )}
    </div>
  );
}

export function SalesProgressChartSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <Skeleton className={`flex-1 ${compact ? 'h-10' : 'h-12'}`} />
        <Skeleton className={`flex-1 ${compact ? 'h-10' : 'h-12'}`} />
        <Skeleton className={`flex-1 ${compact ? 'h-10' : 'h-12'}`} />
      </div>
      <Skeleton className={`w-full ${compact ? 'h-3' : 'h-4'}`} />
      <Skeleton className={`w-full ${compact ? 'h-3' : 'h-4'}`} />
    </div>
  );
}
