import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, differenceInMinutes, differenceInHours, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
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
  X,
  Gauge,
  Scissors,
  Calculator,
  ChevronRight
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import type { AppRole } from '@/hooks/useUserRole';
import { getCachedLiveSales, getCachedProjections } from '@/utils/salesCache';

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
  scheduledEndTime?: string; // HH:mm format from shift template
}

interface HourlySale {
  hour: string;
  sales: number;
  projected?: number;
}

interface LaborCut {
  userId: string;
  minutesCut: number;
  customEndTime?: string;
}

export function ManagerDashboardOverlay({ 
  locationId, 
  timezone, 
  onClose 
}: ManagerDashboardOverlayProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [countdown, setCountdown] = useState(60);
  const [laborCuts, setLaborCuts] = useState<LaborCut[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<ActiveShift | null>(null);
  const [showCutOptions, setShowCutOptions] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [cutsSaved, setCutsSaved] = useState(false);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      setCountdown(prev => {
        if (prev <= 1) {
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [onClose]);

  const todayStr = useMemo(() => getTodayInTimezone(timezone), [timezone]);

  // Fetch sales data
  const { data: salesData } = useQuery({
    queryKey: ['manager-dash-sales', locationId, todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data, projected_sales')
        .eq('location_id', locationId)
        .eq('sale_date', todayStr)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Refresh every minute
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

      // Get today's shifts for positions and end times
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, template:shift_templates(position, end_time)')
        .eq('shift_date', todayStr)
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));
      const shiftMap = new Map((shifts || []).map(s => [s.user_id, { 
        position: s.template?.position, 
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

  // Calculate sales metrics from DB
  const totalSales = Number(salesData?.net_sales) || 0;
  const hourlyData = (salesData?.hourly_data as unknown as HourlySale[] | null) || [];

  // Get pace and EOD goal from the same cache SalesOverview uses
  // This ensures Manager Dashboard shows EXACTLY the same numbers as the Dashboard
  const cachedLiveSales = useMemo(() => getCachedLiveSales(locationId), [locationId]);
  const cachedProjections = useMemo(() => getCachedProjections(locationId), [locationId]);
  
  // EOD Goal: prefer cachedLiveSales.projections.todayProjected, fall back to sales_cache.projected_sales
  const eodGoal = useMemo(() => {
    // First try cached live sales (same source as SalesOverview)
    const liveProjected = cachedLiveSales?.data?.projections?.todayProjected;
    if (liveProjected && liveProjected > 0) return liveProjected;
    
    // Then try projection cache
    const cachedProjected = cachedProjections?.todayProjected;
    if (cachedProjected && cachedProjected > 0) return cachedProjected;
    
    // Fall back to sales_cache.projected_sales
    return Number(salesData?.projected_sales) || 0;
  }, [cachedLiveSales, cachedProjections, salesData?.projected_sales]);
  
  // Pace Adjusted: get from cache (same source as SalesOverview)
  const paceAdjusted = useMemo(() => {
    // First try cached live sales (same source as SalesOverview)
    const livePace = cachedLiveSales?.data?.projections?.todayPaceAdjusted;
    if (livePace && livePace > 0) return livePace;
    
    // Then try projection cache
    const cachedPace = cachedProjections?.todayPaceAdjusted;
    if (cachedPace && cachedPace > 0) return cachedPace;
    
    // Fall back to actual sales if no pace data
    return totalSales;
  }, [cachedLiveSales, cachedProjections, totalSales]);

  // Get last 4 hours of sales
  const currentHour = new Date(currentTime.toLocaleString('en-US', { timeZone: timezone })).getHours();
  const last4Hours = Array.from({ length: 4 }, (_, i) => {
    const hour = currentHour - 3 + i;
    const hourStr = `${String(hour).padStart(2, '0')}:00`;
    const hourData = hourlyData.find(h => h.hour === hourStr);
    return {
      hour: hour,
      label: hour >= 12 ? `${hour === 12 ? 12 : hour - 12}PM` : `${hour === 0 ? 12 : hour}AM`,
      sales: hourData?.sales || 0,
    };
  }).filter(h => h.hour >= 0 && h.hour <= 23);

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

  // Find max hourly sale for scaling
  const maxHourlySale = Math.max(...last4Hours.map(h => h.sales), 1);

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
    // Reset countdown when interacting
    setCountdown(60);
  };

  const handleCustomCut = (employee: ActiveShift) => {
    if (!customTime) return;
    const now = new Date();
    const [hours, minutes] = customTime.split(':').map(Number);
    const endTime = new Date(now);
    endTime.setHours(hours, minutes, 0, 0);
    
    const minutesCut = differenceInMinutes(now, endTime);
    if (minutesCut > 0) {
      handleAddCut(employee, minutesCut);
    }
  };

  const handleRemoveCut = (userId: string) => {
    setLaborCuts(prev => prev.filter(c => c.userId !== userId));
    setCountdown(60);
  };

  const handleClearAllCuts = () => {
    setLaborCuts([]);
    setCutsSaved(false);
    setShowPreviewModal(false);
    setCountdown(60);
  };

  const handleSaveCuts = () => {
    setCutsSaved(true);
    setShowPreviewModal(false);
    setCountdown(60);
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

  const hasPendingCuts = laborCuts.length > 0 && !cutsSaved;
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

        {/* Close Button - Top Right */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex items-center gap-3 px-4 py-2 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 hover:bg-white/20 transition-all group"
        >
          <div className="relative w-8 h-8">
            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 40 40">
              <circle
                cx="20"
                cy="20"
                r="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-white/20"
              />
              <circle
                cx="20"
                cy="20"
                r="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={106.8}
                strokeDashoffset={106.8 - (countdown / 60) * 106.8}
                className="text-primary transition-all duration-1000"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
              {countdown}
            </span>
          </div>
          <X className="h-6 w-6 text-white/70 group-hover:text-white transition-colors" />
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
                <CardContent className="p-2 sm:p-4 lg:p-6 h-full flex flex-col">
                  <h3 className="text-white/80 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold mb-2 lg:mb-4 flex items-center gap-2">
                    <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 xl:h-6 xl:w-6" />
                    Last 4 Hours
                  </h3>
                  {last4Hours.length > 0 && last4Hours.some(h => h.sales > 0) ? (
                    <div className="flex items-end justify-around gap-2 sm:gap-3 lg:gap-4 xl:gap-6 flex-1 pb-2">
                      {last4Hours.map((hour, i) => {
                        const barHeightPercent = maxHourlySale > 0 ? (hour.sales / maxHourlySale) * 100 : 0;
                        return (
                          <div
                            key={hour.hour}
                            className="flex flex-col items-center flex-1 h-full"
                          >
                            <span className="text-white font-bold text-[10px] sm:text-xs lg:text-sm xl:text-base 2xl:text-lg mb-1 lg:mb-2">
                              {formatCurrency(hour.sales)}
                            </span>
                            <div className="w-full flex-1 bg-white/10 rounded-t-lg overflow-hidden relative min-h-[50px]">
                              <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: `${barHeightPercent}%` }}
                                transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-primary to-primary/60 rounded-t-lg"
                              />
                            </div>
                            <span className="text-white/60 text-[10px] sm:text-xs lg:text-sm xl:text-base mt-1 lg:mt-2">{hour.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-white/40 text-xs sm:text-sm lg:text-base xl:text-lg">No hourly data yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Center Column - Time Display */}
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.05 }}
              className="flex flex-col items-center justify-center px-6"
            >
              <div className="relative">
                {/* Liquid Glass container */}
                <div className="relative px-6 sm:px-10 py-3 sm:py-5 rounded-3xl overflow-hidden">
                  {/* Glass background layers */}
                  <div className="absolute inset-0 bg-white/[0.08] backdrop-blur-2xl rounded-3xl" />
                  <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-white/5 rounded-3xl" />
                  <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/[0.03] to-white/10 rounded-3xl" />
                  
                  {/* Inner glow effect */}
                  <div className="absolute inset-[1px] rounded-3xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),inset_0_-1px_1px_rgba(0,0,0,0.1)]" />
                  
                  {/* Subtle border */}
                  <div className="absolute inset-0 rounded-3xl border border-white/20" />
                  
                  {/* Light reflection */}
                  <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                  
                  {/* Content */}
                  <div className="relative flex flex-col items-center gap-1 sm:gap-2">
                    <div className="flex items-center gap-2 sm:gap-4">
                      <Clock className="h-6 w-6 sm:h-10 sm:w-10 text-white/80 drop-shadow-lg" />
                      <span 
                        className="text-4xl sm:text-7xl font-light text-white tracking-tight drop-shadow-2xl"
                        style={{ 
                          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                          textShadow: '0 2px 20px rgba(255,255,255,0.15)'
                        }}
                      >
                        {formatTimeDisplay(currentTime)}
                      </span>
                    </div>
                    <p className="text-white/50 text-xs sm:text-sm font-light tracking-wide">
                      {format(currentTime, 'EEEE, MMMM d')}
                    </p>
                  </div>
                </div>
                
                {/* Ambient glow behind the glass */}
                <div className="absolute -inset-4 bg-primary/20 rounded-full blur-3xl -z-10 opacity-50" />
              </div>

              {/* Labor Section - Below Time */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20 mt-4 w-full max-w-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white/80 text-sm font-semibold flex items-center gap-2">
                      <Gauge className="h-4 w-4" />
                      Labor
                      {cutsSaved && hasAnyCuts && (
                        <Badge className="bg-green-500/20 text-green-300 text-xs">
                          Cuts
                        </Badge>
                      )}
                    </h3>
                    <Badge 
                      className={`text-xs ${
                        laborStatus === 'good' 
                          ? 'bg-green-500/20 text-green-300' 
                          : laborStatus === 'warning'
                            ? 'bg-yellow-500/20 text-yellow-300'
                            : 'bg-red-500/20 text-red-300'
                      }`}
                    >
                      Target: {laborTarget}%
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-white/60">Current</span>
                        <div className="flex items-center gap-1">
                          {cutsSaved && hasAnyCuts ? (
                            <>
                              <span className="text-white/40 line-through text-xs">
                                {laborPercentage.toFixed(1)}%
                              </span>
                              <span className="text-green-400 font-bold">
                                {calculateLaborSavings.newLaborPercent.toFixed(1)}%
                              </span>
                            </>
                          ) : (
                            <span className={`font-bold ${
                              laborStatus === 'good' ? 'text-green-400' : laborStatus === 'warning' ? 'text-yellow-400' : 'text-red-400'
                            }`}>
                              {laborPercentage.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <Progress 
                        value={Math.min(cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborPercent : laborPercentage, 40)} 
                        max={40}
                        className="h-2 bg-white/10"
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-white/60 text-xs">Cost</p>
                      <p className="text-lg font-bold text-white">
                        {formatCurrency(cutsSaved && hasAnyCuts ? calculateLaborSavings.newLaborCost : (laborData?.laborCost || 0))}
                      </p>
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
              className="flex-1 flex flex-col gap-2 sm:gap-3 lg:gap-4"
            >
              {/* Active Shifts */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20 flex-1">
                <CardContent className="p-2 sm:p-3 lg:p-4 xl:p-5 h-full flex flex-col">
                  <h3 className="text-white/80 text-xs sm:text-sm lg:text-base xl:text-lg font-semibold mb-1 sm:mb-2 lg:mb-3 flex items-center gap-1 sm:gap-2">
                    <Users className="h-3 w-3 sm:h-4 sm:w-4 lg:h-5 lg:w-5 xl:h-6 xl:w-6" />
                    On The Clock
                    <Badge variant="secondary" className="ml-auto bg-primary/20 text-primary text-[10px] sm:text-xs lg:text-sm">
                      {activeShifts.length}
                    </Badge>
                  </h3>
                  <div className="space-y-1 sm:space-y-1.5 lg:space-y-2 xl:space-y-3 flex-1 overflow-y-auto">
                    {activeShifts.length === 0 ? (
                      <p className="text-white/40 text-center py-4 text-xs sm:text-sm lg:text-base">No one clocked in</p>
                    ) : (
                      activeShifts.map((shift) => {
                        const cut = getCutForEmployee(shift.userId);
                        return (
                          <Popover 
                            key={shift.userId}
                            open={selectedEmployee?.userId === shift.userId && showCutOptions}
                            onOpenChange={(open) => {
                              if (open) {
                                setSelectedEmployee(shift);
                                setShowCutOptions(true);
                                setCountdown(60);
                              } else {
                                setShowCutOptions(false);
                                setSelectedEmployee(null);
                                setCustomTime('');
                              }
                            }}
                          >
                            <PopoverTrigger asChild>
                              <div
                                className={`flex items-center gap-2 lg:gap-3 p-1.5 lg:p-2 xl:p-3 rounded-lg cursor-pointer transition-all hover:bg-white/10 ${
                                  shift.isOnBreak 
                                    ? 'bg-amber-500/20' 
                                    : cut 
                                      ? 'bg-red-500/20 ring-1 ring-red-500/50' 
                                      : 'bg-white/5'
                                }`}
                              >
                                <Avatar className="h-7 w-7 lg:h-9 lg:w-9 xl:h-11 xl:w-11">
                                  <AvatarImage src={shift.profilePhoto || undefined} />
                                  <AvatarFallback className="bg-primary/20 text-primary text-xs lg:text-sm xl:text-base">
                                    {shift.fullName.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1 lg:gap-2">
                                    <p className="text-white text-xs lg:text-sm xl:text-base font-medium truncate">
                                      {shift.fullName.split(' ')[0]}
                                    </p>
                                    {cut && (
                                      <Badge 
                                        variant="secondary" 
                                        className="bg-red-500/30 text-red-300 text-[10px] lg:text-xs px-1 py-0"
                                      >
                                        {cutsSaved && shift.scheduledEndTime 
                                          ? `Out @ ${getNewClockOutTime(shift.scheduledEndTime, cut.minutesCut) || `−${cut.minutesCut}m`}`
                                          : `−${cut.minutesCut}m`
                                        }
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                {shift.isOnBreak && shift.breakStartTime ? (
                                  <div className="flex items-center gap-1 lg:gap-2">
                                    <Coffee className="h-3 w-3 lg:h-4 lg:w-4 xl:h-5 xl:w-5 text-amber-400" />
                                    <span className={`text-[10px] lg:text-xs xl:text-sm font-bold ${
                                      getBreakReturnTime(shift.breakStartTime).isOverdue 
                                        ? 'text-red-400' 
                                        : 'text-amber-300'
                                    }`}>
                                      {getBreakReturnTime(shift.breakStartTime).text}
                                    </span>
                                  </div>
                                ) : (
                                  <Scissors className="h-3 w-3 lg:h-4 lg:w-4 xl:h-5 xl:w-5 text-white/40" />
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
                        className={`w-full h-8 text-xs ${
                          cutsSaved 
                            ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30' 
                            : 'bg-gradient-to-r from-red-500 to-orange-500 text-white hover:from-red-600 hover:to-orange-600'
                        }`}
                        onClick={() => {
                          setShowPreviewModal(true);
                          setCountdown(60);
                        }}
                      >
                        <Calculator className="h-3 w-3 mr-1" />
                        {cutsSaved ? 'View Cuts' : 'Preview Savings'}
                      </Button>
                    </motion.div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Tasks */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                <CardContent className="p-2 sm:p-3">
                  <h3 className="text-white/80 text-xs sm:text-sm font-semibold mb-1 sm:mb-2 flex items-center gap-1 sm:gap-2">
                    <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    Tasks
                  </h3>
                  <div className="space-y-1">
                    {quickTasks.length === 0 ? (
                      <p className="text-white/40 text-center py-2 text-[10px] sm:text-xs">No tasks today</p>
                    ) : (
                      quickTasks.slice(0, 3).map((task: any) => (
                        <div
                          key={task.id}
                          className="flex items-center gap-1 sm:gap-2 p-1 sm:p-1.5 rounded bg-white/5"
                        >
                          <div className="w-0.5 h-4 sm:h-5 rounded-full bg-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-[10px] sm:text-xs font-medium truncate">
                              {task.event_name}
                            </p>
                          </div>
                          <span className="text-white/40 text-[9px] sm:text-[10px]">
                            {format(new Date(`2000-01-01T${task.event_time}`), 'h:mm a')}
                          </span>
                        </div>
                      ))
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
            if (!open) setCountdown(60);
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
