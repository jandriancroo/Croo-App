import { useState, useEffect, useMemo, useRef } from 'react';
import { useClock } from '@/hooks/useClock';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, differenceInMinutes } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { useSwipe } from '@/hooks/useSwipe';
import { SwipePagerHint } from './SwipePagerHint';
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Bar, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip 
} from 'recharts';
import {
  TrendingUp, 
  TrendingDown,
  Users, 
  DollarSign, 
  Target,
  Flame,
  Coffee,
  CheckCircle2,
  X,
  Gauge,
  Scissors,
  Calculator,
  Circle,
  Sun,
  Moon
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { getBusinessDateInTimezone, getDayOfWeekInTimezone, getTimezoneOffset, parseDateStringInTimezone, getEndOfDateStringInTimezone } from '@/utils/timezoneUtils';
import { filterEventsByRole } from '@/utils/eventRoleFilter';
import { getCachedProjections, getCachedLiveSales } from '@/utils/salesCache';
import { resolveProjection, ProjectionSource } from '@/hooks/useResolvedProjection';
import { ProjectionIcon } from '@/components/ui/projection-tag';
import type { AppRole } from '@/hooks/useUserRole';
import { AlarmTaskOverlay } from './AlarmTaskOverlay';
import { TeamTasksView } from './TeamTasksView';
import { ThemeToggleIcons } from './ThemeToggleIcons';

interface ManagerDashboardOverlayProps {
  locationId: string;
  timezone: string;
  closeTime?: string | null;
  onClose: () => void;
  isDayMode: boolean;
  onThemeChange: (next: boolean) => void;
}

interface ActiveShift {
  userId: string;
  fullName: string;
  profilePhoto: string | null;
  clockInTime: string;
  isOnBreak: boolean;
  breakStartTime: string | null;
  breakType: string | null;
  position?: string;
  /** null when the current session isn't allowed to read wages (kiosk device). */
  hourlyWage?: number | null;
  scheduledStartTime?: string; // HH:mm format from shift template
  scheduledEndTime?: string; // HH:mm format from shift template
}

interface HourlySale {
  hour: string;
  sales: number;
  projected?: number;
  checksCount?: number;
}

interface SelectedHourInfo {
  hour: number;
  label: string;
  sales: number;
  projected: number;
  estimatedPizzas: number;
}

interface LaborCut {
  userId: string;
  minutesCut: number;
  customEndTime?: string;
}

interface HourlyChartData {
  hour: number;
  label: string;
  sales: number;
  projected: number;
  estimatedPizzas: number;
}

// HourlyChartProps interface removed - using inline types

// Hourly chart using recharts (matching Dashboard SalesSummaryChart style exactly)
function HourlyChartRecharts({ 
  hours, 
  formatCurrency,
  isDayMode = false
}: { 
  hours: HourlyChartData[]; 
  formatCurrency: (value: number) => string;
  isDayMode?: boolean;
}) {
  const chartData = hours.map(h => ({
    label: h.label,
    sales: h.sales,
    projected: h.projected,
  }));

  const textColor = isDayMode ? 'hsl(var(--muted-foreground))' : 'rgba(255,255,255,0.6)';
  const projectedStroke = isDayMode ? 'hsl(var(--muted-foreground))' : 'rgba(255,255,255,0.4)';
  const projectedFill = isDayMode ? 'hsl(var(--muted-foreground) / 0.15)' : 'rgba(255,255,255,0.15)';

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          barCategoryGap="15%"
          margin={{ top: 10, right: 5, left: -10, bottom: 5 }}
        >
          <XAxis
            dataKey="label"
            tick={{ fill: textColor, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: textColor, fontSize: 10 }}
            tickFormatter={(value) => `$${value}`}
            axisLine={false}
            tickLine={false}
            width={35}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload as any;
              return (
                <div className={`rounded-md p-2 shadow-lg border ${isDayMode ? 'bg-card border-border' : 'bg-neutral-800 border-neutral-700'}`}>
                  <p className={`font-medium text-sm ${isDayMode ? 'text-foreground' : 'text-white'}`}>{label}</p>
                  <p className={`text-xs ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>
                    Projected: <span className={isDayMode ? 'text-foreground' : 'text-white'}>{formatCurrency(data?.projected || 0)}</span>
                  </p>
                  <p className="text-primary text-xs">
                    Actual: <span className="font-medium">{formatCurrency(data?.sales || 0)}</span>
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="projected"
            stroke={projectedStroke}
            strokeWidth={2}
            fill={projectedFill}
          />
          <Bar 
            dataKey="sales" 
            fill="hsl(var(--primary))" 
            radius={[4, 4, 0, 0]} 
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Helper to format shift time from HH:mm to display format
function formatShiftTime(time: string | undefined): string {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function ManagerDashboardOverlay({ 
  locationId, 
  timezone,
  closeTime,
  onClose,
  isDayMode,
  onThemeChange,
}: ManagerDashboardOverlayProps) {
  
  const [selectedEmployee, setSelectedEmployee] = useState<ActiveShift | null>(null);
  const [showCutOptions, setShowCutOptions] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [selectedHour, setSelectedHour] = useState<SelectedHourInfo | null>(null);
  const [showTeamTasks, setShowTeamTasks] = useState(false);

  // Build storage key for labor cuts persistence
  const laborCutsStorageKey = useMemo(() => 
    `labor-cuts-${locationId}-${getBusinessDateInTimezone(timezone, closeTime)}`, 
    [locationId, timezone, closeTime]
  );

  // Load labor cuts and saved state from localStorage on mount
  const [laborCuts, setLaborCuts] = useState<LaborCut[]>(() => {
    try {
      const stored = localStorage.getItem(laborCutsStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.cuts || [];
      }
    } catch (e) {
      console.error('Failed to load labor cuts:', e);
    }
    return [];
  });

  const [cutsSaved, setCutsSaved] = useState(() => {
    try {
      const stored = localStorage.getItem(laborCutsStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.saved || false;
      }
    } catch (e) {
      console.error('Failed to load labor cuts saved state:', e);
    }
    return false;
  });

  // Persist labor cuts to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem(laborCutsStorageKey, JSON.stringify({
        cuts: laborCuts,
        saved: cutsSaved,
      }));
    } catch (e) {
      console.error('Failed to save labor cuts:', e);
    }
  }, [laborCuts, cutsSaved, laborCutsStorageKey]);

  // Shared clock tick — every second for live duration display
  const currentTime = useClock(1000);

  const todayStr = useMemo(() => getBusinessDateInTimezone(timezone, closeTime), [timezone, closeTime]);

  // Fetch sales data from sales_cache — shared key with CompactDashboard + prefetch
  const { data: salesData } = useQuery({
    queryKey: ['sales-cache-today', locationId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data, projected_sales, pizza_count, initial_projection, living_projection, override_projection')
        .eq('location_id', locationId)
        .eq('sale_date', todayStr)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Refresh every minute
  });
  
  // Use the SAME query key as SalesSummary so React Query dedupes and shares
  // the cached response. If SalesSummary hasn't loaded yet (cold open from
  // Punchclock), this query fetches independently from fetch-qubeyond-sales —
  // the same source of truth SalesSummary uses, so the two screens cannot diverge.
  const { data: dashboardSalesData } = useQuery<{
    daily: number;
    hourly?: Array<{ hour: string; sales: number; projected?: number; checksCount?: number }>;
    pizzaCount?: number | { daily: number; weekly: number; monthly: number };
    projections?: {
      todayProjected: number;
      todayPaceAdjusted?: number;
      todaySource?: ProjectionSource;
    };
    labor?: {
      laborCost: number;
      hoursWorked: number;
      laborPercent?: number;
    } | null;
  }>({
    queryKey: ['qubeyond-sales', locationId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fetch-qubeyond-sales', {
        body: { locationId, targetDate: todayStr },
      });
      if (error) {
        console.error('[ManagerDashboardOverlay] fetch-qubeyond-sales error:', error);
        return undefined;
      }
      // Mirror SalesSummary: surface integration-not-configured as no data
      if (data && typeof data === 'object' && 'authenticated' in data && (data as any).authenticated === false) {
        return undefined;
      }
      return data;
    },
    enabled: !!locationId && !!todayStr,
    staleTime: 3 * 60 * 1000, // 3 min — match SalesSummary so dedupe is effective
    refetchInterval: 60_000, // Keep today's labor% fresh while overlay is open
  });

  // Fetch labor target
  const { data: locationSettings } = useQuery({
    queryKey: ['manager-dash-settings', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('location_settings')
        .select('labor_percentage_target')
        .eq('location_id', locationId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  // Fetch active shifts (clocked in today)
  const { data: activeShifts = [] } = useQuery({
    queryKey: ['manager-dash-shifts', locationId, todayStr],
    queryFn: async () => {
      // DST-safe day boundaries
      const startOfDay = parseDateStringInTimezone(todayStr, timezone).toISOString();
      const endOfDayDate = getEndOfDateStringInTimezone(todayStr, timezone);
      const endOfDayPlus = new Date(endOfDayDate);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);
      const endOfDay = endOfDayPlus.toISOString();

      const { data: punches, error } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, punch_type, notes')
        .eq('location_id', locationId)
        .gte('punch_time', startOfDay)
        .lte('punch_time', endOfDay)
        .order('punch_time', { ascending: true });

      if (error) throw error;

      // Group punches by user
      const userPunches: Record<string, typeof punches> = {};
      (punches || []).forEach(p => {
        if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
        userPunches[p.user_id].push(p);
      });

      // Determine who's currently clocked in
      const activeUsers: { 
        userId: string; 
        clockInTime: string; 
        isOnBreak: boolean; 
        breakStartTime: string | null;
        breakType: string | null;
      }[] = [];

      Object.entries(userPunches).forEach(([userId, userPunchList]) => {
        let isClockedIn = false;
        let isOnBreak = false;
        let clockInTime: string | null = null;
        let breakStartTime: string | null = null;
        let breakType: string | null = null;

        userPunchList.forEach(p => {
          if (p.punch_type === 'clock_in') {
            isClockedIn = true;
            clockInTime = p.punch_time;
            isOnBreak = false;
          } else if (p.punch_type === 'clock_out') {
            isClockedIn = false;
            isOnBreak = false;
          } else if (p.punch_type === 'break_start') {
            isOnBreak = true;
            breakStartTime = p.punch_time;
            breakType = p.notes || 'Break';
          } else if (p.punch_type === 'break_end') {
            isOnBreak = false;
          }
        });

        if (isClockedIn && clockInTime) {
          activeUsers.push({ userId, clockInTime, isOnBreak, breakStartTime, breakType });
        }
      });

      // Fetch profiles for active users
      if (activeUsers.length === 0) return [];

      const userIds = activeUsers.map(u => u.userId);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', userIds);

      // Wages are no longer readable directly from profiles by the kiosk
      // (unauthenticated PII protection). The security-definer helper returns a
      // flat 15.00 placeholder for non-manager callers — and the kiosk device
      // session has no role — so only trust the numbers when the signed-in user
      // is actually a manager. Otherwise wages stay null and we hide dollars.
      const { data: authData } = await supabase.auth.getUser();
      const authUserId = authData?.user?.id ?? null;
      let wagesReadable = false;
      if (authUserId) {
        const { data: priv } = await (supabase as any).rpc('has_role_or_higher', {
          _user_id: authUserId,
          _minimum_role: 'manager',
        });
        wagesReadable = priv === true;
      }

      const wageMap = new Map<string, number>();
      if (wagesReadable) {
        const { data: wageRows } = await (supabase as any).rpc('get_current_wages_batch', {
          p_user_ids: userIds,
          p_date: todayStr,
        });
        (wageRows || []).forEach((w: any) => wageMap.set(w.user_id, Number(w.hourly_wage)));
      }


      // Get today's shifts for positions and start/end times
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, template:shift_templates(position, start_time, end_time)')
        .eq('shift_date', todayStr)
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const shiftMap = new Map((shifts || []).map(s => [s.user_id, { 
        position: s.template?.position, 
        startTime: s.template?.start_time,
        endTime: s.template?.end_time 
      }]));

      return activeUsers.map(u => {
        const profile = profileMap.get(u.userId);
        const shiftInfo = shiftMap.get(u.userId);
        return {
          userId: u.userId,
          fullName: profile?.full_name || 'Unknown',
          profilePhoto: profile?.profile_photo_url || null,
          clockInTime: u.clockInTime,
          isOnBreak: u.isOnBreak,
          breakStartTime: u.breakStartTime,
          breakType: u.breakType,
          position: shiftInfo?.position || undefined,
          hourlyWage: wageMap.get(u.userId) || 16, // Default to $16/hr if not set
          scheduledStartTime: shiftInfo?.startTime || undefined,
          scheduledEndTime: shiftInfo?.endTime || undefined,
        } as ActiveShift;
      }).sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
    refetchInterval: 30000,
  });

  // Historical labor only — today's labor comes live from dashboardSalesData.labor
  // (calculated from open punches by fetch-qubeyond-sales). labor_cache is
  // intentionally history-only: labor-service excludes today to keep the cache
  // idempotent and source-tagged. See cache write rules.
  const { data: laborDataRaw } = useQuery({
    queryKey: ['labor-cache-today', locationId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_cache')
        .select('labor_cost, labor_hours')
        .eq('location_id', locationId)
        .eq('labor_date', todayStr);

      if (error) throw error;
      if (!data || data.length === 0) return null;

      // Sum up all labor sources
      const totalCost = (data || []).reduce((sum, row) => sum + (row.labor_cost || 0), 0);
      const totalHours = (data || []).reduce((sum, row) => sum + (row.labor_hours || 0), 0);
      return { labor_cost: totalCost, labor_hours: totalHours };
    },
    enabled: false, // Today's labor is served by dashboardSalesData.labor (live punch calc)
    refetchInterval: 60000,
  });

  // Prefer live labor (from fetch-qubeyond-sales punch calc) for today.
  // Fall back to labor_cache only if the live response is unavailable.
  const liveLabor = dashboardSalesData?.labor;
  const laborData = liveLabor
    ? { laborCost: liveLabor.laborCost, laborHours: liveLabor.hoursWorked }
    : laborDataRaw
      ? { laborCost: laborDataRaw.labor_cost, laborHours: laborDataRaw.labor_hours }
      : null;

  // Fetch quick tasks for shift managers+
  const { data: quickTasks = [] } = useQuery({
    queryKey: ['manager-dash-tasks', locationId, todayStr],
    queryFn: async () => {
      const todayDayOfWeek = getDayOfWeekInTimezone(timezone);

      // Fetch recurring events
      const { data: events, error } = await supabase
        .from('schedule_events')
        .select('id, event_name, event_time, tagged_roles, day_of_week, days_of_week')
        .eq('location_id', locationId)
        .eq('is_recurring', true);

      if (error) throw error;

      // Filter for today and cast tagged_roles
      const todayEvents = (events || []).filter(e => {
        if (e.days_of_week && e.days_of_week.length > 0) {
          return e.days_of_week.includes(todayDayOfWeek);
        }
        return e.day_of_week === todayDayOfWeek;
      }).map(e => ({
        ...e,
        tagged_roles: e.tagged_roles as string[] | null
      }));

      // Filter for shift_manager+ roles
      const managerRole: AppRole = 'shift_manager';
      const filteredEvents = filterEventsByRole(todayEvents, managerRole).slice(0, 5);
      
      if (filteredEvents.length === 0) return [];
      
      // Fetch completions for these events for today
      const { data: completions } = await supabase
        .from('event_task_completions')
        .select('event_id')
        .in('event_id', filteredEvents.map(e => e.id))
        .eq('completed_date', todayStr);
      
      const completedEventIds = new Set((completions || []).map(c => c.event_id));
      
      // Add isComplete flag to each event
      return filteredEvents.map(e => ({
        ...e,
        isComplete: completedEventIds.has(e.id)
      }));
    },
  });

  // Fetch today's checklists with REAL completion status
  // Uses same logic as ChecklistCompletionAlerts - counts actual responses vs items
  const todayDayOfWeek = getDayOfWeekInTimezone(timezone);
  
  const { data: checklistsData = [] } = useQuery({
    queryKey: ['manager-dash-checklists', locationId, todayStr, todayDayOfWeek],
    queryFn: async () => {
      // Get active checklists with their items for this location
      const { data: checklists, error: checklistError } = await supabase
        .from('checklists')
        .select(`
          id, 
          title, 
          frequency,
          template_type,
          checklist_items(id, days_of_week)
        `)
        .eq('location_id', locationId)
        .eq('is_active', true);

      if (checklistError) throw checklistError;
      if (!checklists?.length) return [];

      // Filter to relevant checklists for today
      const relevantChecklists = checklists.filter(c => {
        if (c.template_type === 'dynamic') {
          // Only include dynamic checklists if they have items for today
          const todayItems = c.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(todayDayOfWeek)
          );
          return todayItems && todayItems.length > 0;
        }
        // Include daily and weekly standard checklists
        return c.frequency === 'daily' || c.frequency === 'weekly';
      });

      if (relevantChecklists.length === 0) return [];

      // Get today's submissions WITH responses to check actual completion
      const { data: submissions, error: subError } = await supabase
        .from('checklist_submissions')
        .select(`
          checklist_id, 
          id,
          checklist_responses(id, item_id)
        `)
        .eq('location_id', locationId)
        .gte('submitted_at', new Date(`${todayStr}T00:00:00${getTimezoneOffset(timezone)}`).toISOString())
        .lte('submitted_at', new Date(`${todayStr}T23:59:59${getTimezoneOffset(timezone)}`).toISOString());

      if (subError) throw subError;

      // Calculate actual completion status for each checklist
      return relevantChecklists.map(c => {
        // Get the active item IDs for today (accounting for dynamic day filtering)
        let activeItems: any[] = c.checklist_items || [];
        if (c.template_type === 'dynamic') {
          activeItems = activeItems.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(todayDayOfWeek)
          );
        }
        const totalItems = activeItems.length;
        const activeItemIds = new Set(activeItems.map((item: any) => item.id));

        // Get all submissions for this checklist today
        const checklistSubmissions = (submissions || []).filter(s => s.checklist_id === c.id);
        
        // Count unique completed items that are ALSO active today
        const uniqueItemIds = new Set<string>();
        checklistSubmissions.forEach((sub: any) => {
          sub.checklist_responses?.forEach((response: any) => {
            if (response.item_id && activeItemIds.has(response.item_id)) {
              uniqueItemIds.add(response.item_id);
            }
          });
        });
        
        const completedItems = uniqueItemIds.size;
        const isComplete = totalItems > 0 && completedItems >= totalItems;

        return {
          id: c.id,
          title: c.title,
          frequency: c.frequency,
          isComplete,
          completedItems,
          totalItems,
        };
      });
    },
    refetchInterval: 30000, // Check more frequently for task updates
  });

  // Calculate sales metrics from DB (actual sales from sales_cache table)
  const totalSales = Number(salesData?.net_sales) || 0;
  const hourlyData = (salesData?.hourly_data as unknown as HourlySale[] | null) || [];

  // Get REAL projections from localStorage cache (same source as Dashboard SalesSummary)
  // This is the SINGLE SOURCE OF TRUTH for projections - Dashboard writes to this cache
  const localStorageProjections = useMemo(() => {
    return getCachedProjections(locationId, timezone);
  }, [locationId, timezone]);
  
  // Get REAL live sales data from localStorage cache (same source as Dashboard)
  const localStorageLiveSales = useMemo(() => {
    return getCachedLiveSales(locationId);
  }, [locationId]);
  
  // Use React Query cache as secondary source
  const cachedSalesOverviewData = dashboardSalesData;
  
  // Get pizza count - try localStorage first, then React Query, then DB
  const pizzaCount = useMemo(() => {
    // First try localStorage cache (what Dashboard actually shows)
    const liveSalesData = localStorageLiveSales?.data;
    if (liveSalesData?.pizzaCount) {
      const pc = liveSalesData.pizzaCount;
      if (typeof pc === 'number' && pc > 0) return pc;
      if (typeof pc === 'object' && pc?.daily && pc.daily > 0) return pc.daily;
    }
    
    // Fall back to React Query cache
    const pc = cachedSalesOverviewData?.pizzaCount;
    if (typeof pc === 'number' && pc > 0) return pc;
    if (typeof pc === 'object' && pc?.daily && pc.daily > 0) return pc.daily;
    
    // Fall back to direct DB query result
    return Number(salesData?.pizza_count) || 0;
  }, [localStorageLiveSales, cachedSalesOverviewData, salesData?.pizza_count]);
  
  // EOD Goal: use localStorage cache (SAME source as Dashboard SalesSummary)
  // Falls back to resolveProjection which uses: override > living > initial > legacy
  const { eodGoal, projectionSource: eodGoalSource } = useMemo(() => {
    // First try localStorage cache - this is what Dashboard shows
    if (localStorageProjections?.todayProjected && localStorageProjections.todayProjected > 0) {
      // If localStorage has it, also check cached todaySource
      const cachedSource = cachedSalesOverviewData?.projections?.todaySource;
      return { 
        eodGoal: localStorageProjections.todayProjected, 
        projectionSource: cachedSource || null 
      };
    }
    
    // Fall back to React Query cache
    const liveProjected = cachedSalesOverviewData?.projections?.todayProjected;
    const liveSource = cachedSalesOverviewData?.projections?.todaySource;
    if (liveProjected && liveProjected > 0) {
      return { eodGoal: liveProjected, projectionSource: liveSource || null };
    }
    
    // Fall back to sales_cache using proper resolution (override > living > initial > legacy)
    // This matches how Dashboard resolves projections
    const resolved = resolveProjection(salesData);
    return { eodGoal: resolved.value || 0, projectionSource: resolved.source };
  }, [localStorageProjections, cachedSalesOverviewData, salesData]);
  
  // Pace Adjusted: use localStorage cache (SAME source as Dashboard SalesSummary)
  // CRITICAL: This is the TRUE pace number from Dashboard
  // If no cached pace, calculate on-the-fly using: actualSales + remainingHoursProjected
  const paceAdjusted = useMemo(() => {
    // First try localStorage cache - this is EXACTLY what Dashboard shows
    if (localStorageProjections?.todayPaceAdjusted && localStorageProjections.todayPaceAdjusted > 0) {
      return localStorageProjections.todayPaceAdjusted;
    }
    
    // Fall back to React Query cache
    const livePace = cachedSalesOverviewData?.projections?.todayPaceAdjusted;
    if (livePace && livePace > 0) return livePace;
    
    // Calculate pace on-the-fly when cache is stale/missing
    // Pace = actual sales so far + projected remaining hours
    // Get current hour in timezone
    const now = new Date();
    const tzHour = new Date(now.toLocaleString('en-US', { timeZone: timezone })).getHours();
    
    // Get hourly data from sales_cache
    const hourlyArray = (salesData?.hourly_data as unknown as HourlySale[] | null) || [];
    
    // Calculate remaining projection from hourly data
    let remainingProjected = 0;
    hourlyArray.forEach(h => {
      const hourNum = parseInt(h.hour?.split(':')[0] || '0', 10);
      // Add projections for hours after current hour
      if (hourNum > tzHour && h.projected) {
        remainingProjected += h.projected;
      }
    });
    
    // If we have both actual sales and remaining projections, calculate pace
    if (totalSales > 0 && remainingProjected > 0) {
      return totalSales + remainingProjected;
    }
    
    // If we have actual sales but no hourly projections, use MAX(actual, goal)
    // This prevents showing misleading low pace early in the day
    if (totalSales > 0 && eodGoal > 0) {
      return Math.max(totalSales, eodGoal);
    }
    
    // Last resort: show EOD goal (better than showing 0)
    return eodGoal;
  }, [localStorageProjections, cachedSalesOverviewData, totalSales, eodGoal, salesData?.hourly_data, timezone]);

  // Get hourly sales with projections from cached SalesOverview data
  // Only show hours that have actual sales recorded (not empty hours)
  const currentHour = new Date(currentTime.toLocaleString('en-US', { timeZone: timezone })).getHours();
  const cachedHourly = cachedSalesOverviewData?.hourly || hourlyData;
  
  // Calculate total hourly sales for pizza distribution (matching SalesOverview logic)
  const totalHourlySales = useMemo(() => {
    return cachedHourly?.reduce((sum, h) => sum + (h.sales || 0), 0) || 0;
  }, [cachedHourly]);
  
  // Get hours with actual sales - up to 8 hours shown in two rows
  const salesHours = useMemo(() => {
    const hoursWithSales: Array<{
      hour: number;
      label: string;
      sales: number;
      projected: number;
      estimatedPizzas: number;
    }> = [];

    let firstSalesHour: number | null = null;
    for (let h = 0; h <= currentHour; h++) {
      const hourStr = `${String(h).padStart(2, '0')}:00`;
      const cachedHourData = cachedHourly?.find(
        hd => hd.hour.startsWith(String(h).padStart(2, '0')) || hd.hour === hourStr
      );
      const dbHourData = hourlyData.find(hd => hd.hour === hourStr);
      const hourData = cachedHourData || dbHourData;
      if (hourData && (hourData.sales || 0) > 0) {
        firstSalesHour = h;
        break;
      }
    }

    if (firstSalesHour === null) return [];

    // Include every hour from first sale → current hour so quiet/in-progress hours
    // (like an unfinished 11 AM) still render on the chart.
    for (let h = firstSalesHour; h <= currentHour; h++) {
      const hourStr = `${String(h).padStart(2, '0')}:00`;
      const cachedHourData = cachedHourly?.find(
        hd => hd.hour.startsWith(String(h).padStart(2, '0')) || hd.hour === hourStr
      );
      const dbHourData = hourlyData.find(hd => hd.hour === hourStr);
      const hourData = cachedHourData || dbHourData;

      const sales = hourData?.sales || 0;
      const projected = hourData?.projected || 0;
      const estimatedPizzas = totalHourlySales > 0 && pizzaCount > 0
        ? Math.round((sales / totalHourlySales) * pizzaCount * 10) / 10
        : 0;

      hoursWithSales.push({
        hour: h,
        label: h >= 12 ? `${h === 12 ? 12 : h - 12}PM` : `${h === 0 ? 12 : h}AM`,
        sales,
        projected,
        estimatedPizzas,
      });
    }

    return hoursWithSales.slice(-8);
  }, [currentHour, cachedHourly, hourlyData, totalHourlySales, pizzaCount]);

  // Calculate pace delta and status
  const paceDelta = eodGoal > 0 ? paceAdjusted - eodGoal : 0;
  const paceStatus = eodGoal > 0 && paceDelta >= eodGoal * 0.1 
    ? 'fire' 
    : paceDelta >= -eodGoal * 0.05 
      ? 'good' 
      : 'cold';

  // Calculate labor percentage
  const laborPercentage = totalSales > 0 ? ((laborData?.laborCost || 0) / totalSales) * 100 : 0;
  const laborTarget = locationSettings?.labor_percentage_target || 25;
  const laborStatus = laborPercentage <= laborTarget ? 'good' : laborPercentage <= laborTarget + 3 ? 'warning' : 'bad';

  const formatTimeDisplay = (time: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(time);
  };

  const getBreakReturnTime = (breakStartTime: string, breakType?: string | null) => {
    const breakStart = new Date(breakStartTime);
    const now = new Date();
    const minutesOnBreak = differenceInMinutes(now, breakStart);
    
    // Parse expected break length from notes (e.g. "10 minute paid break", "30 minute unpaid break")
    let expectedBreakLength = 30; // default fallback
    if (breakType) {
      const match = breakType.match(/(\d+)\s*min/i);
      if (match) {
        expectedBreakLength = parseInt(match[1], 10);
      } else if (breakType.toLowerCase().includes('paid') && !breakType.toLowerCase().includes('unpaid')) {
        expectedBreakLength = 10; // paid breaks are typically 10 min
      }
    }
    
    const minutesRemaining = expectedBreakLength - minutesOnBreak;
    
    if (minutesRemaining <= 0) {
      return { text: 'Overdue', isOverdue: true };
    }
    return { text: `${minutesRemaining}m`, isOverdue: false };
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Calculate new clock-out time based on scheduled end and cut minutes
  const getNewClockOutTime = (scheduledEndTime: string | undefined, minutesCut: number): string | null => {
    if (!scheduledEndTime) return null;
    
    // Parse the scheduled end time (HH:mm format)
    const [hours, minutes] = scheduledEndTime.split(':').map(Number);
    const endDate = new Date();
    endDate.setHours(hours, minutes, 0, 0);
    
    // Subtract the cut minutes
    endDate.setMinutes(endDate.getMinutes() - minutesCut);
    
    // Format as time display
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(endDate);
  };

  // Format custom time (HH:mm) to display format (e.g., "4:30 PM")
  const formatCustomTime = (time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  // maxHourlySale removed - using recharts auto-scaling

  // Labor Cut Functions
  const getCutForEmployee = (userId: string): LaborCut | undefined => {
    return laborCuts.find(c => c.userId === userId);
  };

  const handleAddCut = (employee: ActiveShift, minutes: number) => {
    setLaborCuts(prev => {
      const existing = prev.find(c => c.userId === employee.userId);
      if (existing) {
        return prev.map(c => c.userId === employee.userId ? { ...c, minutesCut: minutes } : c);
      }
      return [...prev, { userId: employee.userId, minutesCut: minutes }];
    });
    setShowCutOptions(false);
    setSelectedEmployee(null);
    setCustomTime('');
  };

  const handleCustomCut = (employee: ActiveShift) => {
    if (!customTime) return;
    
    // Parse the custom end time
    const [customHours, customMinutes] = customTime.split(':').map(Number);
    const customEnd = new Date();
    customEnd.setHours(customHours, customMinutes, 0, 0);
    
    // If we have a scheduled end time, calculate minutes cut from that
    if (employee.scheduledEndTime) {
      const [schedHours, schedMinutes] = employee.scheduledEndTime.split(':').map(Number);
      const schedEnd = new Date();
      schedEnd.setHours(schedHours, schedMinutes, 0, 0);
      
      const minutesCut = differenceInMinutes(schedEnd, customEnd);
      if (minutesCut > 0) {
        // Store both the minutes cut and the custom end time for display
        setLaborCuts(prev => {
          const existing = prev.find(c => c.userId === employee.userId);
          if (existing) {
            return prev.map(c => c.userId === employee.userId 
              ? { ...c, minutesCut, customEndTime: customTime } 
              : c
            );
          }
          return [...prev, { userId: employee.userId, minutesCut, customEndTime: customTime }];
        });
      }
    } else {
      // No scheduled end time - just store a minimal cut with the custom time
      setLaborCuts(prev => {
        const existing = prev.find(c => c.userId === employee.userId);
        if (existing) {
          return prev.map(c => c.userId === employee.userId 
            ? { ...c, minutesCut: 0, customEndTime: customTime } 
            : c
          );
        }
        return [...prev, { userId: employee.userId, minutesCut: 0, customEndTime: customTime }];
      });
    }
    
    setShowCutOptions(false);
    setSelectedEmployee(null);
    setCustomTime('');
  };

  const handleRemoveCut = (userId: string) => {
    setLaborCuts(prev => prev.filter(c => c.userId !== userId));
  };

  const handleClearAllCuts = () => {
    setLaborCuts([]);
    setCutsSaved(false);
    setShowPreviewModal(false);
    // Clear from localStorage
    try {
      localStorage.removeItem(laborCutsStorageKey);
    } catch (e) {
      console.error('Failed to clear labor cuts:', e);
    }
  };

  const handleSaveCuts = () => {
    setCutsSaved(true);
    setShowPreviewModal(false);
  };

  // Calculate labor savings
  const calculateLaborSavings = useMemo(() => {
    let totalMinutesSaved = 0;
    let totalCostSaved = 0;
    
    laborCuts.forEach(cut => {
      const employee = activeShifts.find(s => s.userId === cut.userId);
      if (employee) {
        totalMinutesSaved += cut.minutesCut;
        const hoursSaved = cut.minutesCut / 60;
        totalCostSaved += hoursSaved * (employee.hourlyWage || 16);
      }
    });

    const currentLaborCost = laborData?.laborCost || 0;
    const newLaborCost = Math.max(0, currentLaborCost - totalCostSaved);
    
    const currentLaborPercent = totalSales > 0 ? (currentLaborCost / totalSales) * 100 : 0;
    const newLaborPercent = totalSales > 0 ? (newLaborCost / totalSales) * 100 : 0;

    return {
      totalMinutesSaved,
      totalCostSaved,
      currentLaborCost,
      newLaborCost,
      currentLaborPercent,
      newLaborPercent,
      percentSaved: currentLaborPercent - newLaborPercent,
    };
  }, [laborCuts, activeShifts, laborData?.laborCost, totalSales]);

  const hasAnyCuts = laborCuts.length > 0;

  if (showTeamTasks) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 z-[100] ${isDayMode ? 'bg-background' : 'bg-neutral-900'}`}
      >
        <TeamTasksView
          locationId={locationId}
          timezone={timezone}
          onBack={() => setShowTeamTasks(false)}
          isDayMode={isDayMode}
        />
      </motion.div>
    );
  }

  // Swipe RIGHT on the dashboard to return to the punch clock
  const overlayRef = useRef<HTMLDivElement>(null);
  useSwipe(overlayRef, { onSwipeRight: onClose });

  return (
    <>
      <motion.div
        ref={overlayRef}
        key="manager-dashboard-overlay"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed inset-0 z-[100] overflow-hidden ${
          isDayMode ? 'bg-background' : 'bg-neutral-950'
        }`}
      >
        {/* Pager hint — replaces old teal swap button */}
        <SwipePagerHint
          page="dashboard"
          isDayMode={isDayMode}
          onDotClick={(target) => target === 'punch' && onClose()}
        />

        {/* Bottom-right theme toggle */}
        <ThemeToggleIcons isDayMode={isDayMode} onChange={onThemeChange} />


        <div
          className="relative h-full overflow-y-auto p-3 pb-24 lg:p-4 lg:pb-24"
          style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}
        >
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className={`overflow-hidden rounded-[24px] border p-4 shadow-2xl lg:p-5 ${
                isDayMode
                  ? 'border-slate-200 bg-white text-slate-900'
                  : 'border-white/5 bg-neutral-900 text-white'
              }`}
            >
              <div className={`flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-start lg:justify-between ${isDayMode ? 'border-slate-200' : 'border-white/5'}`}>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-500">Manager Dashboard</p>
                  <p className={`mt-2 text-lg font-medium lg:text-xl ${isDayMode ? 'text-slate-900' : 'text-white'}`}>
                    <span className={isDayMode ? 'text-slate-500' : 'text-slate-400'}>{format(currentTime, 'EEEE')} service · </span>
                    <span className={`font-semibold ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{formatCurrency(totalSales)}</span>
                    <span className={isDayMode ? 'text-slate-500' : 'text-slate-400'}> sales · projecting </span>
                    <span className={`font-semibold ${paceDelta >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {paceDelta >= 0 ? `${formatCurrency(Math.abs(paceDelta))} ahead` : `${formatCurrency(Math.abs(paceDelta))} short`}
                    </span>
                    <span className={isDayMode ? 'text-slate-500' : 'text-slate-400'}> of EOD goal</span>
                  </p>
                </div>

                <div className="flex items-start gap-4 self-end lg:self-auto shrink-0">
                  <div className="text-right">
                    {(() => {
                      const timeStr = formatTimeDisplay(currentTime);
                      const match = timeStr.match(/^([\d:]+)\s*(AM|PM)$/i);
                      const timePart = match ? match[1] : timeStr;
                      const periodPart = match ? match[2] : '';
                      return (
                        <>
                          <div className={`text-5xl font-light tracking-tight lg:text-6xl ${isDayMode ? 'text-slate-900' : 'text-white'}`}>
                            {timePart}
                            <span className={`ml-1 text-xl ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>{periodPart}</span>
                          </div>
                          <div className={`mt-1 text-[11px] uppercase tracking-[0.22em] ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>
                            {format(currentTime, 'EEEE, MMM d')}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>



              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-stretch">
                <div className="flex flex-col gap-3 min-w-0">
                  {/* Combined EOD Goal / Pace card */}
                  <div className={`rounded-2xl p-3 ${isDayMode ? 'bg-slate-50' : 'bg-neutral-800'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`}>EOD Goal</span>
                        <ProjectionIcon source={eodGoalSource} />
                        <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-300' : 'text-slate-600'}`}>/</span>
                        <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`}>Pace</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {paceStatus === 'fire' ? (
                          <Flame className="h-5 w-5 animate-pulse text-amber-500" />
                        ) : paceStatus === 'cold' ? (
                          <TrendingDown className="h-5 w-5 text-red-500" />
                        ) : (
                          <TrendingUp className="h-5 w-5 text-emerald-500" />
                        )}
                        <Target className="h-5 w-5 text-sky-500" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                      <span className={`text-2xl font-bold lg:text-3xl ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{formatCurrency(eodGoal)}</span>
                      <span className={`text-xl font-light ${isDayMode ? 'text-slate-300' : 'text-slate-600'}`}>/</span>
                      <span className="text-2xl font-bold text-amber-500 lg:text-3xl">{formatCurrency(paceAdjusted)}</span>
                      <span className={`text-xs ${paceDelta >= 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {paceDelta >= 0 ? 'above pace' : 'needs push'}
                      </span>
                    </div>
                  </div>

                  <div className={`flex flex-1 min-h-0 flex-col rounded-2xl p-3 lg:p-4 ${isDayMode ? 'bg-slate-50' : 'bg-neutral-800'}`}>

                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      Hourly Sales
                    </h3>
                    {salesHours.some(h => h.projected > 0) && (
                      <div className={`flex items-center gap-4 text-[10px] font-semibold uppercase tracking-[0.14em] ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Actual
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm border border-amber-500/30 bg-amber-500/20" /> Projected
                        </span>
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {selectedHour && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className={`mb-4 rounded-xl border p-3 ${isDayMode ? 'border-slate-200 bg-white' : 'border-white/5 bg-neutral-900/60'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-semibold ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{selectedHour.label}</span>
                          <button type="button" onClick={() => setSelectedHour(null)}>
                            <X className={`h-3.5 w-3.5 ${isDayMode ? 'text-slate-400 hover:text-slate-900' : 'text-slate-500 hover:text-white'}`} />
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <div>
                            <p className={`text-[10px] uppercase tracking-[0.16em] ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>Sales</p>
                            <p className={`mt-1 text-sm font-semibold ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{formatCurrency(selectedHour.sales)}</p>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase tracking-[0.16em] ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>Projected</p>
                            <p className={`mt-1 text-sm font-semibold ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{selectedHour.projected > 0 ? formatCurrency(selectedHour.projected) : '—'}</p>
                          </div>
                          <div>
                            <p className={`text-[10px] uppercase tracking-[0.16em] ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>Pizzas</p>
                            <p className={`mt-1 text-sm font-semibold ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{selectedHour.estimatedPizzas > 0 ? selectedHour.estimatedPizzas : '—'}</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex-1 min-h-[200px]">
                    {salesHours.some(h => h.sales > 0) ? (
                      <HourlyChartRecharts hours={salesHours} formatCurrency={formatCurrency} isDayMode={isDayMode} />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <p className={`text-sm ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>No hourly data yet</p>
                      </div>
                    )}
                  </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 min-w-0">

                  <div className={`rounded-2xl p-3 ${isDayMode ? 'bg-slate-50' : 'bg-neutral-800'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`}>Labor</h3>
                        <div className="mt-2 flex items-end gap-2">
                          <span className={`text-3xl font-bold ${laborStatus === 'good' ? 'text-emerald-500' : laborStatus === 'warning' ? 'text-amber-500' : 'text-red-500'}`}>
                            {(cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborPercent : laborPercentage).toFixed(1)}%
                          </span>
                          <span className={`pb-1 text-xs ${laborStatus === 'good' ? 'text-emerald-500/80' : laborStatus === 'warning' ? 'text-amber-500/80' : 'text-red-500/80'}`}>
                            {laborStatus === 'good' ? 'on target' : laborStatus === 'warning' ? 'watching' : 'over target'}
                          </span>
                        </div>
                        <p className={`mt-1 text-xs ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {formatCurrency(cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborCost : (laborData?.laborCost || 0))} · {(laborData?.laborHours || 0).toFixed(1)}h · target {laborTarget}%
                        </p>
                      </div>
                        <div className={`rounded-full p-2 ${isDayMode ? 'bg-white' : 'bg-neutral-900/60'}`}>
                        <Gauge className={`h-5 w-5 ${laborStatus === 'good' ? 'text-emerald-500' : laborStatus === 'warning' ? 'text-amber-500' : 'text-red-500'}`} />
                      </div>
                    </div>

                  </div>

                  <div className={`flex min-h-0 flex-col rounded-2xl p-3 ${isDayMode ? 'bg-slate-50' : 'bg-neutral-800'}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`}>On The Line</h3>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={isDayMode ? 'bg-white text-slate-600' : 'bg-white/5 text-slate-300'}>
                          {activeShifts.length}
                        </Badge>
                        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${isDayMode ? 'bg-white' : 'bg-white/5'}`}>
                          <Scissors className={`h-3.5 w-3.5 ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`} />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 overflow-y-auto pr-1 max-h-[220px]">
                      {activeShifts.length === 0 ? (
                        <p className={`py-6 text-center text-sm ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>No one clocked in</p>
                      ) : (
                        activeShifts.map((shift) => {
                          const cut = getCutForEmployee(shift.userId);
                          const breakState = shift.isOnBreak && shift.breakStartTime ? getBreakReturnTime(shift.breakStartTime, shift.breakType) : null;
                          return (
                            <Popover
                              key={shift.userId}
                              open={selectedEmployee?.userId === shift.userId && showCutOptions}
                              onOpenChange={(open) => {
                                if (open) {
                                  setSelectedEmployee(shift);
                                  setShowCutOptions(true);
                                } else {
                                  setShowCutOptions(false);
                                  setSelectedEmployee(null);
                                  setCustomTime('');
                                }
                              }}
                            >
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-all ${
                                    shift.isOnBreak
                                      ? 'bg-amber-500/15'
                                      : cut
                                        ? 'bg-red-500/15 ring-1 ring-red-500/30'
                                        : isDayMode
                                          ? 'bg-white hover:bg-slate-100'
                                          : 'bg-neutral-900/50 hover:bg-neutral-900/80'
                                  }`}
                                >
                                  <Avatar className="h-8 w-8 shrink-0">
                                    <AvatarImage src={shift.profilePhoto || undefined} />
                                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                                      {shift.fullName.charAt(0)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className={`truncate text-sm font-medium ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{shift.fullName.split(' ')[0]}</p>
                                      {cut && (
                                        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                                          {cutsSaved
                                            ? cut.customEndTime
                                              ? `Out @ ${formatCustomTime(cut.customEndTime)}`
                                              : shift.scheduledEndTime
                                                ? `Out @ ${getNewClockOutTime(shift.scheduledEndTime, cut.minutesCut) || `−${cut.minutesCut}m`}`
                                                : `−${cut.minutesCut}m`
                                            : `−${cut.minutesCut}m`}
                                        </span>
                                      )}
                                    </div>
                                    <p className={`mt-0.5 truncate text-[10px] ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                      {shift.scheduledStartTime && shift.scheduledEndTime
                                        ? `${formatShiftTime(shift.scheduledStartTime)} - ${formatShiftTime(shift.scheduledEndTime)}`
                                        : shift.scheduledEndTime
                                          ? `until ${formatShiftTime(shift.scheduledEndTime)}`
                                          : shift.position || 'On the floor'}
                                    </p>
                                  </div>
                                  {breakState ? (
                                    <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-500">
                                      <Coffee className="h-3.5 w-3.5" />
                                      <span className={breakState.isOverdue ? 'text-red-500' : 'text-amber-500'}>{breakState.text}</span>
                                    </div>
                                  ) : (
                                    <Scissors className={`h-4 w-4 shrink-0 ${isDayMode ? 'text-slate-300' : 'text-slate-500'}`} />
                                  )}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className={`w-56 p-3 shadow-neumorphic-lg ${isDayMode ? 'border-slate-200 bg-white' : 'border-neutral-700 bg-neutral-900'}`} side="left">
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <h4 className={`text-sm font-semibold ${isDayMode ? 'text-slate-900' : 'text-white'}`}>Send Home Early</h4>
                                    {cut && (
                                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-500 hover:bg-red-500/20 hover:text-red-400" onClick={() => handleRemoveCut(shift.userId)}>
                                        Clear
                                      </Button>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    {[15, 30, 45, 60].map((mins) => (
                                      <Button
                                        key={mins}
                                        size="sm"
                                        variant={cut?.minutesCut === mins ? 'default' : 'outline'}
                                        className={`h-9 text-sm font-medium ${cut?.minutesCut === mins ? 'border-red-500 bg-red-500 text-white hover:bg-red-600' : isDayMode ? 'border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100' : 'border-neutral-600 bg-neutral-800 text-white hover:bg-neutral-700'}`}
                                        onClick={() => handleAddCut(shift, mins)}
                                      >
                                        -{mins === 60 ? '1hr' : `${mins}m`}
                                      </Button>
                                    ))}
                                  </div>
                                  <div className={`border-t pt-2 ${isDayMode ? 'border-slate-200' : 'border-neutral-700'}`}>
                                    <p className={`mb-2 text-xs ${isDayMode ? 'text-slate-400' : 'text-neutral-400'}`}>Custom end time:</p>
                                    <div className="flex gap-2">
                                      <Input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} className={`h-9 flex-1 text-sm ${isDayMode ? 'border-slate-200 bg-slate-50' : 'border-neutral-600 bg-neutral-800 text-white'}`} />
                                      <Button size="sm" variant="outline" className={`h-9 px-3 text-sm ${isDayMode ? 'border-slate-200 bg-slate-50 hover:bg-slate-100' : 'border-neutral-600 bg-neutral-800 text-white hover:bg-neutral-700'}`} onClick={() => handleCustomCut(shift)} disabled={!customTime}>
                                        Set
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          );
                        })
                      )}
                    </div>

                    {hasAnyCuts && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`mt-3 border-t pt-3 ${isDayMode ? 'border-slate-200' : 'border-white/5'}`}>
                        <Button size="sm" className={`h-9 w-full text-xs ${cutsSaved ? 'bg-green-500/20 text-green-600 hover:bg-green-500/30' : 'bg-red-500 text-white hover:bg-red-600'}`} onClick={() => setShowPreviewModal(true)}>
                          <Calculator className="mr-1.5 h-3.5 w-3.5" />
                          {cutsSaved ? 'View Cuts' : 'Preview Savings'}
                        </Button>
                      </motion.div>
                    )}
                  </div>

                  {/* Tasks / Checklists block (right column) */}
                  <div className={`rounded-2xl p-3 ${isDayMode ? 'bg-slate-50' : 'bg-neutral-800'}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDayMode ? 'text-slate-500' : 'text-slate-400'}`}>Checklists</h3>
                      <span className={`text-xs ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>
                        {checklistsData.filter((c: any) => c.isComplete).length} of {checklistsData.length || quickTasks.length || 0} done
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {checklistsData.slice(0, 5).map((checklist: any) => {
                        const completed = checklist.completedItems || 0;
                        const total = checklist.totalItems || 0;
                        const progressPct = total > 0 ? Math.round((completed / total) * 100) : checklist.isComplete ? 100 : 0;
                        const done = checklist.isComplete;
                        return (
                          <div key={checklist.id}>
                            <div className="mb-1 flex items-baseline justify-between gap-2">
                              <span className={`truncate text-xs font-medium ${isDayMode ? 'text-slate-900' : 'text-white'}`}>{checklist.title}</span>
                              <span className={`shrink-0 text-[10px] font-semibold ${done ? 'text-emerald-500' : 'text-amber-500'}`}>
                                {done ? 'done' : `${completed}/${total}`}
                              </span>
                            </div>
                            <div className={`h-1 w-full overflow-hidden rounded-full ${isDayMode ? 'bg-slate-200' : 'bg-white/5'}`}>
                              <div className={`h-full rounded-full ${done ? 'bg-emerald-400' : 'bg-amber-500'}`} style={{ width: `${progressPct}%` }} />
                            </div>
                          </div>
                        );
                      })}

                      {checklistsData.length === 0 && quickTasks.length > 0 && quickTasks.slice(0, 5).map((task: any) => (
                        <div key={task.id}>
                          <div className="mb-1 flex items-baseline justify-between gap-2">
                            <span className={`truncate text-xs font-medium ${task.isComplete ? (isDayMode ? 'text-slate-400 line-through' : 'text-slate-500 line-through') : isDayMode ? 'text-slate-900' : 'text-white'}`}>
                              {task.event_name}
                            </span>
                            <span className={`shrink-0 text-[10px] font-semibold ${task.isComplete ? 'text-emerald-500' : 'text-amber-500'}`}>
                              {task.isComplete ? 'done' : format(new Date(`2000-01-01T${task.event_time}`), 'h:mm a')}
                            </span>
                          </div>
                          <div className={`h-1 w-full overflow-hidden rounded-full ${isDayMode ? 'bg-slate-200' : 'bg-white/5'}`}>
                            <div className={`h-full rounded-full ${task.isComplete ? 'bg-emerald-400' : 'bg-amber-500'}`} style={{ width: `${task.isComplete ? 100 : 35}%` }} />
                          </div>
                        </div>
                      ))}

                      {checklistsData.length === 0 && quickTasks.length === 0 && (
                        <p className={`py-2 text-center text-xs ${isDayMode ? 'text-slate-400' : 'text-slate-500'}`}>No tasks today</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onPointerDown={(e) => { e.stopPropagation(); }}
                      onClick={(e) => { e.stopPropagation(); setShowTeamTasks(true); }}
                      className={`mt-3 w-full rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-all ${isDayMode ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-white text-neutral-900 hover:bg-neutral-200'}`}
                    >
                      Team Tasks
                    </button>
                  </div>
                </div>
              </div>

            </motion.div>
          </div>
        </div>

        {/* Labor Savings Preview Modal */}
        <Dialog 
          open={showPreviewModal} 
          onOpenChange={(open) => {
            setShowPreviewModal(open);
          }}
        >
          <DialogContent 
            className={`max-w-md ${isDayMode ? 'bg-card border-border text-foreground' : 'bg-neutral-900 border-neutral-700 text-white'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle className={`flex items-center gap-2 ${isDayMode ? 'text-foreground' : 'text-white'}`}>
                <Calculator className="h-5 w-5 text-primary" />
                Labor Savings Preview
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              {/* Employees being cut */}
              <div className="space-y-2">
                <h4 className={`text-sm font-medium ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>Employees Being Sent Home Early:</h4>
                {laborCuts.map(cut => {
                  const employee = activeShifts.find(s => s.userId === cut.userId);
                  if (!employee) return null;
                  const hoursSaved = cut.minutesCut / 60;
                  const costSaved = hoursSaved * (employee.hourlyWage || 16);
                  return (
                    <div key={cut.userId} className={`flex items-center justify-between p-2 rounded ${isDayMode ? 'bg-secondary' : 'bg-neutral-800'}`}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={employee.profilePhoto || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {employee.fullName.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className={`text-sm ${isDayMode ? 'text-foreground' : 'text-white'}`}>{employee.fullName}</span>
                      </div>
                      <div className="text-right">
                        <Badge className="bg-red-500/30 text-red-500 text-xs">-{cut.minutesCut}m</Badge>
                        <p className="text-green-500 text-xs mt-0.5">-{formatCurrency(costSaved)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Comparison */}
              <div className="grid grid-cols-2 gap-4">
                {/* Current Labor */}
                <div className={`p-4 rounded-lg text-center ${isDayMode ? 'bg-secondary' : 'bg-neutral-800'}`}>
                  <p className={`text-xs mb-1 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>Current Projected</p>
                  <p className={`text-2xl font-bold ${
                    calculateLaborSavings.currentLaborPercent > laborTarget ? 'text-red-500' : isDayMode ? 'text-foreground' : 'text-white'
                  }`}>
                    {calculateLaborSavings.currentLaborPercent.toFixed(1)}%
                  </p>
                  <p className={`text-xs mt-1 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-500'}`}>
                    {formatCurrency(calculateLaborSavings.currentLaborCost)}
                  </p>
                </div>
                
                {/* New Labor */}
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                  <p className="text-green-500/80 text-xs mb-1">After Cuts</p>
                  <p className={`text-2xl font-bold ${
                    calculateLaborSavings.newLaborPercent <= laborTarget ? 'text-green-500' : 'text-yellow-500'
                  }`}>
                    {calculateLaborSavings.newLaborPercent.toFixed(1)}%
                  </p>
                  <p className={`text-xs mt-1 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-500'}`}>
                    {formatCurrency(calculateLaborSavings.newLaborCost)}
                  </p>
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <div className="flex justify-between items-center">
                  <div>
                    <p className={`text-sm ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>Total Savings</p>
                    <p className="text-green-500 text-xl font-bold">
                      {formatCurrency(calculateLaborSavings.totalCostSaved)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>Labor % Saved</p>
                    <p className="text-green-500 text-xl font-bold">
                      -{calculateLaborSavings.percentSaved.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <p className={`text-xs mt-2 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-500'}`}>
                  {Math.floor(calculateLaborSavings.totalMinutesSaved / 60)}h {calculateLaborSavings.totalMinutesSaved % 60}m total hours cut
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className={`flex-1 ${isDayMode ? 'bg-secondary border-border hover:bg-secondary/80' : 'bg-neutral-800 border-neutral-700 text-white hover:bg-neutral-700'}`}
                  onClick={handleClearAllCuts}
                >
                  Clear All
                </Button>
                <Button
                  className={`flex-1 ${
                    cutsSaved 
                      ? 'bg-green-500 hover:bg-green-600' 
                      : 'bg-green-500 hover:bg-green-600'
                  }`}
                  onClick={handleSaveCuts}
                >
                  {cutsSaved ? 'Saved ✓' : 'Save Cuts'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>
      
      {/* Alarm Task Overlay - must be outside motion.div for proper z-index stacking */}
      <AlarmTaskOverlay locationId={locationId} />
    </>
  );
}
