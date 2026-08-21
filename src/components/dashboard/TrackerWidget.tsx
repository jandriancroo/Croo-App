import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import type { TrackerDisplayMode, TrackerRankMetric, TrackerScopeType } from './AddWidgetDialog';
import { PROMO_BANNER_ASPECT_CLASS, PromoImageLayers } from './PromoBannerPreview';


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
      className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${
        sortMetric === metric ? 'border-primary/35 bg-primary/10' : 'border-border/60 bg-muted/40 hover:bg-muted/60'
      }`}
    >
      <p className="text-[9px] font-medium uppercase leading-none text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold leading-none tabular-nums">{value}</p>
    </button>
  );

  return (
    <Card className="overflow-hidden rounded-[26px] border-transparent bg-transparent shadow-none">
      <CardContent className="p-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => canExpand && setExpanded(v => !v)}
            className="relative block w-full aspect-[4/2.3] overflow-hidden text-left shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]"
            onTouchStart={handleItemTouchStart}
            onTouchEnd={handleItemTouchEnd}
          >
            {promoImageUrl ? (
              <img src={promoImageUrl} alt={tracker.title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="absolute inset-0 bg-primary" />
            )}

            {/* Subtle bottom fade for the pill to read clearly */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />

            {/* Glass bubble overlay */}
            <div className="pointer-events-none absolute inset-0 rounded-[26px] border-[0.5px] border-white/35 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_4px_12px_rgba(0,0,0,0.2)]" />


            <div className="absolute left-3 top-3 inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-white/30 bg-black/60 px-3 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
              </span>
              LIVE
            </div>

            <div className="absolute right-3 top-3 inline-flex h-6 items-center overflow-hidden rounded-full border border-white/30 bg-black/40 p-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-sm">
              {PERIOD_MODES.map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPeriod(key); }}
                  className={`px-2.5 py-1 transition-colors ${period === key ? 'rounded-full bg-white text-black' : 'text-white/80 hover:text-white'}`}
                >
                  {PERIOD_LABELS[key]}
                </button>
              ))}
            </div>

            <div className="absolute left-3 top-[3.25rem] right-3">
              <p className="truncate text-2xl font-black leading-none text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.6)]">{tracker.title}</p>
            </div>

            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="flex h-7 w-full items-center overflow-hidden rounded-full border border-white/30 bg-black/40 p-0.5 text-[10px] font-bold shadow-lg backdrop-blur-sm">
                {/* Item selector as the white selected segment */}
                <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-white px-1.5 py-1 text-black">
                  {itemSwitchOptions.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cycleItem('prev'); }}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10"
                      aria-label="Previous item"
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                  )}
                  <span className="max-w-[100px] truncate">{activeItemLabel}</span>
                  {itemSwitchOptions.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cycleItem('next'); }}
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10"
                      aria-label="Next item"
                    >
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Ranking metrics on the dark glass remainder - scrollable on narrow screens */}
                <div className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap px-2 py-1 text-white no-scrollbar">
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Trophy className="h-2.5 w-2.5 shrink-0" />
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/80">Rank</span>
                      <span className="shrink-0 tabular-nums">#{isPending ? '-' : myStore?.rank ?? '-'} / {totalLocationCount || '-'}</span>
                    </div>
                    {rankMetrics.includes('units') && (
                      <div className="flex items-center gap-1">
                        <span className="h-2.5 w-px shrink-0 bg-white/25" />
                        <span className="shrink-0 tabular-nums">{isPending ? '--' : number(myVisibleStats.units)} sold</span>
                      </div>
                    )}
                  </div>
                </div>

                {canExpand && (
                  <div className="flex shrink-0 items-center px-2 py-1 text-white/80">
                    <span className="h-3 w-px bg-white/25" />
                    <span className="ml-1.5">
                      {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>

        {canExpand && expanded && (
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 text-xs font-bold text-foreground">
                {itemSwitchOptions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => cycleItem('prev')}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted"
                    aria-label="Previous item"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                <span className="min-w-0 truncate">{activeItemLabel}</span>
                {itemSwitchOptions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => cycleItem('next')}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted"
                    aria-label="Next item"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ranking</span>
            </div>

            <div className="flex gap-2">
              {rankMetrics.includes('units') && <MetricButton metric="units" label="Units" value={isPending ? '--' : number(myVisibleStats.units)} />}
              {rankMetrics.includes('sales') && <MetricButton metric="sales" label="Sales" value={isPending ? '--' : money(myVisibleStats.sales)} />}
              {rankMetrics.includes('pmix') && <MetricButton metric="pmix" label="PMIX" value={isPending ? '--' : percent(myVisibleStats.pmix)} />}
            </div>

            <div className="rounded-xl border border-border/60 bg-background p-1 shadow-sm">
              <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="w-6">Rank</span>
                <span className="min-w-0 flex-1">Location</span>
                <button type="button" onClick={() => setSortMetric('units')} className="flex w-16 items-center justify-end gap-0.5">
                  Units {sortMetric === 'units' && <ArrowDown className="h-2.5 w-2.5" />}
                </button>
                <button type="button" onClick={() => setSortMetric('sales')} className="flex w-16 items-center justify-end gap-0.5">
                  Sales {sortMetric === 'sales' && <ArrowDown className="h-2.5 w-2.5" />}
                </button>
              </div>
              {sortedRanking.slice(0, 20).map((store, idx, arr) => (
                <div
                  key={store.locationId}
                  className={`flex items-center gap-2 px-2 py-2 text-[12px] ${
                    store.locationId === currentLocation?.id
                      ? 'rounded-lg bg-accent font-medium text-accent-foreground'
                      : idx !== arr.length - 1
                        ? 'border-b border-border/40'
                        : ''
                  }`}
                >
                  <span className="w-6 font-bold tabular-nums">#{store.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{store.locationName}</span>
                  <span className="w-16 text-right tabular-nums">{number(getMetricValue(store, 'units'))}</span>
                  <span className="w-16 text-right tabular-nums">{money(getMetricValue(store, 'sales'))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
