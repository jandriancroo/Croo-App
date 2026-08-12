import { useState, useEffect, useMemo } from 'react';
import { useClock } from '@/hooks/useClock';
import { getDisplayName } from '@/utils/displayName';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, differenceInMinutes } from 'date-fns';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Flame,
  ChevronDown,
  Scissors,
  Users,
  Calculator,
  X
} from 'lucide-react';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { ProjectionIcon } from '@/components/ui/projection-tag';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TheoOrb } from '@/components/dock/TheoOrb';
import { useTheoUnread } from '@/hooks/useTheoUnread';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { getTimezoneOffset } from '@/utils/timezoneUtils';
import { useAuth } from '@/lib/auth';

interface CompactDashboardProps {
  isExpanded: boolean;
  onClose: () => void;
  onDragEnd: (info: PanInfo) => void;
}

interface ActiveShift {
  userId: string;
  fullName: string;
  profilePhoto: string | null;
  clockInTime: string;
  isOnBreak: boolean;
  hourlyWage?: number;
  scheduledEndTime?: string;
}

interface LaborCut {
  userId: string;
  minutesCut: number;
  customEndTime?: string;
}

export const CompactDashboard = ({ isExpanded, onClose, onDragEnd }: CompactDashboardProps) => {
  const { currentLocation } = useAppLocation();
  const { timezone, getTodayInTimezone: getTodayStr } = useLocationTimezone();
  const locationId = currentLocation?.id;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showCutOptions, setShowCutOptions] = useState<string | null>(null);
  const [customTime, setCustomTime] = useState('');

  // Build storage key for labor cuts persistence
  const laborCutsStorageKey = useMemo(() => 
    `labor-cuts-dock-${locationId}-${getTodayStr()}`, 
    [locationId, getTodayStr]
  );

  // Load labor cuts from localStorage
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
      console.error('Failed to load saved state:', e);
    }
    return false;
  });

  // Persist labor cuts to localStorage
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
  
  // Shared clock tick — every minute (no seconds needed for dock)
  const currentTime = useClock(60000);

  // Lock body scroll when expanded to prevent background scrolling
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isExpanded]);

  const todayStr = useMemo(() => getTodayStr(), [getTodayStr]);
  
  // Fetch user profile for greeting
  const { data: userProfile } = useQuery({
    queryKey: ['compact-dash-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, nickname, profile_photo_url')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && isExpanded,
  });

  // Get first name for greeting
  const firstName = useMemo(() => {
    if (!userProfile?.full_name) return 'there';
    const nick = (userProfile as any)?.nickname;
    if (nick?.trim()) return nick.trim();
    return userProfile.full_name.split(' ')[0];
  }, [userProfile]);

  // Theo unread state — drives the red dot on the orb + speech bubble swap.
  const { count: theoUnreadCount, preview: theoUnreadPreview } = useTheoUnread();
  const hasUnreadTheo = theoUnreadCount > 0;
  
  // Format time in location timezone (no seconds)
  const formattedTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      }).format(currentTime);
    } catch {
      return format(currentTime, 'h:mm a');
    }
  }, [currentTime, timezone]);

  // Fetch sales data from sales_cache — shared key with prefetch + ManagerDashboard
  const { data: salesData } = useQuery({
    queryKey: ['sales-cache-today', locationId, todayStr],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data, projected_sales, initial_projection, living_projection, override_projection, hourly_data')
        .eq('location_id', locationId)
        .eq('sale_date', todayStr)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId && isExpanded,
    refetchInterval: isExpanded ? 60000 : false,
  });

  const { data: dashboardSalesData = null } = useQuery<any | null>({
    queryKey: ['dashboard-sales-enriched', locationId],
    queryFn: () => queryClient.getQueryData(['dashboard-sales-enriched', locationId]) ?? null,
    enabled: !!locationId && isExpanded,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: laborCacheFallback } = useQuery({
    queryKey: ['labor-cache-today', locationId, todayStr],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('labor_cache')
        .select('labor_hours, labor_cost, source')
        .eq('location_id', locationId)
        .eq('labor_date', todayStr);

      if (error) throw error;
      if (!data || data.length === 0) {
        // labor_cache only holds CLOSED days — use the shared live-punch helper
        // so the dock agrees with the dashboard for today.
        const live = await fetchLiveLaborForToday(locationId, timezone);
        return live.hours > 0 ? { labor_cost: live.cost, labor_hours: live.hours } : null;
      }

      const punchClockRow = data.find(
        (r: any) => r.source === 'punch_clock' && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0)
      );
      const externalRow = data.find((r: any) => ['qubeyond', 'aloha', 'clover'].includes(r.source) && (Number(r.labor_hours) > 0 || Number(r.labor_cost) > 0));
      const preferred = punchClockRow || externalRow || data[0];

      if (!(Number(preferred.labor_hours) > 0)) {
        const live = await fetchLiveLaborForToday(locationId, timezone);
        if (live.hours > 0) return { labor_cost: live.cost, labor_hours: live.hours };
      }

      return {
        labor_cost: Number(preferred.labor_cost) || 0,
        labor_hours: Number(preferred.labor_hours) || 0,
      };
    },
    enabled: !!locationId && isExpanded,
    refetchInterval: isExpanded ? 60000 : false,
  });

  // Use the exact labor payload produced by Dashboard SalesSummary when available.
  const laborData = dashboardSalesData?.labor
    ? {
        labor_cost: Number(dashboardSalesData.labor.laborCost) || 0,
        labor_hours: Number(dashboardSalesData.labor.hoursWorked) || 0,
      }
    : laborCacheFallback;




  // Fetch labor target
  const { data: locationSettings } = useQuery({
    queryKey: ['compact-dash-settings', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('location_settings')
        .select('labor_percentage_target')
        .eq('location_id', locationId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId && isExpanded,
  });

  // Fetch active shifts (same logic as manager dash)
  const { data: activeShifts = [] } = useQuery({
    queryKey: ['compact-dash-shifts', locationId, todayStr],
    queryFn: async () => {
      if (!locationId) return [];
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
      const activeUsers: { userId: string; clockInTime: string; isOnBreak: boolean }[] = [];

      Object.entries(userPunches).forEach(([userId, userPunchList]) => {
        let isClockedIn = false;
        let isOnBreak = false;
        let clockInTime: string | null = null;

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
          } else if (p.punch_type === 'break_end') {
            isOnBreak = false;
          }
        });

        if (isClockedIn && clockInTime) {
          activeUsers.push({ userId, clockInTime, isOnBreak });
        }
      });

      if (activeUsers.length === 0) return [];

      const userIds = activeUsers.map(u => u.userId);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, nickname, profile_photo_url')
        .in('id', userIds);

      // Get today's shifts for end times
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, template:shift_templates(end_time)')
        .eq('shift_date', todayStr)
        .in('user_id', userIds);

      const { data: wageRows } = await supabase.rpc('get_current_wages_batch', { p_user_ids: userIds });
      const wageMap = new Map<string, number>(((wageRows || []) as any[]).map(w => [w.user_id, Number(w.hourly_wage)]));

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));
      const shiftMap = new Map((shifts || []).map(s => [s.user_id, s.template?.end_time]));

      return activeUsers.map(u => {
        const profile = profileMap.get(u.userId);
        return {
          userId: u.userId,
          fullName: getDisplayName(profile?.full_name, (profile as any)?.nickname) || 'Unknown',
          profilePhoto: profile?.profile_photo_url || null,
          clockInTime: u.clockInTime,
          isOnBreak: u.isOnBreak,
          hourlyWage: wageMap.get(u.userId) ?? 16,
          scheduledEndTime: shiftMap.get(u.userId) || undefined,
        } as ActiveShift;
      });
    },
    enabled: !!locationId && isExpanded,
    refetchInterval: isExpanded ? 60000 : false,
  });

  // Calculate metrics
  const totalSales = salesData?.net_sales || 0;
  const resolvedProjection = resolveProjection(salesData);
  const projectedSales = resolvedProjection.value || 0;
  
  // Calculate pace-adjusted (same logic as ManagerDashboardOverlay)
  // Pace = actual sales so far + projected remaining hours
  const paceAdjusted = useMemo(() => {
    // First check localStorage cache (same key pattern as Dashboard)
    try {
      const cacheKey = `qu_projections_cache_${locationId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.data?.todayPaceAdjusted && parsed.data.todayPaceAdjusted > 0) {
          return parsed.data.todayPaceAdjusted;
        }
      }
    } catch {
      // Ignore cache errors
    }

    // Calculate pace on-the-fly when cache is stale/missing
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const tzHour = tzNow.getHours();
    const tzMinutes = tzNow.getMinutes();
    
    // Get hourly data from sales_cache
    const hourlyArray = (salesData?.hourly_data as unknown as { hour?: string; sales?: number; projected?: number }[] | null) || [];
    
    // Find the last hour with data (indicates store close time)
    let lastDataHour = 0;
    hourlyArray.forEach(h => {
      const hourNum = parseInt(h.hour?.split(':')[0] || '0', 10);
      if (hourNum > lastDataHour) {
        lastDataHour = hourNum;
      }
    });
    
    // If current hour is past the last data hour, store is closed - pace = actuals
    if (tzHour > lastDataHour && totalSales > 0) {
      return totalSales;
    }
    
    // === SHIFT-AWARE PACE V3 ===
    const SHIFT_BOUNDARY = 15;
    const lunchPcts: number[] = [];
    const dinnerPcts: number[] = [];
    hourlyArray.forEach(h => {
      const hourNum = parseInt(h.hour?.split(':')[0] || '0', 10);
      const actual = Number(h.sales) || 0;
      const projected = Number(h.projected) || 0;
      if (projected > 0) {
        const isCompleted = (hourNum < tzHour && actual > 0) || 
                            (hourNum === tzHour && tzMinutes >= 30 && actual > 0);
        if (isCompleted) {
          if (hourNum < SHIFT_BOUNDARY) {
            lunchPcts.push((actual - projected) / projected);
          } else {
            dinnerPcts.push((actual - projected) / projected);
          }
        }
      }
    });
    
    let adjustmentFactor = 1.0;
    const isDinnerShift = tzHour >= SHIFT_BOUNDARY;
    let activeAvg: number | null = null;
    
    if (isDinnerShift) {
      if (dinnerPcts.length >= 3) {
        activeAvg = dinnerPcts.reduce((a, b) => a + b, 0) / dinnerPcts.length;
      } else if (lunchPcts.length >= 3) {
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
    
    // Calculate pace with adjustment and 30-min grace period
    let paceSum = 0;
    hourlyArray.forEach(h => {
      const hourNum = parseInt(h.hour?.split(':')[0] || '0', 10);
      const actual = Number(h.sales) || 0;
      const projected = Number(h.projected) || 0;
      if (hourNum < tzHour) {
        paceSum += actual;
      } else if (hourNum === tzHour) {
        if (tzMinutes < 30) {
          paceSum += projected * adjustmentFactor;
        } else {
          const remainFrac = (60 - tzMinutes) / 60;
          paceSum += actual + (projected * remainFrac * adjustmentFactor);
        }
      } else {
        paceSum += projected * adjustmentFactor;
      }
    });
    
    if (paceSum > 0) {
      return Math.max(paceSum, totalSales);
    }
    
    // If no remaining projections but still during business hours, use actual sales
    if (totalSales > 0) {
      return totalSales;
    }
    
    return projectedSales;
  }, [locationId, salesData?.hourly_data, totalSales, projectedSales, timezone]);
  
  
  // Labor calculations
  const laborCost = laborData?.labor_cost || 0;
  const laborTarget = locationSettings?.labor_percentage_target || 25;
  const laborPercentage = totalSales > 0 ? (laborCost / totalSales) * 100 : 0;
  const laborDiff = laborPercentage - laborTarget;
  
  // Determine labor status
  const laborStatus = laborDiff <= 0 ? 'good' : laborDiff <= 3 ? 'warning' : 'bad';
  
  // Calculate target labor cost
  const targetLaborCost = (totalSales * laborTarget) / 100;
  const laborSavings = targetLaborCost - laborCost;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Get pace status badge based on delta
  const getPaceStatus = () => {
    if (totalSales < 100) return null;
    const pacePercent = projectedSales > 0 ? (paceAdjusted / projectedSales) * 100 : 0;
    if (pacePercent >= 110) return { label: 'On Fire', icon: Flame, color: 'text-orange-500', greeting: "It's pretty busy tonight" };
    if (pacePercent >= 105) return { label: 'Ahead', icon: TrendingUp, color: 'text-green-500', greeting: "It's pretty busy tonight" };
    if (pacePercent >= 95) return { label: 'On Track', icon: Target, color: 'text-blue-500', greeting: 'Things are looking steady today' };
    return { label: 'Behind', icon: TrendingDown, color: 'text-red-500', greeting: "Today is pretty slow, might wanna save labor" };
  };

  const paceStatus = getPaceStatus();

  // Labor cut functions
  const getCutForEmployee = (userId: string): LaborCut | undefined => {
    return laborCuts.find(c => c.userId === userId);
  };

  const handleAddCut = (employee: ActiveShift, minutes: number) => {
    setLaborCuts(prev => {
      const existing = prev.find(c => c.userId === employee.userId);
      if (existing) {
        return prev.map(c => c.userId === employee.userId ? { ...c, minutesCut: minutes, customEndTime: undefined } : c);
      }
      return [...prev, { userId: employee.userId, minutesCut: minutes }];
    });
    setShowCutOptions(null);
  };

  const handleCustomCut = (employee: ActiveShift) => {
    if (!customTime || !employee.scheduledEndTime) return;
    
    // Parse scheduled end time
    const [schedHours, schedMinutes] = employee.scheduledEndTime.split(':').map(Number);
    const schedEnd = new Date();
    schedEnd.setHours(schedHours, schedMinutes, 0, 0);
    
    // Parse custom end time
    const [custHours, custMinutes] = customTime.split(':').map(Number);
    const customEnd = new Date();
    customEnd.setHours(custHours, custMinutes, 0, 0);
    
    const minutesCut = differenceInMinutes(schedEnd, customEnd);
    if (minutesCut > 0) {
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
    } else {
      // Custom time is after or equal to scheduled end - just set the custom time
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
    setCustomTime('');
    setShowCutOptions(null);
  };

  // Calculate new clock-out time based on scheduled end and cut minutes
  const getNewClockOutTime = (scheduledEndTime: string | undefined, minutesCut: number): string | null => {
    if (!scheduledEndTime) return null;
    
    const [hours, minutes] = scheduledEndTime.split(':').map(Number);
    const endDate = new Date();
    endDate.setHours(hours, minutes, 0, 0);
    endDate.setMinutes(endDate.getMinutes() - minutesCut);
    
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(endDate);
  };

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

  const handleRemoveCut = (userId: string) => {
    setLaborCuts(prev => prev.filter(c => c.userId !== userId));
  };

  const handleClearAllCuts = () => {
    setLaborCuts([]);
    setCutsSaved(false);
    setShowPreviewModal(false);
  };

  const handleSaveCuts = () => {
    setCutsSaved(true);
    setShowPreviewModal(false);
  };

  // Calculate labor savings from cuts
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

    const currentLaborCost = laborData?.labor_cost || 0;
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
  }, [laborCuts, activeShifts, laborData?.labor_cost, totalSales]);

  const hasAnyCuts = laborCuts.length > 0;

  // Format shift end time
  const formatEndTime = (time: string | undefined): string => {
    if (!time) return '';
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  return (
    <AnimatePresence>
      {isExpanded && (
        <>
          {/* Backdrop fade behind the slide-up sheet */}
          <motion.div
            key="dock-dash-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[55] bg-black/60"
            onClick={onClose}
          />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.3 }}
          onDragEnd={(_, info) => onDragEnd(info)}
          className="fixed bottom-0 left-0 right-0 z-[60] bg-accent rounded-t-3xl"
          style={{ height: '75vh', touchAction: 'none' }}
        >

          {/* Drag Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-12 h-1.5 bg-accent-foreground/30 rounded-full" />
          </div>
          
          {/* Close hint */}
          <button 
            onClick={onClose}
            className="absolute top-3 right-4 text-accent-foreground/50 hover:text-accent-foreground transition-colors"
          >
            <ChevronDown className="h-6 w-6" />
          </button>

          {/* Content */}
          <div className="px-4 pb-safe overflow-y-auto" style={{ maxHeight: 'calc(75vh - 60px)' }}>
            {/* Row 1: small time above greeting, THEO orb pinned right.
                Tapping the orb opens Theo (listened for in AiAssistantBubble). */}
            {(() => {
              // Compute once for both the orb + speech-bubble row.
              let teaching = false;
              try {
                const raw = localStorage.getItem('theo-tab-teaching-v1');
                const firstSeen = raw ? parseInt(raw, 10) : NaN;
                if (firstSeen && !Number.isNaN(firstSeen)) {
                  teaching = (Date.now() - firstSeen) / (1000 * 60 * 60 * 24) < 7;
                }
              } catch { /* ignore */ }
              return (
                <>
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-accent-foreground/70 tabular-nums leading-none mb-1">
                        {formattedTime}
                      </p>
                      <h2 className="text-2xl font-bold text-accent-foreground truncate leading-tight">
                        Hey {firstName}
                      </h2>
                      {paceStatus && (
                        <p className="text-sm font-medium text-accent-foreground/90 mt-1 leading-snug">
                          {paceStatus.greeting}
                        </p>
                      )}
                    </div>
                    <div className="mr-10 shrink-0">
                      <TheoOrb
                        size={58}
                        data-tour="theo-orb"
                        label="Open Theo"
                        nudge={false}
                        unread={false}
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('open-theo'));
                        }}
                      />
                    </div>
                  </div>

                  {/* Theo speech bubble — centered under the orb, in-flow so cards push down.
                      Unread message always wins over the static greeting. */}
                  {(hasUnreadTheo || teaching) && (
                    <div className="flex justify-end mr-10 -mt-2 mb-3 animate-scale-in">
                      {/* Wider when showing a message preview, tight when static greeting */}
                      <div
                        className="relative flex justify-center"
                        style={{ width: hasUnreadTheo ? 180 : 58 }}
                      >
                        <button
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('open-theo'))}
                          className="relative px-3 py-2 rounded-2xl bg-accent-foreground text-accent shadow-lg text-left transition-transform active:scale-[0.97] hover:brightness-110"
                          aria-label="Open Theo"
                        >
                          {/* Tail pointing up to the orb above */}
                          <div className="absolute -top-1 right-[15px] w-3 h-3 rotate-45 bg-accent-foreground" />
                          {hasUnreadTheo ? (
                            <>
                              <p className="text-[9px] font-bold tracking-[0.12em] uppercase text-red-500 leading-none mb-0.5">
                                New message
                              </p>
                              <p className="text-[11px] font-semibold leading-snug line-clamp-2">
                                {theoUnreadPreview || 'Theo has an update for you'}
                              </p>
                              <p className="text-[10px] font-medium leading-tight opacity-70 mt-0.5">
                                Tap to read
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-[11px] font-semibold leading-tight whitespace-nowrap">
                                Hey, I'm Theo 👋
                              </p>
                              <p className="text-[10px] font-medium leading-tight opacity-90 mt-0.5 whitespace-nowrap">
                                Tap me anytime!
                              </p>
                            </>
                          )}
                        </button>

                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Sales & Pace Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Total Sales Card */}
              <div className="bg-accent-foreground/10 rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  <span className="text-accent-foreground/70 text-xs">Sales</span>
                </div>
                <p className="text-2xl font-bold text-accent-foreground">
                  {formatCurrency(totalSales)}
                </p>
                <div className="flex items-center gap-1 text-accent-foreground/50 text-[10px] mt-0.5">
                  <span>of {formatCurrency(projectedSales)} projected</span>
                  <ProjectionIcon source={resolvedProjection.source} className="text-accent-foreground" />
                </div>
              </div>

              {/* Pace Card */}
              <div className="bg-accent-foreground/10 rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  {paceStatus ? (
                    <paceStatus.icon className={cn("h-4 w-4", paceStatus.color)} />
                  ) : (
                    <Target className="h-4 w-4 text-accent-foreground/50" />
                  )}
                  <span className="text-accent-foreground/70 text-xs">Pace</span>
                </div>
                <p className="text-2xl font-bold text-amber-500">
                  {formatCurrency(paceAdjusted)}
                </p>
                {paceStatus && (
                  <p className={cn("text-[10px] mt-0.5", paceStatus.color)}>
                    {paceStatus.label}
                  </p>
                )}
              </div>
            </div>

            {/* Labor / Goal / Variance — data pill */}
            <div className="bg-accent-foreground/10 rounded-2xl px-4 py-3 mb-4">
              <div className="grid grid-cols-3 divide-x divide-accent-foreground/20">
                <div className="flex flex-col items-center justify-center px-2">
                  <p className={cn(
                    "text-xl font-bold leading-tight",
                    laborStatus === 'good' ? 'text-green-500' :
                    laborStatus === 'warning' ? 'text-yellow-500' :
                    'text-red-500'
                  )}>
                    {laborPercentage.toFixed(1)}%
                  </p>
                  <p className="text-accent-foreground/70 text-xs mt-0.5">
                    Labor
                  </p>
                </div>
                <div className="flex flex-col items-center justify-center px-2">
                  <p className="text-xl font-bold text-accent-foreground leading-tight">
                    {laborTarget}%
                  </p>
                  <p className="text-accent-foreground/70 text-xs mt-0.5">
                    Goal
                  </p>
                </div>
                <div className="flex flex-col items-center justify-center px-2">
                  <p className={cn(
                    "text-xl font-bold leading-tight",
                    laborSavings >= 0 ? 'text-green-500' : 'text-red-500'
                  )}>
                    {laborSavings >= 0 ? '−' : '+'}{formatCurrency(Math.abs(laborSavings))}
                  </p>
                  <p className="text-accent-foreground/70 text-xs mt-0.5">
                    Variance
                  </p>
                </div>
              </div>
            </div>

            {/* On The Clock - with cut options */}
            <div className="bg-accent-foreground/10 rounded-2xl p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent-foreground/70" />
                  <span className="text-accent-foreground/70 text-xs font-medium">On The Clock</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {activeShifts.length}
                  </Badge>
                </div>
                {hasAnyCuts && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs text-primary hover:text-primary/80 px-2"
                    onClick={() => setShowPreviewModal(true)}
                  >
                    <Calculator className="h-3 w-3 mr-1" />
                    Preview
                  </Button>
                )}
              </div>

              {activeShifts.length === 0 ? (
                <p className="text-accent-foreground/50 text-xs text-center py-4">No one clocked in</p>
              ) : (
                <div className="space-y-2">
                  {activeShifts.map((shift) => {
                    const cut = getCutForEmployee(shift.userId);
                    return (
                      <div
                        key={shift.userId}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-xl transition-colors",
                          cut ? "bg-red-500/10 border border-red-500/30" : "bg-accent-foreground/5"
                        )}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={shift.profilePhoto || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {shift.fullName.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-accent-foreground truncate">
                            {shift.fullName}
                          </p>
                          {shift.scheduledEndTime && (
                            <p className="text-[10px] text-accent-foreground/50">
                              until {formatEndTime(shift.scheduledEndTime)}
                            </p>
                          )}
                        </div>
                        
                        {cut ? (
                          <div className="flex items-center gap-1">
                            <Badge className="bg-red-500/30 text-red-500 text-[10px] px-1.5">
                              {cut.customEndTime 
                                ? `Out @ ${formatCustomTime(cut.customEndTime)}`
                                : shift.scheduledEndTime
                                  ? `Out @ ${getNewClockOutTime(shift.scheduledEndTime, cut.minutesCut) || `-${cut.minutesCut}m`}`
                                  : `-${cut.minutesCut}m`
                              }
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 w-5 p-0 text-red-500 hover:text-red-400"
                              onClick={() => handleRemoveCut(shift.userId)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Popover open={showCutOptions === shift.userId} onOpenChange={(open) => {
                            setShowCutOptions(open ? shift.userId : null);
                            if (!open) setCustomTime('');
                          }}>
                            <PopoverTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2 text-accent-foreground/70 hover:text-red-500 hover:bg-red-500/10"
                              >
                                <Scissors className="h-3 w-3 mr-1" />
                                Cut
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent 
                              className="w-48 p-3 bg-background border border-border shadow-neumorphic-lg"
                              side="left"
                              align="start"
                            >
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-medium text-foreground">Cut shift early</p>
                                  {getCutForEmployee(shift.userId) && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-5 text-[10px] text-muted-foreground"
                                      onClick={() => handleRemoveCut(shift.userId)}
                                    >
                                      Clear
                                    </Button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                  {[15, 30, 45, 60].map((mins) => {
                                    const existingCut = getCutForEmployee(shift.userId);
                                    return (
                                      <Button
                                        key={mins}
                                        size="sm"
                                        variant={existingCut?.minutesCut === mins ? 'default' : 'outline'}
                                        className={cn(
                                          "text-[10px] h-7 font-medium",
                                          existingCut?.minutesCut === mins 
                                            ? 'bg-red-500 hover:bg-red-600 text-white border-red-500' 
                                            : 'bg-muted border-border text-foreground hover:bg-red-500/20'
                                        )}
                                        onClick={() => handleAddCut(shift, mins)}
                                      >
                                        -{mins === 60 ? '1hr' : `${mins}m`}
                                      </Button>
                                    );
                                  })}
                                </div>
                                {shift.scheduledEndTime && (
                                  <div className="pt-2 border-t border-border">
                                    <p className="text-[10px] mb-1.5 text-muted-foreground">Custom end time:</p>
                                    <div className="flex gap-1.5">
                                      <Input
                                        type="time"
                                        value={customTime}
                                        onChange={(e) => setCustomTime(e.target.value)}
                                        className="text-[10px] h-7 flex-1 bg-muted border-border text-foreground"
                                      />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-[10px]"
                                        onClick={() => handleCustomCut(shift)}
                                        disabled={!customTime}
                                      >
                                        Set
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Summary when cuts exist */}
              {hasAnyCuts && (
                <div className="mt-3 pt-3 border-t border-accent-foreground/10 flex items-center justify-between">
                  <div>
                    <p className="text-green-500 text-xs font-medium">
                      -{calculateLaborSavings.percentSaved.toFixed(1)}% labor
                    </p>
                    <p className="text-accent-foreground/50 text-[10px]">
                      Save {formatCurrency(calculateLaborSavings.totalCostSaved)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-accent-foreground/70"
                      onClick={handleClearAllCuts}
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      className={cn(
                        "h-7 text-xs",
                        cutsSaved 
                          ? "bg-green-500 hover:bg-green-600" 
                          : "bg-primary hover:bg-primary/90"
                      )}
                      onClick={handleSaveCuts}
                    >
                      {cutsSaved ? 'Saved ✓' : 'Save Plan'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Labor Savings Preview Modal */}
          <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
            <DialogContent className="max-w-sm bg-accent border-accent-foreground/20 text-accent-foreground">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-primary" />
                  Labor Savings Preview
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-4 py-2">
                {/* Employees being cut */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-accent-foreground/70">Sending Home Early:</h4>
                  {laborCuts.map(cut => {
                    const employee = activeShifts.find(s => s.userId === cut.userId);
                    if (!employee) return null;
                    const hoursSaved = cut.minutesCut / 60;
                    const costSaved = hoursSaved * (employee.hourlyWage || 16);
                    return (
                      <div key={cut.userId} className="flex items-center justify-between p-2 rounded-lg bg-accent-foreground/10">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={employee.profilePhoto || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
                              {employee.fullName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs">{employee.fullName}</span>
                        </div>
                        <div className="text-right">
                          <Badge className="bg-red-500/30 text-red-500 text-[10px]">-{cut.minutesCut}m</Badge>
                          <p className="text-green-500 text-[10px] mt-0.5">-{formatCurrency(costSaved)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Comparison */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-accent-foreground/10 text-center">
                    <p className="text-[10px] mb-1 text-accent-foreground/70">Current</p>
                    <p className={cn(
                      "text-lg font-bold",
                      calculateLaborSavings.currentLaborPercent > laborTarget ? 'text-red-500' : 'text-accent-foreground'
                    )}>
                      {calculateLaborSavings.currentLaborPercent.toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                    <p className="text-[10px] mb-1 text-green-500/80">After Cuts</p>
                    <p className={cn(
                      "text-lg font-bold",
                      calculateLaborSavings.newLaborPercent <= laborTarget ? 'text-green-500' : 'text-yellow-500'
                    )}>
                      {calculateLaborSavings.newLaborPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Summary */}
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] text-accent-foreground/70">Total Savings</p>
                      <p className="text-green-500 text-lg font-bold">
                        {formatCurrency(calculateLaborSavings.totalCostSaved)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-accent-foreground/70">Time Cut</p>
                      <p className="text-green-500 text-lg font-bold">
                        {Math.floor(calculateLaborSavings.totalMinutesSaved / 60)}h {calculateLaborSavings.totalMinutesSaved % 60}m
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleClearAllCuts}
                  >
                    Clear All
                  </Button>
                  <Button
                    className="flex-1 bg-green-500 hover:bg-green-600"
                    onClick={handleSaveCuts}
                  >
                    {cutsSaved ? 'Saved ✓' : 'Save Cuts'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </motion.div>
        </>
      )}
    </AnimatePresence>

  );
};
