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
 * Fetches sales/labor data for multiple locations by calling the SAME
 * edge function that SalesSummary uses (fetch-qubeyond-sales).
 * This guarantees identical numbers for goal, pace, sales, labor, etc.
 */
export function useOrgLocationData(locationIds: string[]) {
  return useQuery({
    queryKey: ['org-location-data', locationIds.sort().join(',')],
    queryFn: async () => {
      if (locationIds.length === 0) return {};

      const now = new Date();
      const todayStr = laDate(now);

      // Call the same edge function SalesSummary uses, for each location in parallel
      const responses = await Promise.allSettled(
        locationIds.map(locId =>
          supabase.functions.invoke('fetch-qubeyond-sales', {
            body: { locationId: locId, targetDate: todayStr, fastMode: true }
          }).then(res => ({ locId, data: res.data, error: res.error }))
        )
      );

      const result: Record<string, Omit<OrgLocationData, 'locationId' | 'locationName' | 'storeNumber'>> = {};

      for (const res of responses) {
        if (res.status !== 'fulfilled') continue;
        const { locId, data, error } = res.value;
        if (error || !data || (data as any).authenticated === false) {
          // Still provide empty entry so the card renders
          result[locId] = {
            salesToday: 0, paceToday: null, goalToday: null,
            last7Days: Array(7).fill(0),
            salesWtd: 0, salesPrevWeek: null,
            salesMtd: 0, salesPrevMonth: null,
            salesLastYearDay: null,
            laborPercent: null, laborCost: null,
            laborCostWtd: null, laborCostMtd: null,
            hourlyData: Array(24).fill(0),
          };
          continue;
        }

        const sd = data as any; // SalesData shape from edge function

        // Hourly data — extract only actual sales for heatmap display
        const hourly = Array(24).fill(0);
        if (sd.hourly && Array.isArray(sd.hourly)) {
          for (const entry of sd.hourly) {
            const hourStr = entry.hour;
            const match = hourStr?.match(/^(\d{1,2}):?\d*\s*(AM|PM)?$/i);
            if (match) {
              let h = parseInt(match[1]);
              const ampm = match[2]?.toUpperCase();
              if (ampm === 'PM' && h !== 12) h += 12;
              if (ampm === 'AM' && h === 12) h = 0;
              if (h >= 0 && h < 24) {
                hourly[h] = Number(entry.sales) || 0;
              }
            }
          }
        }

        // Sparkline from weeklyBreakdown
        const last7 = Array(7).fill(0);
        if (sd.weeklyBreakdown && Array.isArray(sd.weeklyBreakdown)) {
          sd.weeklyBreakdown.forEach((day: any, i: number) => {
            if (i < 7) last7[i] = Number(day.sales) || 0;
          });
        }

        // Labor — directly from edge function response (same as SalesSummary)
        const laborCost = sd.labor?.laborCost ?? null;
        const laborPercent = sd.labor?.laborPercent ?? null;
        const laborCostWtd = sd.weeklyLabor?.laborCost ?? null;
        const laborCostMtd = sd.monthlyLabor?.laborCost ?? null;

        result[locId] = {
          salesToday: Number(sd.daily) || 0,
          paceToday: sd.projections?.todayPaceAdjusted
            ? Math.max(Number(sd.projections.todayPaceAdjusted), Number(sd.daily) || 0)
            : null,
          goalToday: sd.projections?.todayProjected ? Number(sd.projections.todayProjected) : null,
          last7Days: last7,
          salesWtd: Number(sd.weekly) || 0,
          salesPrevWeek: sd.comparison?.prevWeek ?? null,
          salesMtd: Number(sd.monthly) || 0,
          salesPrevMonth: sd.comparison?.prevMonth ?? null,
          salesLastYearDay: sd.lastYear?.sameDay ?? null,
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
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}
