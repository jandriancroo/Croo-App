import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronLeft, ChevronRight, Crown, Flame, TrendingUp, Trophy } from 'lucide-react';
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

function useTrackerData(period: 'day' | 'promo') {
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const tz = timezone || 'America/Los_Angeles';
  const today = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  const range = period === 'day' ? { start: today, end: today } : { start: PROMO_START, end: today };

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

function ItemSwitcher({ label, cycle, className = '' }: { label: string; cycle: (dir: 'prev' | 'next') => void; className?: string }) {
  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); cycle('prev'); }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/20 hover:text-white"
        aria-label="Previous item"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); cycle('next'); }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/20 hover:text-white"
        aria-label="Next item"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function useMyStats(period: 'day' | 'promo', item: string = ALL_ITEMS) {
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


/* ---------------- Option A: Poster ---------------- */
function OptionA({ period }: { period: 'day' | 'promo' }) {
  const sw = useItemSwitcher();
  const s = useMyStats(period, sw.item);
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-lg">
      <CardContent className="p-0">
        <button type="button" onClick={() => setOpen(v => !v)} className="relative block w-full aspect-[16/9] overflow-hidden text-left">
          <img src={PROMO_IMAGE} alt={PROMO_TITLE} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
            <div className="min-w-0">
              <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-white backdrop-blur-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Promo
              </span>
              <ItemSwitcher label={sw.label} cycle={sw.cycle} className="text-lg font-extrabold leading-tight text-white drop-shadow" />
            </div>

            <div className="shrink-0 rounded-xl bg-white/15 px-2.5 py-1.5 text-right backdrop-blur-md">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-white/70">Rank</p>
              <p className="text-xl font-black leading-none tabular-nums text-white">
                #{s.isLoading ? '-' : s.rank || '-'}
                <span className="text-xs font-semibold text-white/70">/{s.total || '-'}</span>
              </p>
            </div>
          </div>
          <ChevronDown className={`absolute right-2 top-2 h-5 w-5 rounded-full bg-black/35 p-0.5 text-white transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
            {[['Units', num(s.units)], ['Sales', money(s.sales)], ['PMIX', pct(s.pmix)]].map(([l, v]) => (
              <div key={l} className="px-2 py-2 text-center">
                <p className="text-[9px] font-medium uppercase text-muted-foreground">{l}</p>
                <p className="text-sm font-bold tabular-nums">{s.isLoading ? '--' : v}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Option B: Glass ticker ---------------- */
function OptionB({ period }: { period: 'day' | 'promo' }) {
  const sw = useItemSwitcher();
  const s = useMyStats(period, sw.item);
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-lg">
      <CardContent className="p-0">
        <button type="button" onClick={() => setOpen(v => !v)} className="relative block w-full aspect-[2/1] overflow-hidden text-left">
          <img src={PROMO_IMAGE} alt={PROMO_TITLE} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-black/25 via-transparent to-black/45" />
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-2xl border border-white/20 bg-black/35 px-2.5 py-2 backdrop-blur-xl">
            <Flame className="h-4 w-4 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <ItemSwitcher label={sw.label} cycle={sw.cycle} className="text-[13px] font-bold leading-tight text-white" />
              <p className="text-[10px] font-medium leading-tight text-white/70 tabular-nums">
                {s.isLoading ? '--' : `${num(s.units)} units · ${money(s.sales)}`}
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-amber-400/90 px-2 py-1 text-[11px] font-black tabular-nums text-black">
              #{s.isLoading ? '-' : s.rank || '-'}
            </span>
          </div>
        </button>
        {open && (
          <div className="space-y-1 px-2 py-2">
            {s.rows.slice(0, 6).map(r => (
              <div key={r.locationId} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${r.rank === s.rank ? 'bg-accent text-accent-foreground' : 'bg-muted/45'}`}>
                <span className="w-6 font-semibold">#{r.rank}</span>
                <span className="min-w-0 flex-1 truncate">{r.locationName}</span>
                <span className="tabular-nums">{num(s.pick(r).units)}</span>
                <span className="w-14 text-right tabular-nums">{money(s.pick(r).sales)}</span>
              </div>
            ))}
          </div>
        )}

      </CardContent>
    </Card>
  );
}

