import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ArrowDown, ChevronDown, Trophy } from 'lucide-react';
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
    <Card className="overflow-hidden border-primary/20 bg-card/95 shadow-sm">
      <CardContent className="space-y-1.5 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Trophy className="h-3.5 w-3.5 text-primary" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold leading-tight">{promoName}</h2>
              <p className="truncate text-[10px] leading-tight text-muted-foreground">{activeItemRef === 'all' ? `${trackedItemRefs.length || 0} tracked item${trackedItemRefs.length === 1 ? '' : 's'}` : activeItemRef}</p>
            </div>
          </div>
          <Badge variant="secondary" className="h-6 shrink-0 rounded-full px-2 text-[11px] font-semibold">#{myStore?.rank || '--'} / {sortedRanking.length || '--'}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-0.5 rounded-md bg-muted/80 p-0.5">
          {(['day', 'wtd', 'promo'] as PeriodKey[]).map(key => (
            <Button key={key} size="sm" variant={period === key ? 'default' : 'ghost'} className="h-6 rounded text-[10px] font-semibold" onClick={() => setPeriod(key)}>
              {key === 'day' ? 'DAY' : key === 'wtd' ? 'WTD' : 'PROMO'}
            </Button>
          ))}
        </div>

        {trackedItemRefs.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['all', ...trackedItemRefs].map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setSelectedItemRef(item)}
                className={`h-6 max-w-28 shrink-0 truncate rounded-full border px-2 text-[10px] font-semibold transition-colors ${
                  activeItemRef === item ? 'border-primary/35 bg-primary/10 text-primary' : 'border-border/60 bg-muted/35 text-muted-foreground'
                }`}
              >
                {item === 'all' ? 'All items' : item}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-1">
          {rankMetrics.includes('units') && <MetricButton metric="units" label="Units" value={isLoading ? '--' : number(myVisibleStats.units)} />}
          {rankMetrics.includes('sales') && <MetricButton metric="sales" label="Sales" value={isLoading ? '--' : money(myVisibleStats.sales)} />}
          {rankMetrics.includes('pmix') && <MetricButton metric="pmix" label="PMIX" value={isLoading ? '--' : percent(myVisibleStats.pmix)} />}
        </div>

        {canExpand && (
          <Button variant="ghost" size="sm" className="h-6 w-full rounded-md text-[11px] text-muted-foreground" onClick={() => setExpanded(value => !value)}>
            Ranking List <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
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
                <span className="text-right font-medium tabular-nums">{number(store.units)}</span>
                <span className="text-right font-medium tabular-nums">{money(store.sales)}</span>
                <span className="text-right font-medium tabular-nums">{percent(store.pmix)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}