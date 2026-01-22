import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, differenceInMinutes } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
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
  Clock, 
  TrendingUp, 
  TrendingDown,
  Users, 
  DollarSign, 
  Target,
  Flame,
  Coffee,
  CheckCircle2,
  ArrowLeftRight,
  X,
  Gauge,
  Scissors,
  Calculator,
  Circle
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
import { getTodayInTimezone, getDayOfWeekInTimezone, getTimezoneOffset } from '@/utils/timezoneUtils';
import { filterEventsByRole } from '@/utils/eventRoleFilter';
import { getCachedProjections, getCachedLiveSales } from '@/utils/salesCache';
import type { AppRole } from '@/hooks/useUserRole';


interface ManagerDashboardOverlayProps {
  locationId: string;
  timezone: string;
  onClose: () => void;
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
  hourlyWage?: number;
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
  formatCurrency 
}: { 
  hours: HourlyChartData[]; 
  formatCurrency: (value: number) => string;
}) {
  const chartData = hours.map(h => ({
    label: h.label,
    sales: h.sales,
    projected: h.projected,
  }));

  return (
    <div className="flex-1 min-h-0 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          barCategoryGap="15%"
          margin={{ top: 10, right: 5, left: -10, bottom: 5 }}
        >
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
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
                <div className="bg-slate-800 border border-white/20 rounded-md p-2 shadow-lg">
                  <p className="font-medium text-white text-sm">{label}</p>
                  <p className="text-white/60 text-xs">
                    Projected: <span className="text-white">{formatCurrency(data?.projected || 0)}</span>
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
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={2}
            fill="rgba(255,255,255,0.15)"
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
  onClose 
}: ManagerDashboardOverlayProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<ActiveShift | null>(null);
  const [showCutOptions, setShowCutOptions] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [selectedHour, setSelectedHour] = useState<SelectedHourInfo | null>(null);

  // Build storage key for labor cuts persistence
  const laborCutsStorageKey = useMemo(() => 
    `labor-cuts-${locationId}-${getTodayInTimezone(timezone)}`, 
    [locationId, timezone]
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

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = useMemo(() => getTodayInTimezone(timezone), [timezone]);

  // Fetch sales data from sales_cache
  const { data: salesData } = useQuery({
    queryKey: ['manager-dash-sales', locationId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data, projected_sales, pizza_count')
        .eq('location_id', locationId)
        .eq('sale_date', todayStr)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Refresh every minute
  });
  
  // Use the SAME query key as SalesSummary to get real projections and pace
  // This ensures we display EXACTLY what Dashboard shows
  const { data: dashboardSalesData } = useQuery<{
    daily: number;
    hourly?: Array<{ hour: string; sales: number; projected?: number; checksCount?: number }>;
    pizzaCount?: number | { daily: number; weekly: number; monthly: number };
    projections?: {
      todayProjected: number;
      todayPaceAdjusted?: number;
    };
  }>({
    queryKey: ['qubeyond-sales', locationId, todayStr],
    queryFn: () => Promise.resolve(undefined), // Placeholder - we read from cache only
    enabled: false, // Don't fetch, just read from cache if SalesSummary already populated it
    staleTime: Infinity, // Never consider stale since we're reading from cache
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
      const offset = getTimezoneOffset(timezone);
      const startOfDay = new Date(`${todayStr}T00:00:00${offset}`).toISOString();
      const endOfDayPlus = new Date(`${todayStr}T23:59:59${offset}`);
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
        .select('id, full_name, profile_photo_url, hourly_wage')
        .in('id', userIds);

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
          hourlyWage: profile?.hourly_wage || 16, // Default to $16/hr if not set
          scheduledStartTime: shiftInfo?.startTime || undefined,
          scheduledEndTime: shiftInfo?.endTime || undefined,
        } as ActiveShift;
      }).sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
    refetchInterval: 30000,
  });

  // Fetch labor data
  const { data: laborData } = useQuery({
    queryKey: ['manager-dash-labor', locationId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labor_cache')
        .select('labor_cost, labor_hours')
        .eq('location_id', locationId)
        .eq('labor_date', todayStr);

      if (error) throw error;

      // Sum up all labor sources
      const totalCost = (data || []).reduce((sum, row) => sum + (row.labor_cost || 0), 0);
      const totalHours = (data || []).reduce((sum, row) => sum + (row.labor_hours || 0), 0);
      return { laborCost: totalCost, laborHours: totalHours };
    },
    refetchInterval: 60000,
  });

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
      return filterEventsByRole(todayEvents, managerRole).slice(0, 5);
    },
  });

  // Fetch today's checklists with completion status
  const { data: checklistsData = [] } = useQuery({
    queryKey: ['manager-dash-checklists', locationId, todayStr],
    queryFn: async () => {
      // Get active checklists for this location
      const { data: checklists, error: checklistError } = await supabase
        .from('checklists')
        .select('id, title, frequency')
        .eq('location_id', locationId)
        .eq('is_active', true);

      if (checklistError) throw checklistError;
      if (!checklists?.length) return [];

      // Filter to daily/weekly checklists (most relevant for shift managers)
      const relevantChecklists = checklists.filter(c => {
        if (c.frequency === 'daily') return true;
        if (c.frequency === 'weekly') return true;
        return false;
      });

      // Get today's submissions
      const { data: submissions, error: subError } = await supabase
        .from('checklist_submissions')
        .select('checklist_id, id')
        .eq('location_id', locationId)
        .gte('submitted_at', `${todayStr}T00:00:00`)
        .lte('submitted_at', `${todayStr}T23:59:59`);

      if (subError) throw subError;

      const submittedIds = new Set((submissions || []).map(s => s.checklist_id));

      return relevantChecklists.map(c => ({
        id: c.id,
        title: c.title,
        frequency: c.frequency,
        isComplete: submittedIds.has(c.id),
      }));
    },
    refetchInterval: 60000,
  });

  // Calculate sales metrics from DB (actual sales from sales_cache table)
  const totalSales = Number(salesData?.net_sales) || 0;
  const hourlyData = (salesData?.hourly_data as unknown as HourlySale[] | null) || [];

  // Get REAL projections from localStorage cache (same source as Dashboard SalesSummary)
  // This is the SINGLE SOURCE OF TRUTH for projections - Dashboard writes to this cache
  const localStorageProjections = useMemo(() => {
    return getCachedProjections(locationId);
  }, [locationId]);
  
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
  const eodGoal = useMemo(() => {
    // First try localStorage cache - this is what Dashboard shows
    if (localStorageProjections?.todayProjected && localStorageProjections.todayProjected > 0) {
      return localStorageProjections.todayProjected;
    }
    
    // Fall back to React Query cache
    const liveProjected = cachedSalesOverviewData?.projections?.todayProjected;
    if (liveProjected && liveProjected > 0) return liveProjected;
    
    // Fall back to sales_cache.projected_sales
    return Number(salesData?.projected_sales) || 0;
  }, [localStorageProjections, cachedSalesOverviewData, salesData?.projected_sales]);
  
  // Pace Adjusted: use localStorage cache (SAME source as Dashboard SalesSummary)
  // CRITICAL: This is the TRUE pace number from Dashboard
  const paceAdjusted = useMemo(() => {
    // First try localStorage cache - this is EXACTLY what Dashboard shows
    if (localStorageProjections?.todayPaceAdjusted && localStorageProjections.todayPaceAdjusted > 0) {
      return localStorageProjections.todayPaceAdjusted;
    }
    
    // Fall back to React Query cache
    const livePace = cachedSalesOverviewData?.projections?.todayPaceAdjusted;
    if (livePace && livePace > 0) return livePace;
    
    // Fall back to EOD goal if no pace data (not totalSales which is wrong)
    return eodGoal;
  }, [localStorageProjections, cachedSalesOverviewData, eodGoal]);

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
    // Build a list of all hours up to current hour that have sales
    const hoursWithSales: Array<{
      hour: number;
      label: string;
      sales: number;
      projected: number;
      estimatedPizzas: number;
    }> = [];
    
    // Look at recent hours (from store open to current hour)
    for (let h = 0; h <= currentHour; h++) {
      const hourStr = `${String(h).padStart(2, '0')}:00`;
      const cachedHourData = cachedHourly?.find(
        hd => hd.hour.startsWith(String(h).padStart(2, '0')) || hd.hour === hourStr
      );
      const dbHourData = hourlyData.find(hd => hd.hour === hourStr);
      const hourData = cachedHourData || dbHourData;
      
      // Only include hours with actual sales recorded
      if (hourData && hourData.sales > 0) {
        const sales = hourData.sales || 0;
        // Calculate estimated pizzas proportionally (matching SalesOverview)
        const estimatedPizzas = totalHourlySales > 0 && pizzaCount > 0
          ? Math.round((sales / totalHourlySales) * pizzaCount * 10) / 10
          : 0;
        
        hoursWithSales.push({
          hour: h,
          label: h >= 12 ? `${h === 12 ? 12 : h - 12}PM` : `${h === 0 ? 12 : h}AM`,
          sales,
          projected: hourData.projected || 0,
          estimatedPizzas,
        });
      }
    }
    
    // Return up to 8 hours with sales
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

  const getBreakReturnTime = (breakStartTime: string) => {
    const breakStart = new Date(breakStartTime);
    const now = new Date();
    const minutesOnBreak = differenceInMinutes(now, breakStart);
    const expectedBreakLength = 30; // 30-minute break
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

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden"
      >
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-accent/10 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        {/* Swap Button - Bottom Center */}
        <button
          onClick={onClose}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-8 py-4 rounded-full bg-accent backdrop-blur-xl border border-accent-foreground/20 hover:bg-accent/80 transition-all group shadow-lg"
        >
          <ArrowLeftRight className="h-6 w-6 text-accent-foreground" />
          <span className="text-accent-foreground text-base font-medium">Punch Clock</span>
        </button>

        <div className="relative h-full p-4 flex flex-col">
          {/* Top Row: Sales Cards + Time + Employees */}
          <div className="flex-1 flex items-stretch gap-4 min-h-0">
            
            {/* Left Column - Sales & Labor */}
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex-1 flex flex-col gap-3"
            >
              {/* Sales Cards Row */}
              <div className="grid grid-cols-3 gap-1 sm:gap-2 lg:gap-3 xl:gap-4">
                {/* Total Sales */}
                <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                  <CardContent className="p-2 sm:p-3 lg:p-4 xl:p-5 text-center">
                    <DollarSign className="h-4 w-4 sm:h-6 sm:w-6 lg:h-8 lg:w-8 xl:h-10 xl:w-10 mx-auto mb-0.5 sm:mb-1 lg:mb-2 text-green-400" />
                    <p className="text-white/60 text-[10px] sm:text-xs lg:text-sm xl:text-base mb-0.5">Total Sales</p>
                    <p className="text-base sm:text-xl lg:text-2xl xl:text-3xl 2xl:text-4xl font-bold text-white">{formatCurrency(totalSales)}</p>
                  </CardContent>
                </Card>

                {/* EOD Goal */}
                <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                  <CardContent className="p-2 sm:p-3 lg:p-4 xl:p-5 text-center">
                    <Target className="h-4 w-4 sm:h-6 sm:w-6 lg:h-8 lg:w-8 xl:h-10 xl:w-10 mx-auto mb-0.5 sm:mb-1 lg:mb-2 text-blue-400" />
                    <p className="text-white/60 text-[10px] sm:text-xs lg:text-sm xl:text-base mb-0.5">EOD Goal</p>
                    <p className="text-base sm:text-xl lg:text-2xl xl:text-3xl 2xl:text-4xl font-bold text-white">{formatCurrency(eodGoal)}</p>
                  </CardContent>
                </Card>

                {/* Pace */}
                <Card className={`bg-white/10 backdrop-blur-xl border-white/20 ${
                  paceStatus === 'fire' ? 'ring-2 ring-orange-500/50' : ''
                }`}>
                  <CardContent className="p-2 sm:p-3 lg:p-4 xl:p-5 text-center">
                    {paceStatus === 'fire' ? (
                      <Flame className="h-4 w-4 sm:h-6 sm:w-6 lg:h-8 lg:w-8 xl:h-10 xl:w-10 mx-auto mb-0.5 sm:mb-1 lg:mb-2 text-orange-500 animate-pulse" />
                    ) : paceStatus === 'cold' ? (
                      <TrendingDown className="h-4 w-4 sm:h-6 sm:w-6 lg:h-8 lg:w-8 xl:h-10 xl:w-10 mx-auto mb-0.5 sm:mb-1 lg:mb-2 text-red-400" />
                    ) : (
                      <TrendingUp className="h-4 w-4 sm:h-6 sm:w-6 lg:h-8 lg:w-8 xl:h-10 xl:w-10 mx-auto mb-0.5 sm:mb-1 lg:mb-2 text-green-400" />
                    )}
                    <p className="text-white/60 text-[10px] sm:text-xs lg:text-sm xl:text-base mb-0.5">Pace</p>
                    <p className="text-base sm:text-xl lg:text-2xl xl:text-3xl 2xl:text-4xl font-bold text-amber-400">{formatCurrency(paceAdjusted)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Hourly Chart */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20 flex-1 min-h-[200px] lg:min-h-[300px] xl:min-h-[400px]">
                <CardContent className="p-2 sm:p-3 lg:p-4 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-1 lg:mb-2">
                    <h3 className="text-white/80 text-xs sm:text-sm lg:text-base font-semibold flex items-center gap-2">
                      <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                      Hourly Sales
                    </h3>
                    {/* Legend */}
                    {salesHours.some(h => h.projected > 0) && (
                      <div className="flex items-center gap-2 text-[9px] sm:text-[10px]">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-sm bg-primary" />
                          <span className="text-white/60">Actual</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-sm bg-muted-foreground/30" />
                          <span className="text-white/60">Projected</span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Selected Hour Info */}
                  <AnimatePresence>
                    {selectedHour && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mb-2 p-2 bg-white/10 rounded-lg border border-white/20"
                        onClick={() => setSelectedHour(null)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-white font-semibold text-sm">{selectedHour.label}</span>
                          <X className="h-3 w-3 text-white/60 cursor-pointer hover:text-white" onClick={() => setSelectedHour(null)} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <div className="text-center">
                            <p className="text-white/60 text-[9px]">Sales</p>
                            <p className="text-white font-bold text-sm">{formatCurrency(selectedHour.sales)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-white/60 text-[9px]">Projected</p>
                            <p className="text-white/80 font-bold text-sm">
                              {selectedHour.projected > 0 ? formatCurrency(selectedHour.projected) : '—'}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-white/60 text-[9px]">🍕</p>
                            <p className="text-white/80 font-bold text-sm">
                              {selectedHour.estimatedPizzas > 0 ? selectedHour.estimatedPizzas : '—'}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  {salesHours.some(h => h.sales > 0) ? (
                    <HourlyChartRecharts 
                      hours={salesHours} 
                      formatCurrency={formatCurrency}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-white/40 text-xs sm:text-sm lg:text-base">No hourly data yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Center Column - Time Display with contrasting style */}
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="flex flex-col items-center justify-start px-4 lg:px-6 pt-2"
            >
              {/* Clock section with accent contrast */}
              <div className="relative px-6 sm:px-10 py-4 sm:py-6 rounded-2xl bg-gradient-to-br from-primary/30 via-primary/20 to-accent/20 border border-primary/40 shadow-xl">
                {/* Inner glow */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-transparent to-white/5" />
                
                {/* Content */}
                <div className="relative flex flex-col items-center gap-1 sm:gap-2">
                  <div className="flex items-center gap-2 sm:gap-4">
                    <Clock className="h-6 w-6 sm:h-8 sm:w-8 lg:h-10 lg:w-10 text-primary drop-shadow-lg" />
                    <span 
                      className="text-3xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight"
                      style={{ 
                        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      }}
                    >
                      {formatTimeDisplay(currentTime)}
                    </span>
                  </div>
                  <p className="text-white/60 text-xs sm:text-sm font-medium tracking-wide">
                    {format(currentTime, 'EEEE, MMMM d')}
                  </p>
                </div>
              </div>

              {/* Labor Section - Redesigned for clarity */}
              <Card className="bg-white/10 border-white/20 mt-4 w-full max-w-sm">
                <CardContent className="p-4 lg:p-5">
                  {/* Header with status indicator */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white text-sm lg:text-base font-semibold flex items-center gap-2">
                      <Gauge className="h-4 w-4 lg:h-5 lg:w-5" />
                      Labor
                    </h3>
                    {cutsSaved && hasAnyCuts && (
                      <Badge className="bg-green-500/20 text-green-300 text-xs px-2">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Cuts Active
                      </Badge>
                    )}
                  </div>
                  
                  {/* Large percentage display with status */}
                  <div className="text-center mb-4">
                    <div className="flex items-center justify-center gap-3">
                      {cutsSaved && hasAnyCuts ? (
                        <>
                          <span className="text-white/40 line-through text-2xl lg:text-3xl">
                            {laborPercentage.toFixed(1)}%
                          </span>
                          <span className="text-green-400 font-bold text-4xl lg:text-5xl">
                            {calculateLaborSavings.newLaborPercent.toFixed(1)}%
                          </span>
                        </>
                      ) : (
                        <span className={`font-bold text-4xl lg:text-5xl ${
                          laborStatus === 'good' ? 'text-green-400' : laborStatus === 'warning' ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {laborPercentage.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    
                    {/* Status message */}
                    <div className="mt-2">
                      {(() => {
                        const currentPercent = cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborPercent : laborPercentage;
                        const diff = currentPercent - laborTarget;
                        if (diff <= -3) {
                          return <span className="text-green-400 text-sm font-medium">🎯 {Math.abs(diff).toFixed(1)}% under target</span>;
                        } else if (diff <= 0) {
                          return <span className="text-green-400 text-sm font-medium">✓ On target</span>;
                        } else if (diff <= 3) {
                          return <span className="text-yellow-400 text-sm font-medium">⚠️ {diff.toFixed(1)}% over target</span>;
                        } else {
                          return <span className="text-red-400 text-sm font-medium">🔥 {diff.toFixed(1)}% over – cut labor!</span>;
                        }
                      })()}
                    </div>
                  </div>
                  
                  {/* Cost and Hours - side by side */}
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/10">
                    <div className="text-center">
                      <p className="text-white/50 text-xs mb-1">Cost</p>
                      <p className="text-xl lg:text-2xl font-bold text-white">
                        {formatCurrency(cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborCost : (laborData?.laborCost || 0))}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-white/50 text-xs mb-1">Hours</p>
                      <p className="text-xl lg:text-2xl font-bold text-white">
                        {(laborData?.laborHours || 0).toFixed(1)}
                      </p>
                    </div>
                  </div>
                  
                  {/* Visual labor gauge bar */}
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="relative h-3 rounded-full bg-white/10 overflow-hidden">
                      {/* Color zones */}
                      <div className="absolute inset-0 flex">
                        <div className="h-full bg-green-500/30" style={{ width: `${(laborTarget / 40) * 100}%` }} />
                        <div className="h-full bg-yellow-500/30" style={{ width: `${((laborTarget + 3) / 40 * 100) - (laborTarget / 40 * 100)}%` }} />
                        <div className="flex-1 bg-red-500/30" />
                      </div>
                      {/* Current value indicator */}
                      <div 
                        className={`absolute top-0 bottom-0 rounded-full transition-all ${
                          laborStatus === 'good' ? 'bg-green-500' : laborStatus === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ 
                          width: `${Math.min((cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborPercent : laborPercentage) / 40 * 100, 100)}%` 
                        }}
                      />
                      {/* Target marker */}
                      <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-white"
                        style={{ left: `${(laborTarget / 40) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-white/40 text-[10px]">0%</span>
                      <span className="text-white/60 text-[10px] font-medium">Target: {laborTarget}%</span>
                      <span className="text-white/40 text-[10px]">40%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Right Column - Employees & Tasks */}
            <motion.div
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="flex-1 flex flex-col gap-2 lg:gap-3"
            >
              {/* Active Shifts - 50% height, scrollable */}
              <Card className="bg-white/10 border-white/20 flex-1 min-h-0">
                <CardContent className="p-2 sm:p-3 lg:p-4 h-full flex flex-col">
                  <h3 className="text-white/80 text-xs sm:text-sm font-semibold mb-1 sm:mb-2 flex items-center gap-1 sm:gap-2">
                    <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                    On The Clock
                    <Badge variant="secondary" className="ml-auto bg-primary/20 text-primary text-[10px] sm:text-xs">
                      {activeShifts.length}
                    </Badge>
                  </h3>
                  <div className="space-y-1 sm:space-y-1.5 flex-1 overflow-y-auto">
                    {activeShifts.length === 0 ? (
                      <p className="text-white/40 text-center py-4 text-xs sm:text-sm">No one clocked in</p>
                    ) : (
                      activeShifts.slice(0, 6).map((shift) => {
                        const cut = getCutForEmployee(shift.userId);
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
                              <div
                                className={`flex items-center gap-2 p-1.5 lg:p-2 rounded-lg cursor-pointer transition-all hover:bg-white/10 ${
                                  shift.isOnBreak 
                                    ? 'bg-amber-500/20' 
                                    : cut 
                                      ? 'bg-red-500/20 ring-1 ring-red-500/50' 
                                      : 'bg-white/5'
                                }`}
                              >
                                <Avatar className="h-6 w-6 lg:h-8 lg:w-8">
                                  <AvatarImage src={shift.profilePhoto || undefined} />
                                  <AvatarFallback className="bg-primary/20 text-primary text-[10px] lg:text-xs">
                                    {shift.fullName.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1">
                                    <p className="text-white text-xs lg:text-sm font-medium truncate">
                                      {shift.fullName.split(' ')[0]}
                                    </p>
                                    {cut && (
                                      <Badge 
                                        variant="secondary" 
                                        className="bg-red-500/30 text-red-300 text-[9px] lg:text-[10px] px-1 py-0"
                                      >
                                        {cutsSaved 
                                          ? cut.customEndTime 
                                            ? `Out @ ${formatCustomTime(cut.customEndTime)}`
                                            : shift.scheduledEndTime
                                              ? `Out @ ${getNewClockOutTime(shift.scheduledEndTime, cut.minutesCut) || `−${cut.minutesCut}m`}`
                                              : `−${cut.minutesCut}m`
                                          : `−${cut.minutesCut}m`
                                        }
                                      </Badge>
                                    )}
                                  </div>
                                  {/* Show scheduled shift times */}
                                  {(shift.scheduledStartTime || shift.scheduledEndTime) && !cut && (
                                    <p className="text-white/40 text-[9px] lg:text-[10px]">
                                      {shift.scheduledStartTime && shift.scheduledEndTime 
                                        ? `${formatShiftTime(shift.scheduledStartTime)} - ${formatShiftTime(shift.scheduledEndTime)}`
                                        : shift.scheduledEndTime 
                                          ? `until ${formatShiftTime(shift.scheduledEndTime)}`
                                          : ''
                                      }
                                    </p>
                                  )}
                                </div>
                                {shift.isOnBreak && shift.breakStartTime ? (
                                  <div className="flex items-center gap-1">
                                    <Coffee className="h-3 w-3 lg:h-4 lg:w-4 text-amber-400" />
                                    <span className={`text-[9px] lg:text-[10px] font-bold ${
                                      getBreakReturnTime(shift.breakStartTime).isOverdue 
                                        ? 'text-red-400' 
                                        : 'text-amber-300'
                                    }`}>
                                      {getBreakReturnTime(shift.breakStartTime).text}
                                    </span>
                                  </div>
                                ) : (
                                  <Scissors className="h-3 w-3 lg:h-4 lg:w-4 text-white/40" />
                                )}
                              </div>
                            </PopoverTrigger>
                            <PopoverContent 
                              className="w-56 p-3 !bg-slate-900/95 !backdrop-blur-xl border-white/20 shadow-2xl"
                              side="left"
                            >
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-white font-semibold text-sm">Send Home Early</h4>
                                  {cut && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/20 px-2"
                                      onClick={() => handleRemoveCut(shift.userId)}
                                    >
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
                                      className={`text-sm h-9 font-medium ${
                                        cut?.minutesCut === mins 
                                          ? 'bg-red-500 hover:bg-red-600 text-white border-red-500' 
                                          : 'bg-white/10 border-white/30 text-white hover:bg-white/20'
                                      }`}
                                      onClick={() => handleAddCut(shift, mins)}
                                    >
                                      -{mins === 60 ? '1hr' : `${mins}m`}
                                    </Button>
                                  ))}
                                </div>
                                <div className="pt-2 border-t border-white/20">
                                  <p className="text-white/70 text-xs mb-2">Custom end time:</p>
                                  <div className="flex gap-2">
                                    <Input
                                      type="time"
                                      value={customTime}
                                      onChange={(e) => setCustomTime(e.target.value)}
                                      className="bg-white/10 border-white/30 text-white text-sm h-9 flex-1"
                                    />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="bg-white/10 border-white/30 text-white hover:bg-white/20 h-9 px-3 text-sm"
                                      onClick={() => handleCustomCut(shift)}
                                      disabled={!customTime}
                                    >
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
                    {/* Show scroll indicator if more than 6 */}
                    {activeShifts.length > 6 && (
                      <p className="text-white/40 text-center text-[9px] pt-1">
                        +{activeShifts.length - 6} more (scroll to see)
                      </p>
                    )}
                  </div>
                  
                  {/* Labor Savings Preview Button */}
                  {hasAnyCuts && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 pt-2 border-t border-white/10"
                    >
                      <Button
                        size="sm"
                        className={`w-full h-7 text-[10px] ${
                          cutsSaved 
                            ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30' 
                            : 'bg-gradient-to-r from-red-500 to-orange-500 text-white hover:from-red-600 hover:to-orange-600'
                        }`}
                        onClick={() => {
                          setShowPreviewModal(true);
                        }}
                      >
                        <Calculator className="h-3 w-3 mr-1" />
                        {cutsSaved ? 'View Cuts' : 'Preview Savings'}
                      </Button>
                    </motion.div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Tasks - 50% height */}
              <Card className="bg-white/10 border-white/20 flex-1 min-h-0">
                <CardContent className="p-2 sm:p-3 h-full flex flex-col">
                  <h3 className="text-white/80 text-xs sm:text-sm font-semibold mb-1 sm:mb-2 flex items-center gap-1 sm:gap-2">
                    <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    Tasks
                    {quickTasks.length > 0 && (
                      <Badge variant="secondary" className="ml-auto bg-white/10 text-white/60 text-[10px]">
                        {quickTasks.length}
                      </Badge>
                    )}
                  </h3>
                  <div className="space-y-1 flex-1 overflow-y-auto">
                    {/* Events section */}
                    {quickTasks.length > 0 && (
                      <div className="mb-2">
                        <p className="text-white/40 text-[9px] uppercase tracking-wide mb-1">Events</p>
                        {quickTasks.slice(0, 4).map((task: any) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 rounded bg-white/5 mb-1"
                          >
                            <div className="w-0.5 h-4 sm:h-5 rounded-full bg-primary" />
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-[10px] sm:text-xs font-medium truncate">
                                {task.event_name}
                              </p>
                            </div>
                            <span className="text-white/50 text-[9px] sm:text-[10px] font-medium">
                              {format(new Date(`2000-01-01T${task.event_time}`), 'h:mm a')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Checklists section */}
                    {checklistsData.length > 0 && (
                      <div>
                        <p className="text-white/40 text-[9px] uppercase tracking-wide mb-1">Checklists</p>
                        {checklistsData.slice(0, 4).map((checklist: any) => (
                          <div
                            key={checklist.id}
                            className="flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 rounded bg-white/5 mb-1"
                          >
                            {checklist.isComplete ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`text-[10px] sm:text-xs font-medium truncate ${
                                checklist.isComplete ? 'text-white/50 line-through' : 'text-white'
                              }`}>
                                {checklist.title}
                              </p>
                            </div>
                            <Badge 
                              variant="secondary" 
                              className={`text-[8px] px-1.5 py-0 ${
                                checklist.isComplete 
                                  ? 'bg-green-500/20 text-green-300' 
                                  : 'bg-white/10 text-white/50'
                              }`}
                            >
                              {checklist.isComplete ? '✓' : checklist.frequency}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* Empty state */}
                    {quickTasks.length === 0 && checklistsData.length === 0 && (
                      <p className="text-white/40 text-center py-4 text-[10px] sm:text-xs">No tasks today</p>
                    )}
                  </div>
                </CardContent>
              </Card>
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
            className="bg-slate-900 border-white/20 text-white max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Calculator className="h-5 w-5 text-primary" />
                Labor Savings Preview
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              {/* Employees being cut */}
              <div className="space-y-2">
                <h4 className="text-white/60 text-sm font-medium">Employees Being Sent Home Early:</h4>
                {laborCuts.map(cut => {
                  const employee = activeShifts.find(s => s.userId === cut.userId);
                  if (!employee) return null;
                  const hoursSaved = cut.minutesCut / 60;
                  const costSaved = hoursSaved * (employee.hourlyWage || 16);
                  return (
                    <div key={cut.userId} className="flex items-center justify-between p-2 rounded bg-white/5">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={employee.profilePhoto || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {employee.fullName.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-white text-sm">{employee.fullName}</span>
                      </div>
                      <div className="text-right">
                        <Badge className="bg-red-500/30 text-red-300 text-xs">-{cut.minutesCut}m</Badge>
                        <p className="text-green-400 text-xs mt-0.5">-{formatCurrency(costSaved)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Comparison */}
              <div className="grid grid-cols-2 gap-4">
                {/* Current Labor */}
                <div className="p-4 rounded-lg bg-white/5 text-center">
                  <p className="text-white/60 text-xs mb-1">Current Projected</p>
                  <p className={`text-2xl font-bold ${
                    calculateLaborSavings.currentLaborPercent > laborTarget ? 'text-red-400' : 'text-white'
                  }`}>
                    {calculateLaborSavings.currentLaborPercent.toFixed(1)}%
                  </p>
                  <p className="text-white/40 text-xs mt-1">
                    {formatCurrency(calculateLaborSavings.currentLaborCost)}
                  </p>
                </div>
                
                {/* New Labor */}
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                  <p className="text-green-400/80 text-xs mb-1">After Cuts</p>
                  <p className={`text-2xl font-bold ${
                    calculateLaborSavings.newLaborPercent <= laborTarget ? 'text-green-400' : 'text-yellow-400'
                  }`}>
                    {calculateLaborSavings.newLaborPercent.toFixed(1)}%
                  </p>
                  <p className="text-white/40 text-xs mt-1">
                    {formatCurrency(calculateLaborSavings.newLaborCost)}
                  </p>
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 rounded-lg bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-white/60 text-sm">Total Savings</p>
                    <p className="text-green-400 text-xl font-bold">
                      {formatCurrency(calculateLaborSavings.totalCostSaved)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/60 text-sm">Labor % Saved</p>
                    <p className="text-green-400 text-xl font-bold">
                      -{calculateLaborSavings.percentSaved.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <p className="text-white/40 text-xs mt-2">
                  {Math.floor(calculateLaborSavings.totalMinutesSaved / 60)}h {calculateLaborSavings.totalMinutesSaved % 60}m total hours cut
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 bg-white/5 border-white/20 text-white hover:bg-white/10"
                  onClick={handleClearAllCuts}
                >
                  Clear All
                </Button>
                <Button
                  className={`flex-1 ${
                    cutsSaved 
                      ? 'bg-green-500 hover:bg-green-600' 
                      : 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600'
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
    </AnimatePresence>
  );
}
