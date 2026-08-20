import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
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
  trackerLocationScope?: 'org' | 'brand';
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

const DEFAULT_TRACKER_TZ = 'America/Los_Angeles';

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
  const { timezone: locTimezone } = useLocationTimezone();
  const TRACKER_TZ = locTimezone || DEFAULT_TRACKER_TZ;
  const [period, setPeriod] = useState<PeriodKey>('day');
  const [expanded, setExpanded] = useState(false);
  const [sortMetric, setSortMetric] = useState<TrackerSortMetric>('pmix');
  const [selectedItemRef, setSelectedItemRef] = useState<string>(() => tracker.trackerItemRefs?.[0] || '');
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const touchStartXRef = useRef<number | null>(null);

  const today = DateTime.now().setZone(TRACKER_TZ).toFormat('yyyy-MM-dd');
  const wtdStart = DateTime.now().setZone(TRACKER_TZ).minus({ days: DateTime.now().setZone(TRACKER_TZ).weekday - 1 }).toFormat('yyyy-MM-dd');
  const promoStart = tracker.trackerPromoStart || wtdStart;
  const promoEnd = tracker.trackerPromoEnd || today;
  const trackedItemRefs = tracker.trackerItemRefs || [];
  const trackedItems = trackedItemRefs.map(item => item.toLowerCase());
  const isBrandScope = tracker.trackerLocationScope === 'brand';

  const range = period === 'day'
    ? { start: today, end: today }
    : period === 'wtd'
      ? { start: wtdStart, end: today }
      : { start: promoStart, end: promoEnd };

  // Higher-level scopes (brand/org) must always recompute the live pool — ignore any stale trackerLocationRefs snapshot
  const explicitRefs =
    !(isBrandScope || tracker.trackerLocationScope === 'org') &&
    tracker.trackerLocationRefs?.length
      ? tracker.trackerLocationRefs
      : null;

  const { data: rpcResult, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard-tracker-ranking-rpc', tracker.id, currentLocation?.id, isBrandScope, explicitRefs, trackedItems, range.start, range.end],
    queryFn: async () => {
      if (!currentLocation?.id || trackedItems.length === 0) return { rows: [] as StoreRankRow[] };

      const { data, error } = await supabase.rpc('get_tracker_ranking', {
        _location_id: currentLocation.id,
        _scope: isBrandScope ? 'brand' : 'org',
        _location_refs: explicitRefs,
        _start_date: range.start,
        _end_date: range.end,
      });
      if (error) throw error;

      const byLocation = new Map<string, StoreRankRow>();
      for (const row of (data || []) as any[]) {
        let entry = byLocation.get(row.location_id);
        if (!entry) {
          entry = {
            locationId: row.location_id,
            locationName: row.location_name || 'Store',
            units: 0,
            sales: 0,
            pmix: 0,
            totalSales: 0,
            itemStats: Object.fromEntries(trackedItemRefs.map(item => [item, { units: 0, sales: 0, pmix: 0 }])),
            rank: 0,
          };
          byLocation.set(row.location_id, entry);
        }
        if (row.product_mix == null) continue;
        entry.totalSales += Number(row.net_sales) || 0;
        for (const item of normalizeMix(row.product_mix)) {
          const itemNameLower = item.itemName.toLowerCase();
          // Match most-specific (longest) ref first so "Prosciutto Pizza (Large)" wins over "Prosciutto Pizza"
          const matchedRef = [...trackedItemRefs]
            .sort((a, b) => b.length - a.length)
            .find(target => itemNameLower.includes(target.toLowerCase()));
          if (matchedRef) {
            entry.units += item.quantity;
            entry.sales += item.netSales;
            entry.itemStats[matchedRef] ||= { units: 0, sales: 0, pmix: 0 };
            entry.itemStats[matchedRef].units += item.quantity;
            entry.itemStats[matchedRef].sales += item.netSales;
          }
        }
      }

      const rows = Array.from(byLocation.values()).map(store => ({
        ...store,
        pmix: store.totalSales > 0 ? (store.sales / store.totalSales) * 100 : 0,
        itemStats: Object.fromEntries(Object.entries(store.itemStats).map(([name, stats]) => [
          name,
          { ...stats, pmix: store.totalSales > 0 ? (stats.sales / store.totalSales) * 100 : 0 },
        ])),
      }));
      return { rows };
    },
    enabled: !!currentLocation?.id,
    staleTime: 60 * 1000,
  });

  const ranking = rpcResult?.rows || [];

  const ALL_ITEMS = '__ALL__';
  // Include a synthetic "All Items" option when tracking more than one item so users can see combined ranking.
  const itemSwitchOptions = trackedItemRefs.length > 1 ? [ALL_ITEMS, ...trackedItemRefs] : trackedItemRefs;
  const activeItemRef = itemSwitchOptions.includes(selectedItemRef)
    ? selectedItemRef
    : itemSwitchOptions[0] || '';
  const isAllItems = activeItemRef === ALL_ITEMS;
  const getMetricValue = (store: StoreRankRow, metric: TrackerSortMetric) => {
    if (!activeItemRef || isAllItems) return store[metric];
    return store.itemStats[activeItemRef]?.[metric] || 0;
  };

  const sortedRanking = useMemo(() => {
    return [...ranking]
      .sort((a, b) => getMetricValue(b, sortMetric) - getMetricValue(a, sortMetric) || getMetricValue(b, 'units') - getMetricValue(a, 'units') || getMetricValue(b, 'sales') - getMetricValue(a, 'sales') || getMetricValue(b, 'pmix') - getMetricValue(a, 'pmix'))
      .map((store, index) => ({ ...store, rank: index + 1 }));
  }, [ranking, sortMetric, activeItemRef]);
  const myStore = useMemo(() => sortedRanking.find(store => store.locationId === currentLocation?.id), [sortedRanking, currentLocation?.id]);
  const totalLocationCount = sortedRanking.length;
  const isPending = isLoading || isFetching || !currentLocation?.id || !rpcResult;
  const rankChipLabel = isPending ? '#--/--' : `#${myStore?.rank ?? '-'}/${totalLocationCount || '-'}`;
  const myVisibleStats = !activeItemRef || isAllItems
    ? { units: myStore?.units || 0, sales: myStore?.sales || 0, pmix: myStore?.pmix || 0 }
    : myStore?.itemStats[activeItemRef] || { units: 0, sales: 0, pmix: 0 };
  const rankMetrics = tracker.trackerRankMetrics?.length ? tracker.trackerRankMetrics : ['units', 'sales', 'pmix'];
  const canExpand = tracker.trackerDisplayMode === 'expandable';
  const promoImageUrl = tracker.trackerPromoImageUrl?.trim();

  const activeItemLabel = isAllItems ? 'All Items' : (activeItemRef || 'Promo item');
  const activePeriodLabel = PERIOD_LABELS[period];

  const cyclePeriod = (direction: 'prev' | 'next') => {
    const currentIndex = PERIOD_MODES.indexOf(period);
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % PERIOD_MODES.length
      : (currentIndex - 1 + PERIOD_MODES.length) % PERIOD_MODES.length;
    setPeriod(PERIOD_MODES[nextIndex]);
  };

  const cycleItem = (direction: 'prev' | 'next') => {
    if (itemSwitchOptions.length <= 1) return;
    const currentIndex = Math.max(0, itemSwitchOptions.indexOf(activeItemRef));
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % itemSwitchOptions.length
      : (currentIndex - 1 + itemSwitchOptions.length) % itemSwitchOptions.length;
    setSelectedItemRef(itemSwitchOptions[nextIndex]);
  };

  const handleItemTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };
  const handleItemTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(dx) > 40) cycleItem(dx < 0 ? 'next' : 'prev');
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
    <Card className="overflow-visible border-border/50 bg-card shadow-lg shadow-background/20">
      <CardContent className="p-0 md:p-0">
        <div className={`relative ${PROMO_BANNER_ASPECT_CLASS} min-h-[88px] w-full rounded-t-lg bg-primary text-primary-foreground`}>
          {promoImageUrl && (
            <div className="absolute inset-0 overflow-hidden rounded-t-lg">
              <img src={promoImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              <PromoImageLayers />
            </div>
          )}

          <div className="absolute inset-0 z-40 flex items-center justify-center px-3">
            <div
              className="inline-flex max-w-full flex-col items-center gap-1 rounded-2xl border border-background/15 bg-foreground/35 px-3 py-1.5 text-background shadow-md shadow-foreground/15 backdrop-blur-md"
              onTouchStart={handleItemTouchStart}
              onTouchEnd={handleItemTouchEnd}
            >
              <span className="flex items-center gap-1.5 leading-none">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(142_76%_55%)]" />
                </span>
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-background/90">PROMO</span>
              </span>
              <div className="flex items-center gap-2">
                {itemSwitchOptions.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cycleItem('prev'); }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-background/75 transition-colors hover:bg-background/15 hover:text-background"
                    aria-label="Previous item"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <span className="min-w-0 truncate text-sm font-bold leading-tight">{activeItemLabel}</span>
                {itemSwitchOptions.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cycleItem('next'); }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-background/75 transition-colors hover:bg-background/15 hover:text-background"
                    aria-label="Next item"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={`flex items-center justify-between gap-2 bg-card text-[12px] rounded-b-lg px-[12px] my-0 py-[6px] ${canExpand && expanded ? '' : 'rounded-b-lg'}`}>
          <span className="min-w-0 truncate text-muted-foreground text-sm">
            You're <span className="font-bold text-orange-500">{rankChipLabel}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 font-medium tabular-nums text-muted-foreground">
            <span>{isLoading ? '--' : money(myVisibleStats.sales)} sales · {isLoading ? '--' : number(myVisibleStats.units)} units</span>
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={expanded ? 'Collapse rankings' : 'Expand rankings'}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </span>
        </div>

        {canExpand && expanded && (
          <>
            <div className="relative z-10 -mt-px flex justify-center px-6">
              <div className="flex max-w-full items-stretch overflow-hidden rounded-b-md border border-t-0 border-border/70 bg-card/95 text-foreground shadow-md shadow-background/15">
                <button
                  type="button"
                  onClick={() => cyclePeriod('prev')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center transition-colors hover:bg-muted/50"
                  aria-label="Previous period"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => cyclePeriod('next')}
                  className="flex h-8 min-w-[118px] items-center justify-center px-4 text-sm font-semibold leading-none transition-colors hover:bg-muted/50"
                >
                  <span className="truncate">{activePeriodLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => cyclePeriod('next')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center transition-colors hover:bg-muted/50"
                  aria-label="Next period"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-3 bg-card px-3 pb-3 pt-3">
              <div className="flex gap-2">
                {rankMetrics.includes('units') && <MetricButton metric="units" label="Units" value={isLoading ? '--' : number(myVisibleStats.units)} />}
                {rankMetrics.includes('sales') && <MetricButton metric="sales" label="Sales" value={isLoading ? '--' : money(myVisibleStats.sales)} />}
                {rankMetrics.includes('pmix') && <MetricButton metric="pmix" label="PMIX" value={isLoading ? '--' : percent(myVisibleStats.pmix)} />}
                <div className="ml-auto flex min-w-[72px] items-center justify-between gap-1 rounded-md border border-accent/45 bg-accent px-2 py-1 text-left text-accent-foreground shadow-sm">
                  <span className="min-w-0">
                    <p className="text-[9px] font-medium uppercase leading-none text-accent-foreground/75">Rank</p>
                    <p className="mt-0.5 truncate text-[13px] font-bold leading-none tabular-nums">{rankChipLabel}</p>
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-1 px-1 pb-2 pt-0.5">
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
          </>
        )}
      </CardContent>
    </Card>
  );
}