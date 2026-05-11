import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { calculateCountItemValue } from '@/utils/countItemValue';

export interface LocationReportData {
  inventory: {
    startingCount: number;
    endingCount: number;
    vendors: { name: string; amount: number }[];
    totalPurchases: number;
    cogs: number;
    cogsPct: number;
    aligned: boolean;
    periodLabel?: string;
    startLabel?: string;
    endLabel?: string;
  };
  labor: {
    totalHours: number;
    regularHours: number;
    otHours: number;
    dotHours: number;
    grossWages: number;
    days: { date: string; totalHours: number; otHours: number; dotHours: number; grossWages: number }[];
  };
  cash: {
    days: { date: string; total: number; variance: number; countedBy?: string }[];
    total: number;
    totalVariance: number;
  };
  sales: { net: number; guests: number };
}

const EMPTY_DATA: LocationReportData = {
  inventory: { startingCount: 0, endingCount: 0, vendors: [], totalPurchases: 0, cogs: 0, cogsPct: 0, aligned: false },
  labor: { totalHours: 0, regularHours: 0, otHours: 0, dotHours: 0, grossWages: 0, days: [] },
  cash: { days: [], total: 0, totalVariance: 0 },
  sales: { net: 0, guests: 0 },
};

async function fetchLocationData(
  locationId: string,
  fromISO: string,
  toISO: string
): Promise<LocationReportData> {
  // Sales (sales_cache)
  const salesP = supabase
    .from('sales_cache')
    .select('net_sales, guest_count')
    .eq('location_id', locationId)
    .gte('sale_date', fromISO)
    .lte('sale_date', toISO);

  // Labor (labor_cache) - prefer punch_clock then qubeyond fallback
  const laborP = supabase
    .from('labor_cache')
    .select('labor_date, source, labor_cost, labor_hours, regular_hours, overtime_hours, double_time_hours')
    .eq('location_id', locationId)
    .gte('labor_date', fromISO)
    .lte('labor_date', toISO);

  // Inventory counts — read straight from the inventory period panel source of truth.
  // Pick the most recent COMPLETED count whose period_end_date falls inside the window.
  // Then anchor the previous completed count (any period_type) as the starting baseline.
  // Pull all completed counts whose period_end_date is inside the window; we'll pick
  // the best one below — preferring MONTHLY > WEEKLY > other to match the inventory
  // period panel hierarchy (don't grab a weekly when a full monthly close exists).
  const endingCountP = supabase
    .from('inventory_counts')
    .select('id, count_date, period_end_date, period_type')
    .eq('location_id', locationId)
    .eq('status', 'completed')
    .gte('period_end_date', fromISO)
    .lte('period_end_date', toISO)
    .order('period_end_date', { ascending: false });

  // Drawer counts (LogBook → "Drawer Count" category)
  const drawerP = supabase
    .from('logbook_entries')
    .select('id, entry_date, created_by, logbook_categories!inner(name), logbook_entry_values(value_text), profiles:created_by(full_name, nickname, email)')
    .eq('location_id', locationId)
    .ilike('logbook_categories.name', 'Drawer Count')
    .gte('entry_date', fromISO)
    .lte('entry_date', toISO)
    .order('entry_date', { ascending: true });

  const [salesR, laborR, endingCountR, drawerR] = await Promise.all([salesP, laborP, endingCountP, drawerP]);

  // === Sales ===
  const salesRows = salesR.data || [];
  const salesNet = salesRows.reduce((s, r) => s + Number(r.net_sales || 0), 0);
  const guests = salesRows.reduce((s, r) => s + Number(r.guest_count || 0), 0);

  // === Labor === — pick best source per day: prefer the row that actually has cost/hours
  const laborRows = laborR.data || [];
  const byDay = new Map<string, any>();
  for (const r of laborRows) {
    const key = r.labor_date;
    const existing = byDay.get(key);
    if (!existing) { byDay.set(key, r); continue; }
    const rHasData = Number(r.labor_cost || 0) > 0 || Number(r.labor_hours || 0) > 0;
    const eHasData = Number(existing.labor_cost || 0) > 0 || Number(existing.labor_hours || 0) > 0;
    if (rHasData && !eHasData) { byDay.set(key, r); continue; }
    if (rHasData && eHasData && r.source === 'punch_clock' && existing.source !== 'punch_clock') {
      byDay.set(key, r);
    }
  }
  const dayRows = Array.from(byDay.entries()).map(([date, r]) => ({
    date,
    totalHours: Number(r.labor_hours || 0),
    otHours: Number(r.overtime_hours || 0),
    dotHours: Number(r.double_time_hours || 0),
    grossWages: Number(r.labor_cost || 0),
  })).sort((a, b) => a.date.localeCompare(b.date));
  const laborAgg = dayRows.reduce(
    (acc, r) => ({
      totalHours: acc.totalHours + r.totalHours,
      regularHours: acc.regularHours + Number(byDay.get(r.date)?.regular_hours || 0),
      otHours: acc.otHours + r.otHours,
      dotHours: acc.dotHours + r.dotHours,
      grossWages: acc.grossWages + r.grossWages,
      days: acc.days,
    }),
    { totalHours: 0, regularHours: 0, otHours: 0, dotHours: 0, grossWages: 0, days: dayRows }
  );

  // === Inventory: SOURCE OF TRUTH = inventory period panel ===
  // Pick the latest completed count whose period_end_date is inside the report window.
  // That count's items = ENDING. The previous completed count = STARTING. Purchases come
  // from `inventory_order_assignments` bound to the ending count (same logic as
  // PeriodDetailPanel) — NOT a date-range scan over vendor_invoices.
  // Pick the best ending count: prefer MONTHLY (full close) > WEEKLY > anything else.
  // This ensures a "Last Month" preset uses the monthly close, not a mid-month weekly.
  const endingRows = (endingCountR.data || []) as Array<{ id: string; count_date: string; period_end_date: string; period_type: string }>;
  const periodRank = (t?: string) => t === 'monthly' ? 0 : t === 'weekly' ? 1 : 2;
  const endingCountRow = endingRows.length
    ? [...endingRows].sort((a, b) => {
        const r = periodRank(a.period_type) - periodRank(b.period_type);
        if (r !== 0) return r;
        return (b.period_end_date || '').localeCompare(a.period_end_date || '');
      })[0]
    : null;

  // Anchor the previous completed count of the SAME period_type for the starting baseline
  // (monthly → previous monthly; weekly → previous weekly). Fall back to any type.
  let startingCountRow: { id: string; count_date: string; period_end_date: string | null } | null = null;
  if (endingCountRow?.period_end_date) {
    const sameTypeP = supabase
      .from('inventory_counts')
      .select('id, count_date, period_end_date')
      .eq('location_id', locationId)
      .eq('status', 'completed')
      .eq('period_type', endingCountRow.period_type)
      .lt('period_end_date', endingCountRow.period_end_date)
      .order('period_end_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: prev } = await sameTypeP;
    if (prev) {
      startingCountRow = prev as any;
    } else {
      const { data: anyPrev } = await supabase
        .from('inventory_counts')
        .select('id, count_date, period_end_date')
        .eq('location_id', locationId)
        .eq('status', 'completed')
        .lt('period_end_date', endingCountRow.period_end_date)
        .order('period_end_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      startingCountRow = anyPrev as any;
    }
  }

  // Sum a count's value using the canonical calculator (same as PeriodDetailPanel).
  // Pulls inventory_items and item_conversions to honor pack overrides + brand mapping
  // so the math matches the inventory period panel exactly.
  const sumCount = async (id?: string) => {
    if (!id) return 0;
    const { data: ciRows } = await supabase
      .from('inventory_count_items')
      .select('item_id, quantity, cost_at_count, pack_quantity_at_count, entered_cases, entered_units')
      .eq('count_id', id);
    const rows = (ciRows || []) as any[];
    if (!rows.length) return 0;
    const itemIds = Array.from(new Set(rows.map(r => r.item_id)));
    const { data: items } = await supabase
      .from('inventory_items')
      .select('id, cost_per_unit, pack_quantity, pack_quantity_override, brand_item_id, is_recipe')
      .in('id', itemIds);
    const itemMap = new Map<string, any>();
    for (const it of items || []) itemMap.set(it.id, it);
    const brandIds = Array.from(new Set((items || []).map((i: any) => i.brand_item_id).filter(Boolean)));
    const conversionMap = new Map<string, any>();
    if (brandIds.length) {
      const { data: convs } = await (supabase as any)
        .from('item_conversions')
        .select('brand_item_id, outer_qty, canonical_qty_per_inner, canonical_unit')
        .in('brand_item_id', brandIds as string[]);
      for (const c of convs || []) conversionMap.set((c as any).brand_item_id, c);
    }
    return rows.reduce((s, ci) => {
      const item = itemMap.get(ci.item_id);
      const conversion = item?.brand_item_id ? conversionMap.get(item.brand_item_id) : null;
      return s + calculateCountItemValue(
        ci,
        item ? {
          brand_item_id: item.brand_item_id,
          cost_per_unit: item.cost_per_unit,
          pack_quantity: item.pack_quantity,
          pack_quantity_override: item.pack_quantity_override,
          is_recipe: item.is_recipe === true,
        } : undefined,
        conversion || null,
        false
      );
    }, 0);
  };

  let startingCount = await sumCount(startingCountRow?.id);
  let endingCount = await sumCount(endingCountRow?.id);

  // === Purchases: mirror PeriodDetailPanel exactly ===
  // For monthly/yearly counts, aggregate this count's own assignments PLUS all
  // child weekly counts' assignments within the period (minus exclusions and
  // anything locked to a different same-type count).
  let totalPurchases = 0;
  let vendors: { name: string; amount: number }[] = [];
  if (endingCountRow?.id) {
    const periodType = endingCountRow.period_type as 'weekly' | 'monthly' | 'yearly';
    const isAggregating = periodType === 'monthly' || periodType === 'yearly';

    // Resolve this period's date range (start = day after previous count end)
    const periodEnd = endingCountRow.period_end_date;
    const periodStart = startingCountRow?.period_end_date
      ? format(new Date(new Date(startingCountRow.period_end_date + 'T12:00:00').getTime() + 86400000), 'yyyy-MM-dd')
      : periodEnd;

    let childWeeklyCountIds: string[] = [];
    if (isAggregating && periodEnd) {
      const { data: childCounts } = await supabase
        .from('inventory_counts')
        .select('id')
        .eq('location_id', locationId)
        .eq('period_type', 'weekly')
        .gte('period_end_date', periodStart)
        .lte('period_end_date', periodEnd);
      childWeeklyCountIds = (childCounts || []).map(c => c.id);
    }

    const [sameTypeAssignsR, childWeeklyAssignsR, exclusionsR] = await Promise.all([
      supabase
        .from('inventory_order_assignments')
        .select('source_type, source_row_id, count_id')
        .eq('location_id', locationId)
        .eq('period_type', periodType),
      isAggregating && childWeeklyCountIds.length
        ? supabase
            .from('inventory_order_assignments')
            .select('source_type, source_row_id')
            .eq('location_id', locationId)
            .eq('period_type', 'weekly')
            .in('count_id', childWeeklyCountIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from('inventory_order_exclusions')
        .select('source_type, source_row_id')
        .eq('location_id', locationId)
        .eq('period_type', periodType)
        .eq('count_id', endingCountRow.id),
    ]);

    const exclusionSet = new Set<string>(((exclusionsR.data as any[]) || []).map(e => `${e.source_type}_${e.source_row_id}`));
    const sameTypeMap = new Map<string, string>();
    for (const a of (sameTypeAssignsR.data as any[]) || []) {
      sameTypeMap.set(`${a.source_type}_${a.source_row_id}`, a.count_id);
    }

    const targetIds = { pfg: new Set<string>(), pa: new Set<string>(), invoice: new Set<string>() };
    for (const a of (sameTypeAssignsR.data as any[]) || []) {
      if (a.count_id !== endingCountRow.id) continue;
      (targetIds as any)[a.source_type]?.add(a.source_row_id);
    }
    for (const a of (childWeeklyAssignsR.data as any[]) || []) {
      const k = `${a.source_type}_${a.source_row_id}`;
      const lockedElsewhere = sameTypeMap.has(k) && sameTypeMap.get(k) !== endingCountRow.id;
      if (!exclusionSet.has(k) && !lockedElsewhere) {
        (targetIds as any)[a.source_type]?.add(a.source_row_id);
      }
    }

    const pfgIds = Array.from(targetIds.pfg);
    const paIds = Array.from(targetIds.pa);
    const invIds = Array.from(targetIds.invoice);
    const [pfgR, paR, invR] = await Promise.all([
      pfgIds.length ? supabase.from('pfg_orders').select('total_amount').in('id', pfgIds) : Promise.resolve({ data: [] as any[] }),
      paIds.length ? supabase.from('pa_orders').select('total_amount').in('id', paIds) : Promise.resolve({ data: [] as any[] }),
      invIds.length ? supabase.from('vendor_invoices').select('vendor_name, total_amount').in('id', invIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const vendorMap = new Map<string, number>();
    (pfgR.data || []).forEach((o: any) => vendorMap.set('PFG', (vendorMap.get('PFG') || 0) + (Number(o.total_amount) || 0)));
    (paR.data || []).forEach((o: any) => vendorMap.set('Produce Alliance', (vendorMap.get('Produce Alliance') || 0) + (Number(o.total_amount) || 0)));
    (invR.data || []).forEach((o: any) => {
      const name = o.vendor_name || 'Other';
      vendorMap.set(name, (vendorMap.get(name) || 0) + (Number(o.total_amount) || 0));
    });
    vendors = Array.from(vendorMap.entries()).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    totalPurchases = vendors.reduce((s, v) => s + v.amount, 0);
  }

  const aligned = !!endingCountRow;
  const cogs = startingCount + totalPurchases - endingCount;
  const cogsPct = salesNet > 0 ? (cogs / salesNet) * 100 : 0;

  // === Cash drawer === parse value_text JSON from logbook entries
  const drawerRows = drawerR.data || [];
  const dayMap = new Map<string, { total: number; variance: number; countedBy: Set<string> }>();
  for (const e of drawerRows as any[]) {
    const vals = e.logbook_entry_values || [];
    const prof = e.profiles;
    const name = prof ? (prof.nickname || prof.full_name || prof.email || '').trim() : '';
    for (const v of vals) {
      if (!v.value_text) continue;
      try {
        const parsed = JSON.parse(v.value_text);
        const total = Number(parsed.totalDrawer || 0);
        const variance = Number(parsed.variance || 0);
        const existing = dayMap.get(e.entry_date);
        if (existing) {
          existing.total += total;
          existing.variance = variance;
          if (name) existing.countedBy.add(name);
        } else {
          const set = new Set<string>();
          if (name) set.add(name);
          dayMap.set(e.entry_date, { total, variance, countedBy: set });
        }
      } catch {}
    }
  }
  const cashDays = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, total: v.total, variance: v.variance, countedBy: Array.from(v.countedBy).join(', ') }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const cashTotal = cashDays.reduce((s, d) => s + d.total, 0);
  const cashTotalVariance = cashDays.reduce((s, d) => s + d.variance, 0);

  return {
    inventory: {
      startingCount,
      endingCount,
      vendors,
      totalPurchases,
      cogs,
      cogsPct: Math.round(cogsPct * 10) / 10,
      aligned,
      startLabel: startingCountRow?.period_end_date || startingCountRow?.count_date,
      endLabel: endingCountRow?.period_end_date || endingCountRow?.count_date,
    },
    labor: laborAgg,
    cash: { days: cashDays, total: cashTotal, totalVariance: cashTotalVariance },
    sales: { net: salesNet, guests },
  };
}

export function useLocationReportData(locationId: string | undefined, from: Date, to: Date) {
  const fromISO = format(from, 'yyyy-MM-dd');
  const toISO = format(to, 'yyyy-MM-dd');
  return useQuery({
    queryKey: ['report-data', locationId, fromISO, toISO],
    queryFn: () => fetchLocationData(locationId!, fromISO, toISO),
    enabled: !!locationId,
    staleTime: 60_000,
  });
}

export function useMultiLocationReportData(locationIds: string[], from: Date, to: Date) {
  const fromISO = format(from, 'yyyy-MM-dd');
  const toISO = format(to, 'yyyy-MM-dd');
  return useQuery({
    queryKey: ['report-data-multi', locationIds.sort().join(','), fromISO, toISO],
    queryFn: async () => {
      const results = await Promise.all(locationIds.map(id => fetchLocationData(id, fromISO, toISO)));
      const byLocation: Record<string, LocationReportData> = {};
      locationIds.forEach((id, i) => { byLocation[id] = results[i]; });

      // Combined / org total
      const combined: LocationReportData = JSON.parse(JSON.stringify(EMPTY_DATA));
      const vendorMap = new Map<string, number>();
      results.forEach(r => {
        combined.inventory.startingCount += r.inventory.startingCount;
        combined.inventory.endingCount += r.inventory.endingCount;
        combined.inventory.totalPurchases += r.inventory.totalPurchases;
        combined.inventory.cogs += r.inventory.cogs;
        combined.inventory.aligned = combined.inventory.aligned || r.inventory.aligned;
        r.inventory.vendors.forEach(v => vendorMap.set(v.name, (vendorMap.get(v.name) || 0) + v.amount));
        combined.labor.totalHours += r.labor.totalHours;
        combined.labor.regularHours += r.labor.regularHours;
        combined.labor.otHours += r.labor.otHours;
        combined.labor.dotHours += r.labor.dotHours;
        combined.labor.grossWages += r.labor.grossWages;
        combined.sales.net += r.sales.net;
        combined.sales.guests += r.sales.guests;
        // Labor: aggregate by date
        r.labor.days.forEach(d => {
          const ex = combined.labor.days.find(x => x.date === d.date);
          if (ex) {
            ex.totalHours += d.totalHours; ex.otHours += d.otHours;
            ex.dotHours += d.dotHours; ex.grossWages += d.grossWages;
          } else combined.labor.days.push({ ...d });
        });
        // Cash: aggregate by date
        r.cash.days.forEach(d => {
          const existing = combined.cash.days.find(x => x.date === d.date);
          if (existing) {
            existing.total += d.total; existing.variance += d.variance;
            const merged = new Set([...(existing.countedBy ? existing.countedBy.split(', ').filter(Boolean) : []), ...((d as any).countedBy ? (d as any).countedBy.split(', ').filter(Boolean) : [])]);
            (existing as any).countedBy = Array.from(merged).join(', ');
          }
          else combined.cash.days.push({ ...d });
        });
        combined.cash.total += r.cash.total;
        combined.cash.totalVariance += r.cash.totalVariance;
      });
      combined.cash.days.sort((a, b) => a.date.localeCompare(b.date));
      combined.labor.days.sort((a, b) => a.date.localeCompare(b.date));
      combined.inventory.vendors = Array.from(vendorMap.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);
      combined.inventory.cogsPct = combined.sales.net > 0
        ? Math.round((combined.inventory.cogs / combined.sales.net) * 1000) / 10
        : 0;
      return { byLocation, combined };
    },
    enabled: locationIds.length > 0,
    staleTime: 60_000,
  });
}
