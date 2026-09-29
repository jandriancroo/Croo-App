import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * One labor number everywhere: every screen reads get_store_labor (server).
 * Closed days come from the server's saved totals; business today is live.
 * On error callers must show "—" (never 0).
 */
export interface StoreLaborRow {
  location_id: string;
  labor_date: string;
  labor_cost: number;
  labor_hours: number;
  regular_hours: number;
  overtime_hours: number;
  source: string;
  net_sales: number | null;
  labor_pct: number | null;
  is_live: boolean;
  as_of: string | null;
}

export async function fetchStoreLabor(
  locationIds: string[],
  start: string,
  end: string,
): Promise<{ data: StoreLaborRow[] | null; error: Error | null }> {
  const ids = Array.from(new Set(locationIds.filter(Boolean)));
  if (ids.length === 0) return { data: [], error: null };
  // Server caps one request at ~92 days; split long ranges (YTD, many pay
  // periods) into 90-day windows so they never come back empty.
  const windows: Array<[string, string]> = [];
  const addDays = (d: string, n: number) => {
    const [y, m, dd] = d.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd + n));
    return t.toISOString().slice(0, 10);
  };
  let cur = start;
  while (cur <= end) {
    const wEnd = addDays(cur, 89) < end ? addDays(cur, 89) : end;
    windows.push([cur, wEnd]);
    cur = addDays(wEnd, 1);
  }
  const results = await Promise.all(windows.map(([s, e]) =>
    supabase.rpc('get_store_labor' as any, { _location_ids: ids, _start: s, _end: e })));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { data: null, error: new Error(failed.error.message) };
  const data = results.flatMap((r) => ((r.data as any[]) || []));
  const rows: StoreLaborRow[] = ((data as any[]) || []).map((r) => ({
    location_id: r.location_id,
    labor_date: r.date,
    labor_cost: Number(r.cost) || 0,
    labor_hours: Number(r.hours) || 0,
    regular_hours: Number(r.hours) || 0,
    overtime_hours: 0,
    source: r.source,
    net_sales: r.net_sales == null ? null : Number(r.net_sales),
    labor_pct: r.labor_pct == null ? null : Number(r.labor_pct),
    is_live: !!r.is_live,
    as_of: r.as_of ?? null,
  }));
  return { data: rows, error: null };
}

function useTabVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * C1: server labor for stores × date range. Refreshes every 60 s only while
 * the tab is visible and the range includes business today.
 */
export function useStoreLabor(
  locationIds: string[],
  start: string | null | undefined,
  end: string | null | undefined,
  opts: { businessToday?: string | null; enabled?: boolean } = {},
) {
  const visible = useTabVisible();
  const ids = Array.from(new Set(locationIds.filter(Boolean))).sort();
  const includesToday = !!opts.businessToday && !!start && !!end &&
    start <= opts.businessToday && opts.businessToday <= end;
  return useQuery({
    queryKey: ['store-labor', ids.join(','), start, end],
    enabled: (opts.enabled ?? true) && ids.length > 0 && !!start && !!end,
    queryFn: async () => {
      const { data, error } = await fetchStoreLabor(ids, start!, end!);
      if (error) throw error;
      return data!;
    },
    staleTime: 30_000,
    refetchInterval: includesToday && visible ? 60_000 : false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** "—" for errors/unknown, never 0. */
export function laborDisplay(value: number | null | undefined, format: (n: number) => string): string {
  return value == null || Number.isNaN(value) ? '—' : format(value);
}
