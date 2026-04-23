import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import type { TrackerDisplayMode, TrackerRankMetric, TrackerScopeType } from './AddWidgetDialog';

interface TrackerConfig {
  id: string;
  title: string;
  trackerDisplayMode?: TrackerDisplayMode;
  trackerScope?: { type: TrackerScopeType; role?: string };
  trackerItemRefs?: string[];
  trackerPromoStart?: string | null;
  trackerPromoEnd?: string | null;
  trackerLocationRefs?: string[];
  trackerRankMetrics?: TrackerRankMetric[];
}

interface TrackerWidgetProps {
  tracker: TrackerConfig;
}

type PeriodKey = 'day' | 'wtd' | 'promo';
type TrackerSortMetric = 'units' | 'sales' | 'pmix';

interface StoreRankRow {
  locationId: string;
  locationName: string;
  units: number;
  sales: number;
  pmix: number;
  totalSales: number;
  itemStats: Record<string, { units: number; sales: number; pmix: number }>;
  rank: number;
}

const TRACKER_TZ = 'America/Los_Angeles';

const money = (value: number) => `$${Math.round(value).toLocaleString()}`;
const number = (value: number) => Math.round(value).toLocaleString();
const percent = (value: number) => `${value.toFixed(1)}%`;
const PERIOD_MODES: PeriodKey[] = ['day', 'wtd', 'promo'];
const PERIOD_LABELS: Record<PeriodKey, string> = {
  day: 'Today',
  wtd: 'This Week',
  promo: 'Campaign',
};

function normalizeMix(rowMix: unknown): Array<{ itemName: string; quantity: number; netSales: number }> {
  const mix = typeof rowMix === 'string' ? JSON.parse(rowMix) : rowMix;
  if (!Array.isArray(mix)) return [];
  return mix.map((item: any) => ({
    itemName: String(item.itemName || item.item_name || item.name || '').trim(),
    quantity: Number(item.quantity) || 0,
    netSales: Number(item.netSales ?? item.net_sales ?? item.sales) || 0,
  }));
}

