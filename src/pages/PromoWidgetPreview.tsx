import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

/**
 * Read-only design lab for the promo tracker widget.
 * Uses the REAL promo image + REAL ranking data from get_tracker_ranking.
 * Nothing here is wired into the dashboard — pure preview.
 */

const PROMO_IMAGE = 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/brand-assets/promo-trackers/promo-1787243674104.png';
const PROMO_TITLE = 'Spellbound';
const TRACKED_ITEMS = [
  'Margherita Pizza',
  'Margherita Pizza (Large)',
  'Lemon Bar',
  'Kids Pepperoni Pizza',
  'Kids 3 Top Pizza',
  'Kids 3 Top Pizza Meal',
];
const PROMO_START = '2026-08-19';

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const num = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${v.toFixed(1)}%`;

const ALL_ITEMS = '__ALL__';
const ITEM_OPTIONS = [ALL_ITEMS, ...TRACKED_ITEMS];
const itemLabel = (item: string) => (item === ALL_ITEMS ? 'All Items' : item);

interface ItemStat {
  units: number;
  sales: number;
  pmix: number;
}

interface Row {
  locationId: string;
  locationName: string;
  units: number;
  sales: number;
  pmix: number;
  totalSales: number;
  itemStats: Record<string, ItemStat>;
  rank: number;
}


function normalizeMix(rowMix: unknown): Array<{ itemName: string; quantity: number; netSales: number }> {
  const mix = typeof rowMix === 'string' ? JSON.parse(rowMix) : rowMix;
  if (!Array.isArray(mix)) return [];
  return mix.map((item: any) => ({
    itemName: String(item.itemName || item.item_name || item.name || '').trim(),
    quantity: Number(item.quantity) || 0,
    netSales: Number(item.netSales ?? item.net_sales ?? item.sales) || 0,
  }));
}

function useTrackerData(period: 'day' | 'week' | 'promo') {
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const tz = timezone || 'America/Los_Angeles';
  const today = DateTime.now().setZone(tz);
  const todayStr = today.toFormat('yyyy-MM-dd');
  const weekStart = today.startOf('week').toFormat('yyyy-MM-dd');
  const range = period === 'day'
    ? { start: todayStr, end: todayStr }
    : period === 'week'
      ? { start: weekStart, end: todayStr }
      : { start: PROMO_START, end: todayStr };

  return useQuery({
    queryKey: ['promo-preview-ranking', currentLocation?.id, range.start, range.end],
    queryFn: async () => {
      if (!currentLocation?.id) return [] as Row[];
      const { data, error } = await supabase.rpc('get_tracker_ranking', {
        _location_id: currentLocation.id,
        _scope: 'org',
        _location_refs: null,
        _start_date: range.start,
        _end_date: range.end,
      });
      if (error) throw error;

      const byLoc = new Map<string, Row>();
      for (const row of (data || []) as any[]) {
        let entry = byLoc.get(row.location_id);
        if (!entry) {
          entry = {
            locationId: row.location_id,
            locationName: row.location_name || 'Store',
            units: 0,
            sales: 0,
            pmix: 0,
            totalSales: 0,
            itemStats: Object.fromEntries(TRACKED_ITEMS.map(i => [i, { units: 0, sales: 0, pmix: 0 }])),
            rank: 0,
          };
          byLoc.set(row.location_id, entry);
        }
        if (row.product_mix == null) continue;
        entry.totalSales += Number(row.net_sales) || 0;
        for (const item of normalizeMix(row.product_mix)) {
          const lower = item.itemName.toLowerCase();
          const matched = [...TRACKED_ITEMS].sort((a, b) => b.length - a.length).find(t => lower.includes(t.toLowerCase()));
          if (matched) {
            entry.units += item.quantity;
            entry.sales += item.netSales;
            entry.itemStats[matched] ||= { units: 0, sales: 0, pmix: 0 };
            entry.itemStats[matched].units += item.quantity;
            entry.itemStats[matched].sales += item.netSales;
          }
        }
      }
      return Array.from(byLoc.values())
        .map(s => ({
          ...s,
          pmix: s.totalSales > 0 ? (s.sales / s.totalSales) * 100 : 0,
          itemStats: Object.fromEntries(Object.entries(s.itemStats).map(([name, st]) => [
            name,
            { ...st, pmix: s.totalSales > 0 ? (st.sales / s.totalSales) * 100 : 0 },
          ])),
        }))
        .sort((a, b) => b.pmix - a.pmix)
        .map((s, i) => ({ ...s, rank: i + 1 }));
    },
    enabled: !!currentLocation?.id,
    staleTime: 60 * 1000,
  });
}

/** Item switcher state shared by every preview option (mirrors the live widget). */
function useItemSwitcher() {
  const [item, setItem] = useState<string>(ALL_ITEMS);
  const cycle = (dir: 'prev' | 'next') => {
    const i = Math.max(0, ITEM_OPTIONS.indexOf(item));
    const next = dir === 'next'
      ? (i + 1) % ITEM_OPTIONS.length
      : (i - 1 + ITEM_OPTIONS.length) % ITEM_OPTIONS.length;
    setItem(ITEM_OPTIONS[next]);
  };
  return { item, cycle, label: itemLabel(item) };
}

function useMyStats(period: 'day' | 'week' | 'promo', item: string = ALL_ITEMS) {
  const { currentLocation } = useAppLocation();
  const { data, isLoading } = useTrackerData(period);
  const pick = (r: Row): ItemStat => (item === ALL_ITEMS
    ? { units: r.units, sales: r.sales, pmix: r.pmix }
    : r.itemStats?.[item] || { units: 0, sales: 0, pmix: 0 });

  const rows = useMemo(() => {
    const base = data || [];
    if (item === ALL_ITEMS) return base;
    return [...base]
      .sort((a, b) => pick(b).pmix - pick(a).pmix || pick(b).units - pick(a).units)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [data, item]);

  const mine = useMemo(() => rows.find(r => r.locationId === currentLocation?.id), [rows, currentLocation?.id]);
  const mineStats = mine ? pick(mine) : { units: 0, sales: 0, pmix: 0 };
  return {
    isLoading,
    rows,
    pick,
    total: rows.length,
    rank: mine?.rank ?? 0,
    units: mineStats.units,
    sales: mineStats.sales,
    pmix: mineStats.pmix,
    name: currentLocation?.name || 'My Store',
  };
}

function PromoWidgetCard({ period, setPeriod }: { period: 'day' | 'week' | 'promo'; setPeriod: (p: 'day' | 'week' | 'promo') => void }) {
  const sw = useItemSwitcher();
  const s = useMyStats(period, sw.item);
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-lg">
      <CardContent className="p-0">
        <button type="button" onClick={() => setOpen(v => !v)} className="relative block w-full aspect-[4/3] overflow-hidden text-left">
          <img src={PROMO_IMAGE} alt={PROMO_TITLE} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/25" />
          <div className="absolute left-0 top-3 rounded-r-full bg-amber-400 py-1 pl-3 pr-3 text-[10px] font-black uppercase tracking-[0.18em] text-black shadow-lg">
            Promo · Live
          </div>
          <div className="absolute right-3 top-3 inline-flex overflow-hidden rounded-full border border-white/30 bg-black/40 p-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-sm">
            {PERIOD_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={(e) => { e.stopPropagation(); setPeriod(key); }}
                className={`px-2.5 py-1 transition-colors ${period === key ? 'rounded-full bg-white text-black' : 'text-white/80 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="absolute left-3 top-[3.25rem]">
            <p className="text-2xl font-black leading-none text-white drop-shadow-lg">{PROMO_TITLE}</p>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="mb-2 flex items-center gap-1 text-xs font-bold text-white drop-shadow">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); sw.cycle('prev'); }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/20 hover:text-white"
                aria-label="Previous item"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-0 truncate">{sw.label}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); sw.cycle('next'); }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/20 hover:text-white"
                aria-label="Next item"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1.5 text-[11px] font-bold text-black shadow-sm">
                <Trophy className="h-3 w-3" />
                <span className="tabular-nums">Rank #{s.isLoading ? '-' : s.rank || '-'} / {s.total || '-'}</span>
                <span className="h-3.5 w-px bg-black/15" />
                <span className="tabular-nums">{s.isLoading ? '--' : num(s.units)} sold</span>
                <span className="h-3.5 w-px bg-black/15" />
                <span className="tabular-nums">{s.isLoading ? '--' : money(s.sales)}</span>
                <span className="h-3.5 w-px bg-black/15" />
                <span className="tabular-nums">{s.isLoading ? '--' : pct(s.pmix)}</span>
              </span>
            </div>
          </div>
        </button>
        {open && (
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 text-xs font-bold text-foreground">
                <button
                  type="button"
                  onClick={() => sw.cycle('prev')}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted"
                  aria-label="Previous item"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-0 truncate">{sw.label}</span>
                <button
                  type="button"
                  onClick={() => sw.cycle('next')}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted"
                  aria-label="Next item"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ranking</span>
            </div>
            <div className="flex gap-2">
              {[['Units', num(s.units)], ['Sales', money(s.sales)], ['PMIX', pct(s.pmix)]].map(([l, v]) => (
                <div key={l} className="flex-1 rounded-lg border border-border/60 bg-muted/40 px-2 py-1.5">
                  <p className="text-[9px] font-medium uppercase text-muted-foreground">{l}</p>
                  <p className="text-sm font-bold tabular-nums">{s.isLoading ? '--' : v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-1 shadow-sm">
              <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="w-6">Rank</span>
                <span className="min-w-0 flex-1">Location</span>
                <span className="w-16 text-right">Units</span>
                <span className="w-16 text-right">Sales</span>
              </div>
              {s.rows.slice(0, 6).map((r, idx) => (
                <div
                  key={r.locationId}
                  className={`flex items-center gap-2 px-2 py-2 text-[12px] ${r.rank === s.rank ? 'rounded-lg bg-accent text-accent-foreground font-medium' : ''} ${idx !== s.rows.slice(0, 6).length - 1 && r.rank !== s.rank ? 'border-b border-border/40' : ''}`}
                >
                  <span className="w-6 font-bold tabular-nums">#{r.rank}</span>
                  <span className="min-w-0 flex-1 truncate">{r.locationName}</span>
                  <span className="w-16 text-right tabular-nums">{num(s.pick(r).units)}</span>
                  <span className="w-16 text-right tabular-nums">{money(s.pick(r).sales)}</span>

                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PERIOD_OPTIONS: { key: 'day' | 'week' | 'promo'; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'promo', label: 'Campaign' },
];

export default function PromoWidgetPreview() {
  const [period, setPeriod] = useState<'day' | 'week' | 'promo'>('promo');
  const s = useMyStats(period);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Promo Widget</h1>
        <p className="text-sm text-muted-foreground">
          Live data for {s.name}. Tap the card to expand. Nothing here changes your dashboard.
        </p>
      </header>

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold">Option C — Full hero</h2>
          <p className="text-xs text-muted-foreground">Tallest, most magazine-like. Item name huge, one pill with all metrics. Tap for full detail.</p>
        </div>
        <PromoWidgetCard period={period} setPeriod={setPeriod} />
      </section>

      <p className="pb-10 text-xs text-muted-foreground">
        Let me know if you want to tweak this layout before I wire it into the real widget.
      </p>
    </div>
  );
}
