import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ChevronDown, Trophy } from 'lucide-react';
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

interface StoreRankRow {
  locationId: string;
  locationName: string;
  units: number;
  sales: number;
  pmix: number;
  totalSales: number;
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

  const today = DateTime.now().setZone(TRACKER_TZ).toFormat('yyyy-MM-dd');
  const wtdStart = DateTime.now().setZone(TRACKER_TZ).minus({ days: DateTime.now().setZone(TRACKER_TZ).weekday - 1 }).toFormat('yyyy-MM-dd');
  const promoStart = tracker.trackerPromoStart || wtdStart;
  const promoEnd = tracker.trackerPromoEnd || today;
  const trackedItems = (tracker.trackerItemRefs || []).map(item => item.toLowerCase());
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
        byLocation.set(locationId, { locationId, locationName: location?.name || 'Store', units: 0, sales: 0, pmix: 0, totalSales: 0, rank: 0 });
      }

      for (const row of data || []) {
        const entry = byLocation.get(row.location_id);
        if (!entry) continue;
        entry.totalSales += Number(row.net_sales) || 0;
        for (const item of normalizeMix(row.product_mix)) {
          if (trackedItems.some(target => item.itemName.toLowerCase().includes(target))) {
            entry.units += item.quantity;
            entry.sales += item.netSales;
          }
        }
      }

      const ranked = Array.from(byLocation.values())
        .map(store => ({ ...store, pmix: store.totalSales > 0 ? (store.sales / store.totalSales) * 100 : 0 }))
        .sort((a, b) => b.pmix - a.pmix || b.units - a.units || b.sales - a.sales);

      return ranked.map((store, index) => ({ ...store, rank: index + 1 }));
    },
    enabled: !!currentLocation?.id,
    staleTime: 60 * 1000,
  });

  const myStore = useMemo(() => ranking.find(store => store.locationId === currentLocation?.id), [ranking, currentLocation?.id]);
  const rankMetrics = tracker.trackerRankMetrics?.length ? tracker.trackerRankMetrics : ['units', 'sales', 'pmix'];
  const canExpand = tracker.trackerDisplayMode === 'expandable';

  return (
    <Card className="overflow-hidden border-primary/20 bg-card">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary shrink-0" />
              <h2 className="font-semibold truncate">{tracker.title || 'Promo Tracker'}</h2>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{trackedItems.length ? tracker.trackerItemRefs?.join(', ') : 'Add promo items'}</p>
          </div>
          <Badge variant="secondary" className="shrink-0">#{myStore?.rank || '--'} of {ranking.length || '--'}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {(['day', 'wtd', 'promo'] as PeriodKey[]).map(key => (
            <Button key={key} size="sm" variant={period === key ? 'default' : 'ghost'} className="h-8 text-xs" onClick={() => setPeriod(key)}>
              {key === 'day' ? 'DAY' : key === 'wtd' ? 'WTD' : 'PROMO'}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {rankMetrics.includes('units') && <div><p className="text-[10px] text-muted-foreground">Units</p><p className="font-semibold">{isLoading ? '--' : number(myStore?.units || 0)}</p></div>}
          {rankMetrics.includes('sales') && <div><p className="text-[10px] text-muted-foreground">Sales</p><p className="font-semibold">{isLoading ? '--' : money(myStore?.sales || 0)}</p></div>}
          {rankMetrics.includes('pmix') && <div><p className="text-[10px] text-muted-foreground">PMIX</p><p className="font-semibold">{isLoading ? '--' : percent(myStore?.pmix || 0)}</p></div>}
        </div>

        {canExpand && (
          <Button variant="ghost" size="sm" className="w-full h-8" onClick={() => setExpanded(value => !value)}>
            Ranking List <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        )}

        {canExpand && expanded && (
          <div className="space-y-1 pt-1">
            {ranking.slice(0, 20).map(store => (
              <div key={store.locationId} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                <span className="font-semibold">#{store.rank}</span>
                <span className="truncate">{store.locationName}</span>
                <span className="font-medium">{number(store.units)} · {money(store.sales)} · {percent(store.pmix)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}