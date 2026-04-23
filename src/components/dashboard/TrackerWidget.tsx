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
  trackerPromoImageUrl?: string | null;
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
  const totalLocationCount = locationPool.length;
  const rankChipLabel = isLoading ? '#--/--' : `#${myStore?.rank ?? '-'}/${totalLocationCount || '-'}`;
  const myVisibleStats = activeItemRef === 'all'
    ? { units: myStore?.units || 0, sales: myStore?.sales || 0, pmix: myStore?.pmix || 0 }
    : myStore?.itemStats[activeItemRef] || { units: 0, sales: 0, pmix: 0 };
  const rankMetrics = tracker.trackerRankMetrics?.length ? tracker.trackerRankMetrics : ['units', 'sales', 'pmix'];
  const canExpand = tracker.trackerDisplayMode === 'expandable';
  const promoName = tracker.title && tracker.title !== 'Promo Tracker'
    ? tracker.title
    : tracker.trackerItemRefs?.[0] || 'Promo';
  const promoImageUrl = tracker.trackerPromoImageUrl?.trim();

  const cyclePeriod = (direction: 'prev' | 'next') => {
    const index = PERIOD_MODES.indexOf(period);
    const nextIndex = direction === 'next'
      ? (index + 1) % PERIOD_MODES.length
      : (index - 1 + PERIOD_MODES.length) % PERIOD_MODES.length;
    setPeriod(PERIOD_MODES[nextIndex]);
  };

  const itemSwitchOptions = ['all', ...trackedItemRefs];
  const cycleSelectedItem = (direction: 'prev' | 'next') => {
    const currentIndex = Math.max(0, itemSwitchOptions.indexOf(activeItemRef));
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % itemSwitchOptions.length
      : (currentIndex - 1 + itemSwitchOptions.length) % itemSwitchOptions.length;
    setSelectedItemRef(itemSwitchOptions[nextIndex]);
  };

  const MetricButton = ({ metric, label, value }: { metric: TrackerSortMetric; label: string; value: string }) => (
    <button
      type="button"
      onClick={() => setSortMetric(metric)}
      className={`min-w-0 flex-1 rounded-md border px-2 py-1 text-left transition-colors ${
        sortMetric === metric ? 'border-primary/35 bg-primary/10' : 'border-border/60 bg-muted/35 hover:bg-muted/60'
      }`}
    >
      <p className="text-[9px] font-medium uppercase leading-none text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold leading-none tabular-nums">{value}</p>
    </button>
  );

  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-lg shadow-background/20">
      <CardContent className="p-0 md:p-0">
        <div className="relative min-h-[58px] overflow-hidden bg-primary text-primary-foreground">
          {promoImageUrl && (
            <>
              <img src={promoImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-background/30" />
              <div className="absolute inset-0 bg-gradient-to-r from-background/35 via-background/10 to-background/35" />
            </>
          )}
          <div className="relative z-10 w-[68%] px-3 py-2 pr-5">
            <div className="inline-flex max-w-full flex-col rounded-md border border-background/20 bg-foreground/50 px-2.5 py-1.5 text-background shadow-md shadow-foreground/15 backdrop-blur-md">
              <p className="shrink-0 text-[10px] font-bold uppercase leading-none tracking-wider text-background/70">Live promo</p>
              <h2 className="mt-1 min-w-0 max-w-full truncate text-sm font-semibold leading-tight">{promoName}</h2>
            </div>
          </div>
        </div>

        <div className="relative z-20 -mt-px flex justify-center px-3">
          <div className="flex max-w-full items-stretch overflow-hidden rounded-b-md border border-t-0 border-border/70 bg-card/95 text-card-foreground shadow-md shadow-background/15 backdrop-blur-md">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cycleSelectedItem('prev')}
              className="h-8 w-8 shrink-0 rounded-none p-0 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={() => cycleSelectedItem('next')}
              className="h-8 min-w-[112px] max-w-[188px] truncate bg-card px-3 text-center text-[11px] font-bold uppercase tracking-wide text-foreground transition-colors hover:bg-muted/50"
            >
              {activeItemRef === 'all' ? 'All promo' : activeItemRef}
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cycleSelectedItem('next')}
              className="h-8 w-8 shrink-0 rounded-none p-0 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="relative z-20 flex justify-center px-3">
          <div className="flex max-w-full gap-2 overflow-x-auto py-3 scrollbar-none">
            {PERIOD_MODES.map(periodKey => {
              const active = period === periodKey;
                return (
                  <button
                    key={periodKey}
                    type="button"
                    onClick={() => setPeriod(periodKey)}
                    className={`h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
                      active
                        ? 'border-border/80 bg-muted/65 text-foreground'
                        : 'border-border/70 bg-muted/35 text-foreground hover:bg-muted/60'
                    }`}
                  >
                    {PERIOD_LABELS[periodKey]}
                  </button>
                );
              })}
          </div>
        </div>

        <div className="space-y-3 bg-card px-3 pb-3 pt-0">
          <div className="flex gap-2">
            {rankMetrics.includes('units') && <MetricButton metric="units" label="Units" value={isLoading ? '--' : number(myVisibleStats.units)} />}
            {rankMetrics.includes('sales') && <MetricButton metric="sales" label="Sales" value={isLoading ? '--' : money(myVisibleStats.sales)} />}
            {rankMetrics.includes('pmix') && <MetricButton metric="pmix" label="PMIX" value={isLoading ? '--' : percent(myVisibleStats.pmix)} />}
            <button
              type="button"
              disabled={!canExpand}
              onClick={() => canExpand && setExpanded(value => !value)}
              className="ml-auto flex min-w-[72px] items-center justify-between gap-1 rounded-md border border-accent/45 bg-accent px-2 py-1 text-left text-accent-foreground shadow-sm transition-colors enabled:hover:bg-accent/90 disabled:cursor-default"
            >
              <span className="min-w-0">
                <p className="text-[9px] font-medium uppercase leading-none text-accent-foreground/75">Rank</p>
                <p className="mt-0.5 truncate text-[13px] font-bold leading-none tabular-nums">{rankChipLabel}</p>
              </span>
              {canExpand && <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />}
            </button>
          </div>
        </div>

        {canExpand && expanded && (
          <div className="space-y-1 pt-0.5">
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
              <div
                key={store.locationId}
                className={`grid grid-cols-[1.75rem_1fr_3.1rem_3.6rem_3rem] items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] ${
                  store.locationId === currentLocation?.id
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'bg-muted/45'
                }`}
              >
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