export function TrackerWidget({ tracker }: TrackerWidgetProps) {
  const { currentLocation, locations } = useAppLocation();
  const [period, setPeriod] = useState<PeriodKey>('day');
  const [expanded, setExpanded] = useState(false);
  const [sortMetric, setSortMetric] = useState<TrackerSortMetric>('pmix');
  const [selectedItemRef, setSelectedItemRef] = useState<string>('all');

  const today = DateTime.now().setZone(TRACKER_TZ).toFormat('yyyy-MM-dd');
  const wtdStart = DateTime.now().setZone(TRACKER_TZ).minus({ days: DateTime.now().setZone(TRACKER_TZ).weekday - 1 }).toFormat('yyyy-MM-dd');
  const promoStart = tracker.trackerPromoStart || wtdStart;
  const promoEnd = tracker.trackerPromoEnd || today;
  const trackedItemRefs = tracker.trackerItemRefs || [];
  const trackedItems = trackedItemRefs.map(item => item.toLowerCase());
  const locationPool = tracker.trackerLocationRefs?.length ? tracker.trackerLocationRefs : locations.map(location => location.id);

  const range = period === 'day'
    ? { start: today, end: today }
    : period === 'wtd'
      ? { start: wtdStart, end: today }
      : { start: promoStart, end: promoEnd };

  const { data: ranking = [], isLoading } = useQuery({
    queryKey: ['dashboard-tracker-ranking', tracker.id, locationPool, trackedItems, range.start, range.end],
    queryFn: async () => {
      if (!currentLocation?.id || locationPool.length === 0 || trackedItems.length === 0) return [];

      const { data, error } = await supabase
        .from('sales_cache')
        .select('location_id, sale_date, net_sales, product_mix')
        .in('location_id', locationPool)
        .gte('sale_date', range.start)
        .lte('sale_date', range.end)
        .not('product_mix', 'is', null);

      if (error) throw error;

      const byLocation = new Map<string, StoreRankRow>();
      for (const locationId of locationPool) {
        const location = locations.find(loc => loc.id === locationId);
        byLocation.set(locationId, {
          locationId,
          locationName: location?.name || 'Store',
          units: 0,
          sales: 0,
          pmix: 0,
          totalSales: 0,
          itemStats: Object.fromEntries(trackedItemRefs.map(item => [item, { units: 0, sales: 0, pmix: 0 }])),
          rank: 0,
        });
      }

      for (const row of data || []) {
        const entry = byLocation.get(row.location_id);
        if (!entry) continue;
        entry.totalSales += Number(row.net_sales) || 0;
        for (const item of normalizeMix(row.product_mix)) {
          const matchedRef = trackedItemRefs.find(target => item.itemName.toLowerCase().includes(target.toLowerCase()));
          if (matchedRef) {
            entry.units += item.quantity;
            entry.sales += item.netSales;
            entry.itemStats[matchedRef] ||= { units: 0, sales: 0, pmix: 0 };
            entry.itemStats[matchedRef].units += item.quantity;
            entry.itemStats[matchedRef].sales += item.netSales;
          }
        }
      }

      return Array.from(byLocation.values())
        .map(store => ({
          ...store,
          pmix: store.totalSales > 0 ? (store.sales / store.totalSales) * 100 : 0,
          itemStats: Object.fromEntries(Object.entries(store.itemStats).map(([name, stats]) => [
            name,
            { ...stats, pmix: store.totalSales > 0 ? (stats.sales / store.totalSales) * 100 : 0 },
          ])),
        }));
    },
    enabled: !!currentLocation?.id,
    staleTime: 60 * 1000,
  });

  const activeItemRef = selectedItemRef !== 'all' && trackedItemRefs.includes(selectedItemRef) ? selectedItemRef : 'all';
  const getMetricValue = (store: StoreRankRow, metric: TrackerSortMetric) => {
    if (activeItemRef === 'all') return store[metric];
    return store.itemStats[activeItemRef]?.[metric] || 0;
  };

  const sortedRanking = useMemo(() => {
    return [...ranking]
      .sort((a, b) => getMetricValue(b, sortMetric) - getMetricValue(a, sortMetric) || getMetricValue(b, 'units') - getMetricValue(a, 'units') || getMetricValue(b, 'sales') - getMetricValue(a, 'sales') || getMetricValue(b, 'pmix') - getMetricValue(a, 'pmix'))
      .map((store, index) => ({ ...store, rank: index + 1 }));
  }, [ranking, sortMetric, activeItemRef]);
  const myStore = useMemo(() => sortedRanking.find(store => store.locationId === currentLocation?.id), [sortedRanking, currentLocation?.id]);
  const myVisibleStats = activeItemRef === 'all'
    ? { units: myStore?.units || 0, sales: myStore?.sales || 0, pmix: myStore?.pmix || 0 }
    : myStore?.itemStats[activeItemRef] || { units: 0, sales: 0, pmix: 0 };
  const rankMetrics = tracker.trackerRankMetrics?.length ? tracker.trackerRankMetrics : ['units', 'sales', 'pmix'];
  const canExpand = tracker.trackerDisplayMode === 'expandable';
  const promoName = tracker.title && tracker.title !== 'Promo Tracker'
    ? tracker.title
    : tracker.trackerItemRefs?.[0] || 'Promo';

  const cyclePeriod = (direction: 'prev' | 'next') => {
    const index = PERIOD_MODES.indexOf(period);
    const nextIndex = direction === 'next'
      ? (index + 1) % PERIOD_MODES.length
      : (index - 1 + PERIOD_MODES.length) % PERIOD_MODES.length;
    setPeriod(PERIOD_MODES[nextIndex]);
  };

  const MetricButton = ({ metric, label, value }: { metric: TrackerSortMetric; label: string; value: string }) => (
    <button
      type="button"
      onClick={() => setSortMetric(metric)}
      className={`min-w-0 rounded-md border px-2 py-1 text-left transition-colors ${
        sortMetric === metric ? 'border-primary/35 bg-primary/10' : 'border-border/60 bg-muted/35 hover:bg-muted/60'
      }`}
    >
      <p className="text-[9px] font-medium uppercase leading-none text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold leading-none tabular-nums">{value}</p>
    </button>
  );

  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-lg shadow-background/20">
      <CardContent className="p-0">
        <div className="bg-primary px-3 py-2 text-primary-foreground">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase leading-none tracking-wider text-primary-foreground/65">Live promo</p>
            <Badge className="h-7 shrink-0 rounded-full border-0 bg-accent px-3 text-sm font-bold text-accent-foreground shadow-sm">#{myStore?.rank || '--'} <span className="font-medium opacity-80">of {sortedRanking.length || '--'}</span></Badge>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold leading-tight">{promoName}</h2>
            <div className="flex shrink-0 items-center rounded-full bg-primary-foreground/15 px-0.5 py-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => cyclePeriod('prev')}
                className="h-6 w-6 rounded-full p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => cyclePeriod('next')}
                className="min-w-16 select-none rounded-full px-1.5 text-center text-xs font-semibold leading-6 transition-colors hover:bg-primary-foreground/10"
              >
                {PERIOD_LABELS[period]}
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => cyclePeriod('next')}
                className="h-6 w-6 rounded-full p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-3 bg-card px-3 py-3">
          {trackedItemRefs.length > 1 && (
            <div className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {['all', ...trackedItemRefs].map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSelectedItemRef(item)}
                  className={`h-7 max-w-32 shrink-0 truncate rounded-md border px-2 text-[11px] font-semibold transition-colors ${
                    activeItemRef === item ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/70 bg-muted/25 text-muted-foreground'
                  }`}
                >
                  {item === 'all' ? 'All promo' : item}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {rankMetrics.includes('units') && <MetricButton metric="units" label="Units" value={isLoading ? '--' : number(myVisibleStats.units)} />}
            {rankMetrics.includes('sales') && <MetricButton metric="sales" label="Sales" value={isLoading ? '--' : money(myVisibleStats.sales)} />}
            {rankMetrics.includes('pmix') && <MetricButton metric="pmix" label="PMIX" value={isLoading ? '--' : percent(myVisibleStats.pmix)} />}
          </div>
        </div>

        {canExpand && (
          <Button variant="ghost" size="sm" className="h-9 w-full justify-between rounded-none border-t border-border/60 px-3 text-xs font-semibold text-muted-foreground" onClick={() => setExpanded(value => !value)}>
            See all {sortedRanking.length || '--'} locations <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        )}

        {canExpand && expanded && (
          <div className="space-y-1 pt-0.5">
            {trackedItemRefs.length > 1 && myStore && (
              <div className="rounded-md border border-border/60 bg-muted/25 px-1.5 py-1">
                <div className="grid grid-cols-[1fr_3rem_3.6rem_3rem] gap-1 px-0.5 text-[9px] font-medium uppercase text-muted-foreground">
                  <span>My items</span>
                  <span className="text-right">Units</span>
                  <span className="text-right">Sales</span>
                  <span className="text-right">PMIX</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {trackedItemRefs.map(item => {
                    const stats = myStore.itemStats[item] || { units: 0, sales: 0, pmix: 0 };
                    return (
                      <div key={item} className="grid grid-cols-[1fr_3rem_3.6rem_3rem] items-center gap-1 rounded bg-background/55 px-1 py-1 text-[10px]">
                        <span className="truncate font-medium">{item}</span>
                        <span className="text-right tabular-nums">{number(stats.units)}</span>
                        <span className="text-right tabular-nums">{money(stats.sales)}</span>
                        <span className="text-right tabular-nums">{percent(stats.pmix)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-[1.75rem_1fr_3.1rem_3.6rem_3rem] items-center gap-1 px-1.5 text-[10px] font-medium uppercase text-muted-foreground">
              <span>#</span>
              <span>Store</span>
              {(['units', 'sales', 'pmix'] as TrackerSortMetric[]).map(metric => (
                <button key={metric} type="button" onClick={() => setSortMetric(metric)} className="flex items-center justify-end gap-0.5">
                  {metric === 'units' ? 'Items' : metric === 'sales' ? 'Sales' : 'PMIX'}
                  {sortMetric === metric && <ArrowDown className="h-2.5 w-2.5" />}
                </button>
              ))}
            </div>
            {sortedRanking.slice(0, 20).map(store => (
              <div key={store.locationId} className="grid grid-cols-[1.75rem_1fr_3.1rem_3.6rem_3rem] items-center gap-1 rounded-md bg-muted/45 px-1.5 py-1.5 text-[11px]">
                <span className="font-semibold">#{store.rank}</span>
                <span className="truncate">{store.locationName}</span>
                <span className="text-right font-medium tabular-nums">{number(getMetricValue(store, 'units'))}</span>
                <span className="text-right font-medium tabular-nums">{money(getMetricValue(store, 'sales'))}</span>
                <span className="text-right font-medium tabular-nums">{percent(getMetricValue(store, 'pmix'))}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}