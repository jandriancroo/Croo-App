import { useState, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Building2, TrendingUp, TrendingDown, Minus, ExternalLink, FileText, AlertTriangle, Check, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { SalesSummaryChart } from '@/components/dashboard/SalesSummaryChart';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getCachedLiveSales, setCachedLiveSales, getCachedProjections, setCachedProjections } from '@/utils/salesCache';

interface LocationRow {
  id: string;
  name: string;
  store_number: string | null;
}

interface LocationSalesData {
  // Daily data
  sales: number;
  goal: number;
  pace: number;
  status: 'ahead' | 'behind' | 'on-track';
  hourlyData: Array<{ hour: string; sales: number; projected?: number }>;
  // Weekly totals
  weeklySales: number;
  weeklyGoal: number;
  weeklyStatus: 'ahead' | 'behind' | 'on-track';
  weeklyBreakdown: Array<{ date: string; sales: number; projected: number }>;
  // Monthly totals
  monthlySales: number;
  monthlyGoal: number;
  monthlyStatus: 'ahead' | 'behind' | 'on-track';
  monthlyBreakdown: Array<{ date: string; sales: number; projected: number }>;
}

interface LocationChecklistData {
  id: string;
  title: string;
  expected: number;
  completed: number;
}

interface LocationAuditData {
  id: string;
  audit_date: string;
  visit_score: string | null;
  manager_name: string | null;
  audit_url: string;
}

