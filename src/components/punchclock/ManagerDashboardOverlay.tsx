import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, differenceInMinutes } from 'date-fns';
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
  Gauge
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
}

interface HourlySale {
  hour: string;
  sales: number;
  projected?: number;
}

export function ManagerDashboardOverlay({ 
  locationId, 
  timezone, 
  onClose 
}: ManagerDashboardOverlayProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [countdown, setCountdown] = useState(60);

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
        .select('id, full_name, profile_photo_url')
        .in('id', userIds);

      // Get today's shifts for positions
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, template:shift_templates(position)')
        .eq('shift_date', todayStr)
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));
      const shiftMap = new Map((shifts || []).map(s => [s.user_id, s.template?.position]));

      return activeUsers.map(u => {
        const profile = profileMap.get(u.userId);
        return {
          userId: u.userId,
          fullName: profile?.full_name || 'Unknown',
          profilePhoto: profile?.profile_photo_url || null,
          clockInTime: u.clockInTime,
          isOnBreak: u.isOnBreak,
          breakStartTime: u.breakStartTime,
          breakType: u.breakType,
          position: shiftMap.get(u.userId) || undefined,
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

  // Find max hourly sale for scaling
  const maxHourlySale = Math.max(...last4Hours.map(h => h.sales), 1);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 cursor-pointer overflow-hidden"
        onClick={onClose}
      >
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-accent/10 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        {/* Countdown indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <div className="relative w-10 h-10">
            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
              <circle
                cx="20"
                cy="20"
                r="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-white/20"
              />
              <circle
                cx="20"
                cy="20"
                r="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={113.1}
                strokeDashoffset={113.1 - (countdown / 60) * 113.1}
                className="text-primary transition-all duration-1000"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
              {countdown}
            </span>
          </div>
          <X className="h-6 w-6 text-white/60 hover:text-white transition-colors" />
        </div>

        <div className="relative h-full p-6 overflow-auto">
          {/* Header with time - Liquid Glass effect */}
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-center mb-8"
          >
            <div className="relative inline-block mx-auto">
              {/* Liquid Glass container */}
              <div className="relative px-12 py-6 rounded-3xl overflow-hidden">
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
                <div className="relative flex items-center justify-center gap-5">
                  <Clock className="h-12 w-12 text-white/80 drop-shadow-lg" />
                  <span 
                    className="text-8xl font-light text-white tracking-tight drop-shadow-2xl"
                    style={{ 
                      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      textShadow: '0 2px 20px rgba(255,255,255,0.15)'
                    }}
                  >
                    {formatTimeDisplay(currentTime)}
                  </span>
                </div>
              </div>
              
              {/* Ambient glow behind the glass */}
              <div className="absolute -inset-4 bg-primary/20 rounded-full blur-3xl -z-10 opacity-50" />
            </div>
            
            <p className="text-white/50 text-lg mt-4 font-light tracking-wide">
              {format(currentTime, 'EEEE, MMMM d, yyyy')}
            </p>
          </motion.div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
            
            {/* Sales Section */}
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-2 space-y-4"
            >
              {/* Sales Header Cards */}
              <div className="grid grid-cols-3 gap-4">
                {/* Total Sales */}
                <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                  <CardContent className="p-4 text-center">
                    <DollarSign className="h-8 w-8 mx-auto mb-2 text-green-400" />
                    <p className="text-white/60 text-sm mb-1">Total Sales</p>
                    <p className="text-3xl font-bold text-white">{formatCurrency(totalSales)}</p>
                  </CardContent>
                </Card>

                {/* EOD Goal */}
                <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                  <CardContent className="p-4 text-center">
                    <Target className="h-8 w-8 mx-auto mb-2 text-blue-400" />
                    <p className="text-white/60 text-sm mb-1">EOD Goal</p>
                    <p className="text-3xl font-bold text-white">{formatCurrency(eodGoal)}</p>
                  </CardContent>
                </Card>

                {/* Pace */}
                <Card className={`bg-white/10 backdrop-blur-xl border-white/20 ${
                  paceStatus === 'fire' ? 'ring-2 ring-orange-500/50' : ''
                }`}>
                  <CardContent className="p-4 text-center">
                    {paceStatus === 'fire' ? (
                      <Flame className="h-8 w-8 mx-auto mb-2 text-orange-500 animate-pulse" />
                    ) : paceStatus === 'cold' ? (
                      <TrendingDown className="h-8 w-8 mx-auto mb-2 text-red-400" />
                    ) : (
                      <TrendingUp className="h-8 w-8 mx-auto mb-2 text-green-400" />
                    )}
                    <p className="text-white/60 text-sm mb-1">Sales Pace</p>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-amber-400">
                          {formatCurrency(paceAdjusted)}
                        </span>
                        {paceDelta !== 0 && (
                          <span className={`text-sm font-semibold ${paceDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {paceDelta >= 0 ? '+' : ''}{formatCurrency(paceDelta)}
                          </span>
                        )}
                      </div>
                      <Badge 
                        variant={paceStatus === 'fire' ? 'default' : paceStatus === 'cold' ? 'secondary' : 'outline'}
                        className={`${
                          paceStatus === 'fire' 
                            ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white animate-pulse' 
                            : paceStatus === 'cold'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-green-500/20 text-green-300'
                        }`}
                      >
                        {paceStatus === 'fire' ? '🔥 On Fire' : paceStatus === 'cold' ? 'Behind' : 'On Track'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Hourly Sales Bar Chart */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                <CardContent className="p-6">
                  <h3 className="text-white/80 text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Last 4 Hours
                  </h3>
                  <div className="flex items-end justify-around gap-4 h-32">
                    {last4Hours.map((hour, i) => (
                      <motion.div
                        key={hour.hour}
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        transition={{ delay: 0.3 + i * 0.1 }}
                        className="flex flex-col items-center flex-1"
                      >
                        <span className="text-white font-bold text-sm mb-1">
                          {formatCurrency(hour.sales)}
                        </span>
                        <div className="w-full bg-white/10 rounded-t-lg overflow-hidden" style={{ height: '80px' }}>
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${(hour.sales / maxHourlySale) * 100}%` }}
                            transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                            className="w-full bg-gradient-to-t from-primary to-primary/60 mt-auto"
                            style={{ 
                              height: `${(hour.sales / maxHourlySale) * 100}%`,
                              marginTop: 'auto',
                              position: 'relative',
                              top: `${100 - (hour.sales / maxHourlySale) * 100}%`
                            }}
                          />
                        </div>
                        <span className="text-white/60 text-xs mt-2">{hour.label}</span>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Labor Section */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white/80 text-lg font-semibold flex items-center gap-2">
                      <Gauge className="h-5 w-5" />
                      Labor
                    </h3>
                    <Badge 
                      className={`${
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
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-white/60">Current Labor %</span>
                        <span className={`font-bold ${
                          laborStatus === 'good' ? 'text-green-400' : laborStatus === 'warning' ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {laborPercentage.toFixed(1)}%
                        </span>
                      </div>
                      <Progress 
                        value={Math.min(laborPercentage, 40)} 
                        max={40}
                        className="h-4 bg-white/10"
                      />
                      <div className="flex justify-between text-xs text-white/40 mt-1">
                        <span>0%</span>
                        <span className="text-primary">{laborTarget}%</span>
                        <span>40%</span>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-white/60 text-sm">Labor Cost</p>
                      <p className="text-2xl font-bold text-white">{formatCurrency(laborData?.laborCost || 0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Right Column - Shifts & Tasks */}
            <motion.div
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-4"
            >
              {/* Active Shifts */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                <CardContent className="p-4">
                  <h3 className="text-white/80 text-lg font-semibold mb-4 flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    On The Clock
                    <Badge variant="secondary" className="ml-auto bg-primary/20 text-primary">
                      {activeShifts.length}
                    </Badge>
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {activeShifts.length === 0 ? (
                      <p className="text-white/40 text-center py-4">No one clocked in</p>
                    ) : (
                      activeShifts.map((shift) => (
                        <div
                          key={shift.userId}
                          className={`flex items-center gap-3 p-2 rounded-lg ${
                            shift.isOnBreak ? 'bg-amber-500/20' : 'bg-white/5'
                          }`}
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={shift.profilePhoto || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-sm">
                              {shift.fullName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {shift.fullName}
                            </p>
                            {shift.position && (
                              <p className="text-white/40 text-xs truncate">{shift.position}</p>
                            )}
                          </div>
                          {shift.isOnBreak && shift.breakStartTime && (
                            <div className="flex items-center gap-1">
                              <Coffee className="h-4 w-4 text-amber-400" />
                              <span className={`text-xs font-bold ${
                                getBreakReturnTime(shift.breakStartTime).isOverdue 
                                  ? 'text-red-400' 
                                  : 'text-amber-300'
                              }`}>
                                {getBreakReturnTime(shift.breakStartTime).text}
                              </span>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Quick Tasks */}
              <Card className="bg-white/10 backdrop-blur-xl border-white/20">
                <CardContent className="p-4">
                  <h3 className="text-white/80 text-lg font-semibold mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    Manager Tasks
                  </h3>
                  <div className="space-y-2">
                    {quickTasks.length === 0 ? (
                      <p className="text-white/40 text-center py-4">No tasks today</p>
                    ) : (
                      quickTasks.map((task: any) => (
                        <div
                          key={task.id}
                          className="flex items-center gap-3 p-2 rounded-lg bg-white/5"
                        >
                          <div className="w-1 h-8 rounded-full bg-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">
                              {task.event_name}
                            </p>
                            <p className="text-white/40 text-xs">
                              {format(new Date(`2000-01-01T${task.event_time}`), 'h:mm a')}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Tap to close hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-center text-white/40 text-sm mt-8"
          >
            Tap anywhere to close
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
