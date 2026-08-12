import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { formatInTimeZone } from 'date-fns-tz';
import { fetchLiveLaborForToday } from '@/utils/liveLabor';

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
        .select('location_id, sale_date, net_sales, living_projection, override_projection, initial_projection, projected_sales, hourly_data, yoy_net_sales')
        .in('location_id', locationIds)
        .gte('sale_date', prevMonthStart)
        .lte('sale_date', effectiveToday);

      // Fetch labor
      const { data: laborRows } = await supabase
        .from('labor_cache')
        .select('location_id, labor_date, labor_cost, source')
        .in('location_id', locationIds)
        .gte('labor_date', mtdStart)
        .lte('labor_date', effectiveToday);

      // labor_cache only holds CLOSED days — pull today's live labor per location
      // from the shared punch helper so org cards match each store's dashboard.
      const liveTodayByLoc = new Map<string, { date: string; hours: number; cost: number }>();
      if (!isHistorical) {
        const lives = await Promise.all(
          locationIds.map(id => fetchLiveLaborForToday(id).catch(() => null))
        );
        lives.forEach((live, i) => {
          if (live && live.hours > 0) liveTodayByLoc.set(locationIds[i], live);
        });
      }

      const result: Record<string, Omit<OrgLocationData, 'locationId' | 'locationName' | 'storeNumber'>> = {};

      for (const locId of locationIds) {
        const locSales = (salesRows || []).filter(r => r.location_id === locId);
        const liveToday = liveTodayByLoc.get(locId);
        const locLaborRaw = (laborRows || []).filter(r => r.location_id === locId);
        const locLabor =
          liveToday && !locLaborRaw.some(r => r.labor_date === liveToday.date && Number(r.labor_cost) > 0)
            ? [
                ...locLaborRaw.filter(r => r.labor_date !== liveToday.date),
                { location_id: locId, labor_date: liveToday.date, labor_cost: liveToday.cost, source: 'punch_clock' } as any,
              ]
            : locLaborRaw;

        // Today's row
        const todayRow = locSales.find(r => r.sale_date === effectiveToday);
        const salesToday = Number(todayRow?.net_sales) || 0;

        // Pace: only for real today, not historical
        let paceToday: number | null = null;
        if (!isHistorical && todayRow?.hourly_data && Array.isArray(todayRow.hourly_data)) {
          const nowLA = new Date(nowReal.toLocaleString('en-US', { timeZone: LA_TZ }));
          const currentHour = nowLA.getHours();
          const currentMinutes = nowLA.getMinutes();
          
          // === SHIFT-AWARE PACE V3 ===
          // Shift boundary at 3 PM (hour 15). Before 3 PM: lunch trend. After: dinner trend.
          // If dinner has < 3 data points, carry lunch average at 50% weight.
          const SHIFT_BOUNDARY = 15;
          
          // Collect per-hour over/under % split by shift
          const lunchPcts: number[] = [];
          const dinnerPcts: number[] = [];
          for (const entry of todayRow.hourly_data as any[]) {
            const h = parseInt(String(entry.hour || ''));
            if (isNaN(h)) continue;
            const actual = Number(entry.sales) || 0;
            const projected = Number(entry.projected) || 0;
            if (projected > 0) {
              const isCompleted = (h < currentHour && actual > 0) || 
                                  (h === currentHour && currentMinutes >= 30 && actual > 0);
              if (isCompleted) {
                if (h < SHIFT_BOUNDARY) {
                  lunchPcts.push((actual - projected) / projected);
                } else {
                  dinnerPcts.push((actual - projected) / projected);
                }
              }
            }
          }
          
          let adjustmentFactor = 1.0;
          const isDinnerShift = currentHour >= SHIFT_BOUNDARY;
          let activeAvg: number | null = null;
          
          if (isDinnerShift) {
            if (dinnerPcts.length >= 3) {
              activeAvg = dinnerPcts.reduce((a, b) => a + b, 0) / dinnerPcts.length;
            } else if (lunchPcts.length >= 3) {
              // Carry lunch avg at 50% weight during dinner ramp-up
              activeAvg = (lunchPcts.reduce((a, b) => a + b, 0) / lunchPcts.length) * 0.5;
            }
          } else {
            if (lunchPcts.length >= 3) {
              activeAvg = lunchPcts.reduce((a, b) => a + b, 0) / lunchPcts.length;
            }
          }
          
          if (activeAvg !== null) {
            const severity = Math.min(Math.abs(activeAvg) / 0.50, 1.0);
            const rand = Math.random();
            const variant = activeAvg < 0 ? -(rand * 0.02 * severity) : rand * 0.03 * severity;
            adjustmentFactor = 1.0 + activeAvg + variant;
          }
          
          // Build pace with adjustment
          let paceSum = 0;
          for (const entry of todayRow.hourly_data as any[]) {
            const h = parseInt(String(entry.hour || ''));
            if (isNaN(h)) continue;
            const actual = Number(entry.sales) || 0;
            const projected = Number(entry.projected) || 0;
            if (h < currentHour) {
              paceSum += actual;
            } else if (h === currentHour) {
              if (currentMinutes < 30) {
                paceSum += projected * adjustmentFactor;
              } else {
                const remainFrac = (60 - currentMinutes) / 60;
                paceSum += actual + (projected * remainFrac * adjustmentFactor);
              }
            } else {
              paceSum += projected * adjustmentFactor;
            }
          }
          paceToday = paceSum > 0 ? Math.max(paceSum, salesToday) : null;
        }

        // Goal: override > initial > projected
        const goalToday = Number(todayRow?.override_projection) || Number(todayRow?.initial_projection) || Number(todayRow?.projected_sales) || null;

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

        // Labor — prefer punch_clock source
        const todayLabor = locLabor
          .filter(r => r.labor_date === effectiveToday)
          .sort((a, b) => (a.source === 'punch_clock' ? -1 : 1));
        const laborCost = todayLabor.length > 0 ? Number(todayLabor[0].labor_cost) || null : null;
        const laborPercent = laborCost != null && salesToday > 0 ? (laborCost / salesToday) * 100 : null;

        // Labor WTD
        const wtdLabor = locLabor.filter(r => r.labor_date >= wtdStart && r.labor_date <= effectiveToday);
        const wtdLaborByDate = new Map<string, number>();
        for (const r of wtdLabor.sort((a, b) => (a.source === 'punch_clock' ? -1 : 1))) {
          if (!wtdLaborByDate.has(r.labor_date)) {
            wtdLaborByDate.set(r.labor_date, Number(r.labor_cost) || 0);
          }
        }
        const laborCostWtd = wtdLaborByDate.size > 0 ? Array.from(wtdLaborByDate.values()).reduce((s, v) => s + v, 0) : null;

        // Labor MTD
        const mtdLabor = locLabor.filter(r => r.labor_date >= mtdStart && r.labor_date <= effectiveToday);
        const mtdLaborByDate = new Map<string, number>();
        for (const r of mtdLabor.sort((a, b) => (a.source === 'punch_clock' ? -1 : 1))) {
          if (!mtdLaborByDate.has(r.labor_date)) {
            mtdLaborByDate.set(r.labor_date, Number(r.labor_cost) || 0);
          }
        }
        const laborCostMtd = mtdLaborByDate.size > 0 ? Array.from(mtdLaborByDate.values()).reduce((s, v) => s + v, 0) : null;

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
