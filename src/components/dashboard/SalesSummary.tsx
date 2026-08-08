import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';


import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Package, RefreshCcw, Flame, Activity, AlertCircle } from 'lucide-react';
import { ResponsiveContainer, Tooltip, ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { formatTime12Hour } from '@/lib/utils';
import { setCachedProjections, getCachedProjections, getCachedLiveSales, setCachedLiveSales } from '@/utils/salesCache';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { toast } from 'sonner';
import { resolveProjection, ProjectionSource } from '@/hooks/useResolvedProjection';

interface SalesData {
  daily: number;
  weekly?: number;
  monthly?: number;
  hourly?: Array<{ hour: string; sales: number; projected?: number; checksCount?: number; laborPercent?: number }>;
  weeklyBreakdown?: Array<{ date: string; sales: number; projected?: number; guestCount?: number; laborPercent?: number; laborCost?: number; projectionSource?: ProjectionSource }>;
  monthlyBreakdown?: Array<{ date: string; sales: number; projected?: number; guestCount?: number }>;
  guestCount?: { daily: number; weekly: number; monthly: number };
  avgTicket?: number;
  pizzaCount?: number | { daily: number; weekly: number; monthly: number };
  payments?: {
    daily: Array<{ paymentType: string; amount: number }>;
    weekly: Array<{ paymentType: string; amount: number }>;
    monthly: Array<{ paymentType: string; amount: number }>;
  } | null;
  comparison?: { prevDay: number; prevDayFullDay?: number; prevWeek: number; prevMonth: number };
  lastYear?: { sameDay?: number; sameWeek?: number; sameMonth?: number };
  projections?: { todayProjected: number; todayPaceAdjusted?: number; weekProjected: number; monthProjected: number; todaySource?: ProjectionSource };
  currentHour?: number;
  productMix?: Array<{ name: string; quantity: number; sales: number; category: string }>;
  dateRange?: { today: string; weekStart: string; monthStart: string };
  labor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null;
  weeklyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null;
  monthlyLabor?: { laborPercent: number; laborCost: number; hoursWorked: number; regularHours: number; overtimeHours: number } | null;
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

export function SalesSummary({ locationSettings, onSalesDataChange }: SalesOverviewProps) {
  const { currentLocation } = useAppLocation();
  const { getBusinessDateInTimezone, timezone } = useLocationTimezone();
  const locationZone = timezone || 'America/Los_Angeles';

  const toBusinessDateTime = useCallback((dateStr: string) => {
    const parsed = DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: locationZone });
    return parsed.isValid ? parsed.startOf('day') : DateTime.now().setZone(locationZone).startOf('day');
  }, [locationZone]);

  // Store target as a date STRING (yyyy-MM-dd) in the location's timezone
  // to avoid cross-timezone Date object mismatches.
  const [targetDateStr, setTargetDateStr] = useState<string>(() => getBusinessDateInTimezone());

  // Keep targetDateStr in sync when location/timezone changes
  useEffect(() => {
    setTargetDateStr(getBusinessDateInTimezone());
  }, [currentLocation?.id, getBusinessDateInTimezone]);

  const [activeTab, setActiveTab] = useState<string>('today');
  const [showProductMix, setShowProductMix] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<DiagnosticInfo | null>(null);
  const [isRepairingWeek, setIsRepairingWeek] = useState(false);
  const isMobile = useIsMobile();
  const [expandedToday, setExpandedToday] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState(false);
  const queryClient = useQueryClient();
  const isBackgroundRefreshing = useRef(false);
  const lastIntegrationErrorKey = useRef<string | null>(null);
  const lastSalesDataSentKey = useRef<string>("");
  // POS-source cache: 'qubeyond' | 'clover' | 'none' | null (unknown).
  // Determines whether to do the QU live fetch or read from the shared sales_cache mailroom.
  const posSourceByLocation = useRef<Record<string, 'qubeyond' | 'clover' | 'none'>>({});
  const [lastFetchTimestamp, setLastFetchTimestamp] = useState<Date | null>(() => {
    try {
      const stored = localStorage.getItem('qu_last_fetch_timestamp');
      return stored ? new Date(stored) : null;
    } catch { return null; }
  });
  const visibilityRefreshInterval = useRef<NodeJS.Timeout | null>(null);

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

  // Timezone-aware "today" string for comparisons
  const todayTzStr = getBusinessDateInTimezone();
  const isToday = targetDateStr === todayTzStr;
  const targetDateTime = useMemo(() => toBusinessDateTime(targetDateStr), [targetDateStr, toBusinessDateTime]);
  const todayDateTime = useMemo(() => toBusinessDateTime(todayTzStr), [todayTzStr, toBusinessDateTime]);
  const targetWeekStart = useMemo(() => targetDateTime.minus({ days: targetDateTime.weekday - 1 }).startOf('day'), [targetDateTime]);
  const targetWeekEnd = useMemo(() => targetWeekStart.plus({ days: 6 }).startOf('day'), [targetWeekStart]);
  const targetWeekStartStr = useMemo(() => targetWeekStart.toFormat('yyyy-MM-dd'), [targetWeekStart]);
  const targetWeekEndStr = useMemo(() => targetWeekEnd.toFormat('yyyy-MM-dd'), [targetWeekEnd]);
  const todayWeekStartStr = useMemo(() => todayDateTime.minus({ days: todayDateTime.weekday - 1 }).toFormat('yyyy-MM-dd'), [todayDateTime]);
  const isCurrentWeek = useMemo(() => targetWeekStartStr === todayWeekStartStr, [targetWeekStartStr, todayWeekStartStr]);
  const isCurrentMonth = useMemo(() => targetDateTime.hasSame(todayDateTime, 'month'), [targetDateTime, todayDateTime]);

  // Check database cache for historical dates
  const checkDatabaseCache = async (dateStr: string): Promise<SalesData | null> => {
    if (!currentLocation?.id) return null;
    
    const targetDateTime = toBusinessDateTime(dateStr);
    const weekStart = targetDateTime.minus({ days: targetDateTime.weekday - 1 }).startOf('day');
    const weekEnd = weekStart.plus({ days: 6 }).startOf('day');
    const monthStart = targetDateTime.startOf('month');
    const monthEnd = targetDateTime.endOf('month').startOf('day');

    const weekStartStr = weekStart.toFormat('yyyy-MM-dd');
    const weekEndStr = weekEnd.toFormat('yyyy-MM-dd');
    const monthStartStr = monthStart.toFormat('yyyy-MM-dd');
    const monthEndStr = monthEnd.toFormat('yyyy-MM-dd');
    
    // Fetch daily data + week range + month range + labor data in parallel
    // For month, always fetch full month (1st to last day)
    // Fetch labor for the ENTIRE WEEK to show labor% in weekly chart
    const [dailyResult, weekResult, monthResult, laborResult, weeklyLaborResult, monthlyLaborResult] = await Promise.all([
      // Daily sales
      supabase
        .from('sales_cache')
        .select('*')
        .eq('location_id', currentLocation.id)
        .eq('sale_date', dateStr)
        .maybeSingle(),
      // Week sales + payments (single round-trip)
      supabase
        .from('sales_cache')
        .select('sale_date, net_sales, guest_count, projected_sales, initial_projection, living_projection, override_projection, payments_data')
        .eq('location_id', currentLocation.id)
        .gte('sale_date', weekStartStr)
        .lte('sale_date', weekEndStr)
        .order('sale_date'),
      // Month sales + payments (single round-trip)
      supabase
        .from('sales_cache')
        .select('sale_date, net_sales, guest_count, projected_sales, initial_projection, living_projection, override_projection, payments_data')
        .eq('location_id', currentLocation.id)
        .gte('sale_date', monthStartStr)
        .lte('sale_date', monthEndStr)
        .order('sale_date'),

      // Fetch labor from dedicated labor_cache table for selected day
      supabase
        .from('labor_cache')
        .select('labor_date, labor_cost, labor_hours, regular_hours, overtime_hours, source')
        .eq('location_id', currentLocation.id)
        .eq('labor_date', dateStr),
      // Fetch labor for entire week range for weekly chart
      supabase
        .from('labor_cache')
        .select('labor_date, labor_cost, labor_hours, regular_hours, overtime_hours, source')
        .eq('location_id', currentLocation.id)
        .gte('labor_date', weekStartStr)
        .lte('labor_date', weekEndStr),
      // Fetch labor for entire month range for monthly chart
      supabase
        .from('labor_cache')
        .select('labor_date, labor_cost, labor_hours, regular_hours, overtime_hours, source')
        .eq('location_id', currentLocation.id)
        .gte('labor_date', monthStartStr)
        .lte('labor_date', monthEndStr)
    ]);

    const dbError = dailyResult.error || weekResult.error || monthResult.error || laborResult.error || weeklyLaborResult.error || monthlyLaborResult.error;
    if (dbError) {
      console.error('[SalesOverview] sales_cache/labor_cache query error:', dbError);
      setDiagnosticInfo({
        lastFetchTime: new Date().toISOString(),
        locationId: currentLocation?.id || null,
        locationName: currentLocation?.name || null,
        targetDate: dateStr,
        rawResponse: {
          dailyError: dailyResult.error,
          weekError: weekResult.error,
          monthError: monthResult.error,
          laborError: laborResult.error,
          weeklyLaborError: weeklyLaborResult.error
          ,monthlyLaborError: monthlyLaborResult.error
        },
        error: dbError.message || String(dbError)
      });

      toast.error('Unable to load historical sales', {
        description: dbError.message || 'Your account may not have access to sales history for this location.'
      });
      return null;
    }
    
    // Build a map of daily labor data for the week (prefer punch_clock over qubeyond)
    const weeklyLaborData = weeklyLaborResult.data || [];
    const weeklyLaborMap = new Map<string, { laborCost: number; laborHours: number }>();
    for (const row of weeklyLaborData) {
      const dateKey = row.labor_date;
      const existing = weeklyLaborMap.get(dateKey);
      // Prefer punch_clock source, or use first entry if no preference
      if (!existing || row.source === 'punch_clock') {
        weeklyLaborMap.set(dateKey, {
          laborCost: Number(row.labor_cost) || 0,
          laborHours: Number(row.labor_hours) || 0
        });
      }
    }

    // Check if we have ANY cached data for the period (week or month)
    const hasWeekData = weekResult.data && weekResult.data.length > 0;
    const hasMonthData = monthResult.data && monthResult.data.length > 0;

    // If no daily data but we have week/month data, we can still return historical view
    if (!dailyResult.data && !hasWeekData && !hasMonthData) return null;

    const cached = dailyResult.data;
    
    
    // Aggregate weekly data - always include all 7 days Mon-Sun
    const weekData = weekResult.data || [];
    const weekDataMap = new Map(weekData.map(d => [d.sale_date, d]));
    
    // Get today's date string for pace logic
    const todayStr = todayTzStr;
    
    // Build full 7-day breakdown with labor data
    const weeklyBreakdown: { date: string; sales: number; projected: number; guestCount: number; laborPercent?: number; laborCost?: number; projectionSource?: ProjectionSource }[] = [];
    for (let i = 0; i < 7; i++) {
      const dayStr = weekStart.plus({ days: i }).toFormat('yyyy-MM-dd');
      const existingData = weekDataMap.get(dayStr);
      
      // Use new projection resolution: override > living > initial > legacy
      const resolved = resolveProjection(existingData as any);
      const actualSales = existingData ? Number(existingData.net_sales) || 0 : 0;
      
      // Get labor data for this day and calculate laborPercent from laborCost / sales
      const dayLabor = weeklyLaborMap.get(dayStr);
      const laborCost = dayLabor?.laborCost || 0;
      const laborPercent = (laborCost > 0 && actualSales > 0) ? (laborCost / actualSales) * 100 : 0;
      
      weeklyBreakdown.push({
        date: dayStr,
        sales: actualSales,
        // Use resolved projection if available, otherwise use actual sales as the "projection"
        projected: resolved.value && resolved.value > 0 ? resolved.value : actualSales,
        guestCount: existingData?.guest_count || 0,
        laborPercent,
        laborCost,
        projectionSource: resolved.source
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
    const daysInMonth = monthStart.daysInMonth;
    // Build monthly labor map (same pattern as weekly)
    const monthlyLaborData = monthlyLaborResult.data || [];
    const monthlyLaborMap = new Map<string, { laborCost: number; laborHours: number }>();
    for (const row of monthlyLaborData) {
      const dateKey = row.labor_date;
      const existing = monthlyLaborMap.get(dateKey);
      // Prefer punch_clock source
      if (!existing || row.source === 'punch_clock') {
        monthlyLaborMap.set(dateKey, {
          laborCost: Number(row.labor_cost) || 0,
          laborHours: Number(row.labor_hours) || 0
        });
      }
    }
    
    const monthlyBreakdownFull: { date: string; sales: number; projected: number; guestCount: number; laborPercent?: number; laborCost?: number }[] = [];
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = monthStart.plus({ days: day - 1 }).toFormat('yyyy-MM-dd');
      
      const existingData = monthDataMap.get(dayStr);
      // Use new projection resolution: override > living > initial > legacy
      const resolved = resolveProjection(existingData as any);
      const actualSales = existingData ? Number(existingData.net_sales) || 0 : 0;
      
      // Get labor data for this day
      const dayLabor = monthlyLaborMap.get(dayStr);
      const mLaborCost = dayLabor?.laborCost || 0;
      const mLaborPercent = (mLaborCost > 0 && actualSales > 0) ? (mLaborCost / actualSales) * 100 : 0;
      
      monthlyBreakdownFull.push({
        date: dayStr,
        sales: actualSales,
        // Use resolved projection if available, otherwise use actual sales as "projection"
        projected: resolved.value && resolved.value > 0 ? resolved.value : actualSales,
        guestCount: existingData?.guest_count || 0,
        laborPercent: mLaborPercent,
        laborCost: mLaborCost,
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
    
    // Build daily labor from labor_cache - prioritize punch_clock over qubeyond (do NOT aggregate sources)
    const laborData = laborResult.data || [];
    // Pick the best source: punch_clock > qubeyond (punch_clock is our internal source of truth)
    const punchClockRow = laborData.find((r: any) => r.source === 'punch_clock' && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
    const externalRow = laborData.find((r: any) => ['qubeyond', 'aloha', 'clover'].includes(r.source) && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
    const preferredRow = punchClockRow || externalRow;
    
    const aggregatedLabor = preferredRow ? {
      laborCost: Number(preferredRow.labor_cost) || 0,
      hoursWorked: Number(preferredRow.labor_hours) || 0,
      regularHours: Number(preferredRow.regular_hours) || 0,
      overtimeHours: Number(preferredRow.overtime_hours) || 0
    } : { laborCost: 0, hoursWorked: 0, regularHours: 0, overtimeHours: 0 };
    
    
    const dailyLabor = (aggregatedLabor.laborCost > 0 || aggregatedLabor.hoursWorked > 0) ? {
      laborPercent: cached?.net_sales && Number(cached.net_sales) > 0 
        ? (aggregatedLabor.laborCost / Number(cached.net_sales)) * 100 
        : 0,
      laborCost: aggregatedLabor.laborCost,
      hoursWorked: aggregatedLabor.hoursWorked,
      regularHours: aggregatedLabor.regularHours || aggregatedLabor.hoursWorked,
      overtimeHours: aggregatedLabor.overtimeHours
    } : null;
    
    // Calculate weekly labor totals from weeklyLaborMap
    const weeklyLaborTotalCost = weeklyBreakdown.reduce((sum, d) => sum + (d.laborCost || 0), 0);
    const weeklyLaborTotalHours = Array.from(weeklyLaborMap.values()).reduce((sum, l) => sum + l.laborHours, 0);
    const weeklyLabor = (weeklyLaborTotalCost > 0 || weeklyLaborTotalHours > 0) ? {
      laborPercent: weeklySales > 0 ? (weeklyLaborTotalCost / weeklySales) * 100 : 0,
      laborCost: weeklyLaborTotalCost,
      hoursWorked: weeklyLaborTotalHours,
      regularHours: weeklyLaborTotalHours, // We don't have breakdown, use total
      overtimeHours: 0
    } : null;
    
    // Calculate monthly labor totals from monthlyLaborMap
    const monthlyLaborTotalCost = monthlyBreakdownFull.reduce((sum, d) => sum + (d.laborCost || 0), 0);
    const monthlyLaborTotalHours = Array.from(monthlyLaborMap.values()).reduce((sum, l) => sum + l.laborHours, 0);
    const monthlyLabor = (monthlyLaborTotalCost > 0 || monthlyLaborTotalHours > 0) ? {
      laborPercent: monthlySales > 0 ? (monthlyLaborTotalCost / monthlySales) * 100 : 0,
      laborCost: monthlyLaborTotalCost,
      hoursWorked: monthlyLaborTotalHours,
      regularHours: monthlyLaborTotalHours,
      overtimeHours: 0
    } : null;
    
    // Build payments data from cache for cubes
    const aggregatePayments = (rows: any[]): Array<{ paymentType: string; amount: number }> => {
      const map = new Map<string, number>();
      for (const row of rows) {
        if (row.payments_data && Array.isArray(row.payments_data)) {
          for (const p of row.payments_data as { paymentType: string; amount: number }[]) {
            const current = map.get(p.paymentType) || 0;
            map.set(p.paymentType, current + (Number(p.amount) || 0));
          }
        }
      }
      return Array.from(map.entries()).map(([paymentType, amount]) => ({ paymentType, amount }));
    };

    const normalizeProductMix = (rawMix: unknown): Array<{ name: string; quantity: number; sales: number; category: string }> => {
      if (!Array.isArray(rawMix)) return [];

      return rawMix
        .map((item: any) => ({
          name: String(item?.name ?? item?.itemName ?? item?.item_name ?? 'Item'),
          quantity: Number(item?.quantity ?? item?.qty ?? 0) || 0,
          sales: Number(item?.sales ?? item?.netSales ?? item?.gross ?? 0) || 0,
          category: String(item?.category ?? item?.group ?? item?.itemGroup ?? 'Uncategorized'),
        }))
        .filter((item) => item.name && (item.quantity > 0 || item.sales > 0));
    };

    const dailyPayments = cached?.payments_data && Array.isArray(cached.payments_data)
      ? (cached.payments_data as Array<{ paymentType: string; amount: number }>)
      : [];
    const weeklyPayments = aggregatePayments(weekResult.data || []);
    const monthlyPayments = aggregatePayments(monthResult.data || []);

    const productMix = normalizeProductMix(cached?.product_mix);

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
      productMix,
      payments: (dailyPayments.length > 0 || weeklyPayments.length > 0 || monthlyPayments.length > 0)
        ? { daily: dailyPayments, weekly: weeklyPayments, monthly: monthlyPayments }
        : null,
      projections: {
        todayProjected: cached ? (resolveProjection(cached as any).value || 0) : 0,
        todaySource: cached ? resolveProjection(cached as any).source : null,
        // Live pace value written by the POS adapter (clover-sync / qu sync).
        // Absent for very old rows; UI falls back to actual sales when undefined.
        todayPaceAdjusted: cached && (cached as any).pace_adjusted_projection
          ? Number((cached as any).pace_adjusted_projection)
          : undefined,
        weekProjected: weeklyProjected,
        monthProjected: monthlyProjected
      },
      dateRange: {
        today: dateStr,
        weekStart: weekStartStr,
        monthStart: monthStartStr
      },
      labor: dailyLabor,
      weeklyLabor,
      monthlyLabor
    };
  };

  // Fetch fresh data from API
  const fetchSalesData = async (): Promise<SalesData | null> => {
    const dateStr = targetDateStr;
    const isTodayCheck = targetDateStr === todayTzStr;
    
    // For historical dates, use database cache only
    // Don't call the edge function for past dates - it won't have data
    if (!isTodayCheck && currentLocation?.id) {
      const cachedData = await checkDatabaseCache(dateStr);
      // Return cached data (or null if no data exists for this period)
      return cachedData;
    }

    // ── POS-agnostic routing ────────────────────────────────────────────
    // QU locations: live fetch via fetch-qubeyond-sales (legacy behavior).
    // Clover (or any non-QU) locations: read the shared sales_cache mailroom,
    // which is kept fresh every 2 minutes by clover-sync.
    if (currentLocation?.id) {
      let pos = posSourceByLocation.current[currentLocation.id];
      if (!pos) {
        const { data: ints } = await supabase
          .from('location_integrations')
          .select('integration_type, is_active')
          .eq('location_id', currentLocation.id)
          .eq('is_active', true);
        const types = (ints || []).map((i: any) => i.integration_type);
        if (types.includes('qubeyond')) pos = 'qubeyond';
        else if (types.includes('clover')) pos = 'clover';
        else pos = 'none';
        posSourceByLocation.current[currentLocation.id] = pos;
      }

      if (pos !== 'qubeyond') {
        // Mailroom read for Clover (and future POSes). No QU call.
        // Also kick off an immediate sync so the user doesn't wait for the 2-min cron.
        if (pos === 'clover') {
          supabase.functions.invoke('clover-sync', {
            body: { action: 'sync_today', locationId: currentLocation.id },
          }).catch((e) => console.warn('[SalesSummary] clover-sync kick failed:', e));
        }
        const cachedData = await checkDatabaseCache(dateStr);
        return cachedData;
      }
    }
    
    // Check cache INSIDE the query function to get fresh values
    const cachedProjections = isTodayCheck && currentLocation?.id 
      ? getCachedProjections(currentLocation.id, locationZone) 
      : null;
    
    const hasValidDailyCache = cachedProjections?.todayProjected !== undefined;
    const hasValidPaceCache = cachedProjections?.todayPaceAdjusted !== undefined;
    const hasValidWeeklyMonthlyCache = cachedProjections?.weekProjected !== undefined && cachedProjections?.monthProjected !== undefined;
    // Only skip projections if we have ALL cached values including pace
    // If pace expired (7-min TTL) but todayProjected is still valid (30-min), we MUST refetch
    const skipProjections = isTodayCheck && hasValidDailyCache && hasValidPaceCache && hasValidWeeklyMonthlyCache;
    
    // Check if we have cached data - if so, use fast mode for quicker refresh (TODAY only)
    const cached = isTodayCheck && currentLocation?.id ? getCachedLiveSales(currentLocation.id) : null;
    const useFastMode = isTodayCheck && !!cached?.data;
    
    // Ensure the access token is still valid — an expired JWT makes the edge
    // function reject the call with 401 before the client auto-refreshes.
    const { data: sessionData } = await supabase.auth.getSession();
    const expiresAt = sessionData?.session?.expires_at ?? 0;
    if (expiresAt && expiresAt * 1000 - Date.now() < 60_000) {
      await supabase.auth.refreshSession();
    }

    const invokeSales = () =>
      supabase.functions.invoke("fetch-qubeyond-sales", {
        body: {
          locationId: currentLocation?.id,
          targetDate: dateStr,
          skipProjections,
          fastMode: useFastMode // Skip historical data for faster refresh when we have cached data
        }
      });

    let { data, error } = await invokeSales();

    // One retry after a forced token refresh when the function rejects auth.
    if (error && /401|unauthor/i.test(error.message || "")) {
      await supabase.auth.refreshSession();
      ({ data, error } = await invokeSales());
    }


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

    let salesData = data as SalesData;

    // --- Repair weekly breakdown for CURRENT week ---
    // The live integration can return partial/incorrect historical daily totals for earlier days in the current week.
    // For Mon..Yesterday, prefer the backend sales_cache + labor_cache so labor% is stable and correct.
    if (isTodayCheck && currentLocation?.id && salesData?.weeklyBreakdown?.length) {
      try {
        const todayStr = todayTzStr;
        const weekStartStr = salesData.dateRange?.weekStart
          ? salesData.dateRange.weekStart
          : targetWeekStartStr;
        const weekEndStr = targetWeekEndStr;

        const [weekSalesRes, weekLaborRes] = await Promise.all([
          supabase
            .from('sales_cache')
            .select('sale_date, net_sales, guest_count, projected_sales')
            .eq('location_id', currentLocation.id)
            .gte('sale_date', weekStartStr)
            .lte('sale_date', weekEndStr),
          supabase
            .from('labor_cache')
            .select('labor_date, labor_cost, labor_hours, source')
            .eq('location_id', currentLocation.id)
            .gte('labor_date', weekStartStr)
            .lte('labor_date', weekEndStr),
        ]);

        if (!weekSalesRes.error && !weekLaborRes.error) {
          const salesMap = new Map(
            (weekSalesRes.data || []).map((r) => [
              r.sale_date,
              {
                sales: Number(r.net_sales) || 0,
                guests: Number(r.guest_count) || 0,
                projected: Number(r.projected_sales) || 0,
              },
            ])
          );

          // Prefer punch_clock if both sources exist for the same day
          const laborMap = new Map<string, { cost: number; hours: number }>();
          for (const row of weekLaborRes.data || []) {
            const existing = laborMap.get(row.labor_date);
            if (!existing || row.source === 'punch_clock') {
              laborMap.set(row.labor_date, {
                cost: Number(row.labor_cost) || 0,
                hours: Number(row.labor_hours) || 0,
              });
            }
          }

          const repairedWeeklyBreakdown = salesData.weeklyBreakdown.map((d) => {
            // For today: only patch labor from labor_cache (keep live sales/pace intact)
            if (d.date === todayStr) {
              const labor = laborMap.get(d.date);
              if (labor) {
                const laborCost = labor.cost;
                const laborPercent = laborCost > 0 && d.sales > 0 ? (laborCost / d.sales) * 100 : 0;
                return { ...d, laborCost, laborPercent };
              }
              return d;
            }
            // Future days: no changes
            if (d.date > todayStr) return d;

            // Past days: override sales + labor from cache
            const cachedSales = salesMap.get(d.date);
            const sales = cachedSales?.sales ?? d.sales;
            const guestCount = cachedSales?.guests ?? (d.guestCount || 0);
            const storedProjection = cachedSales?.projected ?? (d.projected || 0);

            const labor = laborMap.get(d.date);
            const laborCost = labor?.cost ?? d.laborCost ?? 0;
            const laborPercent = laborCost > 0 && sales > 0 ? (laborCost / sales) * 100 : 0;

            return {
              ...d,
              sales,
              guestCount,
              projected: storedProjection > 0 ? storedProjection : sales,
              laborCost,
              laborPercent,
            };
          });

          const repairedWeeklySales = repairedWeeklyBreakdown.reduce((sum, r) => sum + (Number(r.sales) || 0), 0);
          const repairedWeeklyLaborCost = repairedWeeklyBreakdown.reduce((sum, r) => sum + (Number(r.laborCost) || 0), 0);
          const repairedWeeklyLaborHours = Array.from(laborMap.values()).reduce((sum, r) => sum + (Number(r.hours) || 0), 0);

          salesData.weeklyBreakdown = repairedWeeklyBreakdown;
          salesData.weekly = repairedWeeklySales;
          salesData.weeklyLabor = (repairedWeeklyLaborCost > 0 || repairedWeeklyLaborHours > 0)
            ? {
                laborPercent: repairedWeeklySales > 0 ? (repairedWeeklyLaborCost / repairedWeeklySales) * 100 : 0,
                laborCost: repairedWeeklyLaborCost,
                hoursWorked: repairedWeeklyLaborHours,
                regularHours: repairedWeeklyLaborHours,
                overtimeHours: 0,
              }
            : null;
        }
      } catch (e) {
        console.warn('[SalesOverview] Weekly repair failed:', e);
      }
    }

    // If we skipped projections but have cached ones, merge them in
    if (skipProjections && cachedProjections && salesData) {
      salesData.projections = {
        todayProjected: cachedProjections.todayProjected || 0,
        todayPaceAdjusted: cachedProjections.todayPaceAdjusted,
        todaySource: cachedProjections.todaySource as any,
        weekProjected: cachedProjections.weekProjected,
        monthProjected: cachedProjections.monthProjected
      };
    }
    
    // Cache new projections if we fetched them fresh
    if (isTodayCheck && !skipProjections && salesData?.projections && currentLocation?.id) {
      const todayProjected = salesData.projections.todayProjected;
      const todayPaceAdjusted = salesData.projections.todayPaceAdjusted;
      const todaySource = salesData.projections.todaySource;
      const weekProjected = salesData.projections.weekProjected;
      const monthProjected = salesData.projections.monthProjected;
      const weeklySales = salesData?.weekly || 0;
      const monthlySales = salesData?.monthly || 0;
      
      // Sanity check: projections must be >= actual sales
      if (weekProjected >= weeklySales && monthProjected >= monthlySales && weekProjected > 0 && monthProjected > 0) {
        setCachedProjections(currentLocation.id, { 
          todayProjected: todayProjected > 0 ? todayProjected : undefined,
          todayPaceAdjusted: todayPaceAdjusted && todayPaceAdjusted > 0 ? todayPaceAdjusted : undefined,
          todaySource: todaySource || undefined,
          weekProjected, 
          monthProjected 
        }, locationZone);
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
  const isTodayQuery = targetDateStr === todayTzStr;
  
  // Get initial data from cache for instant render - computed directly in useMemo
  const initialData = useMemo(() => {
    if (!isTodayQuery || !currentLocation?.id) return undefined;
    const cached = getCachedLiveSales(currentLocation.id);
    return cached?.data || undefined;
  }, [isTodayQuery, currentLocation?.id]);
  
  const initialDataUpdatedAt = useMemo(() => {
    if (!isTodayQuery || !currentLocation?.id) return 0;
    const cached = getCachedLiveSales(currentLocation.id);
    if (!cached) return 0;
    return cached.isStale ? 0 : Date.now();
  }, [isTodayQuery, currentLocation?.id]);

  // Build placeholder from prefetched sales_cache data so dashboard renders instantly
  const placeholderFromCache = useMemo(() => {
    if (!isTodayQuery || !currentLocation?.id) return undefined;
    const dateStr = targetDateStr;
    const cachedRow = queryClient.getQueryData(['sales-cache-today', currentLocation.id, dateStr]) as any;
    if (!cachedRow) return undefined;
    const resolved = resolveProjection(cachedRow);
    return {
      daily: Number(cachedRow.net_sales) || 0,
      guestCount: { daily: cachedRow.guest_count || 0, weekly: 0, monthly: 0 },
      avgTicket: cachedRow.avg_ticket ? Number(cachedRow.avg_ticket) : undefined,
      pizzaCount: cachedRow.pizza_count || 0,
      hourly: cachedRow.hourly_data || [],
      projections: {
        todayProjected: resolved.value || 0,
        todaySource: resolved.source,
        weekProjected: 0,
        monthProjected: 0,
      },
      dateRange: { today: dateStr, weekStart: '', monthStart: '' },
    } as SalesData;
  }, [isTodayQuery, currentLocation?.id, targetDateStr, queryClient]);
  
  const { data: rawSalesData, isLoading, refetch } = useQuery({
    queryKey: ["qubeyond-sales", currentLocation?.id, targetDateStr],
    queryFn: async () => {
      // For today, check if we have fresh cached data (< 3 min old)
      // If so, skip the API call entirely - this applies to ALL loads including manual refresh
      if (isTodayQuery && currentLocation?.id) {
        const cached = getCachedLiveSales(currentLocation.id);
        if (cached?.isFresh && cached.data) {
          // Update the fetch timestamp to reflect cached data age
          if (cached.cachedAt) {
            setLastFetchTimestamp(cached.cachedAt);
            try { localStorage.setItem('qu_last_fetch_timestamp', cached.cachedAt.toISOString()); } catch {}
          }
          return cached.data;
        }
      }
      
      const data = await fetchSalesData();
      // Track when we last fetched live data
      if (isTodayQuery && data) {
        const now = new Date();
        setLastFetchTimestamp(now);
        try { localStorage.setItem('qu_last_fetch_timestamp', now.toISOString()); } catch {}
      }
      return data;
    },
    enabled: !!currentLocation?.id,
    staleTime: isTodayQuery ? 3 * 60 * 1000 : 0, // 3 min stale time matches cache TTL
    gcTime: isTodayQuery ? 30 * 60 * 1000 : 0, // Don't cache historical queries in memory
    refetchOnWindowFocus: true, // Refresh when user tabs back (but will use cache if fresh)
    initialData: initialData,
    initialDataUpdatedAt,
    placeholderData: (previousData) => previousData ?? placeholderFromCache,
  });

  // If the user switches to Weekly view while looking at "today", force a refetch and drop
  // any cached live response so we don't keep showing a bad weekly labor% from localStorage.
  useEffect(() => {
    if (!currentLocation?.id) return;
    if (!isTodayQuery) return;
    if (activeTab !== 'week') return;

    try {
      localStorage.removeItem(`qu_live_sales_${currentLocation.id}`);
    } catch {
      // ignore
    }

    refetch();
  }, [activeTab, currentLocation?.id, isTodayQuery, refetch]);

  // Background refresh when cache is stale but we have data to show
  useEffect(() => {
    if (!currentLocation?.id || !isToday) return;
    
    const cached = getCachedLiveSales(currentLocation.id);
    // Only refetch if cache exists but is stale (> 3 min old) - not if it's fresh
    if (cached?.isStale && !cached?.isFresh && !isBackgroundRefreshing.current) {
      isBackgroundRefreshing.current = true;
      refetch().finally(() => {
        isBackgroundRefreshing.current = false;
      });
    }
  }, [currentLocation?.id, isToday, refetch]);

  // Visibility-based auto-refresh: only refresh when dashboard is visible/focused
  // AND the store is within operating hours (+1h grace after close).
  // Prevents overnight polling of a POS that has nothing new to report.
  useEffect(() => {
    if (!currentLocation?.id) return;

    const VISIBILITY_REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes - matches cache TTL

    // If hours aren't configured we fall back to always-on (previous behavior).
    const isWithinOperatingHours = () => {
      const openStr = locationSettings?.hours_open;
      const closeStr = locationSettings?.hours_close;
      if (!openStr || !closeStr) return true;

      const now = DateTime.now().setZone(locationZone);
      const nowMin = now.hour * 60 + now.minute;
      const [oh, om] = openStr.split(':').map(Number);
      const [ch, cm] = closeStr.split(':').map(Number);
      const openMin = oh * 60 + (om || 0);
      // 60 min grace after close so end-of-night totals still settle
      const closeMin = ch * 60 + (cm || 0) + 60;

      // Overnight close (e.g. open 11:00, close 02:00)
      if (closeMin <= openMin) return nowMin >= openMin || nowMin <= closeMin;
      return nowMin >= openMin && nowMin <= closeMin;
    };

    const startInterval = () => {
      visibilityRefreshInterval.current = setInterval(() => {
        if (
          document.visibilityState === 'visible' &&
          !isBackgroundRefreshing.current &&
          isWithinOperatingHours()
        ) {
          isBackgroundRefreshing.current = true;
          refetch().finally(() => {
            isBackgroundRefreshing.current = false;
          });
        }
      }, VISIBILITY_REFRESH_INTERVAL);
    };

    const handleVisibilityChange = () => {
      // Clear any existing interval
      if (visibilityRefreshInterval.current) {
        clearInterval(visibilityRefreshInterval.current);
        visibilityRefreshInterval.current = null;
      }

      // If page becomes visible and we're viewing today, start refresh interval
      if (document.visibilityState === 'visible' && isToday) {

        // Check if cache is stale (> 3 min) - if fresh, don't refresh yet
        const cached = getCachedLiveSales(currentLocation.id);
        if (!cached?.isFresh) {
          refetch();
        }

        // Start interval for periodic refresh while visible
        startInterval();
      }
    };

    // Set up visibility listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Initial check - if page is already visible, start interval
    if (document.visibilityState === 'visible' && isToday) {
      startInterval();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityRefreshInterval.current) {
        clearInterval(visibilityRefreshInterval.current);
      }
    };
  }, [currentLocation?.id, isToday, refetch, locationSettings?.hours_open, locationSettings?.hours_close, locationZone]);


  // Calculate how long ago data was fetched
  const dataAgeText = useMemo(() => {
    if (!lastFetchTimestamp) return null;
    
    const ageMs = Date.now() - lastFetchTimestamp.getTime();
    const ageMinutes = Math.floor(ageMs / 60000);
    
    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes === 1) return '1 min ago';
    if (ageMinutes < 60) return `${ageMinutes} min ago`;
    
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours === 1) return '1 hour ago';
    return `${ageHours} hours ago`;
  }, [lastFetchTimestamp]);

  // Update data age text every minute
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!lastFetchTimestamp) return;
    
    const interval = setInterval(() => {
      forceUpdate(n => n + 1);
    }, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, [lastFetchTimestamp]);

  // Convert hourly data to 12-hour format and filter to business hours only
  const salesData = useMemo(() => {
    if (!rawSalesData) return rawSalesData;
    
    // Helper: scale hourly projections when an override exists so the chart curve matches the override goal
    const scaleHourlyForOverride = (hourlyArr: Array<{ hour: string; sales: number; projected?: number }>) => {
      const todayProj = rawSalesData.projections?.todayProjected;
      const todaySource = rawSalesData.projections?.todaySource;
      if (todaySource !== 'override' || !todayProj || todayProj <= 0 || hourlyArr.length === 0) return hourlyArr;
      const rawTotal = hourlyArr.reduce((sum, h) => sum + (h.projected || 0), 0);
      if (rawTotal <= 0) return hourlyArr;
      const scaleFactor = todayProj / rawTotal;
      if (Math.abs(scaleFactor - 1) < 0.01) return hourlyArr;
      return hourlyArr.map(h => ({ ...h, projected: h.projected ? Math.round(h.projected * scaleFactor) : 0 }));
    };
    
    // Show hourly breakdown filtered to business hours when configured
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

      return { ...rawSalesData, hourly: scaleHourlyForOverride(completeHourly) };
    }
    
    // If locationSettings is loading (undefined) or not configured (null),
    // strip out empty hours to avoid showing a 24-hour window
    if ((!locationSettings || !locationSettings.hours_open || !locationSettings.hours_close) && rawSalesData.hourly) {
      const filtered = rawSalesData.hourly.filter(h => 
        (h.sales && h.sales > 0) || (h.projected && h.projected > 0)
      );
      if (filtered.length > 0) {
        const converted = filtered.map(h => ({
          ...h,
          hour: h.hour.includes('AM') || h.hour.includes('PM') || h.hour.includes('am') || h.hour.includes('pm')
            ? h.hour
            : formatTime12Hour(h.hour),
        }));
        return { ...rawSalesData, hourly: scaleHourlyForOverride(converted) };
      }
    }
    
    // Fallback — show raw hourly data in 12-hour format
    if (rawSalesData.hourly) {
      const converted = rawSalesData.hourly.map(h => ({
        ...h,
        hour: h.hour.includes('AM') || h.hour.includes('PM') || h.hour.includes('am') || h.hour.includes('pm')
          ? h.hour
          : formatTime12Hour(h.hour),
      }));
      return { ...rawSalesData, hourly: scaleHourlyForOverride(converted) };
    }
    return rawSalesData;
  }, [rawSalesData, locationSettings]);

  // NOTE: Pace-adjusted values for data cubes are calculated below after useMemo hooks
  // and passed via onSalesDataChange effect after accumulatedWeekDelta/accumulatedMonthDelta are defined

  // Only include days that fall within the selected month to avoid bleeding into other months
  // For the current week, use weeklyBreakdown projections (same source as Week view) for consistency
  const monthlyWeeklyAggregated = useMemo(() => {
    if (!salesData?.monthlyBreakdown || salesData.monthlyBreakdown.length === 0) return [];
    
    // Get the month we're viewing
    const viewingMonth = targetDateTime.month;
    const viewingYear = targetDateTime.year;
    
    // Build a map of weeklyBreakdown projections for the current week (keyed by date string)
    // This ensures the month chart uses the same projection values as the week view
    const weeklyProjectionMap = new Map<string, number>();
    if (salesData?.weeklyBreakdown) {
      for (const day of salesData.weeklyBreakdown) {
        weeklyProjectionMap.set(day.date, day.projected || 0);
      }
    }
    
    // Group by Monday-Sunday weeks, but only count days within the target month
    const weeklyBuckets: Array<{ weekStart: DateTime; sales: number; projected: number; daysInMonth: number; firstDayInMonth: DateTime; lastDayInMonth: DateTime }> = [];
    
    salesData.monthlyBreakdown.forEach(day => {
      const date = toBusinessDateTime(day.date);
      
      // Only include days that are in the viewing month
      if (date.month !== viewingMonth || date.year !== viewingYear) {
        return;
      }
      
      const weekStart = date.minus({ days: date.weekday - 1 }).startOf('day');
      
      // Find existing bucket or create new one
      let bucket = weeklyBuckets.find(b => b.weekStart.toMillis() === weekStart.toMillis());
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
      
      // Use weeklyBreakdown projection if available (for current week consistency)
      // Otherwise fall back to monthlyBreakdown projection
      const projectedValue = weeklyProjectionMap.has(day.date) 
        ? weeklyProjectionMap.get(day.date)! 
        : (day.projected || 0);
      bucket.projected += projectedValue;
      
      bucket.daysInMonth += 1;
      if (date.toMillis() < bucket.firstDayInMonth.toMillis()) bucket.firstDayInMonth = date;
      if (date.toMillis() > bucket.lastDayInMonth.toMillis()) bucket.lastDayInMonth = date;
    });
    
    // Sort by week start date and format labels to show only dates within the month
    return weeklyBuckets
      .sort((a, b) => a.weekStart.toMillis() - b.weekStart.toMillis())
      .map((bucket, index) => ({
        label: `Week ${index + 1}`,
        sales: bucket.sales,
        projected: bucket.projected,
        dateRange: bucket.firstDayInMonth.toMillis() === bucket.lastDayInMonth.toMillis()
          ? bucket.firstDayInMonth.toFormat('MMM d')
          : `${bucket.firstDayInMonth.toFormat('MMM d')} - ${bucket.lastDayInMonth.toFormat('MMM d')}`
      }));
  }, [salesData?.monthlyBreakdown, salesData?.weeklyBreakdown, targetDateTime, toBusinessDateTime]);

  const VIEW_MODES = ['today', 'week', 'month'] as const;
  const cycleView = (direction: 'prev' | 'next') => {
    const idx = VIEW_MODES.indexOf(activeTab as any);
    const next = direction === 'next'
      ? VIEW_MODES[(idx + 1) % VIEW_MODES.length]
      : VIEW_MODES[(idx - 1 + VIEW_MODES.length) % VIEW_MODES.length];
    setActiveTab(next);
  };

  const navigateDay = (direction: 'prev' | 'next') => {
    setTargetDateStr(prev => {
      const next = direction === 'prev'
        ? toBusinessDateTime(prev).minus({ days: 1 })
        : toBusinessDateTime(prev).plus({ days: 1 });
      return next.toFormat('yyyy-MM-dd');
    });
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setTargetDateStr(prev => {
      const next = direction === 'prev'
        ? toBusinessDateTime(prev).minus({ weeks: 1 })
        : toBusinessDateTime(prev).plus({ weeks: 1 });
      return next.toFormat('yyyy-MM-dd');
    });
  };

  // Calculate Target EOW (AI Goal): sum of all daily projections for the week
  // This is a FIXED target - the goal you're aiming for, not influenced by actuals
  const calculatedWeekProjected = useMemo(() => {
    if (!salesData?.weeklyBreakdown || salesData.weeklyBreakdown.length === 0) {
      return salesData?.projections?.weekProjected || 0;
    }
    
    // Sum all daily projections to get the fixed weekly goal
    let total = 0;
    for (const day of salesData.weeklyBreakdown) {
      total += day.projected || 0;
    }
    
    // If we have projections, use our calculated total
    // Otherwise fall back to the backend's weekProjected
    return total > 0 ? total : (salesData?.projections?.weekProjected || 0);
  }, [salesData?.weeklyBreakdown, salesData?.projections?.weekProjected]);

  // Calculate Week Pace: actual past days + today's paced finish + projected future days
  // This represents where we're TRENDING - using daily pace for today
  const calculatedWeekPace = useMemo(() => {
    if (!salesData?.weeklyBreakdown || salesData.weeklyBreakdown.length === 0) {
      return salesData?.projections?.weekProjected || 0;
    }
    
    const todayStr = todayTzStr;
    
    let total = 0;
    for (const day of salesData.weeklyBreakdown) {
      if (day.date < todayStr) {
        // Past day: use actual if available, otherwise projected
        total += day.sales > 0 ? day.sales : (day.projected || 0);
      } else if (day.date === todayStr && isToday) {
        // Today: use daily pace (todayPaceAdjusted) to show real-time trending
        const todayValue = salesData?.projections?.todayPaceAdjusted 
          ?? (day.sales > 0 ? day.sales : (day.projected || 0));
        total += todayValue;
      } else {
        // Future days: use projected
        total += day.projected || 0;
      }
    }
    
    return total > 0 ? total : (salesData?.projections?.weekProjected || 0);
  }, [salesData?.weeklyBreakdown, salesData?.projections?.weekProjected, salesData?.projections?.todayPaceAdjusted, isToday]);

  // Calculate accumulated week delta: Pace - Target (the difference between trending and goal)
  // Calculate Month Projected (Goal): sum of all daily projections
  const calculatedMonthProjected = useMemo(() => {
    if (!salesData?.monthlyBreakdown || salesData.monthlyBreakdown.length === 0) {
      return salesData?.projections?.monthProjected || 0;
    }
    
    // Sum all daily projections to get the fixed monthly goal
    let total = 0;
    for (const day of salesData.monthlyBreakdown) {
      total += day.projected || 0;
    }
    
    return total > 0 ? total : (salesData?.projections?.monthProjected || 0);
  }, [salesData?.monthlyBreakdown, salesData?.projections?.monthProjected]);

  // Calculate Month Pace: actual past days + today's paced finish + projected future days
  // This mirrors the weekly pace logic exactly
  const calculatedMonthPace = useMemo(() => {
    if (!salesData?.monthlyBreakdown || salesData.monthlyBreakdown.length === 0) {
      return salesData?.projections?.monthProjected || 0;
    }
    
    const todayStr = todayTzStr;
    
    let total = 0;
    for (const day of salesData.monthlyBreakdown) {
      if (day.date < todayStr) {
        // Past day: use actual if available, otherwise projected
        total += day.sales > 0 ? day.sales : (day.projected || 0);
      } else if (day.date === todayStr && isToday) {
        // Today: use daily pace (todayPaceAdjusted) to show real-time trending
        const todayValue = salesData?.projections?.todayPaceAdjusted 
          ?? (day.sales > 0 ? day.sales : (day.projected || 0));
        total += todayValue;
      } else {
        // Future days: use projected
        total += day.projected || 0;
      }
    }
    
    return total > 0 ? total : (salesData?.projections?.monthProjected || 0);
  }, [salesData?.monthlyBreakdown, salesData?.projections?.monthProjected, salesData?.projections?.todayPaceAdjusted, isToday]);

  // Calculate accumulated month delta: Pace - Target (the difference between trending and goal)
  // Notify parent component when sales data changes (for data cubes to use)
  // Include pace-adjusted values that are calculated in the useMemo hooks above.
  // Also avoid infinite update loops by only emitting when the underlying values change.
  useEffect(() => {
    if (!salesData) {
      if (lastSalesDataSentKey.current !== 'null') {
        lastSalesDataSentKey.current = 'null';
        // Write null to shared cache + legacy callback
        queryClient.setQueryData(['dashboard-sales-enriched', currentLocation?.id], null);
        onSalesDataChange?.(null);
      }
      return;
    }

    const weekTargetEow = calculatedWeekProjected;
    const weekPace = calculatedWeekPace;
    const monthTargetEom = calculatedMonthProjected;
    const monthPace = calculatedMonthPace;

    const emitKey = JSON.stringify({
      daily: salesData.daily,
      weekly: salesData.weekly,
      monthly: salesData.monthly,
      todayProjected: salesData.projections?.todayProjected,
      todayPaceAdjusted: salesData.projections?.todayPaceAdjusted,
      weekTargetEow,
      weekPace,
      monthProjected: monthTargetEom,
      monthPace,
      prevDayFullDay: salesData.comparison?.prevDayFullDay,
      prevWeek: salesData.comparison?.prevWeek,
      prevMonth: salesData.comparison?.prevMonth,
      guestDaily: salesData.guestCount?.daily,
      guestWeekly: salesData.guestCount?.weekly,
      guestMonthly: salesData.guestCount?.monthly,
      pizzaDaily: typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily,
      pizzaWeekly: typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined,
      pizzaMonthly: typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined,
      laborDaily: salesData.labor,
      laborWeekly: salesData.weeklyLabor,
      lastYearDay: salesData.lastYear?.sameDay,
      lastYearWeek: salesData.lastYear?.sameWeek,
      lastYearMonth: salesData.lastYear?.sameMonth,
      avgTicket: salesData.avgTicket,
    });

    if (emitKey === lastSalesDataSentKey.current) return;
    lastSalesDataSentKey.current = emitKey;

    // Enhance salesData with the same values the Sales Overview UI uses.
    const enhancedData = {
      ...salesData,
      projections: salesData.projections
        ? {
            ...salesData.projections,
            weekProjected: weekTargetEow,
            monthProjected: monthTargetEom,
            weekPaceAdjusted: weekPace,
            monthPaceAdjusted: monthPace,
          }
        : undefined,
    };

    // PRIMARY: Write enriched data to shared React Query cache.
    // Dashboard and widgets read from this key — no callback prop needed.
    // SalesSummary is the MASTER WRITER for this cache key.
    queryClient.setQueryData(['dashboard-sales-enriched', currentLocation?.id], enhancedData);

    // LEGACY: Keep callback for any remaining consumers during migration
    onSalesDataChange?.(enhancedData);
  }, [
    salesData,
    calculatedWeekProjected,
    calculatedWeekPace,
    calculatedMonthProjected,
    calculatedMonthPace,
    onSalesDataChange,
    queryClient,
    currentLocation?.id,
  ]);

  const navigateMonth = (direction: 'prev' | 'next') => {
    setTargetDateStr(prev => {
      const next = direction === 'prev'
        ? toBusinessDateTime(prev).minus({ months: 1 })
        : toBusinessDateTime(prev).plus({ months: 1 });
      return next.toFormat('yyyy-MM-dd');
    });
  };

  const getChangePercent = (current: number, previous: number) => {
    if (previous === 0) return null; // Can't calculate % change from 0
    return ((current - previous) / previous) * 100;
  };

  const hasLaborData = !!(salesData?.labor && salesData.labor.laborPercent > 0);

  // Calculate pacing status for "On Track" badge
  const pacingStatus = useMemo(() => {
    if (!isToday || !salesData?.projections?.todayProjected || !salesData?.projections?.todayPaceAdjusted) {
      return null;
    }
    if (salesData.daily < 100) return null; // Not enough data yet

    const effectivePace = Math.max(salesData.projections.todayPaceAdjusted, salesData.daily || 0);
    const paceVsProjection = (effectivePace / salesData.projections.todayProjected) * 100;

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
                    const weekStart = targetWeekStart;
                    const dates = Array.from({ length: 7 }).map((_, i) => weekStart.plus({ days: i }).toFormat('yyyy-MM-dd'));

                    const results = await Promise.allSettled(
                      dates.map((date) =>
                        supabase.functions.invoke('sales-service', {
                          body: { locationId: currentLocation.id, date, action: 'sync-day' },
                        })
                      )
                    );

                    const updatedCount = results.filter(
                      (r) => r.status === 'fulfilled' && (r.value as any)?.data?.status === 'updated'
                    ).length;

                    toast.success('Re-synced week from source', {
                      description: `${updatedCount}/7 days updated for ${weekStart.toFormat('MMM d')}-${weekStart.plus({ days: 6 }).toFormat('MMM d')}.`,
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
          <div className="w-full">
            {/* Unified nav bar: chevrons navigate date, tapping label cycles view */}
            <div className="mb-2">
              <div className="flex items-center justify-between bg-primary rounded-lg px-3 py-1.5 w-full">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    if (activeTab === 'today') navigateDay('prev');
                    else if (activeTab === 'week') navigateWeek('prev');
                    else navigateMonth('prev');
                  }}
                  disabled={false}
                  className="h-8 w-8 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <button
                  onClick={() => cycleView('next')}
                  className="text-center px-3 py-1 select-none cursor-pointer rounded-md transition-colors"
                >
                  <span className="text-base md:text-lg text-primary-foreground font-semibold whitespace-nowrap">
                    {activeTab === 'today'
                      ? (isToday ? 'Today' : targetDateTime.toFormat('cccc, MMM d'))
                      : activeTab === 'week'
                        ? (isCurrentWeek
                          ? 'This Week'
                          : `${targetWeekStart.toFormat('MMM d')} - ${targetWeekEnd.toFormat('MMM d')}`)
                        : targetDateTime.toFormat('MMMM yyyy')
                    }
                  </span>
                </button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    if (activeTab === 'today') navigateDay('next');
                    else if (activeTab === 'week') navigateWeek('next');
                    else navigateMonth('next');
                  }}
                  disabled={
                    activeTab === 'today' ? isToday
                    : activeTab === 'week' ? isCurrentWeek
                    : isCurrentMonth
                  }
                  className="h-8 w-8 p-0 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground disabled:text-primary-foreground/50 rounded-full"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </div>
            
            {/* TODAY VIEW */}
            {activeTab === 'today' && <div className="space-y-0">
              
              {/* Scoreboard Hero Tile */}
              <div
                className="relative rounded-2xl bg-accent border border-accent/80 px-3 py-2 cursor-pointer select-none"
                style={{ borderBottomLeftRadius: expandedToday ? '0' : undefined, borderBottomRightRadius: expandedToday ? '0' : undefined }}
                onClick={() => setExpandedToday((v) => !v)}
              >
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                  {pacingStatus && (
                    <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 shadow-sm pointer-events-auto" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                      {pacingStatus === 'ahead' && <Flame className="h-4 w-4 text-white" />}
                      {pacingStatus === 'onTrack' && <Activity className="h-4 w-4 text-white" />}
                      {pacingStatus === 'behind' && <AlertCircle className="h-4 w-4 text-white" />}
                      <span className="text-sm font-bold text-white">
                        {pacingStatus === 'ahead' ? 'On Fire' : pacingStatus === 'onTrack' ? 'On Track' : 'Behind'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1 items-center">
                  <div>
                    <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider mb-0.5">TODAY'S SALES</p>
                    <p className="text-2xl font-extrabold text-white">
                      {salesData?.daily ? formatCurrency(salesData.daily) : "--"}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {salesData?.comparison?.prevDay !== undefined && salesData?.daily !== undefined && (() => {
                        const change = getChangePercent(salesData.daily, salesData.comparison!.prevDay!);
                        if (change === null) return null;
                        return (
                          <>
                            {change >= 0 ? <TrendingUp className="h-3 w-3 text-white" /> : <TrendingDown className="h-3 w-3 text-white" />}
                            <span className="text-[9px] text-white font-medium">
                              {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs {targetDateTime.toFormat('ccc')}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="text-right space-y-0">
                    <div>
                      <p className="text-[9px] text-white/70 font-bold">Goal</p>
                      <p className="text-lg font-bold text-white">
                        {salesData?.projections?.todayProjected ? formatCurrency(salesData.projections.todayProjected) : '--'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] text-white/70 font-bold">Pace</p>
                      <p className="text-lg font-bold text-white">
                        {isToday && salesData?.projections?.todayPaceAdjusted 
                          ? formatCurrency(Math.max(salesData.projections.todayPaceAdjusted, salesData.daily || 0))
                          : '--'}
                      </p>
                    </div>
                  </div>
                </div>
                {lastFetchTimestamp && isToday && (() => {
                  const pos = currentLocation?.id ? posSourceByLocation.current[currentLocation.id] : undefined;
                  const label = pos === 'clover' ? 'Clover' : pos === 'qubeyond' ? 'QU' : 'POS';
                  return (
                    <p className="text-[8px] text-white/50 mt-1 font-medium">
                      Updated from {label} at {format(lastFetchTimestamp, 'h:mm a')}
                    </p>
                  );
                })()}
              </div>

              {/* Collapsed tab */}
              <AnimatePresence mode="wait">
                {!expandedToday && (
                  <motion.div
                    key="collapsed-today"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="mx-auto w-44 bg-primary rounded-b-xl px-4 py-2 flex items-center justify-center gap-2 cursor-pointer select-none shadow-md"
                      onClick={() => setExpandedToday(true)}
                    >
                      <p className="text-sm font-bold text-white">
                        {salesData?.labor ? `${salesData.labor.laborPercent.toFixed(1)}%` : '--'}
                      </p>
                      <p className="text-xs text-white/60">Labor %</p>
                      <ChevronDown className="h-3.5 w-3.5 text-white/60" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Expanded labor + product strips */}
              <AnimatePresence mode="wait">
                {expandedToday && (
                  <motion.div
                    key="expanded-today"
                    initial={{ opacity: 0, height: 0, scaleY: 0.8 }}
                    animate={{ opacity: 1, height: "auto", scaleY: 1 }}
                    exit={{ opacity: 0, height: 0, scaleY: 0.8 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="origin-top overflow-hidden space-y-1"
                  >
                    {/* Labor strip */}
                    <div className="rounded-2xl bg-primary px-3 py-2" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                      <div className="flex items-center divide-x divide-white/20">
                        {[
                          { label: "Labor %", value: salesData?.labor ? `${salesData.labor.laborPercent.toFixed(1)}%` : '--' },
                          { label: "Labor $", value: salesData?.labor ? formatCurrency(salesData.labor.laborCost) : '--' },
                          { label: "Hours", value: salesData?.labor ? `${salesData.labor.hoursWorked.toFixed(1)}h` : '--' },
                        ].map((t) => (
                          <div key={t.label} className="flex-1 text-center">
                            <p className="text-sm font-bold text-white">{t.value}</p>
                            <p className="text-[10px] text-white/60">{t.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Product strip */}
                    <div className="flex items-center divide-x divide-border rounded-xl border border-border py-2">
                      {[
                        { label: "Pizzas", value: salesData?.pizzaCount !== undefined 
                          ? String(typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount.daily : salesData.pizzaCount)
                          : '--' },
                        { label: "Ticket", value: salesData?.avgTicket ? formatCurrencyDecimal(salesData.avgTicket) : '--' },
                        { label: "Guests", value: salesData?.guestCount?.daily ? String(salesData.guestCount.daily) : '--' },
                      ].map((t) => (
                        <div key={t.label} className="flex-1 text-center">
                          <p className="text-sm font-bold text-foreground">{t.value}</p>
                          <p className="text-[10px] text-muted-foreground">{t.label}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="pt-2">
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
                        formatter={(value) => value === 'Projected' ? 'Projected' : 'Actual'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="projected"
                        name="Projected"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        fill="hsl(var(--muted-foreground) / 0.15)"
                      />
                      <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                );
              })()}
              </div>


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
            </div>}
            
            {/* WEEK VIEW */}
            {activeTab === 'week' && <div className="space-y-0">
              
              {/* Scoreboard Hero Tile - Week */}
              <div
                className="relative rounded-2xl bg-accent border border-accent/80 px-3 py-2 cursor-pointer select-none mt-2"
                style={{ borderBottomLeftRadius: expandedWeek ? '0' : undefined, borderBottomRightRadius: expandedWeek ? '0' : undefined }}
                onClick={() => setExpandedWeek((v) => !v)}
              >
                <div className="grid grid-cols-2 gap-1 items-center">
                  <div>
                    <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider mb-0.5">WEEK-TO-DATE</p>
                    <p className="text-2xl font-extrabold text-white">
                      {salesData?.weekly !== undefined ? formatCurrency(salesData.weekly) : "--"}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {salesData?.comparison?.prevWeek !== undefined && salesData?.weekly !== undefined && (() => {
                        const change = getChangePercent(salesData.weekly!, salesData.comparison!.prevWeek!);
                        if (change === null) return null;
                        return (
                          <>
                            {change >= 0 ? <TrendingUp className="h-3 w-3 text-white" /> : <TrendingDown className="h-3 w-3 text-white" />}
                            <span className="text-[9px] text-white font-medium">
                              {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs LW
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="text-right space-y-0">
                    <div>
                      <p className="text-[9px] text-white/70 font-bold">Goal</p>
                      <p className="text-lg font-bold text-white">
                        {calculatedWeekProjected > 0 ? formatCurrency(calculatedWeekProjected) : '--'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] text-white/70 font-bold">Pace</p>
                      <p className="text-lg font-bold text-white">
                        {isToday && calculatedWeekPace > 0 ? formatCurrency(calculatedWeekPace) : '--'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Collapsed tab */}
              <AnimatePresence mode="wait">
                {!expandedWeek && (
                  <motion.div
                    key="collapsed-week"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="mx-auto w-44 bg-primary rounded-b-xl px-4 py-2 flex items-center justify-center gap-2 cursor-pointer select-none shadow-md"
                      onClick={() => setExpandedWeek(true)}
                    >
                      <p className="text-sm font-bold text-white">
                        {salesData?.weeklyLabor ? `${salesData.weeklyLabor.laborPercent.toFixed(1)}%` : '--'}
                      </p>
                      <p className="text-xs text-white/60">Labor %</p>
                      <ChevronDown className="h-3.5 w-3.5 text-white/60" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Expanded labor + product strips */}
              <AnimatePresence mode="wait">
                {expandedWeek && (
                  <motion.div
                    key="expanded-week"
                    initial={{ opacity: 0, height: 0, scaleY: 0.8 }}
                    animate={{ opacity: 1, height: "auto", scaleY: 1 }}
                    exit={{ opacity: 0, height: 0, scaleY: 0.8 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="origin-top overflow-hidden space-y-1"
                  >
                    <div className="rounded-2xl bg-primary px-3 py-2" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                      <div className="flex items-center divide-x divide-white/20">
                        {[
                          { label: "Labor %", value: salesData?.weeklyLabor ? `${salesData.weeklyLabor.laborPercent.toFixed(1)}%` : '--' },
                          { label: "Labor $", value: salesData?.weeklyLabor ? formatCurrency(salesData.weeklyLabor.laborCost) : '--' },
                          { label: "Hours", value: salesData?.weeklyLabor ? `${salesData.weeklyLabor.hoursWorked.toFixed(1)}h` : '--' },
                        ].map((t) => (
                          <div key={t.label} className="flex-1 text-center">
                            <p className="text-sm font-bold text-white">{t.value}</p>
                            <p className="text-[10px] text-white/60">{t.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center divide-x divide-border rounded-xl border border-border py-2">
                      {[
                        { label: "Pizzas", value: salesData?.pizzaCount !== undefined 
                          ? (typeof salesData.pizzaCount === 'object' ? String(Math.round(salesData.pizzaCount.weekly)) : '--')
                          : '--' },
                        { label: "Ticket", value: salesData?.guestCount?.weekly && salesData?.weekly 
                          ? formatCurrencyDecimal(salesData.weekly / salesData.guestCount.weekly) : '--' },
                        { label: "Guests", value: salesData?.guestCount?.weekly ? String(salesData.guestCount.weekly) : '--' },
                      ].map((t) => (
                        <div key={t.label} className="flex-1 text-center">
                          <p className="text-sm font-bold text-foreground">{t.value}</p>
                          <p className="text-[10px] text-muted-foreground">{t.label}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="pt-2">
              {salesData?.weeklyBreakdown && salesData.weeklyBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={200} className="md:h-[280px]">
                  <ComposedChart data={salesData.weeklyBreakdown.map(d => ({
                    ...d,
                    label: toBusinessDateTime(d.date).toFormat('ccc')
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
                            <p className="font-medium">{data?.date ? toBusinessDateTime(data.date).toFormat('cccc, MMM d') : ''}</p>
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
                      formatter={(value) => value === 'Projected' ? 'Projected' : 'Actual'}
                      wrapperStyle={{ fontSize: '12px' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="projected"
                      name="Projected"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      fill="hsl(var(--muted-foreground) / 0.15)"
                    />
                    <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] md:h-[280px] flex items-center justify-center text-muted-foreground">
                  No weekly data available
                </div>
              )}
              </div>
            </div>}
            
            {/* MONTH VIEW */}
            {activeTab === 'month' && <div className="space-y-0">
              
              {/* Scoreboard Hero Tile - Month */}
              <div
                className="relative rounded-2xl bg-accent border border-accent/80 px-3 py-2 cursor-pointer select-none mt-2"
                style={{ borderBottomLeftRadius: expandedMonth ? '0' : undefined, borderBottomRightRadius: expandedMonth ? '0' : undefined }}
                onClick={() => setExpandedMonth((v) => !v)}
              >
                <div className="grid grid-cols-2 gap-1 items-center">
                  <div>
                    <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider mb-0.5">MONTH-TO-DATE</p>
                    <p className="text-2xl font-extrabold text-white">
                      {salesData?.monthly !== undefined ? formatCurrency(salesData.monthly) : "--"}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {salesData?.comparison?.prevMonth !== undefined && salesData?.monthly !== undefined && (() => {
                        const change = getChangePercent(salesData.monthly!, salesData.comparison!.prevMonth!);
                        if (change === null) return null;
                        return (
                          <>
                            {change >= 0 ? <TrendingUp className="h-3 w-3 text-white" /> : <TrendingDown className="h-3 w-3 text-white" />}
                            <span className="text-[9px] text-white font-medium">
                              {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs LM
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="text-right space-y-0">
                    <div>
                      <p className="text-[9px] text-white/70 font-bold">Goal</p>
                      <p className="text-lg font-bold text-white">
                        {calculatedMonthProjected > 0 ? formatCurrency(calculatedMonthProjected) : '--'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] text-white/70 font-bold">Pace</p>
                      <p className="text-lg font-bold text-white">
                        {isToday && calculatedMonthPace > 0 ? formatCurrency(calculatedMonthPace) : '--'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Collapsed tab */}
              <AnimatePresence mode="wait">
                {!expandedMonth && (
                  <motion.div
                    key="collapsed-month"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="mx-auto w-44 bg-primary rounded-b-xl px-4 py-2 flex items-center justify-center gap-2 cursor-pointer select-none shadow-md"
                      onClick={() => setExpandedMonth(true)}
                    >
                      <p className="text-sm font-bold text-white">
                        {salesData?.monthlyLabor ? `${salesData.monthlyLabor.laborPercent.toFixed(1)}%` : '--'}
                      </p>
                      <p className="text-xs text-white/60">Labor %</p>
                      <ChevronDown className="h-3.5 w-3.5 text-white/60" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Expanded labor + product strips */}
              <AnimatePresence mode="wait">
                {expandedMonth && (
                  <motion.div
                    key="expanded-month"
                    initial={{ opacity: 0, height: 0, scaleY: 0.8 }}
                    animate={{ opacity: 1, height: "auto", scaleY: 1 }}
                    exit={{ opacity: 0, height: 0, scaleY: 0.8 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="origin-top overflow-hidden space-y-1"
                  >
                    <div className="rounded-2xl bg-primary px-3 py-2" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                      <div className="flex items-center divide-x divide-white/20">
                        {[
                          { label: "Labor %", value: salesData?.monthlyLabor ? `${salesData.monthlyLabor.laborPercent.toFixed(1)}%` : '--' },
                          { label: "Labor $", value: salesData?.monthlyLabor ? formatCurrency(salesData.monthlyLabor.laborCost) : '--' },
                          { label: "Hours", value: salesData?.monthlyLabor ? `${salesData.monthlyLabor.hoursWorked.toFixed(1)}h` : '--' },
                        ].map((t) => (
                          <div key={t.label} className="flex-1 text-center">
                            <p className="text-sm font-bold text-white">{t.value}</p>
                            <p className="text-[10px] text-white/60">{t.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center divide-x divide-border rounded-xl border border-border py-2">
                      {[
                        { label: "Pizzas", value: salesData?.pizzaCount !== undefined 
                          ? (typeof salesData.pizzaCount === 'object' ? String(Math.round(salesData.pizzaCount.monthly)) : '--')
                          : '--' },
                        { label: "Ticket", value: salesData?.guestCount?.monthly && salesData?.monthly 
                          ? formatCurrencyDecimal(salesData.monthly / salesData.guestCount.monthly) : '--' },
                        { label: "Guests", value: salesData?.guestCount?.monthly ? String(salesData.guestCount.monthly) : '--' },
                      ].map((t) => (
                        <div key={t.label} className="flex-1 text-center">
                          <p className="text-sm font-bold text-foreground">{t.value}</p>
                          <p className="text-[10px] text-muted-foreground">{t.label}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="pt-2">
              {/* Mobile: Show weekly aggregated view, Desktop: Show daily view */}
              {isMobile ? (
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
                        formatter={(value) => value === 'Projected' ? 'Projected' : 'Actual'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="projected"
                        name="Projected"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        fill="hsl(var(--muted-foreground) / 0.15)"
                      />
                      <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    No monthly data available
                  </div>
                )
              ) : (
                salesData?.monthlyBreakdown && salesData.monthlyBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={salesData.monthlyBreakdown.map(d => ({
                      ...d,
                      label: toBusinessDateTime(d.date).toFormat('d')
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
                              <p className="font-medium">{data?.date ? toBusinessDateTime(data.date).toFormat('cccc, MMM d') : ''}</p>
                              <p className="text-muted-foreground">Projected: <span className="text-foreground">{formatCurrency(data?.projected || 0)}</span></p>
                              <p className="text-primary">Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span></p>
                            </div>
                          );
                        }}
                      />
                      <Legend 
                        formatter={(value) => value === 'Projected' ? 'Projected' : 'Actual'}
                        wrapperStyle={{ fontSize: '12px' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="projected"
                        name="Projected"
                        stroke="hsl(var(--muted-foreground))"
                        strokeWidth={2}
                        fill="hsl(var(--muted-foreground) / 0.15)"
                      />
                      <Bar dataKey="sales" name="Actual" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                    No monthly data available
                  </div>
                )
              )}
              </div>
            </div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}