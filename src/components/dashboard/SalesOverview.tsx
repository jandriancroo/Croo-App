import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, TrendingUp, TrendingDown, Package, Sparkles, Bug, RefreshCcw } from 'lucide-react';
import { ResponsiveContainer, Tooltip, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameDay, isSameWeek, isSameMonth } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { formatTime12Hour } from '@/lib/utils';
import { setCachedProjections, getCachedProjections, getCachedLiveSales, setCachedLiveSales } from '@/utils/salesCache';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';
import { DateNavigator } from '@/components/ui/date-navigator';
import { toast } from 'sonner';

interface SalesData {
  daily: number;
  weekly?: number;
  monthly?: number;
  hourly?: Array<{ hour: string; sales: number; projected?: number; checksCount?: number; laborPercent?: number }>;
  weeklyBreakdown?: Array<{ date: string; sales: number; projected?: number; guestCount?: number; laborPercent?: number; laborCost?: number }>;
  monthlyBreakdown?: Array<{ date: string; sales: number; projected?: number; guestCount?: number }>;
  guestCount?: { daily: number; weekly: number; monthly: number };
  avgTicket?: number;
  pizzaCount?: number | { daily: number; weekly: number; monthly: number };
  comparison?: { prevDay: number; prevDayFullDay?: number; prevWeek: number; prevMonth: number };
  projections?: { todayProjected: number; todayPaceAdjusted?: number; weekProjected: number; monthProjected: number };
  currentHour?: number;
  productMix?: Array<{ name: string; quantity: number; sales: number; category: string }>;
  dateRange?: { today: string; weekStart: string; monthStart: string };
  labor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null;
  weeklyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null;
}

interface LocationSettings {
  hours_open?: string;
  hours_close?: string;
}

interface SalesOverviewProps {
  locationSettings?: LocationSettings | null;
  onSalesDataChange?: (data: SalesData | null) => void;
}

// Debug state to capture raw API response for diagnostics
interface DiagnosticInfo {
  lastFetchTime: string;
  locationId: string | null;
  locationName: string | null;
  targetDate: string;
  rawResponse: unknown;
  error: string | null;
  authenticated?: boolean;
}

