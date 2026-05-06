import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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
    days: { date: string; total: number; variance: number }[];
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
  const endingCountP = supabase
    .from('inventory_counts')
    .select('id, count_date, period_end_date, period_type')
    .eq('location_id', locationId)
    .eq('status', 'completed')
    .gte('period_end_date', fromISO)
    .lte('period_end_date', toISO)
    .order('period_end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Drawer counts (LogBook → "Drawer Count" category)
  const drawerP = supabase
    .from('logbook_entries')
    .select('id, entry_date, logbook_categories!inner(name), logbook_entry_values(value_text)')
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
  const endingCountRow = endingCountR.data;

  // Anchor the previous completed count (any period_type) for the starting baseline
  let startingCountRow: { id: string; count_date: string; period_end_date: string | null } | null = null;
  if (endingCountRow?.period_end_date) {
    const { data: prev } = await supabase
      .from('inventory_counts')
      .select('id, count_date, period_end_date')
      .eq('location_id', locationId)
      .eq('status', 'completed')
      .lt('period_end_date', endingCountRow.period_end_date)
      .order('period_end_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    startingCountRow = prev as any;
  }

  // Sum a count's value using the snapshot fields (cost_at_count × quantity / pack snapshot)
  const sumCount = async (id?: string) => {
    if (!id) return 0;
    const { data } = await supabase
      .from('inventory_count_items')
      .select('quantity, cost_at_count, pack_quantity_at_count, entered_cases, entered_units')
      .eq('count_id', id);
    return (data || []).reduce((s, r: any) => {
      const packQty = Number(r.pack_quantity_at_count) || 1;
      const cost = Number(r.cost_at_count) || 0;
      const qty = Number(r.quantity) || 0;
      // Per-unit cost = cost_per_case / pack_qty (matches PeriodDetailPanel snapshot path)
      return s + (qty * cost) / Math.max(packQty, 1);
    }, 0);
  };

  let startingCount = await sumCount(startingCountRow?.id);
  let endingCount = await sumCount(endingCountRow?.id);

  // === Purchases: bound assignments for the ending count (same as period panel) ===
  let totalPurchases = 0;
  let vendors: { name: string; amount: number }[] = [];
  if (endingCountRow?.id) {
    const { data: assigns } = await supabase
      .from('inventory_order_assignments')
      .select('source_type, source_row_id')
      .eq('count_id', endingCountRow.id);
    const pfgIds = (assigns || []).filter(a => a.source_type === 'pfg').map(a => a.source_row_id);
    const paIds = (assigns || []).filter(a => a.source_type === 'pa').map(a => a.source_row_id);
    const invIds = (assigns || []).filter(a => a.source_type === 'invoice').map(a => a.source_row_id);
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
  const dayMap = new Map<string, { total: number; variance: number }>();
  for (const e of drawerRows as any[]) {
    const vals = e.logbook_entry_values || [];
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
        } else {
          dayMap.set(e.entry_date, { total, variance });
        }
      } catch {}
    }
  }
  const cashDays = Array.from(dayMap.entries())
    .map(([date, v]) => ({ date, total: v.total, variance: v.variance }))
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
      startLabel: startCountRow?.count_date as string | undefined,
      endLabel: endCountRow?.count_date as string | undefined,
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
          if (existing) { existing.total += d.total; existing.variance += d.variance; }
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
