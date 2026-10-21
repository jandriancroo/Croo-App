import { Button } from '@/components/ui/button';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import type { TrackerRankMetric } from './AddWidgetDialog';
import { buildPromoSlides, campaignDay, type PromoTracker } from '@/lib/promoTrackers';
import { PromoHeroView, type PromoPeriodKey } from './promo/PromoHeroView';
import { usePrefersReducedMotion, usePromoAutoplay } from './promo/usePromoAutoplay';
import { promoBorderReactions } from '@/lib/promoBorders';

interface TrackerWidgetProps {
  promo: PromoTracker;
}

type PeriodKey = PromoPeriodKey;
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

function normalizeMix(rowMix: unknown): Array<{ itemName: string; quantity: number; netSales: number }> {
  const mix = typeof rowMix === 'string' ? JSON.parse(rowMix) : rowMix;
  if (!Array.isArray(mix)) return [];
  return mix.map((item: any) => ({
    itemName: String(item.itemName || item.item_name || item.name || '').trim(),
    quantity: Number(item.quantity) || 0,
    netSales: Number(item.netSales ?? item.net_sales ?? item.sales) || 0,
  }));
}

export function TrackerWidget({ promo }: TrackerWidgetProps) {
  const cfg = promo.config || {};
  const tracker = {
    id: promo.id,
    title: promo.title,
    trackerDisplayMode: cfg.tracker_display_mode,
    trackerItemRefs: cfg.tracker_item_refs || [],
    trackerPromoStart: promo.starts_on,
    trackerPromoEnd: promo.ends_on,
    trackerPromoImageUrl: cfg.tracker_promo_image_url,
    trackerRankMetrics: cfg.tracker_rank_metrics as TrackerRankMetric[] | undefined,
  };
  const { currentLocation } = useAppLocation();
  const { timezone: locTimezone } = useLocationTimezone();
  const TRACKER_TZ = locTimezone || DEFAULT_TRACKER_TZ;
  const slides = useMemo(() => buildPromoSlides(cfg), [cfg]);
  const [period, setPeriod] = useState<PeriodKey>('day');
  const [expanded, setExpanded] = useState(false);
  const [sortMetric, setSortMetric] = useState<TrackerSortMetric>('pmix');
  const [selectedItemRef, setSelectedItemRef] = useState<string>(() => slides[0]?.ref || tracker.trackerItemRefs[0] || '');
  const reducedMotion = usePrefersReducedMotion();

  const today = DateTime.now().setZone(TRACKER_TZ).toFormat('yyyy-MM-dd');
  const yesterday = DateTime.now().setZone(TRACKER_TZ).minus({ days: 1 }).toFormat('yyyy-MM-dd');
  const wtdStart = DateTime.now().setZone(TRACKER_TZ).minus({ days: DateTime.now().setZone(TRACKER_TZ).weekday - 1 }).toFormat('yyyy-MM-dd');
  const promoStart = tracker.trackerPromoStart || wtdStart;
  const promoEnd = tracker.trackerPromoEnd || today;
  const trackedItemRefs = tracker.trackerItemRefs;
  const trackedItems = trackedItemRefs.map(item => item.toLowerCase());
  // Ranking pool: brand promo = every store in the brand; org contest = its chosen stores (or the whole org).
  const isBrandScope = promo.owner_type === 'brand';

  const range = period === 'day'
    ? { start: today, end: today }
    : period === 'yday'
      ? { start: yesterday, end: yesterday }
      : period === 'wtd'
        ? { start: wtdStart, end: today }
        : { start: promoStart, end: promoEnd };

  const explicitRefs = !isBrandScope && promo.location_ids?.length ? promo.location_ids : null;

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


  const cycleItem = (direction: 'prev' | 'next') => {
    if (itemSwitchOptions.length <= 1) return;
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
      className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${
        sortMetric === metric ? 'border-primary/35 bg-primary/10' : 'border-border/60 bg-muted/40 hover:bg-muted/60'
      }`}
    >
      <p className="text-[9px] font-medium uppercase leading-none text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold leading-none tabular-nums">{value}</p>
    </button>
  );

  // ── Hero wiring ────────────────────────────────────────────────────────
  const slideRefs = slides.map(s => s.ref);
  const goToSlide = (dir: 'next' | 'prev') => {
    if (slideRefs.length <= 1) return;
    const i = Math.max(0, slideRefs.indexOf(activeItemRef));
    const n = dir === 'next' ? (i + 1) % slideRefs.length : (i - 1 + slideRefs.length) % slideRefs.length;
    setSelectedItemRef(slideRefs[n]);
  };
  const autoplay = usePromoAutoplay({
    enabled: cfg.tracker_autoplay !== false && !expanded,
    count: slides.length,
    onAdvance: () => goToSlide('next'),
  });
  // Expanding the list pauses autoplay.
  useEffect(() => { if (expanded) autoplay.setPaused(true); }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const day = campaignDay(promo.starts_on, promo.ends_on, TRACKER_TZ);
  const heroRank = isPending ? '#– of –' : `#${myStore?.rank ?? '–'} of ${totalLocationCount || '–'}`;
  const borderReactions = promoBorderReactions(sortedRanking, currentLocation?.id, activeItemRef, isPending);
  const heroSubtitle = trackedItemRefs.length === 0
    ? ''
    : isPending
      ? `${isAllItems ? 'All items' : activeItemLabel} · –`
      : `${isAllItems ? 'All items' : activeItemLabel} · ${number(myVisibleStats.units)}\u00A0sold`;

  return (
    <Card className="overflow-visible rounded-3xl border-transparent bg-transparent shadow-none">
      <CardContent className="p-0">
        <PromoHeroView
          title={tracker.title}
          slides={slides}
          activeRef={activeItemRef}
          subtitle={heroSubtitle}
          dayLabel={day ? `DAY ${day.day}/${day.total}` : null}
          rankLabel={heroRank}
          canExpand={canExpand}
          expanded={expanded}
          paused={autoplay.active && autoplay.paused}
          reducedMotion={reducedMotion}
          period={period}
          campaignImageUrl={promoImageUrl || null}
          border={cfg.tracker_border}
          borderWinner={!!cfg.tracker_border_winner && borderReactions.winner}
          borderClosing={!!cfg.tracker_border_closing && borderReactions.closing}
          borderPaused={autoplay.paused || cfg.tracker_autoplay === false || expanded || (typeof document !== 'undefined' && document.hidden)}
          onPeriodChange={setPeriod}
          onSelectSlide={(ref) => { setSelectedItemRef(ref); autoplay.setPaused(true); }}
          onRankTap={() => setExpanded(v => !v)}
          onLongPress={() => autoplay.setPaused(p => !p)}
          onSwipe={(dir) => { goToSlide(dir); autoplay.setPaused(true); }}
        />

        {canExpand && expanded && (
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 text-xs font-bold text-foreground">
                {itemSwitchOptions.length > 1 && (
                  <Button variant="ghost" size="icon-sm"
                   
                    onClick={() => cycleItem('prev')}
                    className="[&_svg]:size-auto flex shrink-0 items-center justify-center hover:bg-muted"
                    aria-label="Previous item"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <span className="min-w-0 truncate">{activeItemLabel}</span>
                {itemSwitchOptions.length > 1 && (
                  <Button variant="ghost" size="icon-sm"
                   
                    onClick={() => cycleItem('next')}
                    className="[&_svg]:size-auto flex shrink-0 items-center justify-center hover:bg-muted"
                    aria-label="Next item"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
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
                <button type="button" onClick={() => setSortMetric('units')} className="flex w-12 items-center justify-end gap-0.5">
                  Units {sortMetric === 'units' && <ArrowDown className="h-2.5 w-2.5" />}
                </button>
                <button type="button" onClick={() => setSortMetric('sales')} className="flex w-14 items-center justify-end gap-0.5">
                  Sales {sortMetric === 'sales' && <ArrowDown className="h-2.5 w-2.5" />}
                </button>
                <button type="button" onClick={() => setSortMetric('pmix')} className="flex w-12 items-center justify-end gap-0.5">
                  PMIX {sortMetric === 'pmix' && <ArrowDown className="h-2.5 w-2.5" />}
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
                  <span className="w-12 text-right tabular-nums">{number(getMetricValue(store, 'units'))}</span>
                  <span className="w-14 text-right tabular-nums">{money(getMetricValue(store, 'sales'))}</span>
                  <span className="w-12 text-right tabular-nums">{percent(getMetricValue(store, 'pmix'))}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
