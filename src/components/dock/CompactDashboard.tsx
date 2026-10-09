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
import { fetchStoreLabor } from '@/hooks/useStoreLabor';
import { getBusinessDateInTimezone } from '@/utils/timezoneUtils';
import { useAuth } from '@/lib/auth';
import { useCutSavingsTotal } from '@/hooks/useCutSavingsTotal';
import { summarizeCuts } from '@/utils/cutSavingsSummary';
import { useLaborGoalDisplay } from '@/hooks/useLaborGoalDisplay';
import { computePace, laborPct, storeNow } from '../../../supabase/functions/_shared/cubeMetrics';

// Swipe-up panel palette. "Ink" = theme primary darkened for text on the light
// page background; dark themes lighten it instead so it stays readable.
const CD_STYLE = `
.cd-panel{--cd-ink:color-mix(in srgb,hsl(var(--primary)) 75%,black);--cd-solid:color-mix(in srgb,hsl(var(--primary)) 75%,black);--cd-good:hsl(142 70% 28%);--cd-warn:hsl(32 90% 32%);--cd-bad:hsl(0 72% 42%);--cd-good-solid:hsl(142 70% 28%);--cd-bad-solid:hsl(0 72% 42%);--cd-line:color-mix(in srgb,var(--cd-ink) 25%,transparent)}
.dark .cd-panel,[data-theme="oled"] .cd-panel,.dark.cd-panel,[data-theme="oled"].cd-panel{--cd-ink:color-mix(in srgb,hsl(var(--primary)) 45%,white);--cd-good:hsl(142 62% 55%);--cd-warn:hsl(38 92% 60%);--cd-bad:hsl(0 80% 66%)}
`;
const PACE_PILL_BG: Record<string, string> = {
  'On Track': 'var(--cd-solid)',
  'Ahead': 'var(--cd-good-solid)',
  'On Fire': 'hsl(var(--accent))',
  'Behind': 'var(--cd-bad-solid)',
};
const LABOR_COLOR: Record<string, string> = {
  good: 'var(--cd-good)',
  warning: 'var(--cd-warn)',
  bad: 'var(--cd-bad)',
};

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

  // "Tap me" hint on Theo's orb until he's been tapped once today (store's local date).
  const theoTapKey = useMemo(() => {
    let d = '';
    try { d = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()); } catch { d = format(new Date(), 'yyyy-MM-dd'); }
    return `theo-dock-tapped:${user?.id ?? ''}:${d}`;
  }, [timezone, user?.id]);
  const [theoTappedToday, setTheoTappedToday] = useState(() => {
    try { return !!localStorage.getItem(theoTapKey); } catch { return false; }
  });
  useEffect(() => {
    try { setTheoTappedToday(!!localStorage.getItem(theoTapKey)); } catch { /* ignore */ }
  }, [theoTapKey]);
  const markTheoTapped = () => {
    try { localStorage.setItem(theoTapKey, '1'); } catch { /* ignore */ }
    setTheoTappedToday(true);
  };
  
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
        .select('net_sales, hourly_data, projected_sales, initial_projection, living_projection, override_projection, pace_adjusted_projection, pace_calculated_at')
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
    queryKey: ['dashboard-sales-enriched', locationId, getBusinessDateInTimezone()],
    queryFn: () => queryClient.getQueryData(['dashboard-sales-enriched', locationId, getBusinessDateInTimezone()]) ?? null,
    enabled: !!locationId && isExpanded,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Server labor (get_store_labor): one number, business today live. On error → "—".
  const { data: laborCacheFallback, isError: laborError } = useQuery({
    queryKey: ['store-labor-dock', locationId, todayStr],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await fetchStoreLabor([locationId], todayStr, todayStr);
      if (error) throw error;
      const row = data?.[0];
      return row ? { labor_cost: row.labor_cost, labor_hours: row.labor_hours } : null;
    },
    enabled: !!locationId && isExpanded,
    refetchInterval: isExpanded && document.visibilityState === 'visible' ? 60000 : false,
    refetchOnWindowFocus: false,
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

  // Store labor goal (week template + day goals), same source as the rest of the app.
  const goal = useLaborGoalDisplay(locationId, todayStr, isExpanded);

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

      // exact wages, server-side aggregate via get_cut_savings_total; no
      // per-person $ reaches this device

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
  
  // Pace: the one shared, deterministic helper (fresh stored pace wins, else shift-aware V3).
  const paceAdjusted = useMemo(() => {
    const pace = salesData ? computePace({ ...(salesData as any), nowInStoreTz: storeNow(timezone) }) : null;
    return pace ?? (totalSales > 0 ? totalSales : projectedSales);
  }, [salesData, totalSales, projectedSales, timezone]);

  // Labor calculations
  const laborCost = laborData?.labor_cost || 0;
  const laborTarget = goal?.day ?? goal?.weekly ?? (locationSettings?.labor_percentage_target || 25);
  const laborPercentage = laborPct(laborCost, totalSales) ?? 0;
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

  // Exact cut savings, aggregate only — computed server-side with real wages.
  // The response carries just { total_minutes, est_savings }; no per-person
  // dollars or pay rates ever reach this device.
  const cutSavingsTotal = useCutSavingsTotal(locationId, laborCuts);

  const calculateLaborSavings = useMemo(
    () =>
      summarizeCuts({
        totalMinutesCut: cutSavingsTotal.totalMinutes,
        estSavings: cutSavingsTotal.estSavings,
        currentLaborCost: laborData?.labor_cost || 0,
        totalSales,
      }),
    [cutSavingsTotal.totalMinutes, cutSavingsTotal.estSavings, laborData?.labor_cost, totalSales]
  );

  const dollarsKnown = calculateLaborSavings.dollarsKnown;

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
          className="cd-panel fixed bottom-0 left-0 right-0 z-[60] bg-accent rounded-t-3xl flex flex-col overflow-hidden"
          style={{ height: '75vh', touchAction: 'none' }}
        >
          <style>{CD_STYLE}</style>
          {/* A. Orange header — does not scroll */}
          <div className="relative shrink-0 px-4 pb-4">
            <div className="flex justify-center items-center h-[34px]">
              <div className="w-[44px] h-[5px] bg-accent-foreground/40 rounded-full" />
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-0 right-1 h-11 w-11 flex items-center justify-center text-accent-foreground"
            >
              <ChevronDown className="h-6 w-6" />
            </button>
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
                  <div className="flex items-start gap-3 mb-1">
                    <div className="flex-1 min-w-0 text-accent-foreground">
                      <p className="text-[13px] font-bold tabular-nums leading-none mb-1.5">
                        {formattedTime}
                      </p>
                      <h2 className="text-[30px] font-extrabold tracking-[-0.02em] leading-[1.1] truncate">
                        Hey {firstName}
                      </h2>
                      {paceStatus && (
                        <p className="text-[15px] font-semibold mt-1 leading-snug">
                          {paceStatus.greeting}
                        </p>
                      )}
                    </div>
                    <div className="mr-10 shrink-0 flex flex-col items-center">
                      <TheoOrb
                        size={58}
                        data-tour="theo-orb"
                        label="Open Theo"
                        nudge={!theoTappedToday}
                        unread={false}
                        onClick={() => {
                          markTheoTapped();
                          window.dispatchEvent(new CustomEvent('open-theo'));
                        }}
                      />
                      {!theoTappedToday && !hasUnreadTheo && !teaching && (
                        <span aria-hidden className="mt-1.5 rounded-full bg-accent-foreground px-2.5 py-0.5 text-[12px] font-extrabold text-accent animate-pulse">
                          Tap me
                        </span>
                      )}
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
          </div>

          {/* B. Beige panel — scrolls on its own */}
          <div
            className="flex-1 min-h-0 overflow-y-auto bg-background rounded-t-[24px] px-4 pt-5 tabular-nums"
            style={{ color: 'var(--cd-ink)', paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
          >
            {/* B1. Sales | Pace */}
            <div className="grid grid-cols-2">
              <div className="pr-4">
                <p className="text-[13px] font-bold">Sales</p>
                <p className="text-[32px] font-extrabold tracking-[-0.02em] leading-tight">
                  {formatCurrency(totalSales)}
                </p>
                <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: 'color-mix(in srgb, var(--cd-ink) 18%, transparent)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: 'hsl(var(--primary))',
                      width: `${projectedSales > 0 ? Math.min(100, (totalSales / projectedSales) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="flex items-center gap-1 text-[12px] font-bold mt-1.5">
                  <span>
                    {projectedSales > 0 ? Math.round((totalSales / projectedSales) * 100) : 0}% of {formatCurrency(projectedSales)} goal
                  </span>
                  <ProjectionIcon source={resolvedProjection.source} />
                </div>
              </div>
              <div className="pl-4" style={{ borderLeft: '1px solid var(--cd-line)' }}>
                <p className="text-[13px] font-bold">Pace</p>
                <p className="text-[32px] font-extrabold tracking-[-0.02em] leading-tight">
                  {formatCurrency(paceAdjusted)}
                </p>
                {paceStatus && (
                  <span
                    className="inline-flex items-center gap-1 h-[26px] px-2.5 mt-1.5 rounded-full text-[12px] font-extrabold text-white"
                    style={{ background: PACE_PILL_BG[paceStatus.label] }}
                  >
                    <paceStatus.icon className="h-[13px] w-[13px]" />
                    {paceStatus.label}
                  </span>
                )}
              </div>
            </div>

            <div className="my-[14px] h-px" style={{ background: 'var(--cd-line)' }} />

            {/* B2. Labor | Goal | Variance */}
            <div className="grid grid-cols-3 text-center">
              <div>
                <p className="text-[24px] font-extrabold leading-tight" style={{ color: LABOR_COLOR[laborStatus] }}>
                  {laborPercentage.toFixed(1)}%
                </p>
                <p className="text-[13px] font-bold">Labor</p>
              </div>
              <div style={{ borderLeft: '1px solid var(--cd-line)', borderRight: '1px solid var(--cd-line)' }}>
                <p className="text-[24px] font-extrabold leading-tight">{laborTarget}%</p>
                <p className="text-[13px] font-bold">Goal</p>
              </div>
              <div>
                <p
                  className="text-[24px] font-extrabold leading-tight"
                  style={{ color: laborSavings >= 0 ? 'var(--cd-good)' : 'var(--cd-bad)' }}
                >
                  {laborSavings >= 0 ? '−' : '+'}{formatCurrency(Math.abs(laborSavings))}
                </p>
                <p className="text-[13px] font-bold">Variance</p>
              </div>
            </div>

            <div className="my-[14px] h-px" style={{ background: 'var(--cd-line)' }} />

            {/* B3. On the clock */}
            <div>
              <div className="flex items-center justify-between min-h-[44px]">
                <div className="flex items-center gap-2">
                  <Users className="h-[18px] w-[18px]" />
                  <span className="text-[15px] font-extrabold">On the clock</span>
                  <span
                    className="inline-flex items-center justify-center h-[22px] min-w-[22px] px-2 rounded-full text-[12px] font-extrabold text-white"
                    style={{ background: 'var(--cd-solid)' }}
                  >
                    {activeShifts.length}
                  </span>
                </div>
                {hasAnyCuts && (
                  <button
                    type="button"
                    className="h-11 px-2 inline-flex items-center gap-1.5 text-[13px] font-extrabold"
                    onClick={() => setShowPreviewModal(true)}
                  >
                    <Calculator className="h-4 w-4" />
                    Preview
                  </button>
                )}
              </div>

              {activeShifts.length === 0 ? (
                <p className="text-[14px] font-semibold text-center py-6">No one clocked in</p>
              ) : (
                <div className="space-y-1 mt-1">
                  {activeShifts.map((shift) => {
                    const cut = getCutForEmployee(shift.userId);
                    const cutText = cut
                      ? cut.customEndTime
                        ? `Out at ${formatCustomTime(cut.customEndTime)}`
                        : shift.scheduledEndTime
                          ? (getNewClockOutTime(shift.scheduledEndTime, cut.minutesCut)
                              ? `Out at ${getNewClockOutTime(shift.scheduledEndTime, cut.minutesCut)}`
                              : `−${cut.minutesCut}m`)
                          : `−${cut.minutesCut}m`
                      : null;
                    return (
                      <div
                        key={shift.userId}
                        className="flex items-center gap-3 min-h-[52px] px-2 py-1 rounded-[14px]"
                        style={cut ? {
                          background: 'color-mix(in srgb, var(--cd-bad) 8%, transparent)',
                          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cd-bad) 35%, transparent)',
                        } : undefined}
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={shift.profilePhoto || undefined} />
                          <AvatarFallback className="bg-primary/15 text-[14px] font-extrabold" style={{ color: 'var(--cd-ink)' }}>
                            {shift.fullName.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-bold truncate">{shift.fullName}</p>
                          {cutText ? (
                            <p className="text-[13px] font-extrabold" style={{ color: 'var(--cd-bad)' }}>{cutText}</p>
                          ) : shift.scheduledEndTime ? (
                            <p className="text-[13px] font-semibold">until {formatEndTime(shift.scheduledEndTime)}</p>
                          ) : null}
                        </div>

                        {cut ? (
                          <button
                            type="button"
                            aria-label={`Remove cut for ${shift.fullName}`}
                            className="h-11 w-11 flex items-center justify-center"
                            style={{ color: 'var(--cd-bad)' }}
                            onClick={() => handleRemoveCut(shift.userId)}
                          >
                            <X className="h-5 w-5" />
                          </button>
                        ) : (
                          <Popover open={showCutOptions === shift.userId} onOpenChange={(open) => {
                            setShowCutOptions(open ? shift.userId : null);
                            if (!open) setCustomTime('');
                          }}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-full text-[13px] font-bold"
                                style={{ boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--cd-ink) 50%, transparent)' }}
                              >
                                <Scissors className="h-4 w-4" />
                                Cut
                              </button>
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
                <div className="mt-3 pt-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--cd-line)' }}>
                  <div className="min-w-0">
                    <p className="text-[15px] font-extrabold" style={{ color: 'var(--cd-good)' }}>
                      −{calculateLaborSavings.percentSaved.toFixed(1)}% labor
                    </p>
                    <p className="text-[13px] font-semibold">
                      {dollarsKnown
                        ? `Est. savings ${formatCurrency(calculateLaborSavings.totalCostSaved ?? 0)}`
                        : `${calculateLaborSavings.totalMinutesCut}m — savings estimate unavailable right now.`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" className="h-11 px-3 text-[14px] font-bold" onClick={handleClearAllCuts}>
                      Clear
                    </button>
                    <button
                      type="button"
                      className="h-11 px-4 rounded-full text-[14px] font-extrabold text-white"
                      style={{ background: cutsSaved ? 'var(--cd-good-solid)' : 'var(--cd-solid)' }}
                      onClick={handleSaveCuts}
                    >
                      {cutsSaved ? 'Saved ✓' : 'Save plan'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* C. Labor Savings Preview */}
          <Dialog open={showPreviewModal} onOpenChange={setShowPreviewModal}>
            <DialogContent className="cd-panel max-w-sm bg-background border-border tabular-nums" style={{ color: 'var(--cd-ink)' }}>
              <style>{CD_STYLE}</style>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-[18px] font-extrabold" style={{ color: 'var(--cd-ink)' }}>
                  <Calculator className="h-5 w-5" />
                  Labor Savings Preview
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-1">
                <div>
                  <h4 className="text-[13px] font-bold mb-1">Sending home early</h4>
                  {laborCuts.map(cut => {
                    const employee = activeShifts.find(s => s.userId === cut.userId);
                    if (!employee) return null;
                    return (
                      <div key={cut.userId} className="flex items-center justify-between py-2" style={{ borderTop: '1px solid var(--cd-line)' }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={employee.profilePhoto || undefined} />
                            <AvatarFallback className="bg-primary/15 text-[13px] font-extrabold" style={{ color: 'var(--cd-ink)' }}>
                              {employee.fullName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-[15px] font-bold truncate">{employee.fullName}</span>
                        </div>
                        {/* Minutes only — no per-person dollars on any device. */}
                        <span className="text-[14px] font-extrabold" style={{ color: 'var(--cd-bad)' }}>−{cut.minutesCut}m</span>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 text-center py-3" style={{ borderTop: '1px solid var(--cd-line)', borderBottom: '1px solid var(--cd-line)' }}>
                  <div>
                    <p className="text-[13px] font-bold">Current</p>
                    <p
                      className="text-[24px] font-extrabold"
                      style={{ color: calculateLaborSavings.currentLaborPercent > laborTarget ? 'var(--cd-bad)' : 'var(--cd-ink)' }}
                    >
                      {calculateLaborSavings.currentLaborPercent.toFixed(1)}%
                    </p>
                  </div>
                  <div style={{ borderLeft: '1px solid var(--cd-line)' }}>
                    <p className="text-[13px] font-bold">After cuts</p>
                    <p
                      className="text-[24px] font-extrabold"
                      style={{ color: calculateLaborSavings.newLaborPercent <= laborTarget ? 'var(--cd-good)' : 'var(--cd-warn)' }}
                    >
                      {calculateLaborSavings.newLaborPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[13px] font-bold">Est. savings</p>
                    {dollarsKnown ? (
                      <p className="text-[22px] font-extrabold" style={{ color: 'var(--cd-good)' }}>
                        {formatCurrency(calculateLaborSavings.totalCostSaved ?? 0)}
                      </p>
                    ) : (
                      <p className="text-[13px] font-semibold mt-0.5">Savings estimate unavailable right now.</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-bold">Time cut</p>
                    <p className="text-[22px] font-extrabold" style={{ color: 'var(--cd-good)' }}>
                      {Math.floor(calculateLaborSavings.totalMinutesCut / 60)}h {calculateLaborSavings.totalMinutesCut % 60}m
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    className="flex-1 h-11 rounded-full text-[14px] font-bold"
                    style={{ boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--cd-ink) 50%, transparent)' }}
                    onClick={handleClearAllCuts}
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    className="flex-1 h-11 rounded-full text-[14px] font-extrabold text-white"
                    style={{ background: cutsSaved ? 'var(--cd-good-solid)' : 'var(--cd-solid)' }}
                    onClick={handleSaveCuts}
                  >
                    {cutsSaved ? 'Saved ✓' : 'Save Cuts'}
                  </button>
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