export default function MultiLocationDashboard() {
  const { organizationId: contextOrgId } = useAppLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [chartPeriod, setChartPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Prefer org from URL param, fallback to context org
  const urlOrgId = searchParams.get('org');
  const organizationId = urlOrgId || contextOrgId;

  // Fetch all locations in the organization
  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ['org-locations', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, store_number')
        .eq('organization_id', organizationId)
        .order('name');
      
      if (error) throw error;
      return data as LocationRow[];
    },
    enabled: !!organizationId,
  });

  // Date ranges
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
  const monthStartStr = format(monthStart, 'yyyy-MM-dd');
  const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

  // Helper: calculate pace-adjusted projection (same logic as edge function)
  // actualSales + remaining hourly projections for the day
  const calculatePaceAdjusted = (
    actualSales: number, 
    hourlyData: Array<{ hour: string; sales: number; projected?: number }>,
    hoursOpen: number,
    hoursClose: number
  ): number => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();
    
    // If store is closed or hasn't opened yet, return actual sales
    if (currentHour < hoursOpen || currentHour >= hoursClose) {
      return actualSales;
    }
    
    // Calculate fraction of current hour remaining
    const minutesRemainingInCurrentHour = 60 - currentMinutes;
    const fractionOfCurrentHourRemaining = minutesRemainingInCurrentHour / 60;
    
    // Get current hour's projection and add fractional remaining portion
    const currentHourStr = `${currentHour.toString().padStart(2, '0')}:00`;
    const currentHourData = hourlyData.find(h => h.hour === currentHourStr);
    const currentHourRemainingProjection = currentHourData?.projected 
      ? currentHourData.projected * fractionOfCurrentHourRemaining 
      : 0;
    
    // Sum up projections for FUTURE hours (starting from next hour through close)
    let futureHoursProjected = 0;
    for (let hour = currentHour + 1; hour < hoursClose; hour++) {
      const hourStr = `${hour.toString().padStart(2, '0')}:00`;
      const hourData = hourlyData.find(h => h.hour === hourStr);
      if (hourData?.projected) {
        futureHoursProjected += hourData.projected;
      }
    }
    
    // Pace-adjusted = actual sales + remaining projections
    const paceAdjusted = actualSales + currentHourRemainingProjection + futureHoursProjected;
    
    // CRITICAL: Pacing should NEVER be below actual sales - clamp to floor
    return Math.max(Math.round(paceAdjusted), actualSales);
  };

  // SHARED CACHE APPROACH: Use the same localStorage cache as Dashboard
  // This ensures both pages show IDENTICAL values for Sales, AI Goal, and Pace
  // Cache TTL: 3 minutes (matches Dashboard's cache freshness window)
  
  // Sync and fetch live sales data — USES SHARED LOCALSTORAGE CACHE
  // Priority: 1) Fresh localStorage cache (<3 min) 2) Edge function call (updates cache)
  const { data: liveDataMap = {}, isLoading: syncLoading } = useQuery({
    queryKey: ['org-live-sales-shared-cache', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const liveResults: Record<string, { 
        sales: number;
        projections: { 
          todayProjected: number; 
          todayPaceAdjusted: number; 
          weekProjected: number; 
          monthProjected: number 
        };
        hourlyData: Array<{ hour: string; sales: number; projected?: number }>;
        fromCache: boolean;
      }> = {};
      
      // Check each location's localStorage cache first
      const locationsNeedingRefresh: string[] = [];
      
      for (const loc of locations) {
        const cachedLive = getCachedLiveSales(loc.id);
        const cachedProj = getCachedProjections(loc.id);
        
        // If cache is fresh (<3 min), use it directly — NO API CALL
        if (cachedLive?.isFresh && cachedLive.data) {
          console.log(`[OrgDash] Location ${loc.id}: Using fresh cache (< 3 min old)`);
          
          // Extract values from cached data (same structure as Dashboard stores)
          const salesData = cachedLive.data;
          const projections = salesData.projections || cachedProj || {};
          
          liveResults[loc.id] = {
            sales: salesData.daily || 0,
            projections: {
              todayProjected: projections.todayProjected || 0,
              todayPaceAdjusted: projections.todayPaceAdjusted || 0,
              weekProjected: projections.weekProjected || 0,
              monthProjected: projections.monthProjected || 0,
            },
            hourlyData: salesData.hourly || [],
            fromCache: true,
          };
        } else {
          // Cache is stale or missing — needs refresh
          locationsNeedingRefresh.push(loc.id);
        }
      }
      
      console.log(`[OrgDash] Cache check: ${locations.length - locationsNeedingRefresh.length} fresh, ${locationsNeedingRefresh.length} need refresh`);
      
      // Fetch fresh data for stale locations
      if (locationsNeedingRefresh.length > 0) {
        const BATCH_SIZE = 5;
        for (let i = 0; i < locationsNeedingRefresh.length; i += BATCH_SIZE) {
          const batch = locationsNeedingRefresh.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async locationId => {
              try {
                const { data, error } = await supabase.functions.invoke('fetch-qubeyond-sales', {
                  body: { 
                    locationId,
                    targetDate: todayStr,
                    skipProjections: false,
                    fastMode: true
                  }
                });
                if (error) {
                  console.warn(`[OrgDash] Failed to sync location ${locationId}:`, error);
                  return null;
                }
                return { locationId, data };
              } catch (err) {
                console.warn(`[OrgDash] Failed to sync location ${locationId}:`, err);
                return null;
              }
            })
          );
          
          // Process results and UPDATE SHARED CACHE
          for (const result of batchResults) {
            if (result?.data) {
              const { locationId, data: salesData } = result;
              
              // Store in shared localStorage cache (same as Dashboard does)
              setCachedLiveSales(locationId, salesData);
              
              // Store projections in shared cache (same as Dashboard does)
              if (salesData.projections) {
                const proj = salesData.projections;
                const weeklySales = salesData.weekly || 0;
                const monthlySales = salesData.monthly || 0;
                
                // Sanity check before caching (same as SalesSummary)
                if (proj.weekProjected >= weeklySales && proj.monthProjected >= monthlySales && 
                    proj.weekProjected > 0 && proj.monthProjected > 0) {
                  setCachedProjections(locationId, {
                    todayProjected: proj.todayProjected > 0 ? proj.todayProjected : undefined,
                    todayPaceAdjusted: proj.todayPaceAdjusted > 0 ? proj.todayPaceAdjusted : undefined,
                    weekProjected: proj.weekProjected,
                    monthProjected: proj.monthProjected,
                  });
                }
              }
              
              liveResults[locationId] = {
                sales: salesData.daily || 0,
                projections: salesData.projections || { todayProjected: 0, todayPaceAdjusted: 0, weekProjected: 0, monthProjected: 0 },
                hourlyData: salesData.hourly || [],
                fromCache: false,
              };
            }
          }
        }
      }
      
      return liveResults;
    },
    enabled: locations.length > 0,
    staleTime: 60 * 1000, // Only re-check every 60s (cache handles freshness)
    refetchInterval: 3 * 60 * 1000, // Re-check every 3 minutes (matches cache TTL)
  });

  // Fetch sales data from sales_cache — SAME SOURCE as SalesSummary.checkDatabaseCache
  // This runs AFTER sync to ensure we have fresh data
  // We include liveDataMap in the key so it refetches after sync completes
  const { data: salesDataMap = {}, isLoading: salesLoading } = useQuery({
    queryKey: ['org-sales-data', locations.map(l => l.id), todayStr, weekStartStr, monthEndStr, Object.keys(liveDataMap).length],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      // Fetch today's data, week range, and month range from sales_cache in parallel
      const [todayResult, weekResult, monthResult] = await Promise.all([
        supabase
          .from('sales_cache')
          .select('*')
          .in('location_id', locationIds)
          .eq('sale_date', todayStr),
        supabase
          .from('sales_cache')
          .select('location_id, sale_date, net_sales, guest_count, projected_sales, initial_projection, living_projection, override_projection')
          .in('location_id', locationIds)
          .gte('sale_date', weekStartStr)
          .lte('sale_date', weekEndStr)
          .order('sale_date'),
        supabase
          .from('sales_cache')
          .select('location_id, sale_date, net_sales, guest_count, projected_sales, initial_projection, living_projection, override_projection')
          .in('location_id', locationIds)
          .gte('sale_date', monthStartStr)
          .lte('sale_date', monthEndStr)
          .order('sale_date'),
      ]);
      
      if (todayResult.error || weekResult.error || monthResult.error) {
        console.error('[OrgDash] sales_cache query error:', todayResult.error || weekResult.error || monthResult.error);
        return {};
      }
      
      // Build lookup maps
      const todayDataByLocation = new Map<string, any>();
      for (const row of todayResult.data || []) {
        todayDataByLocation.set(row.location_id, row);
      }
      
      const weekDataByLocation = new Map<string, any[]>();
      for (const row of weekResult.data || []) {
        if (!weekDataByLocation.has(row.location_id)) {
          weekDataByLocation.set(row.location_id, []);
        }
        weekDataByLocation.get(row.location_id)!.push(row);
      }
      
      const monthDataByLocation = new Map<string, any[]>();
      for (const row of monthResult.data || []) {
        if (!monthDataByLocation.has(row.location_id)) {
          monthDataByLocation.set(row.location_id, []);
        }
        monthDataByLocation.get(row.location_id)!.push(row);
      }
      
      const result: Record<string, LocationSalesData> = {};
      
      // Default business hours (will be overridden per location if available)
      const DEFAULT_OPEN = 10;
      const DEFAULT_CLOSE = 22;
      
      for (const loc of locations) {
        const todayData = todayDataByLocation.get(loc.id);
        const weekData = weekDataByLocation.get(loc.id) || [];
        const monthData = monthDataByLocation.get(loc.id) || [];
        
        // SHARED CACHE: Prefer live data from localStorage cache when available
        const liveData = liveDataMap[loc.id];
        
        // Daily sales: PREFER shared cache value (same as Dashboard sees)
        const dailySales = liveData?.sales ?? (todayData ? Number(todayData.net_sales) || 0 : 0);
        
        // Daily goal: PREFER shared cache projection (EXACT same as Dashboard)
        const dailyGoal = liveData?.projections?.todayProjected && liveData.projections.todayProjected > 0
          ? liveData.projections.todayProjected 
          : (resolveProjection(todayData).value || 0);
        
        // Hourly data: PREFER shared cache (same as Dashboard sees)
        const hourlyData: Array<{ hour: string; sales: number; projected?: number }> = liveData?.hourlyData?.length 
          ? liveData.hourlyData 
          : (todayData?.hourly_data && Array.isArray(todayData.hourly_data) 
              ? todayData.hourly_data.map((h: any) => ({ hour: h.hour, sales: h.sales || 0, projected: h.projected }))
              : []);
        
        // Pace: PREFER shared cache pace-adjusted value (EXACT same as Dashboard)
        const pace = liveData?.projections?.todayPaceAdjusted && liveData.projections.todayPaceAdjusted > 0
          ? liveData.projections.todayPaceAdjusted
          : calculatePaceAdjusted(dailySales, hourlyData, DEFAULT_OPEN, DEFAULT_CLOSE);
        
        // Status calculation using pace vs goal
        let status: 'ahead' | 'behind' | 'on-track' = 'on-track';
        if (dailyGoal > 0 && pace > 0) {
          const pacePercent = (pace / dailyGoal) * 100;
          if (pacePercent >= 103) status = 'ahead';
          else if (pacePercent <= 97) status = 'behind';
        }
        
        // Weekly data - build full 7-day breakdown
        const weekDataMap = new Map(weekData.map((d: any) => [d.sale_date, d]));
        const weeklyBreakdown: Array<{ date: string; sales: number; projected: number }> = [];
        let weeklySales = 0;
        let weeklyGoal = 0;
        
        for (let i = 0; i < 7; i++) {
          const dayDate = new Date(weekStart);
          dayDate.setDate(weekStart.getDate() + i);
          const dayStr = format(dayDate, 'yyyy-MM-dd');
          const dayData = weekDataMap.get(dayStr);
          
          // For today, use cached sales value (same as Dashboard)
          const daySales = dayStr === todayStr 
            ? dailySales  // Use the cached value from liveDataMap
            : (dayData ? Number(dayData.net_sales) || 0 : 0);
          
          // For today, use cached projection (same as Dashboard)
          let dayProjected: number;
          if (dayStr === todayStr && liveData?.projections?.todayProjected) {
            dayProjected = liveData.projections.todayProjected;
          } else {
            const dayResolved = resolveProjection(dayData);
            dayProjected = dayResolved.value && dayResolved.value > 0 ? dayResolved.value : daySales;
          }
          
          weeklyBreakdown.push({ date: dayStr, sales: daySales, projected: dayProjected });
          weeklySales += daySales;
          
          // Weekly goal: past days use actuals, today use MAX(actual, proj), future use projections
          if (dayStr < todayStr) {
            weeklyGoal += daySales;
          } else if (dayStr === todayStr) {
            weeklyGoal += Math.max(daySales, dayProjected);
          } else {
            weeklyGoal += dayProjected;
          }
        }
        
        const weeklyStatus: 'ahead' | 'behind' | 'on-track' = weeklyGoal > 0 
          ? (weeklySales / weeklyGoal >= 1.03 ? 'ahead' : weeklySales / weeklyGoal <= 0.97 ? 'behind' : 'on-track')
          : 'on-track';
        
        // Monthly data - build full month breakdown
        const monthDataMap = new Map(monthData.map((d: any) => [d.sale_date, d]));
        const daysInMonth = monthEnd.getDate();
        const monthlyBreakdown: Array<{ date: string; sales: number; projected: number }> = [];
        let monthlySales = 0;
        let monthlyGoal = 0;
        
        for (let day = 1; day <= daysInMonth; day++) {
          const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
          const dayStr = format(dayDate, 'yyyy-MM-dd');
          const dayData = monthDataMap.get(dayStr);
          
          // For today, use cached sales value (same as Dashboard)
          const daySales = dayStr === todayStr 
            ? dailySales  // Use the cached value from liveDataMap
            : (dayData ? Number(dayData.net_sales) || 0 : 0);
          
          // For today, use cached projection (same as Dashboard)
          let dayProjected: number;
          if (dayStr === todayStr && liveData?.projections?.todayProjected) {
            dayProjected = liveData.projections.todayProjected;
          } else {
            const dayResolved = resolveProjection(dayData);
            dayProjected = dayResolved.value && dayResolved.value > 0 ? dayResolved.value : daySales;
          }
          
          monthlyBreakdown.push({ date: dayStr, sales: daySales, projected: dayProjected });
          monthlySales += daySales;
          
          // Monthly goal: past days use actuals, today use MAX(actual, proj), future use projections
          if (dayStr < todayStr) {
            monthlyGoal += daySales;
          } else if (dayStr === todayStr) {
            monthlyGoal += Math.max(daySales, dayProjected);
          } else {
            monthlyGoal += dayProjected;
          }
        }
        
        const monthlyStatus: 'ahead' | 'behind' | 'on-track' = monthlyGoal > 0 
          ? (monthlySales / monthlyGoal >= 1.03 ? 'ahead' : monthlySales / monthlyGoal <= 0.97 ? 'behind' : 'on-track')
          : 'on-track';
        
        result[loc.id] = {
          sales: dailySales,
          goal: dailyGoal,
          pace,
          status,
          hourlyData,
          weeklySales,
          weeklyGoal,
          weeklyStatus,
          weeklyBreakdown,
          monthlySales,
          monthlyGoal,
          monthlyStatus,
          monthlyBreakdown,
        };
      }
      
      return result;
    },
    enabled: locations.length > 0 && !syncLoading,
    refetchInterval: 60000,
  });

  // Fetch checklist data
  const { data: checklistDataMap = {}, isLoading: checklistsLoading } = useQuery({
    queryKey: ['org-checklists', locations.map(l => l.id), todayStr],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      const { data: checklists, error: checklistError } = await supabase
        .from('checklists')
        .select('id, title, location_id, frequency, template_type, checklist_items(id, days_of_week)')
        .in('location_id', locationIds)
        .eq('is_active', true);
      
      if (checklistError) throw checklistError;
      
      const now = new Date();
      const cutoffHour = 4;
      const businessDayStart = new Date(now);
      businessDayStart.setHours(cutoffHour, 0, 0, 0);
      if (now.getHours() < cutoffHour) {
        businessDayStart.setDate(businessDayStart.getDate() - 1);
      }
      const businessDayEnd = new Date(businessDayStart);
      businessDayEnd.setDate(businessDayEnd.getDate() + 1);
      
      const { data: responses, error: responseError } = await supabase
        .from('checklist_responses')
        .select(`
          id,
          item_id,
          created_at,
          checklist_submissions!inner(id, checklist_id, location_id)
        `)
        .in('checklist_submissions.location_id', locationIds)
        .gte('created_at', businessDayStart.toISOString())
        .lte('created_at', businessDayEnd.toISOString());
      
      if (responseError) throw responseError;
      
      const result: Record<string, LocationChecklistData[]> = {};
      
      for (const loc of locations) {
        const locChecklists = checklists?.filter(c => c.location_id === loc.id) || [];
        const currentDay = getDayOfWeekInTimezone('America/Los_Angeles');
        
        const checklistData: LocationChecklistData[] = [];
        
        for (const checklist of locChecklists) {
          const items = checklist.checklist_items || [];
          let expectedCount = items.length;
          let todayItemIds: Set<string> | null = null;
          
          if (checklist.template_type === 'dynamic') {
            const todayItems = items.filter((item: any) => 
              item.days_of_week && item.days_of_week.includes(currentDay)
            );
            expectedCount = todayItems.length;
            todayItemIds = new Set(todayItems.map((item: any) => item.id));
            if (expectedCount === 0) continue;
          }
          
          const locResponses = responses?.filter((r: any) => 
            r.checklist_submissions?.checklist_id === checklist.id &&
            r.checklist_submissions?.location_id === loc.id
          ) || [];
          
          const uniqueItemIds = new Set<string>();
          locResponses.forEach((response: any) => {
            if (response.item_id) {
              if (todayItemIds === null || todayItemIds.has(response.item_id)) {
                uniqueItemIds.add(response.item_id);
              }
            }
          });
          
          checklistData.push({
            id: checklist.id,
            title: checklist.title,
            expected: expectedCount,
            completed: uniqueItemIds.size,
          });
        }
        
        result[loc.id] = checklistData;
      }
      
      return result;
    },
    enabled: locations.length > 0,
    refetchInterval: 30000,
  });

  // Fetch audits
  const { data: auditDataMap = {}, isLoading: auditsLoading } = useQuery({
    queryKey: ['org-audits', locations.map(l => l.id)],
    queryFn: async () => {
      if (locations.length === 0) return {};
      
      const locationIds = locations.map(l => l.id);
      
      const { data: audits, error } = await supabase
        .from('food_safety_audits')
        .select('id, location_id, audit_date, visit_score, manager_name, audit_url')
        .in('location_id', locationIds)
        .order('audit_date', { ascending: false });
      
      if (error) throw error;
      
      const result: Record<string, LocationAuditData> = {};
      for (const audit of audits || []) {
        if (!result[audit.location_id]) {
          result[audit.location_id] = {
            id: audit.id,
            audit_date: audit.audit_date,
            visit_score: audit.visit_score,
            manager_name: audit.manager_name,
            audit_url: audit.audit_url,
          };
        }
      }
      
      return result;
    },
    enabled: locations.length > 0,
  });

  const isLoading = locationsLoading || syncLoading || salesLoading || checklistsLoading || auditsLoading;

  // Filter locations based on search query
  const filteredLocations = useMemo(() => {
    if (!searchQuery.trim()) return locations;
    const query = searchQuery.toLowerCase();
    return locations.filter(loc => {
      const audit = auditDataMap[loc.id];
      const matchesName = loc.name.toLowerCase().includes(query);
      const matchesStoreNumber = loc.store_number?.toLowerCase().includes(query);
      const matchesManager = audit?.manager_name?.toLowerCase().includes(query);
      return matchesName || matchesStoreNumber || matchesManager;
    });
  }, [locations, searchQuery, auditDataMap]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusIcon = (status: 'ahead' | 'behind' | 'on-track') => {
    switch (status) {
      case 'ahead':
        return <TrendingUp className="h-3.5 w-3.5 text-green-500" />;
      case 'behind':
        return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
      default:
        return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: 'ahead' | 'behind' | 'on-track') => {
    switch (status) {
      case 'ahead':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs px-1.5 py-0">Ahead</Badge>;
      case 'behind':
        return <Badge className="bg-red-500/20 text-red-500 border-red-500/30 text-xs px-1.5 py-0">Behind</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground text-xs px-1.5 py-0">On Track</Badge>;
    }
  };

  // Compact checklist row component with card styling
  const ChecklistRow = ({ checklist }: { checklist: LocationChecklistData }) => {
    const completionRate = checklist.expected > 0 
      ? Math.min(100, Math.round((checklist.completed / checklist.expected) * 100)) 
      : 0;
    const isComplete = completionRate === 100;
    
    return (
      <button
        onClick={() => navigate(`/complete/${checklist.id}`)}
        className={`flex items-center gap-2 p-2 rounded-md border transition-colors w-full text-left ${
          isComplete 
            ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20' 
            : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20'
        }`}
      >
        <div className={`flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 ${
          isComplete ? 'bg-green-500' : 'bg-red-500'
        }`}>
          {isComplete ? (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          ) : (
            <span className="text-white text-xs font-bold">✕</span>
          )}
        </div>
        <span className="text-xs truncate flex-1">{checklist.title}</span>
        <span className={`text-xs font-medium ${isComplete ? 'text-green-600' : 'text-red-600'}`}>
          {completionRate}%
        </span>
      </button>
    );
  };

  if (!organizationId) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <Building2 className="h-16 w-16 text-muted-foreground mb-4" />
              <h1 className="text-2xl font-bold mb-2">No Organization</h1>
              <p className="text-muted-foreground">
                You need to be part of an organization to view this dashboard.
              </p>
            </div>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-4">
        {/* Header with title, search, and period selector */}
        <div className="flex flex-col gap-3 mb-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Org Dashboard</h1>
            <Tabs value={chartPeriod} onValueChange={(v) => setChartPeriod(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="daily" className="text-xs px-2 sm:px-3 h-7">Today</TabsTrigger>
                <TabsTrigger value="weekly" className="text-xs px-2 sm:px-3 h-7">Week</TabsTrigger>
                <TabsTrigger value="monthly" className="text-xs px-2 sm:px-3 h-7">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search locations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 w-full text-sm"
            />
          </div>
        </div>
        
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-4">
                <div className="flex gap-4">
                  <Skeleton className="h-24 w-48" />
                  <Skeleton className="h-24 flex-1" />
                  <Skeleton className="h-24 w-40" />
                  <Skeleton className="h-24 w-36" />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredLocations.map((location) => {
              const salesData = salesDataMap[location.id];
              const checklists = checklistDataMap[location.id] || [];
              const audit = auditDataMap[location.id];
              
              return (
                <Card key={location.id} className="p-3 overflow-hidden">
                  <div className="flex flex-col gap-4 md:grid md:grid-cols-[180px_minmax(200px,1fr)_220px_180px] md:gap-3">
                    {/* Column 1: Store Info + Sales - Compact */}
                    <div className="flex flex-col gap-1.5">
                      {/* Location tag - name on one line, number below */}
                      <div className="flex flex-col bg-primary/10 border border-primary/20 rounded-md px-2 py-1 w-fit">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-primary" />
                          <span className="text-sm font-semibold">{location.name}</span>
                        </div>
                        {location.store_number && (
                          <span className="text-xs text-muted-foreground ml-5">#{location.store_number}</span>
                        )}
                      </div>
                      
                      {/* Sales info - period-aware */}
                      {salesData ? (() => {
                        const displaySales = chartPeriod === 'daily' ? salesData.sales 
                          : chartPeriod === 'weekly' ? salesData.weeklySales 
                          : salesData.monthlySales;
                        const displayGoal = chartPeriod === 'daily' ? salesData.goal 
                          : chartPeriod === 'weekly' ? salesData.weeklyGoal 
                          : salesData.monthlyGoal;
                        const displayStatus = chartPeriod === 'daily' ? salesData.status 
                          : chartPeriod === 'weekly' ? salesData.weeklyStatus 
                          : salesData.monthlyStatus;
                        // Pace only makes sense for daily
                        const showPace = chartPeriod === 'daily';
                        
                        return (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">Sales</span>
                              <span className="text-base font-bold">{formatCurrency(displaySales)}</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-muted-foreground">AI Goal</span>
                              <span className="text-sm font-semibold text-muted-foreground">{formatCurrency(displayGoal)}</span>
                            </div>
                            {showPace && (
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs text-muted-foreground">Pace</span>
                                <span className="text-sm font-semibold">{formatCurrency(salesData.pace)}</span>
                              </div>
                            )}
                            {/* Status badge */}
                            <div className="flex items-center gap-1 mt-0.5">
                              {getStatusIcon(displayStatus)}
                              {getStatusBadge(displayStatus)}
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="text-sm text-muted-foreground">No sales data</div>
                      )}
                    </div>
                    
                    {/* Column 2: Sales Chart */}
                    <div className="h-48 md:h-32">
                      {salesData ? (
                        <SalesSummaryChart
                          period={chartPeriod}
                          hourly={chartPeriod === 'daily' ? salesData.hourlyData : undefined}
                          weeklyBreakdown={chartPeriod === 'weekly' ? salesData.weeklyBreakdown : undefined}
                          monthlyBreakdown={chartPeriod === 'monthly' ? salesData.monthlyBreakdown : undefined}
                          compact
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg">
                          No chart data
                        </div>
                      )}
                    </div>
                    
                    {/* Column 3: Checklists - Card styling per item */}
                    <div className="flex flex-col gap-1.5">
                      {checklists.length > 0 ? (
                        checklists.map((checklist) => (
                          <ChecklistRow key={checklist.id} checklist={checklist} />
                        ))
                      ) : (
                        <div className="flex items-center justify-center text-sm text-muted-foreground bg-muted/30 rounded-lg py-4">
                          No checklists
                        </div>
                      )}
                    </div>
                    
                    {/* Column 4: Steritech Audit */}
                    <div className="rounded-lg border bg-card p-2.5">
                      {audit ? (
                        <a
                          href={audit.audit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <div className="flex flex-col hover:bg-muted/30 -m-2.5 p-2.5 rounded-lg transition-colors">
                            <div className="flex items-center gap-2 mb-2">
                              <FileText className="h-3.5 w-3.5 text-primary" />
                              <span className="font-medium text-xs">Steritech Audit</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Date</span>
                                <span className="font-medium">{format(new Date(audit.audit_date), 'MMM d, yyyy')}</span>
                              </div>
                              {audit.visit_score && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Score</span>
                                  <span className="text-sm font-bold text-primary">{audit.visit_score}</span>
                                </div>
                              )}
                              {audit.manager_name && (
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">Manager</span>
                                  <span className="font-medium truncate max-w-[100px]">{audit.manager_name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </a>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-xs text-muted-foreground py-3">
                          <AlertTriangle className="h-4 w-4 mb-1 text-yellow-500" />
                          No audit
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            
            {filteredLocations.length === 0 && (
              <Card className="p-8">
                <div className="flex flex-col items-center justify-center text-center">
                  <Search className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-lg font-medium">No locations found</p>
                  <p className="text-sm text-muted-foreground">Try adjusting your search query</p>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
