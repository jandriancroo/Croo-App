import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { formatInTimeZone } from 'date-fns-tz';
import { fetchStoreLabor } from '@/hooks/useStoreLabor';
import { computePace, laborPct, resolveGoal, storeNow } from '../../supabase/functions/_shared/cubeMetrics';

const LA_TZ = 'America/Los_Angeles';

// Get formatted date string in LA timezone
function laDate(date: Date, fmt = 'yyyy-MM-dd'): string {
  return formatInTimeZone(date, LA_TZ, fmt);
}

interface LocationInfo {
  id: string;
  name: string;
  store_number: string | null;
  org_name: string | null;
  brand_name: string | null;
}

/**
 * Fetches all locations the user has access to within an organization
 */
export function useOrgLocations(organizationId: string | null) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['org-locations', organizationId, user?.id],
    queryFn: async () => {
      if (!organizationId || !user?.id) return [];
      
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('location_id')
        .eq('user_id', user.id);
      
      const userLocIds = userLocs?.map(ul => ul.location_id) || [];
      if (userLocIds.length === 0) return [];

      const { data: locations } = await supabase
        .from('locations')
        .select('id, name, store_number, organization_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .in('id', userLocIds)
        .order('name');

      const { data: orgData } = await supabase
        .from('organizations')
        .select('name, brand_name')
        .eq('id', organizationId)
        .single();

      return (locations || []).map(l => ({
        ...l,
        org_name: orgData?.name ?? null,
        brand_name: orgData?.brand_name ?? null,
      })) as LocationInfo[];
    },
    enabled: !!organizationId && !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches all locations across all orgs in a brand
 */
export function useBrandLocations(brandId: string | null) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['brand-locations', brandId, user?.id],
    queryFn: async () => {
      if (!brandId || !user?.id) return [];
      
      const { data: userLocs } = await supabase
        .from('user_locations')
        .select('location_id')
        .eq('user_id', user.id);
      
      const userLocIds = userLocs?.map(ul => ul.location_id) || [];
      if (userLocIds.length === 0) return [];

      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name, brand_name')
        .eq('brand_id', brandId as any)
        .eq('is_active', true);
      
      const orgIds = (orgs || []).map(o => o.id);
      if (orgIds.length === 0) return [];

      const { data: locations } = await supabase
        .from('locations')
        .select('id, name, store_number, organization_id')
        .in('organization_id', orgIds)
        .eq('is_active', true)
        .in('id', userLocIds)
        .order('name');

      const orgMap = new Map((orgs || []).map(o => [o.id, o]));
      
      const { data: brand } = await supabase
        .from('brands')
        .select('name')
        .eq('id', brandId)
        .single();

      return (locations || []).map(l => {
        const org = orgMap.get(l.organization_id!);
        return {
          ...l,
          org_name: org?.name ?? null,
          brand_name: brand?.name ?? org?.brand_name ?? null,
        };
      }) as LocationInfo[];
    },
    enabled: !!brandId && !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetches sales/labor data for multiple locations from sales_cache + labor_cache.
 * targetDate: the selected date (yyyy-MM-dd). For month view this is the 1st of the month.
 * period: 'day' | 'week' | 'month' — determines the effective end date for range queries.
 */
export function useOrgLocationData(locationIds: string[], targetDate?: string, period: 'day' | 'week' | 'month' = 'day') {
  const nowReal = new Date();
  const todayReal = laDate(nowReal);

  // Compute the effective "end of range" date based on period
  const baseDate = targetDate || todayReal;
  const effectiveEndDate = (() => {
    if (period === 'day') return baseDate;
    if (period === 'week') {
      // targetDate is any day in the week; end = Sunday of that week, capped at today
      const [y, m, d] = baseDate.split('-').map(Number);
      const dt = new Date(y, m - 1, d, 12);
      const dow = dt.getDay();
      const mondayOff = dow === 0 ? 6 : dow - 1;
      const sunday = new Date(dt);
      sunday.setDate(sunday.getDate() - mondayOff + 6);
      const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
      return sundayStr > todayReal ? todayReal : sundayStr;
    }
    // month: end = last day of month, capped at today
    const [y, m] = baseDate.split('-').map(Number);
    const lastDay = new Date(y, m, 0); // day 0 of next month = last day of this month
    const lastStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    return lastStr > todayReal ? todayReal : lastStr;
  })();

  // The "reference day" for daily metrics (today's row, hourly data, etc.)
  const effectiveToday = period === 'day' ? baseDate : effectiveEndDate;
  const isHistorical = effectiveToday !== todayReal;

  return useQuery({
    queryKey: ['org-location-data', locationIds.sort().join(','), effectiveToday, period],
    queryFn: async () => {
      if (locationIds.length === 0) return {};

      const [y, m, d] = effectiveToday.split('-').map(Number);
      const refDate = new Date(y, m - 1, d, 12);

      // Determine WTD start (Monday) relative to effectiveToday
      const dayOfWeek = refDate.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(refDate);
      monday.setDate(monday.getDate() - mondayOffset);
      const wtdStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;

      // MTD start
      const mtdStart = effectiveToday.slice(0, 8) + '01';

      // Previous week range
      const prevSunday = new Date(monday);
      prevSunday.setDate(prevSunday.getDate() - 1);
      const prevMonday = new Date(prevSunday);
      prevMonday.setDate(prevMonday.getDate() - 6);
      const prevWeekStart = `${prevMonday.getFullYear()}-${String(prevMonday.getMonth() + 1).padStart(2, '0')}-${String(prevMonday.getDate()).padStart(2, '0')}`;
      const prevWeekEnd = `${prevSunday.getFullYear()}-${String(prevSunday.getMonth() + 1).padStart(2, '0')}-${String(prevSunday.getDate()).padStart(2, '0')}`;

      // Previous month range
      const firstOfMonth = new Date(y, m - 1, 1);
      const prevMonthEnd = new Date(firstOfMonth);
      prevMonthEnd.setDate(prevMonthEnd.getDate() - 1);
      const prevMonthStart = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, '0')}-01`;
      const prevMonthEndStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(prevMonthEnd.getDate()).padStart(2, '0')}`;

      // Fetch sales_cache — use effectiveToday (end of range) as upper bound
      const { data: salesRows } = await supabase
        .from('sales_cache')
        .select('location_id, sale_date, net_sales, living_projection, override_projection, initial_projection, projected_sales, hourly_data, yoy_net_sales, pace_adjusted_projection, pace_calculated_at')
        .in('location_id', locationIds)
        .gte('sale_date', prevMonthStart)
        .lte('sale_date', effectiveToday);

      // Labor: one server number per store-day (get_store_labor; today is live).
      const laborRes = await fetchStoreLabor(
        locationIds,
        wtdStart < mtdStart ? wtdStart : mtdStart,
        effectiveToday,
      );
      if (laborRes.error) throw laborRes.error;
      const laborRows = (laborRes.data || []).map(r => ({
        location_id: r.location_id, labor_date: r.labor_date, labor_cost: r.labor_cost, source: r.source,
      }));

      // Each store's own time zone (for "what hour is it now" in pace)
      const { data: tzRows } = await supabase
        .from('location_settings')
        .select('location_id, timezone')
        .in('location_id', locationIds);
      const tzByLoc = new Map<string, string>(
        (tzRows || []).map((r: any) => [r.location_id, r.timezone || LA_TZ])
      );

      const result: Record<string, Omit<OrgLocationData, 'locationId' | 'locationName' | 'storeNumber'>> = {};

      for (const locId of locationIds) {
        const locSales = (salesRows || []).filter(r => r.location_id === locId);
        const locLabor = (laborRows || []).filter(r => r.location_id === locId);

        // Today's row
        const todayRow = locSales.find(r => r.sale_date === effectiveToday);
        const salesToday = Number(todayRow?.net_sales) || 0;

        // Pace (shared, deterministic) — only for real today; goal: shared order.
        const paceToday = !isHistorical && todayRow
          ? computePace({ ...todayRow, nowInStoreTz: storeNow(tzByLoc.get(locId) || LA_TZ) })
          : null;
        const goalToday = resolveGoal(todayRow);

        // Last year same day
        const salesLastYearDay = todayRow?.yoy_net_sales != null ? Number(todayRow.yoy_net_sales) : null;

        // WTD
        const wtdRows = locSales.filter(r => r.sale_date >= wtdStart && r.sale_date <= effectiveToday);
        const salesWtd = wtdRows.reduce((sum, r) => sum + (Number(r.net_sales) || 0), 0);

        // Previous week
        const prevWeekRows = locSales.filter(r => r.sale_date >= prevWeekStart && r.sale_date <= prevWeekEnd);
        const salesPrevWeek = prevWeekRows.length > 0 ? prevWeekRows.reduce((sum, r) => sum + (Number(r.net_sales) || 0), 0) : null;

        // MTD
        const mtdRows = locSales.filter(r => r.sale_date >= mtdStart && r.sale_date <= effectiveToday);
        const salesMtd = mtdRows.reduce((sum, r) => sum + (Number(r.net_sales) || 0), 0);

        // Previous month
        const prevMonthRows = locSales.filter(r => r.sale_date >= prevMonthStart && r.sale_date <= prevMonthEndStr);
        const salesPrevMonth = prevMonthRows.length > 0 ? prevMonthRows.reduce((sum, r) => sum + (Number(r.net_sales) || 0), 0) : null;

        // Hourly data
        const hourly = Array(24).fill(0);
        if (todayRow?.hourly_data && Array.isArray(todayRow.hourly_data)) {
          for (const entry of todayRow.hourly_data as any[]) {
            const hourStr = String(entry.hour);
            const h = parseInt(hourStr.includes(':') ? hourStr.split(':')[0] : hourStr, 10);
            if (!isNaN(h) && h >= 0 && h < 24) {
              hourly[h] = Number(entry.sales) || Number(entry.actual) || 0;
            }
          }
        }

        // Last 7 days sparkline
        const last7 = Array(7).fill(0);
        for (let i = 0; i < 7; i++) {
          const dd = new Date(refDate);
          dd.setDate(dd.getDate() - (6 - i));
          const dStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
          const row = locSales.find(r => r.sale_date === dStr);
          last7[i] = Number(row?.net_sales) || 0;
        }

        // Labor: get_store_labor already returns ONE server-chosen row per store-day.
        const laborByDate = new Map<string, number>(locLabor.map(r => [r.labor_date, Number(r.labor_cost) || 0]));
        const laborCost = laborByDate.has(effectiveToday) ? (laborByDate.get(effectiveToday) || null) : null;
        const laborPercent = laborPct(laborCost, salesToday);
        const sumRange = (from: string) => {
          const vals = [...laborByDate].filter(([d]) => d >= from && d <= effectiveToday).map(([, v]) => v);
          return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) : null;
        };
        const laborCostWtd = sumRange(wtdStart);
        const laborCostMtd = sumRange(mtdStart);

        result[locId] = {
          salesToday, paceToday, goalToday,
          last7Days: last7,
          salesWtd, salesPrevWeek,
          salesMtd, salesPrevMonth,
          salesLastYearDay,
          laborPercent, laborCost,
          laborCostWtd, laborCostMtd,
          hourlyData: hourly,
        };
      }

      return result;
    },
    enabled: locationIds.length > 0,
    staleTime: isHistorical ? 10 * 60 * 1000 : 60 * 1000,
    refetchInterval: isHistorical ? false : 2 * 60 * 1000,
  });
}
