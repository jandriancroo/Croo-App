import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { formatInTimeZone } from 'date-fns-tz';

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
      
      // Get all locations in this org that the user has access to
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

      // Fetch org name + brand name
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
 * Fetches aggregated sales/labor data for multiple locations from cache
 * Pulls from the most recent cached data — no live API calls
 */
export function useOrgLocationData(locationIds: string[]) {
  return useQuery({
    queryKey: ['org-location-data', locationIds.sort().join(',')],
    queryFn: async () => {
      if (locationIds.length === 0) return {};

      const now = new Date();
      const todayStr = laDate(now);
      
      // Week start (Monday) in LA timezone
      const nowLA = new Date(formatInTimeZone(now, LA_TZ, "yyyy-MM-dd'T'HH:mm:ss"));
      const dayOfWeek = nowLA.getDay(); // 0=Sun
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(nowLA);
      weekStart.setDate(weekStart.getDate() - mondayOffset);
      const weekStartStr = laDate(weekStart);
      
      // Month start
      const monthStart = new Date(nowLA.getFullYear(), nowLA.getMonth(), 1);
      const monthStartStr = laDate(monthStart);
      
      // Previous period dates
      const prevWeekStartD = new Date(weekStart);
      prevWeekStartD.setDate(prevWeekStartD.getDate() - 7);
      const prevWeekEndD = new Date(weekStart);
      prevWeekEndD.setDate(prevWeekEndD.getDate() - 1);
      const prevWeekStart = laDate(prevWeekStartD);
      const prevWeekEnd = laDate(prevWeekEndD);
      
      const prevMonthStartD = new Date(nowLA.getFullYear(), nowLA.getMonth() - 1, 1);
      const prevMonthEndD = new Date(nowLA.getFullYear(), nowLA.getMonth(), 0);
      const prevMonthStart = laDate(prevMonthStartD);
      const prevMonthEnd = laDate(prevMonthEndD);
      
      // Last 7 days for sparkline
      const sparklineStartD = new Date(nowLA);
      sparklineStartD.setDate(sparklineStartD.getDate() - 6);
      const sparklineStart = laDate(sparklineStartD);

      // Fetch all sales cache data in parallel
      const [salesResult, laborResult, sparklineResult, prevWeekResult, prevMonthResult, laborWtdResult, laborMtdResult] = await Promise.all([
        // Today + WTD + MTD sales (all in one query since date range covers it)
        supabase
          .from('sales_cache')
          .select('location_id, sale_date, net_sales, hourly_data, projected_sales, living_projection, override_projection, avg_ticket, guest_count, yoy_net_sales')
          .in('location_id', locationIds)
          .gte('sale_date', monthStartStr)
          .lte('sale_date', todayStr),

        // Today's labor for each location (prefer punch_clock)
        supabase
          .from('labor_cache')
          .select('location_id, labor_cost, labor_hours, labor_date, source')
          .in('location_id', locationIds)
          .eq('labor_date', todayStr),

        // Sparkline: last 7 days
        supabase
          .from('sales_cache')
          .select('location_id, sale_date, net_sales')
          .in('location_id', locationIds)
          .gte('sale_date', sparklineStart)
          .lte('sale_date', todayStr)
          .order('sale_date', { ascending: true }),

        // Previous week sales for comparison
        supabase
          .from('sales_cache')
          .select('location_id, net_sales')
          .in('location_id', locationIds)
          .gte('sale_date', prevWeekStart)
          .lte('sale_date', prevWeekEnd),

        // Previous month sales for comparison
        supabase
          .from('sales_cache')
          .select('location_id, net_sales')
          .in('location_id', locationIds)
          .gte('sale_date', prevMonthStart)
          .lte('sale_date', prevMonthEnd),

        // WTD labor
        supabase
          .from('labor_cache')
          .select('location_id, labor_cost, source')
          .in('location_id', locationIds)
          .gte('labor_date', weekStartStr)
          .lte('labor_date', todayStr),

        // MTD labor
        supabase
          .from('labor_cache')
          .select('location_id, labor_cost, source')
          .in('location_id', locationIds)
          .gte('labor_date', monthStartStr)
          .lte('labor_date', todayStr),
      ]);

      const result: Record<string, Omit<OrgLocationData, 'locationId' | 'locationName' | 'storeNumber'>> = {};

      for (const locId of locationIds) {
        const locSales = salesResult.data?.filter(s => s.location_id === locId) || [];
        const todaySales = locSales.find(s => s.sale_date === todayStr);
        
        // WTD: sum all days from week start to today
        const wtdSales = locSales
          .filter(s => s.sale_date >= weekStartStr && s.sale_date <= todayStr)
          .reduce((sum, s) => sum + (s.net_sales || 0), 0);

        // MTD: sum all days this month
        const mtdSales = locSales
          .reduce((sum, s) => sum + (s.net_sales || 0), 0);

        // Prev week total
        const prevWeekTotal = prevWeekResult.data
          ?.filter(s => s.location_id === locId)
          .reduce((sum, s) => sum + (s.net_sales || 0), 0) || null;

        // Prev month total
        const prevMonthTotal = prevMonthResult.data
          ?.filter(s => s.location_id === locId)
          .reduce((sum, s) => sum + (s.net_sales || 0), 0) || null;

        // Sparkline
        const sparklineDays = sparklineResult.data?.filter(s => s.location_id === locId) || [];
        const last7 = Array(7).fill(0);
        for (const day of sparklineDays) {
          // Calculate index based on date difference from sparklineStart
          const dayDate = new Date(day.sale_date + 'T12:00:00'); // noon to avoid TZ issues
          const startDate = new Date(sparklineStartD.getFullYear(), sparklineStartD.getMonth(), sparklineStartD.getDate(), 12);
          const idx = Math.round((dayDate.getTime() - startDate.getTime()) / (86400000));
          if (idx >= 0 && idx < 7) last7[idx] = day.net_sales || 0;
        }

        // Labor (prefer punch_clock)
        const locLabor = laborResult.data?.filter(l => l.location_id === locId) || [];
        const punchLabor = locLabor.find(l => l.source === 'punch_clock');
        const bestLabor = punchLabor || locLabor[0];
        const laborCost = bestLabor?.labor_cost ?? null;
        const todayNet = todaySales?.net_sales || 0;
        const laborPercent = laborCost !== null && todayNet > 0 
          ? (laborCost / todayNet) * 100 
          : null;

        // Hourly data — extract ONLY actual sales, not projected
        // Format in sales_cache is array of { hour: string, sales: number, checksCount: number, projected?: number }
        const hourly = Array(24).fill(0);
        if (todaySales?.hourly_data) {
          if (Array.isArray(todaySales.hourly_data)) {
            // Array format: [{ hour: "11:00 AM", sales: 350, ... }]
            for (const entry of todaySales.hourly_data as Array<{ hour: string; sales: number; projected?: number }>) {
              const hourStr = entry.hour;
              // Parse hour from "11:00 AM" or "2:00 PM" format
              const match = hourStr?.match(/^(\d{1,2}):?\d*\s*(AM|PM)?$/i);
              if (match) {
                let h = parseInt(match[1]);
                const ampm = match[2]?.toUpperCase();
                if (ampm === 'PM' && h !== 12) h += 12;
                if (ampm === 'AM' && h === 12) h = 0;
                if (h >= 0 && h < 24) {
                  hourly[h] = entry.sales || 0; // Only actual sales, NOT projected
                }
              }
            }
          } else if (typeof todaySales.hourly_data === 'object') {
            // Object format keyed by hour index
            const hd = todaySales.hourly_data as Record<string, any>;
            for (const [hour, val] of Object.entries(hd)) {
              const h = parseInt(hour);
              if (!isNaN(h) && h >= 0 && h < 24) {
                // Only use actual sales field, not projected
                hourly[h] = typeof val === 'number' ? val : (val?.sales ?? val?.actual ?? 0);
              }
            }
          }
        }

        // Pace = living_projection (dynamic) or override. NEVER fall back to projected_sales (that's the goal)
        const pace = todaySales?.living_projection ?? todaySales?.override_projection ?? null;

        // WTD labor (sum per location, prefer punch_clock per day but aggregate all)
        const locLaborWtd = laborWtdResult.data?.filter(l => l.location_id === locId) || [];
        const laborCostWtd = locLaborWtd.length > 0
          ? locLaborWtd.reduce((sum, l) => sum + (l.labor_cost || 0), 0)
          : null;

        // MTD labor
        const locLaborMtd = laborMtdResult.data?.filter(l => l.location_id === locId) || [];
        const laborCostMtd = locLaborMtd.length > 0
          ? locLaborMtd.reduce((sum, l) => sum + (l.labor_cost || 0), 0)
          : null;

        // Goal = resolved projection (override > living > initial > projected_sales)
        const goalVal = Number(todaySales?.override_projection) || Number(todaySales?.living_projection) || Number(todaySales?.projected_sales) || null;

        result[locId] = {
          salesToday: todayNet,
          paceToday: pace,
          goalToday: goalVal,
          last7Days: last7,
          salesWtd: wtdSales,
          salesPrevWeek: prevWeekTotal,
          salesMtd: mtdSales,
          salesPrevMonth: prevMonthTotal,
          salesLastYearDay: todaySales?.yoy_net_sales ?? null,
          laborPercent,
          laborCost,
          laborCostWtd,
          laborCostMtd,
          hourlyData: hourly,
        };
      }

      return result;
    },
    enabled: locationIds.length > 0,
    staleTime: 60 * 1000, // 1 min - data comes from cache anyway
    refetchInterval: 2 * 60 * 1000, // Re-pull every 2 min
  });
}
