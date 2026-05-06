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
  };
  labor: {
    totalHours: number;
    regularHours: number;
    otHours: number;
    dotHours: number;
    grossWages: number;
  };
  cash: {
    days: { date: string; total: number; variance: number }[];
    total: number;
    totalVariance: number;
  };
  sales: { net: number; guests: number };
}

const EMPTY_DATA: LocationReportData = {
  inventory: { startingCount: 0, endingCount: 0, vendors: [], totalPurchases: 0, cogs: 0, cogsPct: 0 },
  labor: { totalHours: 0, regularHours: 0, otHours: 0, dotHours: 0, grossWages: 0 },
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

  // Vendor invoices in window
  const invoicesP = supabase
    .from('vendor_invoices')
    .select('vendor_name, total_amount, invoice_date, delivery_date')
    .eq('location_id', locationId)
    .or(`invoice_date.gte.${fromISO},delivery_date.gte.${fromISO}`)
    .or(`invoice_date.lte.${toISO},delivery_date.lte.${toISO}`);

  // Inventory counts in window (for start/end)
  const countsP = supabase
    .from('inventory_counts')
    .select('id, count_date, status')
    .eq('location_id', locationId)
    .eq('status', 'completed')
    .gte('count_date', fromISO)
    .lte('count_date', toISO)
    .order('count_date', { ascending: true });

  const [salesR, laborR, invoicesR, countsR] = await Promise.all([salesP, laborP, invoicesP, countsP]);

  // === Sales ===
  const salesRows = salesR.data || [];
  const salesNet = salesRows.reduce((s, r) => s + Number(r.net_sales || 0), 0);
  const guests = salesRows.reduce((s, r) => s + Number(r.guest_count || 0), 0);

  // === Labor === — pick best source per day (punch_clock preferred)
  const laborRows = laborR.data || [];
  const byDay = new Map<string, any>();
  for (const r of laborRows) {
    const key = r.labor_date;
    const existing = byDay.get(key);
    if (!existing) byDay.set(key, r);
    else if (r.source === 'punch_clock' && existing.source !== 'punch_clock') byDay.set(key, r);
  }
  const laborAgg = Array.from(byDay.values()).reduce(
    (acc, r) => ({
      totalHours: acc.totalHours + Number(r.labor_hours || 0),
      regularHours: acc.regularHours + Number(r.regular_hours || 0),
      otHours: acc.otHours + Number(r.overtime_hours || 0),
      dotHours: acc.dotHours + Number(r.double_time_hours || 0),
      grossWages: acc.grossWages + Number(r.labor_cost || 0),
    }),
    { totalHours: 0, regularHours: 0, otHours: 0, dotHours: 0, grossWages: 0 }
  );

  // === Vendor invoices ===
  const invoiceRows = invoicesR.data || [];
  const vendorMap = new Map<string, number>();
  for (const inv of invoiceRows) {
    vendorMap.set(inv.vendor_name, (vendorMap.get(inv.vendor_name) || 0) + Number(inv.total_amount || 0));
  }
  const vendors = Array.from(vendorMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const totalPurchases = vendors.reduce((s, v) => s + v.amount, 0);

  // === Inventory counts === fetch totals for first/last counts
  const countList = countsR.data || [];
  const startCountId = countList[0]?.id;
  const endCountId = countList[countList.length - 1]?.id;

  let startingCount = 0;
  let endingCount = 0;
  if (startCountId) {
    const { data } = await supabase
      .from('inventory_count_items')
      .select('quantity, cost_at_count')
      .eq('count_id', startCountId);
    startingCount = (data || []).reduce(
      (s, r: any) => s + Number(r.quantity || 0) * Number(r.cost_at_count || 0),
      0
    );
  }
  if (endCountId && endCountId !== startCountId) {
    const { data } = await supabase
      .from('inventory_count_items')
      .select('quantity, cost_at_count')
      .eq('count_id', endCountId);
    endingCount = (data || []).reduce(
      (s, r: any) => s + Number(r.quantity || 0) * Number(r.cost_at_count || 0),
      0
    );
  } else if (startCountId && !endCountId) {
    endingCount = startingCount;
  }

  const cogs = startingCount + totalPurchases - endingCount;
  const cogsPct = salesNet > 0 ? (cogs / salesNet) * 100 : 0;

  return {
    inventory: {
      startingCount,
      endingCount,
      vendors,
      totalPurchases,
      cogs,
      cogsPct: Math.round(cogsPct * 10) / 10,
    },
    labor: laborAgg,
    cash: { days: [], total: 0, totalVariance: 0 }, // Cash drawer data not yet in DB
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
        r.inventory.vendors.forEach(v => vendorMap.set(v.name, (vendorMap.get(v.name) || 0) + v.amount));
        combined.labor.totalHours += r.labor.totalHours;
        combined.labor.regularHours += r.labor.regularHours;
        combined.labor.otHours += r.labor.otHours;
        combined.labor.dotHours += r.labor.dotHours;
        combined.labor.grossWages += r.labor.grossWages;
        combined.sales.net += r.sales.net;
        combined.sales.guests += r.sales.guests;
      });
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