export function SalesOverview({ locationSettings, onSalesDataChange }: SalesOverviewProps) {
  const { currentLocation } = useAppLocation();
  const [targetDate, setTargetDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<string>('today');
  const [showProductMix, setShowProductMix] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<DiagnosticInfo | null>(null);
  const [isRepairingWeek, setIsRepairingWeek] = useState(false);
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const isBackgroundRefreshing = useRef(false);
  const lastIntegrationErrorKey = useRef<string | null>(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatCurrencyDecimal = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const getDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const isToday = isSameDay(targetDate, new Date());

  // Check database cache for historical dates
  const checkDatabaseCache = async (dateStr: string): Promise<SalesData | null> => {
    if (!currentLocation?.id) return null;
    
    // Get the target date for week/month calculations
    const targetDateObj = new Date(dateStr + 'T00:00:00');
    const weekStart = startOfWeek(targetDateObj, { weekStartsOn: 1 }); // Monday
    const weekEnd = endOfWeek(targetDateObj, { weekStartsOn: 1 }); // Sunday
    const monthStart = startOfMonth(targetDateObj);
    const monthEnd = endOfMonth(targetDateObj);
    
    const weekStartStr = format(weekStart, 'yyyy-MM-dd');
    const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
    const monthStartStr = format(monthStart, 'yyyy-MM-dd');
    const monthEndStr = format(monthEnd, 'yyyy-MM-dd');
    
    // Fetch daily data + week range + month range in parallel
    // For month, always fetch full month (1st to last day)
    const [dailyResult, weekResult, monthResult] = await Promise.all([
      supabase
        .from('sales_cache')
        .select('*')
        .eq('location_id', currentLocation.id)
        .eq('sale_date', dateStr)
        .maybeSingle(),
      supabase
        .from('sales_cache')
        .select('sale_date, net_sales, guest_count, projected_sales')
        .eq('location_id', currentLocation.id)
        .gte('sale_date', weekStartStr)
        .lte('sale_date', weekEndStr)
        .order('sale_date'),
      supabase
        .from('sales_cache')
        .select('sale_date, net_sales, guest_count, projected_sales')
        .eq('location_id', currentLocation.id)
        .gte('sale_date', monthStartStr)
        .lte('sale_date', monthEndStr)
        .order('sale_date')
    ]);

    // If RLS blocks access (or any other DB error), surface it clearly.
    const dbError = dailyResult.error || weekResult.error || monthResult.error;
    if (dbError) {
      console.error('[SalesOverview] sales_cache query error:', dbError);
      setDiagnosticInfo({
        lastFetchTime: new Date().toISOString(),
        locationId: currentLocation?.id || null,
        locationName: currentLocation?.name || null,
        targetDate: dateStr,
        rawResponse: {
          dailyError: dailyResult.error,
          weekError: weekResult.error,
          monthError: monthResult.error
        },
        error: dbError.message || String(dbError)
      });

      toast.error('Unable to load historical sales', {
        description: dbError.message || 'Your account may not have access to sales history for this location.'
      });
      return null;
    }

    // Check if we have ANY cached data for the period (week or month)
    const hasWeekData = weekResult.data && weekResult.data.length > 0;
    const hasMonthData = monthResult.data && monthResult.data.length > 0;

    // If no daily data but we have week/month data, we can still return historical view
    if (!dailyResult.data && !hasWeekData && !hasMonthData) return null;

    const cached = dailyResult.data;
    
    console.log(`[CACHE] Date ${dateStr}: daily=${!!cached}, week=${weekResult.data?.length || 0} days, month=${monthResult.data?.length || 0} days`);
    
    // Aggregate weekly data - always include all 7 days Mon-Sun
    const weekData = weekResult.data || [];
    const weekDataMap = new Map(weekData.map(d => [d.sale_date, d]));
    
    // Get today's date string for pace logic
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    
    // Build full 7-day breakdown
    const weeklyBreakdown: { date: string; sales: number; projected: number; guestCount: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = addDays(weekStart, i);
      const dayStr = format(dayDate, 'yyyy-MM-dd');
      const existingData = weekDataMap.get(dayStr);
      
      // For projections: use stored projected_sales if > 0, otherwise use actual sales as projection
      // (historical data won't have projections, so we use their actual sales as "what was expected")
      const storedProjection = existingData ? Number(existingData.projected_sales) || 0 : 0;
      const actualSales = existingData ? Number(existingData.net_sales) || 0 : 0;
      
      weeklyBreakdown.push({
        date: dayStr,
        sales: actualSales,
        // Use stored projection if available, otherwise use actual sales as the "projection"
        projected: storedProjection > 0 ? storedProjection : actualSales,
        guestCount: existingData?.guest_count || 0
      });
    }
    
    const weeklySales = weeklyBreakdown.reduce((sum, d) => sum + d.sales, 0);
    const weeklyGuests = weeklyBreakdown.reduce((sum, d) => sum + d.guestCount, 0);
    
    // Pace-adjusted weekly projection:
    // Past days: use actuals, Today: MAX(actual, projection), Future: use projections
    const weeklyProjected = weeklyBreakdown.reduce((sum, d) => {
      if (d.date < todayStr) {
        // Past day: use actual
        return sum + d.sales;
      } else if (d.date === todayStr) {
        // Today: use MAX(actual, projection)
        return sum + Math.max(d.sales, d.projected);
      } else {
        // Future day: use projection
        return sum + d.projected;
      }
    }, 0);
    
    // Aggregate monthly data and fill in missing days with projections
    const monthData = monthResult.data || [];
    const monthlySales = monthData.reduce((sum, d) => sum + (Number(d.net_sales) || 0), 0);
    const monthlyGuests = monthData.reduce((sum, d) => sum + (d.guest_count || 0), 0);
    
    // Create a map of existing data
    const monthDataMap = new Map(monthData.map(d => [d.sale_date, d]));
    
    // Generate all days in the month
    const daysInMonth = monthEnd.getDate();
    const monthlyBreakdownFull: { date: string; sales: number; projected: number; guestCount: number }[] = [];
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const dayStr = format(dayDate, 'yyyy-MM-dd');
      
      const existingData = monthDataMap.get(dayStr);
      const storedProjection = existingData ? Number(existingData.projected_sales) || 0 : 0;
      const actualSales = existingData ? Number(existingData.net_sales) || 0 : 0;
      
      monthlyBreakdownFull.push({
        date: dayStr,
        sales: actualSales,
        // Use stored projection if available, otherwise use actual sales as "projection"
        projected: storedProjection > 0 ? storedProjection : actualSales,
        guestCount: existingData?.guest_count || 0
      });
    }
    
    // Pace-adjusted monthly projection:
    // Past days: use actuals, Today: MAX(actual, projection), Future: use projections
    const monthlyProjected = monthlyBreakdownFull.reduce((sum, d) => {
      if (d.date < todayStr) {
        // Past day: use actual
        return sum + d.sales;
      } else if (d.date === todayStr) {
        // Today: use MAX(actual, projection)
        return sum + Math.max(d.sales, d.projected);
      } else {
        // Future day: use projection
        return sum + d.projected;
      }
    }, 0);
    
    // Hourly data should already have projections from backfill (only if we have daily data)
    const hourlyData = cached?.hourly_data 
      ? (cached.hourly_data as Array<{ hour: string; sales: number; checksCount: number; projected?: number }>)
      : [];
    
    return {
      daily: cached ? (Number(cached.net_sales) || 0) : 0,
      weekly: weeklySales,
      monthly: monthlySales,
      hourly: hourlyData,
      weeklyBreakdown,
      monthlyBreakdown: monthlyBreakdownFull,
      guestCount: { 
        daily: cached?.guest_count || 0, 
        weekly: weeklyGuests, 
        monthly: monthlyGuests 
      },
      avgTicket: cached?.avg_ticket ? Number(cached.avg_ticket) : undefined,
      pizzaCount: cached?.pizza_count || 0,
      projections: {
        todayProjected: cached ? (Number(cached.projected_sales) || 0) : 0,
        weekProjected: weeklyProjected,
        monthProjected: monthlyProjected
      },
      dateRange: {
        today: dateStr,
        weekStart: weekStartStr,
        monthStart: monthStartStr
      }
    };
  };

  // Fetch fresh data from API
  const fetchSalesData = async (): Promise<SalesData | null> => {
    const dateStr = getDateString(targetDate);
    const isTodayCheck = isSameDay(targetDate, new Date());
    
    // For historical dates, use database cache only
    // Don't call the edge function for past dates - it won't have data
    if (!isTodayCheck && currentLocation?.id) {
      const cachedData = await checkDatabaseCache(dateStr);
      // Return cached data (or null if no data exists for this period)
      return cachedData;
    }
    
    // Check cache INSIDE the query function to get fresh values
    const cachedProjections = isTodayCheck && currentLocation?.id 
      ? getCachedProjections(currentLocation.id) 
      : null;
    
    const hasValidDailyCache = cachedProjections?.todayProjected !== undefined;
    const hasValidWeeklyMonthlyCache = cachedProjections?.weekProjected !== undefined && cachedProjections?.monthProjected !== undefined;
    const skipProjections = isTodayCheck && hasValidDailyCache && hasValidWeeklyMonthlyCache;
    
    // Check if we have cached data - if so, use fast mode for quicker refresh (TODAY only)
    const cached = isTodayCheck && currentLocation?.id ? getCachedLiveSales(currentLocation.id) : null;
    const useFastMode = isTodayCheck && !!cached?.data;
    
    const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
      body: { 
        locationId: currentLocation?.id,
        targetDate: dateStr,
        skipProjections,
        fastMode: useFastMode // Skip historical data for faster refresh when we have cached data
      }
    });

    // Capture diagnostic info for debugging
    setDiagnosticInfo({
      lastFetchTime: new Date().toISOString(),
      locationId: currentLocation?.id || null,
      locationName: currentLocation?.name || null,
      targetDate: dateStr,
      rawResponse: data,
      error: error?.message || null,
      authenticated: data && typeof data === 'object' && 'authenticated' in data ? (data as any).authenticated : undefined
    });

    if (error) {
      console.error("Error fetching sales data:", error);

      // Fallback: if live fetch fails (e.g. integration outage), try DB cache for the selected date
      const fallback = await checkDatabaseCache(dateStr);
      if (fallback) {
        toast.message('Showing cached sales (live sync unavailable)', {
          description: 'Live sales sync is temporarily unavailable, but historical cache is available.'
        });
        return fallback;
      }

      const key = `${currentLocation?.id || 'unknown'}:${dateStr}`;
      if (lastIntegrationErrorKey.current !== key) {
        lastIntegrationErrorKey.current = key;
        toast.error("Sales integration error", {
          description: error.message || "Unable to fetch sales data."
        });
      }
      return null;
    }

    // Surface backend integration errors (returned as 200 with { authenticated:false })
    if (data && typeof data === 'object' && 'authenticated' in data && (data as any).authenticated === false) {
      const msg = (data as any).error || "Sales integration is not configured for this location.";

      // Fallback: if integration says not authenticated/configured, try DB cache
      const fallback = await checkDatabaseCache(dateStr);
      if (fallback) {
        toast.message('Showing cached sales (integration not configured)', {
          description: 'This location’s live sales integration isn’t configured, but cached history exists.'
        });
        return fallback;
      }

      const key = `${currentLocation?.id || 'unknown'}:${dateStr}`;
      if (lastIntegrationErrorKey.current !== key) {
        lastIntegrationErrorKey.current = key;
        toast.error("Sales integration error", { description: msg });
      }
      return null;
    }

    const salesData = data as SalesData;

    // If we skipped projections but have cached ones, merge them in
    if (skipProjections && cachedProjections && salesData) {
      salesData.projections = {
        todayProjected: cachedProjections.todayProjected || 0,
        todayPaceAdjusted: cachedProjections.todayPaceAdjusted,
        weekProjected: cachedProjections.weekProjected,
        monthProjected: cachedProjections.monthProjected
      };
    }
    
    // Cache new projections if we fetched them fresh
    if (isTodayCheck && !skipProjections && salesData?.projections && currentLocation?.id) {
      const todayProjected = salesData.projections.todayProjected;
      const todayPaceAdjusted = salesData.projections.todayPaceAdjusted;
      const weekProjected = salesData.projections.weekProjected;
      const monthProjected = salesData.projections.monthProjected;
      const weeklySales = salesData?.weekly || 0;
      const monthlySales = salesData?.monthly || 0;
      
      // Sanity check: projections must be >= actual sales
      if (weekProjected >= weeklySales && monthProjected >= monthlySales && weekProjected > 0 && monthProjected > 0) {
        setCachedProjections(currentLocation.id, { 
          todayProjected: todayProjected > 0 ? todayProjected : undefined,
          todayPaceAdjusted: todayPaceAdjusted && todayPaceAdjusted > 0 ? todayPaceAdjusted : undefined,
          weekProjected, 
          monthProjected 
        });
      }
    }
    
    // Cache live sales for stale-while-revalidate
    if (isTodayCheck && salesData && currentLocation?.id) {
      setCachedLiveSales(currentLocation.id, salesData);
    }
    
    return salesData;
  };

  // Historical dates: always fresh from DB cache (staleTime: 0)
  // Today: use 5-minute stale time for live data
  const isTodayQuery = isSameDay(targetDate, new Date());
  
  // Get initial data from cache for instant render - computed directly in useMemo
  const initialData = useMemo(() => {
    if (!isTodayQuery || !currentLocation?.id) return undefined;
    const cached = getCachedLiveSales(currentLocation.id);
    console.log('[SalesOverview] Checking cache for initial data:', { 
      isTodayQuery, 
      locationId: currentLocation?.id,
      hasCached: !!cached,
      cachedData: cached?.data ? 'has data' : 'no data'
    });
    return cached?.data || undefined;
  }, [isTodayQuery, currentLocation?.id]);
  
  const initialDataUpdatedAt = useMemo(() => {
    if (!isTodayQuery || !currentLocation?.id) return 0;
    const cached = getCachedLiveSales(currentLocation.id);
    if (!cached) return 0;
    return cached.isStale ? 0 : Date.now();
  }, [isTodayQuery, currentLocation?.id]);
  
  const { data: rawSalesData, isLoading, refetch } = useQuery({
    queryKey: ["qubeyond-sales", currentLocation?.id, getDateString(targetDate)],
    queryFn: fetchSalesData,
    enabled: !!currentLocation?.id,
    staleTime: isTodayQuery ? 5 * 60 * 1000 : 0, // Historical dates always refetch from DB cache
    gcTime: isTodayQuery ? 30 * 60 * 1000 : 0, // Don't cache historical queries in memory
    refetchOnWindowFocus: false,
    initialData,
    initialDataUpdatedAt
  });

  // Background refresh when cache is stale but we have data to show
  useEffect(() => {
    if (!currentLocation?.id || !isSameDay(targetDate, new Date())) return;
    
    const cached = getCachedLiveSales(currentLocation.id);
    if (cached?.isStale && !isBackgroundRefreshing.current) {
      isBackgroundRefreshing.current = true;
      refetch().finally(() => {
        isBackgroundRefreshing.current = false;
      });
    }
  }, [currentLocation?.id, targetDate, refetch]);

  // Convert hourly data to 12-hour format and filter to business hours only
  const salesData = useMemo(() => {
    if (!rawSalesData) return rawSalesData;
    
    // Only show hourly breakdown if business hours are configured
    if (locationSettings?.hours_open && locationSettings?.hours_close && rawSalesData.hourly) {
      const openHour = parseInt(locationSettings.hours_open.split(':')[0]);
      let closeHour = parseInt(locationSettings.hours_close.split(':')[0]);
      // Handle midnight (00:00) as end of day - treat as 24
      if (closeHour === 0) closeHour = 24;
      
      const completeHourly: Array<{ hour: string; sales: number; projected?: number }> = [];
      for (let hour = openHour; hour < closeHour; hour++) {
        const hourStr24 = `${hour.toString().padStart(2, '0')}:00`;
        const existingData = rawSalesData.hourly?.find(item => {
          // Handle both 24-hour and 12-hour formats from API
          const itemHour = item.hour.includes('AM') || item.hour.includes('PM')
            ? parseInt(item.hour) + (item.hour.includes('PM') && !item.hour.startsWith('12') ? 12 : 0)
            : parseInt(item.hour.split(':')[0]);
          return itemHour === hour;
        });
        
        completeHourly.push({
          hour: formatTime12Hour(hourStr24),
          sales: existingData?.sales || 0,
          projected: existingData?.projected || 0
        });
      }

      return { ...rawSalesData, hourly: completeHourly };
    }
    
    // If no business hours configured, don't show hourly breakdown
    return { ...rawSalesData, hourly: undefined };
  }, [rawSalesData, locationSettings]);

  // NOTE: Pace-adjusted values for data cubes are calculated below after useMemo hooks
  // and passed via onSalesDataChange effect after accumulatedWeekDelta/accumulatedMonthDelta are defined

  // Only include days that fall within the selected month to avoid bleeding into other months
  const monthlyWeeklyAggregated = useMemo(() => {
    if (!salesData?.monthlyBreakdown || salesData.monthlyBreakdown.length === 0) return [];
    
    // Get the month we're viewing
    const viewingMonth = targetDate.getMonth();
    const viewingYear = targetDate.getFullYear();
    
    // Group by Monday-Sunday weeks, but only count days within the target month
    const weeklyBuckets: Array<{ weekStart: Date; sales: number; projected: number; daysInMonth: number; firstDayInMonth: Date; lastDayInMonth: Date }> = [];
    
    salesData.monthlyBreakdown.forEach(day => {
      const date = new Date(day.date + 'T00:00:00');
      
      // Only include days that are in the viewing month
      if (date.getMonth() !== viewingMonth || date.getFullYear() !== viewingYear) {
        return;
      }
      
      const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
      
      // Find existing bucket or create new one
      let bucket = weeklyBuckets.find(b => b.weekStart.getTime() === weekStart.getTime());
      if (!bucket) {
        bucket = { 
          weekStart, 
          sales: 0, 
          projected: 0,
          daysInMonth: 0,
          firstDayInMonth: date,
          lastDayInMonth: date
        };
        weeklyBuckets.push(bucket);
      }
      bucket.sales += day.sales;
      bucket.projected += (day.projected || 0);
      bucket.daysInMonth += 1;
      if (date < bucket.firstDayInMonth) bucket.firstDayInMonth = date;
      if (date > bucket.lastDayInMonth) bucket.lastDayInMonth = date;
    });
    
    // Sort by week start date and format labels to show only dates within the month
    return weeklyBuckets
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
      .map((bucket, index) => ({
        label: `Week ${index + 1}`,
        sales: bucket.sales,
        projected: bucket.projected,
        dateRange: bucket.firstDayInMonth.getTime() === bucket.lastDayInMonth.getTime()
          ? format(bucket.firstDayInMonth, 'MMM d')
          : `${format(bucket.firstDayInMonth, 'MMM d')} - ${format(bucket.lastDayInMonth, 'MMM d')}`
      }));
  }, [salesData?.monthlyBreakdown, targetDate]);

  const navigateDay = (direction: 'prev' | 'next') => {
    setTargetDate(prev => direction === 'prev' ? subDays(prev, 1) : addDays(prev, 1));
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setTargetDate(prev => direction === 'prev' ? subWeeks(prev, 1) : addWeeks(prev, 1));
  };

  // Calculate Target EOW from weekly breakdown: actual sales + projected for days without actuals
  const calculatedWeekProjected = useMemo(() => {
    if (!salesData?.weeklyBreakdown || salesData.weeklyBreakdown.length === 0) {
      return salesData?.projections?.weekProjected || 0;
    }
    
    // Sum: for each day, use actual if > 0, otherwise use projected
    let total = 0;
    for (const day of salesData.weeklyBreakdown) {
      total += day.sales > 0 ? day.sales : (day.projected || 0);
    }
    
    // If we have 7 days with projections, use our calculated total
    // Otherwise fall back to the backend's weekProjected
    return total > 0 ? total : (salesData?.projections?.weekProjected || 0);
  }, [salesData?.weeklyBreakdown, salesData?.projections?.weekProjected]);

  // Calculate accumulated week delta: sum of (actual - projection) for all completed days + today's pace delta
  // This shows the true accumulated position, not just today's delta
  const accumulatedWeekDelta = useMemo(() => {
    if (!salesData?.weeklyBreakdown) return 0;
    
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let delta = 0;
    
    for (const day of salesData.weeklyBreakdown) {
      const actual = day.sales || 0;
      const projected = day.projected || 0;
      
      if (day.date < todayStr && actual > 0) {
        // Past day with sales: add the difference (actual - projected)
        delta += actual - projected;
      } else if (day.date === todayStr && isToday) {
        // Today: use pace delta if available, otherwise use actual - projected
        if (salesData?.projections?.todayPaceAdjusted && salesData?.projections?.todayProjected) {
          delta += salesData.projections.todayPaceAdjusted - salesData.projections.todayProjected;
        } else if (actual > 0) {
          delta += actual - projected;
        }
      }
      // Future days: no delta yet
    }
    
    return delta;
  }, [salesData?.weeklyBreakdown, salesData?.projections?.todayPaceAdjusted, salesData?.projections?.todayProjected, isToday]);

  // Calculate accumulated month delta: sum of (actual - projection) for all completed days + today's pace delta
  const accumulatedMonthDelta = useMemo(() => {
    if (!salesData?.monthlyBreakdown) return 0;
    
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let delta = 0;
    
    for (const day of salesData.monthlyBreakdown) {
      const actual = day.sales || 0;
      const projected = day.projected || 0;
      
      if (day.date < todayStr && actual > 0) {
        // Past day with sales: add the difference (actual - projected)
        delta += actual - projected;
      } else if (day.date === todayStr && isToday) {
        // Today: use pace delta if available, otherwise use actual - projected
        if (salesData?.projections?.todayPaceAdjusted && salesData?.projections?.todayProjected) {
          delta += salesData.projections.todayPaceAdjusted - salesData.projections.todayProjected;
        } else if (actual > 0) {
          delta += actual - projected;
        }
      }
      // Future days: no delta yet
    }
    
    return delta;
  }, [salesData?.monthlyBreakdown, salesData?.projections?.todayPaceAdjusted, salesData?.projections?.todayProjected, isToday]);

  // Notify parent component when sales data changes (for data cubes to use)
  // Include pace-adjusted values that are calculated in the useMemo hooks above
  useEffect(() => {
    if (!salesData) {
      onSalesDataChange?.(null);
      return;
    }
    
    // Enhance salesData with pace-adjusted values for cubes
    const enhancedData = {
      ...salesData,
      projections: salesData.projections ? {
        ...salesData.projections,
        weekPaceAdjusted: calculatedWeekProjected + accumulatedWeekDelta,
        monthPaceAdjusted: (salesData.projections.monthProjected || 0) + accumulatedMonthDelta,
      } : undefined,
    };
    
    onSalesDataChange?.(enhancedData);
  }, [salesData, calculatedWeekProjected, accumulatedWeekDelta, accumulatedMonthDelta, onSalesDataChange]);

  const navigateMonth = (direction: 'prev' | 'next') => {
    setTargetDate(prev => direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };

  const getChangePercent = (current: number, previous: number) => {
    if (previous === 0) return null; // Can't calculate % change from 0
    return ((current - previous) / previous) * 100;
  };

  const ComparisonBadge = ({ current, previous, label, previousFullDay }: { current: number; previous: number; label: string; previousFullDay?: number }) => {
    // Try to calculate change - prefer previous, fall back to previousFullDay for historical days
    let change = getChangePercent(current, previous);
    
    // If previous is 0 but we have full day data, use that for comparison
    if (change === null && previousFullDay && previousFullDay > 0 && current > 0) {
      change = getChangePercent(current, previousFullDay);
    }
    
    // Don't show badge if we can't calculate a meaningful change
    if (change === null) return null;
    
    const isPositive = change >= 0;
    
    return (
      <div className="flex items-center gap-1 text-xs whitespace-nowrap">
        {isPositive ? (
          <TrendingUp className="h-3 w-3 text-green-500 flex-shrink-0" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-500 flex-shrink-0" />
        )}
        <span className={isPositive ? "text-green-500" : "text-red-500"}>
          {isPositive ? "+" : ""}{change.toFixed(1)}%
        </span>
        <span className="text-muted-foreground hidden sm:inline">vs {label}</span>
      </div>
    );
  };

  const hasLaborData = !!(salesData?.labor && salesData.labor.laborPercent > 0);

  // Calculate pacing status for "On Track" badge
  const pacingStatus = useMemo(() => {
    if (!isToday || !salesData?.projections?.todayProjected || !salesData?.projections?.todayPaceAdjusted) {
      return null;
    }
    if (salesData.daily < 100) return null; // Not enough data yet

    const paceVsProjection = (salesData.projections.todayPaceAdjusted / salesData.projections.todayProjected) * 100;

    if (paceVsProjection >= 102) return 'ahead';
    if (paceVsProjection >= 95) return 'onTrack';
    return 'behind';
  }, [isToday, salesData?.daily, salesData?.projections?.todayProjected, salesData?.projections?.todayPaceAdjusted]);

  // Show skeleton shimmer only on first load with no cached data
  // If we have cached data, show it immediately (stale-while-revalidate)
  if (isLoading && !salesData) {
    return (
      <div>
        <Card>
          <CardContent className="pt-4">
            {/* Skeleton shimmer for tabs */}
            <div className="flex gap-2 mb-4">
              <Skeleton className="h-9 flex-1 rounded-md" />
              <Skeleton className="h-9 flex-1 rounded-md" />
              <Skeleton className="h-9 flex-1 rounded-md" />
            </div>
            {/* Skeleton shimmer for stats row */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-8 w-20" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-12 mx-auto" />
                <Skeleton className="h-8 w-16 mx-auto" />
              </div>
              <div className="space-y-2 flex flex-col items-end">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-20" />
              </div>
            </div>
            {/* Skeleton for projections */}
            <Skeleton className="h-16 w-full rounded-lg mb-4" />
            {/* Skeleton for chart area */}
            <Skeleton className="h-[200px] w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>

      {/* Diagnostics Panel */}
      {showDiagnostics && (
        <Card className="mb-4 border-dashed border-yellow-500/50 bg-yellow-500/5">
          <CardContent className="pt-4">
            <h4 className="font-semibold text-sm mb-2 text-yellow-600">🔍 Sales API Diagnostics</h4>
            {diagnosticInfo ? (
              <div className="text-xs space-y-1 font-mono">
                <p><strong>Last Fetch:</strong> {diagnosticInfo.lastFetchTime}</p>
                <p><strong>Location ID:</strong> {diagnosticInfo.locationId || 'N/A'}</p>
                <p><strong>Location Name:</strong> {diagnosticInfo.locationName || 'N/A'}</p>
                <p><strong>Target Date:</strong> {diagnosticInfo.targetDate}</p>
                <p><strong>Error:</strong> {diagnosticInfo.error || 'None'}</p>
                <p><strong>Authenticated:</strong> {diagnosticInfo.authenticated === undefined ? 'N/A' : diagnosticInfo.authenticated ? 'Yes' : 'No'}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw Response (click to expand)</summary>
                  <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(diagnosticInfo.rawResponse, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No API call made yet. Switch locations or dates to trigger a fetch.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["qubeyond-sales"] });
                  refetch();
                }}
              >
                Force Refresh
              </Button>

              <Button
                variant="secondary"
                size="sm"
                disabled={isRepairingWeek || !currentLocation?.id}
                onClick={async () => {
                  if (!currentLocation?.id) return;

                  setIsRepairingWeek(true);
                  try {
                    const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 });
                    const dates = Array.from({ length: 7 }).map((_, i) => format(addDays(weekStart, i), 'yyyy-MM-dd'));

                    const results = await Promise.allSettled(
                      dates.map((date) =>
                        supabase.functions.invoke('sync-day-sales', {
                          body: { locationId: currentLocation.id, date },
                        })
                      )
                    );

                    const updatedCount = results.filter(
                      (r) => r.status === 'fulfilled' && (r.value as any)?.data?.status === 'updated'
                    ).length;

                    toast.success('Re-synced week from source', {
                      description: `${updatedCount}/7 days updated for ${format(weekStart, 'MMM d')}-${format(addDays(weekStart, 6), 'MMM d')}.`,
                    });
                  } catch (e) {
                    toast.error('Week resync failed', {
                      description: e instanceof Error ? e.message : 'Unknown error',
                    });
                  } finally {
                    setIsRepairingWeek(false);
                    queryClient.invalidateQueries({ queryKey: ['qubeyond-sales'] });
                    refetch();
                  }
                }}
              >
                <RefreshCcw className={"mr-2 h-4 w-4" + (isRepairingWeek ? ' animate-spin' : '')} />
                Repair week
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
            
            {/* TODAY TAB */}
            <TabsContent value="today" className="space-y-4">
              <div className="mb-2">
                <DateNavigator 
                  onPrev={() => navigateDay('prev')}
                  onNext={() => navigateDay('next')}
                  label={isToday ? 'Today' : format(targetDate, 'EEEE, MMM d')}
                  canGoNext={!isToday}
                  narrow
                />
              </div>
              
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Sales</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.daily ? formatCurrency(salesData.daily) : "--"}
                  </p>
                  {salesData?.comparison?.prevDay !== undefined && salesData.daily !== undefined && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {pacingStatus && (
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1.5 py-0 h-5 whitespace-nowrap ${
                            pacingStatus === 'ahead'
                              ? 'border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950'
                              : pacingStatus === 'onTrack' 
                                ? 'border-green-500 text-green-600 bg-green-50 dark:bg-green-950' 
                                : 'border-sky-400 text-sky-500 bg-sky-50 dark:bg-sky-950'
                          }`}
                        >
                          {pacingStatus === 'ahead' ? '🔥 On Fire' : pacingStatus === 'onTrack' ? '🏃 On Track' : '🧊 Behind'}
                        </Badge>
                      )}
                      <ComparisonBadge 
                        current={salesData.daily} 
                        previous={salesData.comparison.prevDay} 
                        previousFullDay={salesData.comparison.prevDayFullDay}
                        label={`same time last ${format(targetDate, 'EEEE').slice(0, 3)}`}
                      />
                    </div>
                  )}
                </div>
                <div className="text-center min-w-0">
                  <p className="text-xs text-muted-foreground">Pizzas</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.pizzaCount !== undefined 
                      ? (typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount.daily : salesData.pizzaCount)
                      : "--"}
                  </p>
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-muted-foreground">Avg Ticket</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.avgTicket ? formatCurrencyDecimal(salesData.avgTicket) : "--"}
                  </p>
                </div>
              </div>

              {/* Croo AI Projections & Live Labor for Today */}
              <div className="flex flex-col gap-2 mb-2">
                {/* Combined Target EOD and Pacing row */}
                {salesData?.projections?.todayProjected !== undefined && salesData.projections.todayProjected > 0 && (
                  <div className="flex items-stretch gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 via-purple-500/10 to-amber-500/10 border border-primary/20">
                    {/* Target EOD - Left */}
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex-shrink-0">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Target EOD</span>
                        <span className="text-sm sm:text-base font-semibold text-primary transition-all duration-300 ease-out">
                          {formatCurrency(salesData.projections.todayProjected)}
                        </span>
                      </div>
                    </div>
                    
                    {/* Pace - Right (only show for today when we have pace data) */}
                    {isToday && salesData.projections.todayPaceAdjusted !== undefined && 
                      salesData.projections.todayPaceAdjusted > 0 && (
                        <div className="flex items-center gap-2 flex-1 justify-end">
                          <div className="flex flex-col items-end">
                            <span className="text-xs text-muted-foreground">Pace</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm sm:text-base font-semibold text-amber-500 transition-all duration-300 ease-out">
                                {formatCurrency(salesData.projections.todayPaceAdjusted)}
                              </span>
                              {salesData.projections.todayPaceAdjusted !== salesData.projections.todayProjected && (
                                <span className={`text-xs font-medium ${
                                  salesData.projections.todayPaceAdjusted >= salesData.projections.todayProjected 
                                    ? 'text-green-500' 
                                    : 'text-red-500'
                                }`}>
                                  {salesData.projections.todayPaceAdjusted >= salesData.projections.todayProjected ? '+' : ''}
                                  {formatCurrency(salesData.projections.todayPaceAdjusted - salesData.projections.todayProjected)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex-shrink-0">
                            <TrendingUp className="h-3.5 w-3.5 text-white" />
                          </div>
                        </div>
                      )
                    }
                  </div>
                )}

                {/* Live Labor from Qu */}
                {hasLaborData && salesData?.labor && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex-shrink-0">
                        <span className="text-xs font-bold text-white">%</span>
                      </div>
                      <span className="text-xs sm:text-sm text-muted-foreground">Live Labor</span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="text-right">
                        <p className="text-lg sm:text-xl font-bold text-orange-500 transition-all duration-300 ease-out">{salesData.labor.laborPercent.toFixed(1)}%</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-muted-foreground">Cost</p>
                        <p className="text-sm font-medium transition-all duration-300 ease-out">{formatCurrency(salesData.labor.laborCost)}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-muted-foreground">Hours</p>
                        <p className="text-sm font-medium transition-all duration-300 ease-out">{salesData.labor.hoursWorked.toFixed(1)}h</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
{(() => {
                if (!salesData?.hourly) {
                  return (
                    <div className="h-[200px] md:h-[280px] flex items-center justify-center text-muted-foreground">
                      No sales data available
                    </div>
                  );
                }
                
                // Calculate total hourly sales for pizza distribution
                let totalHourlySales = 0;
                for (const h of salesData.hourly) {
                  totalHourlySales += h.sales || 0;
                }
                const pizzaCount = salesData.pizzaCount 
                  ? (typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount.daily : salesData.pizzaCount) 
                  : 0;
                
                // Add estimated pizzas to each hour based on sales proportion
                const hourlyWithPizzas = salesData.hourly.map(h => {
                  const sales = h.sales || 0;
                  return {
                    ...h,
                    estimatedPizzas: totalHourlySales > 0 && pizzaCount > 0
                      ? Math.round((sales / totalHourlySales) * pizzaCount * 10) / 10
                      : 0
                  };
                });
                
                return (
                  <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                    <ComposedChart data={hourlyWithPizzas} barCategoryGap="10%" margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="hour" className="text-xs" tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }} interval="preserveStartEnd" angle={-45} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                      <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))', fontSize: 10 }} tickFormatter={value => `$${value}`} width={40} axisLine={false} tickLine={false} />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                              <p className="font-medium">{label}</p>
                              <p className="text-muted-foreground">Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span></p>
                              <p className="text-primary">Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span></p>
                              {hasLaborData && data?.laborPercent !== undefined && data.laborPercent > 0 && (
                                <p className="text-orange-500">Labor: <span className="font-medium">{data.laborPercent.toFixed(1)}%</span></p>
                              )}
                              {data?.estimatedPizzas > 0 && (
                                <p className="text-amber-600 flex items-center gap-1">
                                  <span>🍕</span> Pizzas: <span className="font-medium">{data.estimatedPizzas}</span>
                                </p>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Legend 
                        formatter={(value) => value === 'projected' ? 'Projected' : 'Actual'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Line 
                        type="monotone" 
                        dataKey="projected" 
                        name="Projected" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeWidth={2} 
                        dot={{ fill: 'hsl(var(--muted-foreground))', strokeWidth: 2, r: 3, stroke: 'hsl(var(--card))' }}
                        activeDot={{ r: 5, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                );
              })()}

              {/* Product Mix Section */}
              {salesData?.productMix && salesData.productMix.length > 0 && (() => {
                const sortedProductMix = [...salesData.productMix]
                  .sort((a, b) => b.sales - a.sales)
                  .slice(0, 20);
                return (
                  <Collapsible open={showProductMix} onOpenChange={setShowProductMix}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between h-9 text-sm">
                        <span className="flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          Top 20 Products by Sales
                        </span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showProductMix ? 'rotate-180' : ''}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <div className="max-h-[300px] overflow-y-auto space-y-1">
                        {sortedProductMix.map((product, idx) => (
                          <div key={idx} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{product.name}</p>
                                <p className="text-xs text-muted-foreground">{product.category}</p>
                              </div>
                            </div>
                            <div className="text-right ml-2">
                              <p className="text-sm font-medium">{formatCurrency(product.sales)}</p>
                              <p className="text-xs text-muted-foreground">{product.quantity} sold</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })()}
            </TabsContent>
            
            {/* WEEK TAB */}
            <TabsContent value="week" className="space-y-4">
              <DateNavigator 
                onPrev={() => navigateWeek('prev')}
                onNext={() => navigateWeek('next')}
                label={isSameWeek(targetDate, new Date(), { weekStartsOn: 1 })
                  ? 'This Week'
                  : `${format(startOfWeek(targetDate, { weekStartsOn: 1 }), 'MMM d')} - ${format(endOfWeek(targetDate, { weekStartsOn: 1 }), 'MMM d')}`
                }
                canGoNext={!isSameWeek(targetDate, new Date(), { weekStartsOn: 1 })}
                narrow
              />
              
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">WTD</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.weekly !== undefined ? formatCurrency(salesData.weekly) : "--"}
                  </p>
                  {salesData?.comparison?.prevWeek !== undefined && salesData.weekly !== undefined && (
                    <ComparisonBadge 
                      current={salesData.weekly} 
                      previous={salesData.comparison.prevWeek} 
                      label="last week"
                    />
                  )}
                </div>
                <div className="text-center min-w-0">
                  <p className="text-xs text-muted-foreground">Pizzas</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.pizzaCount !== undefined 
                      ? (typeof salesData.pizzaCount === 'object' ? Math.round(salesData.pizzaCount.weekly) : "--")
                      : "--"}
                  </p>
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-muted-foreground">Avg Ticket</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.guestCount?.weekly && salesData?.weekly 
                      ? formatCurrencyDecimal(salesData.weekly / salesData.guestCount.weekly) 
                      : "--"}
                  </p>
                </div>
              </div>

              {/* Croo AI Projection & Pacing & WTD Labor for Week */}
              <div className="flex flex-col gap-2 mb-2">
                {/* Week Projection with Pacing */}
                {calculatedWeekProjected > 0 && (
                  <div className="flex items-stretch gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 via-purple-500/10 to-amber-500/10 border border-primary/20">
                    {/* Target EOW - Left */}
                    <div className="flex items-center gap-2 flex-1">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex-shrink-0">
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Target EOW</span>
                        <span className="text-sm sm:text-base font-semibold text-primary transition-all duration-300 ease-out">
                          {formatCurrency(calculatedWeekProjected)}
                        </span>
                      </div>
                    </div>
                    
                    {/* Divider */}
                    <div className="w-px bg-border/50 self-stretch" />
                    
                    {/* Pacing To - Right (show accumulated pace delta) */}
                    {isToday && (salesData?.weeklyBreakdown?.length || 0) > 0 && (
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-muted-foreground">Pace</span>
                          {(() => {
                            const weekPacing = calculatedWeekProjected + accumulatedWeekDelta;
                            const isPositive = accumulatedWeekDelta >= 0;
                            return (
                              <>
                                <span className="text-sm sm:text-base font-semibold text-amber-500 transition-all duration-300 ease-out">
                                  {formatCurrency(weekPacing)}
                                </span>
                                <span className={`text-xs ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                                  ({isPositive ? '+' : ''}{formatCurrency(accumulatedWeekDelta)})
                                </span>
                              </>
                            );
                          })()}
                        </div>
                        <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex-shrink-0">
                          <TrendingUp className="h-3.5 w-3.5 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* WTD Live Labor */}
                {salesData?.weeklyLabor && salesData.weeklyLabor.laborPercent > 0 && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-gradient-to-r from-orange-500/10 to-amber-500/10 border border-orange-500/20">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex-shrink-0">
                        <span className="text-xs font-bold text-white">%</span>
                      </div>
                      <span className="text-xs sm:text-sm text-muted-foreground">WTD Labor</span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="text-right">
                        <p className="text-lg sm:text-xl font-bold text-orange-500 transition-all duration-300 ease-out">{salesData.weeklyLabor.laborPercent.toFixed(1)}%</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-muted-foreground">Cost</p>
                        <p className="text-sm font-medium transition-all duration-300 ease-out">{formatCurrency(salesData.weeklyLabor.laborCost)}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-xs text-muted-foreground">Hours</p>
                        <p className="text-sm font-medium transition-all duration-300 ease-out">{salesData.weeklyLabor.hoursWorked.toFixed(1)}h</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {salesData?.weeklyBreakdown && salesData.weeklyBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                  <ComposedChart data={salesData.weeklyBreakdown.map(d => ({
                    ...d,
                    label: format(new Date(d.date + 'T00:00:00'), 'EEE')
                  }))} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} axisLine={false} tickLine={false} />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0]?.payload;
                        const hasWeeklyLabor = salesData?.weeklyLabor && salesData.weeklyLabor.laborPercent > 0;
                        return (
                          <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                            <p className="font-medium">{format(new Date(data?.date + 'T00:00:00'), 'EEEE, MMM d')}</p>
                            <p className="text-muted-foreground">Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span></p>
                            <p className="text-primary">Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span></p>
                            {hasWeeklyLabor && data?.laborPercent !== undefined && data.laborPercent > 0 && (
                              <p className="text-blue-500">Labor: <span className="font-medium">{data.laborPercent.toFixed(1)}%</span></p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend 
                      formatter={(value) => value === 'projected' ? 'Projected' : value === 'sales' ? 'Actual Sales' : value}
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                    {/* Bars for actuals */}
                    <Bar dataKey="sales" name="Actual Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    {/* Line for projections */}
                    <Line 
                      type="monotone" 
                      dataKey="projected" 
                      name="Projected" 
                      stroke="hsl(var(--muted-foreground))" 
                      strokeWidth={2} 
                      dot={{ fill: 'hsl(var(--muted-foreground))', strokeWidth: 2, r: 4, stroke: 'hsl(var(--card))' }}
                      activeDot={{ r: 6, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] md:h-[280px] flex items-center justify-center text-muted-foreground">
                  No weekly data available
                </div>
              )}
            </TabsContent>
            
            {/* MONTH TAB */}
            <TabsContent value="month" className="space-y-4">
              <DateNavigator 
                onPrev={() => navigateMonth('prev')}
                onNext={() => navigateMonth('next')}
                label={format(targetDate, 'MMMM yyyy')}
                canGoNext={!isSameMonth(targetDate, new Date())}
                narrow
              />
              
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
              <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">MTD</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.monthly !== undefined ? formatCurrency(salesData.monthly) : "--"}
                  </p>
                  {salesData?.comparison?.prevMonth !== undefined && salesData.monthly !== undefined && (
                    <ComparisonBadge 
                      current={salesData.monthly} 
                      previous={salesData.comparison.prevMonth} 
                      label="last month"
                    />
                  )}
                </div>
                <div className="text-center min-w-0">
                  <p className="text-xs text-muted-foreground">Pizzas</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.pizzaCount !== undefined 
                      ? (typeof salesData.pizzaCount === 'object' ? Math.round(salesData.pizzaCount.monthly) : "--")
                      : "--"}
                  </p>
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-muted-foreground">Avg Ticket</p>
                  <p className="text-lg sm:text-2xl font-bold transition-all duration-300 ease-out">
                    {salesData?.guestCount?.monthly && salesData?.monthly 
                      ? formatCurrencyDecimal(salesData.monthly / salesData.guestCount.monthly) 
                      : "--"}
                  </p>
                </div>
              </div>

              {/* Croo AI Projection & Pacing for Month */}
              {salesData?.projections?.monthProjected && salesData.projections.monthProjected > 0 && (
                <div className="flex items-stretch gap-2 p-2 rounded-lg bg-gradient-to-r from-primary/10 via-purple-500/10 to-amber-500/10 border border-primary/20 mb-2">
                  {/* Target EOM - Left */}
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex-shrink-0">
                      <Sparkles className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">Target EOM</span>
                      <span className="text-sm sm:text-base font-semibold text-primary transition-all duration-300 ease-out">
                        {formatCurrency(salesData.projections.monthProjected)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Divider */}
                  <div className="w-px bg-border/50 self-stretch" />
                  
                  {/* Pacing To - Right (show accumulated pace delta) */}
                  {isToday && (salesData?.monthlyBreakdown?.length || 0) > 0 && (
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-muted-foreground">Pace</span>
                        {(() => {
                          const monthPacing = (salesData?.projections?.monthProjected || 0) + accumulatedMonthDelta;
                          const isPositive = accumulatedMonthDelta >= 0;
                          return (
                            <>
                              <span className="text-sm sm:text-base font-semibold text-amber-500 transition-all duration-300 ease-out">
                                {formatCurrency(monthPacing)}
                              </span>
                              <span className={`text-xs ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                                ({isPositive ? '+' : ''}{formatCurrency(accumulatedMonthDelta)})
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex items-center justify-center h-6 w-6 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex-shrink-0">
                        <TrendingUp className="h-3.5 w-3.5 text-white" />
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Mobile: Show weekly aggregated view, Desktop: Show daily view */}
              {isMobile ? (
                // Mobile weekly aggregated view
                monthlyWeeklyAggregated.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={monthlyWeeklyAggregated} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} axisLine={false} tickLine={false} />
                      <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} axisLine={false} tickLine={false} />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                              <p className="font-medium">{data?.dateRange || label}</p>
                              <p className="text-muted-foreground">Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span></p>
                              <p className="text-primary">Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span></p>
                            </div>
                          );
                        }}
                      />
                      <Legend 
                        formatter={(value) => value === 'projected' ? 'Projected' : 'Actual Sales'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Bar dataKey="sales" name="Actual Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Line 
                        type="monotone" 
                        dataKey="projected" 
                        name="Projected" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeWidth={2} 
                        dot={{ fill: 'hsl(var(--muted-foreground))', strokeWidth: 2, r: 4, stroke: 'hsl(var(--card))' }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No monthly data available
                  </div>
                )
              ) : (
                // Desktop daily view
                salesData?.monthlyBreakdown && salesData.monthlyBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={salesData.monthlyBreakdown.map(d => ({
                      ...d,
                      label: format(new Date(d.date + 'T00:00:00'), 'd')
                    }))} barCategoryGap="5%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="label" className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} interval={2} axisLine={false} tickLine={false} />
                      <YAxis className="text-xs" tick={{ fill: 'hsl(var(--foreground))' }} tickFormatter={value => `$${value}`} axisLine={false} tickLine={false} />
                      <Tooltip 
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const data = payload[0]?.payload;
                          return (
                            <div className="bg-card border border-border rounded-md p-2 shadow-lg">
                              <p className="font-medium">{data?.date ? format(new Date(data.date + 'T00:00:00'), 'EEEE, MMM d') : ''}</p>
                              <p className="text-muted-foreground">Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span></p>
                              <p className="text-primary">Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span></p>
                            </div>
                          );
                        }}
                      />
                      <Legend 
                        formatter={(value) => value === 'projected' ? 'Projected' : 'Actual Sales'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Bar dataKey="sales" name="Actual Sales" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                      <Line 
                        type="monotone" 
                        dataKey="projected" 
                        name="Projected" 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeWidth={2} 
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                    No monthly data available
                  </div>
                )
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}