/* ---------------- Option C: Full-bleed hero, image only until tapped ---------------- */
function OptionC({ period }: { period: 'day' | 'promo' }) {
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
          <div className="absolute inset-x-0 bottom-0 p-3">
            <ItemSwitcher label={sw.label} cycle={sw.cycle} className="text-2xl font-black leading-none text-white drop-shadow-lg" />

            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-black">
                <Trophy className="h-3 w-3" /> #{s.isLoading ? '-' : s.rank || '-'} of {s.total || '-'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm tabular-nums">
                <TrendingUp className="h-3 w-3" /> {s.isLoading ? '--' : `${num(s.units)} sold · ${money(s.sales)}`}
              </span>
            </div>
          </div>
        </button>
        {open && (
          <div className="space-y-2 p-3">
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

/* ---------------- Option D: Framed poster with metal rank medal ---------------- */
function OptionD({ period }: { period: 'day' | 'promo' }) {
  const sw = useItemSwitcher();
  const s = useMyStats(period, sw.item);

  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<'rank' | 'units' | 'sales'>('rank');
  const badge = metric === 'rank'
    ? `#${s.rank || '-'} / ${s.total || '-'}`
    : metric === 'units' ? `${num(s.units)} sold` : money(s.sales);
  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-lg">
      <CardContent className="p-0">
        <div className="relative aspect-[5/3] w-full overflow-hidden">
          <img src={PROMO_IMAGE} alt={PROMO_TITLE} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 ring-1 ring-inset ring-white/15" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white backdrop-blur-md">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Promo
            </span>
            <button
              type="button"
              onClick={() => setMetric(m => (m === 'rank' ? 'units' : m === 'units' ? 'sales' : 'rank'))}
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-2.5 py-1 text-[11px] font-black tabular-nums text-black shadow-md"
            >
              <Crown className="h-3 w-3" />
              {s.isLoading ? '--' : badge}
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-8">
            <p className="truncate text-base font-extrabold text-white">{PROMO_TITLE}</p>
            <button type="button" onClick={() => setOpen(v => !v)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-white/80">
              {open ? 'Hide standings' : 'See standings'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {open && (
          <div className="space-y-1 px-2 py-2">
            {s.rows.slice(0, 8).map(r => (
              <div key={r.locationId} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${r.rank === s.rank ? 'bg-accent text-accent-foreground' : 'bg-muted/45'}`}>
                <span className="w-6 font-semibold">#{r.rank}</span>
                <span className="min-w-0 flex-1 truncate">{r.locationName}</span>
                <span className="tabular-nums">{num(r.units)}</span>
                <span className="w-14 text-right tabular-nums">{money(r.sales)}</span>
                <span className="w-11 text-right tabular-nums">{pct(r.pmix)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PromoWidgetPreview() {
  const [period, setPeriod] = useState<'day' | 'promo'>('promo');
  const s = useMyStats(period);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Promo Widget — Design Options</h1>
        <p className="text-sm text-muted-foreground">
          Live data for {s.name}. Tap any card to expand. Nothing here changes your dashboard.
        </p>
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          <button type="button" onClick={() => setPeriod('day')} className={`px-3 py-1.5 text-xs font-semibold ${period === 'day' ? 'bg-accent text-accent-foreground' : ''}`}>Today</button>
          <button type="button" onClick={() => setPeriod('promo')} className={`px-3 py-1.5 text-xs font-semibold ${period === 'promo' ? 'bg-accent text-accent-foreground' : ''}`}>Campaign</button>
        </div>
      </header>

      {[
        { label: 'Option A — Poster + rank chip', note: '16:9 image, headline and rank badge sit in the shadow. Stats slide out underneath.', node: <OptionA period={period} /> },
        { label: 'Option B — Glass ticker', note: 'Big image, one frosted bar with name, units/sales, and a gold rank pill. Expands into standings.', node: <OptionB period={period} /> },
        { label: 'Option C — Full hero', note: 'Tallest, most magazine-like. Item name huge, two pill stats. Tap for full detail.', node: <OptionC period={period} /> },
        { label: 'Option D — Framed poster + medal', note: 'Metal rank medal, tap the medal to swap rank / units / sales. Standings on demand.', node: <OptionD period={period} /> },
      ].map(o => (
        <section key={o.label} className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">{o.label}</h2>
            <p className="text-xs text-muted-foreground">{o.note}</p>
          </div>
          {o.node}
        </section>
      ))}

      <p className="pb-10 text-xs text-muted-foreground">
        Tell me which one (or a mix) and I'll build it into the real widget.
      </p>
    </div>
  );
}
