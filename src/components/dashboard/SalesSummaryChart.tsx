import { ResponsiveContainer, Tooltip, ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

export type SalesSummaryChartPeriod = 'daily' | 'weekly' | 'monthly';

export interface SalesSummaryHourlyPoint {
  hour: string;
  sales: number;
  projected?: number;
  laborPercent?: number;
  checksCount?: number;
}

export interface SalesSummaryWeeklyPoint {
  date: string; // yyyy-MM-dd
  sales: number;
  projected: number;
  laborPercent?: number;
}

export interface SalesSummaryMonthlyPoint {
  date: string; // yyyy-MM-dd
  sales: number;
  projected: number;
  laborPercent?: number;
  laborCost?: number;
}

export interface SalesSummaryChartProps {
  period: SalesSummaryChartPeriod;
  hourly?: SalesSummaryHourlyPoint[];
  weeklyBreakdown?: SalesSummaryWeeklyPoint[];
  monthlyBreakdown?: SalesSummaryMonthlyPoint[];
  pizzaCount?: number;
  compact?: boolean;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

export function SalesSummaryChart({
  period,
  hourly,
  weeklyBreakdown,
  monthlyBreakdown,
  pizzaCount = 0,
  compact = false,
}: SalesSummaryChartProps) {
  const isMobile = useIsMobile();

  // Consistent height across all periods for uniform layout
  const height = compact ? 200 : 280;

  // Consistent empty state height matching chart height
  const emptyHeight = compact ? 'h-[200px]' : 'h-[280px]';

  if (period === 'daily') {
    if (!hourly) {
      return (
        <div className={`${emptyHeight} flex items-center justify-center text-muted-foreground`}>
          No sales data available
        </div>
      );
    }

    // Calculate total hourly sales for pizza distribution
    let totalHourlySales = 0;
    for (const h of hourly) totalHourlySales += h.sales || 0;

    // Convert 24-hour format to 12-hour format for display
    const formatHourTo12Hr = (hourStr: string) => {
      const hourNum = parseInt(hourStr.split(':')[0], 10);
      if (isNaN(hourNum)) return hourStr;
      const suffix = hourNum >= 12 ? 'pm' : 'am';
      const hour12 = hourNum % 12 || 12;
      return `${hour12}${suffix}`;
    };

    const hourlyWithPizzas = hourly.map((h) => {
      const sales = h.sales || 0;
      return {
        ...h,
        hourLabel: formatHourTo12Hr(h.hour),
        estimatedPizzas:
          totalHourlySales > 0 && pizzaCount > 0
            ? Math.round((sales / totalHourlySales) * pizzaCount * 10) / 10
            : 0,
      };
    });

    const hasLaborData = hourlyWithPizzas.some((h) => (h.laborPercent || 0) > 0);

    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={hourlyWithPizzas}
          barCategoryGap="10%"
          margin={{ top: 5, right: 5, left: -15, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis
            dataKey="hourLabel"
            className="text-xs"
            tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }}
            interval="preserveStartEnd"
            angle={-45}
            textAnchor="end"
            height={50}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            className="text-xs"
            tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }}
            tickFormatter={(value) => `$${value}`}
            width={40}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload as any;
              return (
                <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                  <p className="font-medium">{label}</p>
                  <p className="text-muted-foreground">
                    Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span>
                  </p>
                  <p className="text-primary">
                    Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span>
                  </p>
                  {hasLaborData && data?.laborPercent !== undefined && data.laborPercent > 0 && (
                    <p className="text-orange-500">
                      Labor: <span className="font-medium">{Number(data.laborPercent).toFixed(1)}%</span>
                      {data?.laborCost > 0 && <span className="text-muted-foreground ml-1">({formatCurrency(data.laborCost)})</span>}
                    </p>
                  )}
                  {data?.estimatedPizzas > 0 && (
                    <p className="text-amber-600 flex items-center gap-1">
                      <span>🍕</span> Pizzas: <span className="font-medium">{data.estimatedPizzas}</span>
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Legend formatter={(value) => (value === 'Projected' ? 'Projected' : 'Actual')} wrapperStyle={{ fontSize: '12px' }} />
          <Area
            type="monotone"
            dataKey="projected"
            name="Projected"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={2}
            fill="hsl(var(--muted-foreground) / 0.15)"
          />
          <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  if (period === 'weekly') {
    if (!weeklyBreakdown || weeklyBreakdown.length === 0) {
      return (
        <div className={`${emptyHeight} flex items-center justify-center text-muted-foreground`}>
          No weekly data available
        </div>
      );
    }

    const hasWeeklyLabor = weeklyBreakdown.some((d) => (d.laborPercent || 0) > 0);

    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={weeklyBreakdown.map((d) => ({
            ...d,
            label: format(new Date(d.date + 'T00:00:00'), 'EEE'),
          }))}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} />
          <YAxis
            className="text-xs"
            tick={{ fill: 'hsl(var(--foreground))' }}
            tickFormatter={(value) => `$${value}`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload as any;
              return (
                <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                  <p className="font-medium">{format(new Date(data?.date + 'T00:00:00'), 'EEEE, MMM d')}</p>
                  <p className="text-muted-foreground">
                    Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span>
                  </p>
                  <p className="text-primary">
                    Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span>
                  </p>
                  {hasWeeklyLabor && data?.laborPercent !== undefined && data.laborPercent > 0 && (
                    <p className="text-blue-500">
                      Labor: <span className="font-medium">{Number(data.laborPercent).toFixed(1)}%</span>
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Legend formatter={(value) => (value === 'Projected' ? 'Projected' : 'Actual')} wrapperStyle={{ fontSize: '12px' }} />
          <Area
            type="monotone"
            dataKey="projected"
            name="Projected"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={2}
            fill="hsl(var(--muted-foreground) / 0.15)"
          />
          <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // MONTHLY
  if (!monthlyBreakdown || monthlyBreakdown.length === 0) {
    return (
      <div className={`${emptyHeight} flex items-center justify-center text-muted-foreground`}>
        No monthly data available
      </div>
    );
  }

  // In SalesSummary:
  // - Mobile shows weekly aggregated; desktop shows daily.
  // For Org Dash, use the same behavior and keep it deterministic.
  if (isMobile) {
    // Weekly aggregated view (Mon-Sun buckets)
    // Note: this is a minimal replica sufficient for the same chart style; it aggregates visible month data.
    const buckets: Array<{ label: string; sales: number; projected: number; dateRange: string }> = [];
    const bucketMap = new Map<string, { index: number; weekStart: Date; weekEnd: Date; sales: number; projected: number }>();

    for (const d of monthlyBreakdown) {
      const date = new Date(d.date + 'T00:00:00');
      // Monday week start
      const day = date.getDay();
      const diffToMonday = (day + 6) % 7;
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - diffToMonday);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const key = format(weekStart, 'yyyy-MM-dd');

      const existing = bucketMap.get(key);
      if (!existing) {
        const index = buckets.length;
        bucketMap.set(key, { index, weekStart, weekEnd, sales: 0, projected: 0 });
        buckets.push({
          label: format(weekStart, 'MMM d'),
          sales: 0,
          projected: 0,
          dateRange: `${format(weekStart, 'MMM d')}–${format(weekEnd, 'MMM d')}`,
        });
      }

      const b = bucketMap.get(key)!;
      b.sales += d.sales;
      b.projected += d.projected;
      const out = buckets[b.index];
      out.sales = b.sales;
      out.projected = b.projected;
    }

    return buckets.length > 0 ? (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={buckets} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
          <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} />
          <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={(value) => `$${value}`} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload as any;
              return (
                <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                  <p className="font-medium">{data?.dateRange || label}</p>
                  <p className="text-muted-foreground">
                    Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span>
                  </p>
                  <p className="text-primary">
                    Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span>
                  </p>
                </div>
              );
            }}
          />
          <Legend formatter={(value) => (value === 'Projected' ? 'Projected' : 'Actual')} wrapperStyle={{ fontSize: '12px' }} />
          <Area
            type="monotone"
            dataKey="projected"
            name="Projected"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={2}
            fill="hsl(var(--muted-foreground) / 0.15)"
          />
          <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    ) : (
      <div className="h-[200px] flex items-center justify-center text-muted-foreground">No monthly data available</div>
    );
  }

  const hasMonthlyLabor = monthlyBreakdown.some((d) => (d.laborPercent || 0) > 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={monthlyBreakdown.map((d) => ({
          ...d,
          label: format(new Date(d.date + 'T00:00:00'), 'd'),
        }))}
        barCategoryGap="5%"
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis
          dataKey="label"
          className="text-xs"
          tick={{ fill: 'hsl(var(--foreground))' }}
          interval={2}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          className="text-xs"
          tick={{ fill: 'hsl(var(--foreground))' }}
          tickFormatter={(value) => `$${value}`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const data = payload[0]?.payload as any;
            return (
              <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                <p className="font-medium">{data?.date ? format(new Date(data.date + 'T00:00:00'), 'EEEE, MMM d') : ''}</p>
                <p className="text-muted-foreground">
                  Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span>
                </p>
                <p className="text-primary">
                  Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span>
                </p>
                {hasMonthlyLabor && data?.laborPercent !== undefined && data.laborPercent > 0 && (
                  <p className="text-blue-500">
                    Labor: <span className="font-medium">{Number(data.laborPercent).toFixed(1)}%</span>
                    {data?.laborCost > 0 && <span className="text-muted-foreground ml-1">({formatCurrency(data.laborCost)})</span>}
                  </p>
                )}
              </div>
            );
          }}
        />
        <Legend formatter={(value) => (value === 'Projected' ? 'Projected' : 'Actual')} wrapperStyle={{ fontSize: '12px' }} />
        <Area
          type="monotone"
          dataKey="projected"
          name="Projected"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={2}
          fill="hsl(var(--muted-foreground) / 0.15)"
        />
        <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SalesSummaryChartSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className={`w-full ${compact ? 'h-[200px]' : 'h-[280px]'}`} />
    </div>
  );
}
