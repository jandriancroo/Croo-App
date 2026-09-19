import { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { Loader2, RotateCcw, CheckCircle2, Radio, Sparkles, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCachedSalesData, setCachedSalesData } from '@/utils/salesCache';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { useAuth } from '@/lib/auth';
import { refreshLiveSalesForToday } from '@/lib/pos/liveSales';
import { fetchActualLaborForDates } from '@/utils/liveLabor';
import { SalesProjectionDialog } from '@/components/schedule/SalesProjectionDialog';

// Get current date in the given timezone (YYYY-MM-DD format)
function getTodayInTZ(timezone: string): string {
  const now = new Date();
  const localString = now.toLocaleString('en-US', { timeZone: timezone || 'America/Los_Angeles' });
  const localDate = new Date(localString);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
interface Profile {
  id: string;
  full_name: string;
  hourly_wage?: number;
}
interface ScheduledShift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
}
interface LaborTotalsProps {
  shifts: ScheduledShift[];
  profiles: Profile[];
  currentWeekStart: Date;
  scheduleId?: string | null;
  isEditable?: boolean;
}

// Fetch wages for a specific user+date combo
async function fetchWageForShift(userId: string, shiftDate: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('get_current_wage', {
      p_user_id: userId,
      p_date: shiftDate
    });
    if (!error && data !== null) {
      return data;
    }
  } catch (error) {
    console.error('Error fetching wage:', error);
  }
  return null;
}

export function LaborTotals({
  shifts,
  profiles,
  currentWeekStart,
  scheduleId,
  isEditable = false
}: LaborTotalsProps) {
  const { canViewAllWages } = useUserRole();
  const { canSeeSales } = useTeamSalesVisibility();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const getTodayPST = () => getTodayInTZ(timezone);
  const weekDays = Array.from({
    length: 7
  }, (_, i) => addDays(currentWeekStart, i));
  const [projectedSales, setProjectedSales] = useState<Record<number, number>>({});
  const [salesSource, setSalesSource] = useState<Record<number, 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial'>>({});
  const [isLoadingSales, setIsLoadingSales] = useState(true);
  const [isLoadingQuSales, setIsLoadingQuSales] = useState(false);
  const [actualLabor, setActualLabor] = useState<Record<string, { hours: number; cost: number }>>({});
  const [projectionDialogDay, setProjectionDialogDay] = useState<number | null>(null);
  const { user } = useAuth();

  // Fetch labor rules for OT/DT multipliers
  const { data: laborRules } = useQuery({
    queryKey: ['labor-rules-schedule', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      const { data } = await supabase
        .from('labor_rules')
        .select('daily_overtime_threshold, daily_double_time_threshold, weekly_overtime_threshold, overtime_multiplier, double_time_multiplier')
        .eq('location_id', currentLocation.id)
        .maybeSingle();
      return data;
    },
    enabled: !!currentLocation?.id,
    staleTime: 30 * 60 * 1000,
  });

  // Compute a stable key for shifts to trigger wage refetch
  const shiftsKey = useMemo(() => {
    return shifts.map(s => `${s.id}-${s.user_id}-${s.shift_date}-${s.start_time}-${s.end_time}`).join('|');
  }, [shifts]);

  // Use React Query for wage fetching with staleTime
  const { data: shiftWages = {}, isLoading: isLoadingWages } = useQuery({
    queryKey: ['shift-wages', shiftsKey],
    queryFn: async () => {
      const wages: Record<string, number> = {};
      
      // Group shifts by user to reduce queries
      const shiftsByUser = shifts.reduce((acc, shift) => {
        if (!shift.user_id) return acc;
        if (!acc[shift.user_id]) acc[shift.user_id] = [];
        acc[shift.user_id].push(shift);
        return acc;
      }, {} as Record<string, ScheduledShift[]>);

      // Fetch wages for all users in parallel
      await Promise.all(Object.entries(shiftsByUser).map(async ([userId, userShifts]) => {
        const uniqueDates = [...new Set(userShifts.map(s => s.shift_date))];
        
        const userWages = await Promise.all(uniqueDates.map(async date => {
          const wage = await fetchWageForShift(userId, date);
          return wage !== null ? { date, wage } : null;
        }));

        userShifts.forEach(shift => {
          const wageData = userWages.find(w => w?.date === shift.shift_date);
          if (wageData) {
            wages[shift.id] = wageData.wage;
          }
        });
      }));
      
      return wages;
    },
    enabled: shifts.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes - wages don't change often
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });

  // Fetch saved projected sales first
  useEffect(() => {
    const fetchProjectedSales = async () => {
      if (!scheduleId) {
        setIsLoadingSales(false);
        return;
      }
      setIsLoadingSales(true);
      try {
        const {
          data,
          error
        } = await supabase.from('schedule_projected_sales').select('*').eq('schedule_id', scheduleId);
        if (error) throw error;
        const sales: Record<number, number> = {};
        const sources: Record<number, 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial'> = {};
        data?.forEach(item => {
          sales[item.day_of_week] = Number(item.projected_sales);
          sources[item.day_of_week] = 'manual';
        });
        setProjectedSales(sales);
        setSalesSource(sources);
      } catch (error) {
        console.error('Error fetching projected sales:', error);
      } finally {
        setIsLoadingSales(false);
      }
    };
    fetchProjectedSales();
  }, [scheduleId]);

  // Memoize the week dates string to prevent unnecessary re-fetches
  const weekDatesKey = useMemo(() => 
    weekDays.map(d => format(d, 'yyyy-MM-dd')).join(','), 
    [currentWeekStart]
  );

  // Auto-fill from Qu data:
  // - Past days: use net_sales from sales_cache (fast)
  // - Today: fetch live from API (slow - done in background)
  // - Future days: read from sales_cache.projected_sales (fast)
  // 
  // OPTIMIZATION: Load cached data immediately, then fetch today's live data in background
  useEffect(() => {
    const fetchQuSalesData = async () => {
      if (!currentLocation?.id || isLoadingSales) return;
      
      const todayPST = getTodayPST();
      
      setIsLoadingQuSales(true);
      try {
        // Collect past and future dates to batch-fetch from sales_cache
        const pastDates: string[] = [];
        const futureDates: string[] = [];
        const pastDayIndexMap: Record<string, number> = {};
        const futureDayIndexMap: Record<string, number> = {};
        let todayIndex: number | null = null;
        
        weekDays.forEach((day, dayIndex) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = dateStr < todayPST;
          const isTodayDate = dateStr === todayPST;
          
          if (isPast) {
            pastDates.push(dateStr);
            pastDayIndexMap[dateStr] = dayIndex;
          } else if (isTodayDate) {
            todayIndex = dayIndex;
          } else {
            futureDates.push(dateStr);
            futureDayIndexMap[dateStr] = dayIndex;
          }
        });
        
        // PHASE 1: Batch fetch from sales_cache (FAST - ~200ms)
        // Fetch both past actuals and future projections in parallel
        const [pastResponse, futureResponse, todayCacheResponse] = await Promise.all([
          pastDates.length > 0 
            ? supabase.from('sales_cache').select('sale_date, net_sales').eq('location_id', currentLocation.id).in('sale_date', pastDates)
            : Promise.resolve({ data: null }),
          futureDates.length > 0
            ? supabase.from('sales_cache').select('sale_date, initial_projection, living_projection, override_projection, projected_sales').eq('location_id', currentLocation.id).in('sale_date', futureDates)
            : Promise.resolve({ data: null }),
          // Also try to get today's cached data for instant display
          todayIndex !== null
            ? supabase.from('sales_cache').select('sale_date, net_sales, initial_projection, living_projection, override_projection').eq('location_id', currentLocation.id).eq('sale_date', todayPST).maybeSingle()
            : Promise.resolve({ data: null })
        ]);
        
        // Any future day still missing a projection is filled by the shared,
        // POS-neutral projection service (works for every brand and POS).
        let futureRows = futureResponse.data;
        const missingProjection = futureDates.filter(dateStr => {
          const row = (futureRows || []).find(r => r.sale_date === dateStr);
          if (!row) return true;
          return !resolveProjection({
            initial_projection: row.initial_projection,
            living_projection: row.living_projection,
            override_projection: row.override_projection,
            projected_sales: row.projected_sales
          }).value;
        });
        
        if (missingProjection.length > 0) {
          try {
            const { error: seedError } = await supabase.functions.invoke('sales-week-projections', {
              body: {
                action: 'seed_week',
                locationId: currentLocation.id,
                weekStart: format(weekDays[0], 'yyyy-MM-dd')
              }
            });
            if (!seedError) {
              const { data: refreshed } = await supabase
                .from('sales_cache')
                .select('sale_date, initial_projection, living_projection, override_projection, projected_sales')
                .eq('location_id', currentLocation.id)
                .in('sale_date', futureDates);
              if (refreshed) futureRows = refreshed;
            }
          } catch (seedErr) {
            console.warn('[LaborTotals] shared week projection seed failed:', seedErr);
          }
        }
        
        // Process cached data immediately
        const newSales: Record<number, number> = { ...projectedSales };
        const newSources: Record<number, 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial'> = { ...salesSource };
        
        // Past days from net_sales
        if (pastResponse.data) {
          pastResponse.data.forEach(row => {
            if (row.net_sales && row.net_sales > 0) {
              const dayIndex = pastDayIndexMap[row.sale_date];
              if (dayIndex !== undefined) {
                newSales[dayIndex] = Math.round(row.net_sales * 100) / 100;
                newSources[dayIndex] = 'historical';
              }
            }
          });
        }
        
        // Future days from projections
        if (futureRows) {
          futureRows.forEach(row => {
            const resolved = resolveProjection({
              initial_projection: row.initial_projection,
              living_projection: row.living_projection,
              override_projection: row.override_projection,
              projected_sales: row.projected_sales
            });
            
            if (resolved.value && resolved.value > 0) {
              const dayIndex = futureDayIndexMap[row.sale_date];
              if (dayIndex !== undefined && !projectedSales[dayIndex]) {
                newSales[dayIndex] = Math.round(resolved.value * 100) / 100;
                newSources[dayIndex] = resolved.source === 'legacy' ? 'ai' : resolved.source as 'override' | 'living' | 'initial';
              }
            }
          });
        }
        
        // Today's cached data (show immediately while live fetch happens)
        if (todayCacheResponse.data && todayIndex !== null) {
          const row = todayCacheResponse.data;
          // Use net_sales if available (from recent sync), otherwise use projection as placeholder
          if (row.net_sales && row.net_sales > 0) {
            newSales[todayIndex] = Math.round(row.net_sales * 100) / 100;
            newSources[todayIndex] = 'living';
          } else {
            const resolved = resolveProjection({
              initial_projection: row.initial_projection,
              living_projection: row.living_projection,
              override_projection: row.override_projection,
              projected_sales: null
            });
            if (resolved.value && resolved.value > 0) {
              newSales[todayIndex] = Math.round(resolved.value * 100) / 100;
              newSources[todayIndex] = 'initial';
            }
          }
        }
        
        // Update state immediately with cached data
        setProjectedSales(newSales);
        setSalesSource(newSources);
        setIsLoadingQuSales(false);
        
        // PHASE 2: Fetch today's LIVE data in background (SLOW - ~10s)
        // This updates the display when ready without blocking initial render
        if (todayIndex !== null) {
          refreshLiveSalesForToday(currentLocation.id).then(daily => {
            if (daily && daily > 0) {
              setProjectedSales(prev => ({
                ...prev,
                [todayIndex as number]: Math.round(daily * 100) / 100
              }));
              setSalesSource(prev => ({
                ...prev,
                [todayIndex as number]: 'living'
              }));
            }
          }).catch(err => {
            console.error('Failed to fetch live sales for today:', err);
          });
        }
        
      } catch (error) {
        console.error('Error fetching sales data:', error);
        setIsLoadingQuSales(false);
      }
    };
    
    fetchQuSalesData();
  }, [currentLocation?.id, isLoadingSales, weekDatesKey]);

  // Fetch actual labor data from labor_cache for past days
  useEffect(() => {
    const fetchActualLabor = async () => {
      if (!currentLocation?.id) return;
      
      const todayPST = getTodayPST();
      const pastDates = weekDays
        .map(d => format(d, 'yyyy-MM-dd'))
        .filter(dateStr => dateStr < todayPST);
      
      if (pastDates.length === 0) {
        setActualLabor({});
        return;
      }
      
      const { data, error } = await supabase
        .from('labor_cache')
        .select('labor_date, labor_hours, labor_cost')
        .eq('location_id', currentLocation.id)
        .in('labor_date', pastDates);
      
      if (error) {
        console.error('Error fetching actual labor:', error);
        return;
      }
      
      const laborMap: Record<string, { hours: number; cost: number }> = {};
      data?.forEach(row => {
        laborMap[row.labor_date] = {
          hours: row.labor_hours || 0,
          cost: row.labor_cost || 0
        };
      });

      // Gap-fill only: a missed nightly labor run leaves a 0-hour row behind.
      // Recompute those days straight from punches (read-only, no cache writes).
      const missingDates = pastDates.filter(d => !(laborMap[d]?.hours > 0));
      if (missingDates.length > 0) {
        try {
          const fromPunches = await fetchActualLaborForDates(
            currentLocation.id,
            timezone || 'America/Los_Angeles',
            missingDates
          );
          Object.entries(fromPunches).forEach(([dateStr, value]) => {
            if (value.hours > 0) laborMap[dateStr] = value;
          });
        } catch (e) {
          console.error('Punch-derived labor fallback failed:', e);
        }
      }

      setActualLabor(laborMap);
    };
    
    fetchActualLabor();
  }, [currentLocation?.id, weekDatesKey, timezone]);

  const handleSalesChange = async (dayIndex: number, value: string, excludedDates?: string[]) => {
    if (!currentLocation?.id) return;
    const numValue = parseFloat(value) || 0;
    const day = weekDays[dayIndex];
    const dateStr = format(day, 'yyyy-MM-dd');
    
    setProjectedSales(prev => ({
      ...prev,
      [dayIndex]: numValue
    }));
    setSalesSource(prev => ({
      ...prev,
      [dayIndex]: 'override'
    }));
    
    try {
      // Save override to sales_cache using the new override_projection column
      const { error } = await (supabase
        .from('sales_cache') as any)
        .upsert({
          location_id: currentLocation.id,
          sale_date: dateStr,
          override_projection: numValue,
          override_at: new Date().toISOString(),
          override_by: user?.id || null,
          override_excluded_dates: excludedDates ?? []
        }, {
          onConflict: 'location_id,sale_date'
        });
      
      if (error) throw error;
      
      // Also save to schedule_projected_sales for backwards compatibility
      if (scheduleId) {
        await supabase.from('schedule_projected_sales').upsert({
          schedule_id: scheduleId,
          day_of_week: dayIndex,
          projected_sales: numValue
        }, {
          onConflict: 'schedule_id,day_of_week'
        });
      }
    } catch (error) {
      console.error('Error saving override projection:', error);
      toast.error('Failed to save override');
    }
  };

  // Reload AI/living projection for a specific day (clears override)
  const handleReloadProjection = async (dayIndex: number) => {
    if (!currentLocation?.id) return;
    
    const day = weekDays[dayIndex];
    const dateStr = format(day, 'yyyy-MM-dd');
    const todayPST = getTodayPST();
    const isPast = dateStr < todayPST;
    const isTodayDate = dateStr === todayPST;
    
    try {
      // Clear override from sales_cache
      await (supabase
        .from('sales_cache') as any)
        .update({
          override_projection: null,
          override_at: null,
          override_by: null,
          override_excluded_dates: null
        })
        .eq('location_id', currentLocation.id)
        .eq('sale_date', dateStr);
      
      // Also delete from schedule_projected_sales for backwards compatibility
      if (scheduleId) {
        await supabase
          .from('schedule_projected_sales')
          .delete()
          .eq('schedule_id', scheduleId)
          .eq('day_of_week', dayIndex);
      }
      
      // Clear from local state
      setProjectedSales(prev => {
        const newState = { ...prev };
        delete newState[dayIndex];
        return newState;
      });
      setSalesSource(prev => {
        const newState = { ...prev };
        delete newState[dayIndex];
        return newState;
      });
      
      // Fetch fresh projection from sales_cache with resolution priority
      const { data: cacheData } = await supabase
        .from('sales_cache')
        .select('initial_projection, living_projection, override_projection, net_sales, projected_sales')
        .eq('location_id', currentLocation.id)
        .eq('sale_date', dateStr)
        .maybeSingle();
      
      if (cacheData) {
        let salesValue: number;
        let source: 'historical' | 'living' | 'initial' | 'ai';
        
        if (isPast || isTodayDate) {
          // Use actual sales for past/today
          salesValue = Math.round((cacheData.net_sales || 0) * 100) / 100;
          source = 'historical';
        } else {
          // Use resolved projection for future
          const resolved = resolveProjection({
            initial_projection: cacheData.initial_projection,
            living_projection: cacheData.living_projection,
            override_projection: null, // We just cleared it
            projected_sales: cacheData.projected_sales
          });
          salesValue = Math.round((resolved.value || 0) * 100) / 100;
          source = resolved.source === 'legacy' ? 'ai' : (resolved.source as 'living' | 'initial') || 'ai';
        }
        
        if (salesValue > 0) {
          setProjectedSales(prev => ({ ...prev, [dayIndex]: salesValue }));
          setSalesSource(prev => ({ ...prev, [dayIndex]: source }));
          const sourceLabel = source === 'living' ? 'Live AI goal' : 
                             source === 'initial' ? 'AI goal' : 
                             source === 'historical' ? 'actual sales' : 'AI goal';
          toast.success(`Reloaded ${sourceLabel} for ${format(day, 'EEE')}`);
        } else {
          toast.info(`No goal available for ${format(day, 'EEE')}`);
        }
      } else if (isPast || isTodayDate) {
        // Past/today with no cached row: refresh through the store's own POS.
        const daily = await refreshLiveSalesForToday(currentLocation.id, timezone);
        if (daily && daily > 0) {
          setProjectedSales(prev => ({ ...prev, [dayIndex]: Math.round(daily * 100) / 100 }));
          setSalesSource(prev => ({ ...prev, [dayIndex]: 'historical' }));
          toast.success(`Reloaded actual sales for ${format(day, 'EEE')}`);
        } else {
          toast.info(`No sales available for ${format(day, 'EEE')}`);
        }
      } else {
        // Future day with no row: use the shared projection service (any POS).
        const { error: seedError } = await supabase.functions.invoke('sales-week-projections', {
          body: {
            action: 'seed_week',
            locationId: currentLocation.id,
            weekStart: format(weekDays[0], 'yyyy-MM-dd')
          }
        });
        
        if (seedError) {
          toast.error('Failed to reload projection');
          return;
        }
        
        const { data: seeded } = await supabase
          .from('sales_cache')
          .select('initial_projection, living_projection, projected_sales')
          .eq('location_id', currentLocation.id)
          .eq('sale_date', dateStr)
          .maybeSingle();
        
        const resolved = resolveProjection({
          initial_projection: seeded?.initial_projection,
          living_projection: seeded?.living_projection,
          override_projection: null,
          projected_sales: seeded?.projected_sales
        });
        const salesValue = Math.round((resolved.value || 0) * 100) / 100;
        
        if (salesValue > 0) {
          setProjectedSales(prev => ({ ...prev, [dayIndex]: salesValue }));
          setSalesSource(prev => ({ ...prev, [dayIndex]: resolved.source === 'legacy' ? 'ai' : (resolved.source as 'living' | 'initial') || 'ai' }));
          toast.success(`Reloaded AI projection for ${format(day, 'EEE')}`);
        } else {
          toast.info(`No goal available for ${format(day, 'EEE')}`);
        }
      }
    } catch (error) {
      console.error('Error reloading projection:', error);
      toast.error('Failed to reload projection');
    }
  };
  
  const dailyTotals = useMemo(() => {
    const todayPST = getTodayPST();
    
    return weekDays.map((day) => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const isPast = dayStr < todayPST;
      
      // For past days: use actual labor from labor_cache
      if (isPast && actualLabor[dayStr]) {
        return {
          date: format(day, 'EEE'),
          hours: actualLabor[dayStr].hours,
          wages: actualLabor[dayStr].cost,
          isActual: true
        };
      }
      
      // For today and future: calculate from scheduled shifts with OT/DT
      const dayShifts = shifts.filter(s => s.shift_date === dayStr);
      let totalHours = 0;
      let totalWages = 0;

      // A 0/null daily threshold means the state has NO daily OT/DT rule (e.g. TX, GA, IN).
      // Treat it as disabled — otherwise every scheduled hour lands in double time.
      const rawDailyOT = laborRules?.daily_overtime_threshold;
      const rawDailyDT = laborRules?.daily_double_time_threshold;
      const dailyOT = rawDailyOT && rawDailyOT > 0 ? rawDailyOT : Infinity;
      const dailyDT = rawDailyDT && rawDailyDT > 0 ? rawDailyDT : Infinity;
      const otMult = laborRules?.overtime_multiplier ?? 1.5;
      const dtMult = laborRules?.double_time_multiplier ?? 2.0;

      // Group shifts by employee to calculate per-employee daily OT/DT
      const hoursByEmployee: Record<string, { hours: number; wage: number }> = {};

      dayShifts.forEach(shift => {
        if (!shift.user_id) return;
        const profile = profiles.find(p => p.id === shift.user_id);

        // Calculate shift duration
        const [startHour, startMin] = shift.start_time.split(':').map(Number);
        const [endHour, endMin] = shift.end_time.split(':').map(Number);
        let hours = endHour - startHour;
        let minutes = endMin - startMin;
        if (minutes < 0) {
          hours -= 1;
          minutes += 60;
        }
        if (hours < 0) {
          hours += 24;
        }
        let shiftHours = hours + minutes / 60;

        // Deduct 30 minutes if shift is over 5 hours
        if (shiftHours > 5) {
          shiftHours -= 0.5;
        }
        totalHours += shiftHours;

        const wage = shiftWages[shift.id] ?? profile?.hourly_wage ?? 15;

        if (!hoursByEmployee[shift.user_id]) {
          hoursByEmployee[shift.user_id] = { hours: 0, wage };
        }
        hoursByEmployee[shift.user_id].hours += shiftHours;
        // Use the latest wage found for this employee
        hoursByEmployee[shift.user_id].wage = wage;
      });

      // Calculate wages with OT/DT multipliers per employee
      Object.values(hoursByEmployee).forEach(({ hours: empHours, wage }) => {
        if (empHours <= dailyOT) {
          totalWages += empHours * wage;
        } else if (empHours <= dailyDT) {
          totalWages += dailyOT * wage;
          totalWages += (empHours - dailyOT) * wage * otMult;
        } else {
          totalWages += dailyOT * wage;
          totalWages += (dailyDT - dailyOT) * wage * otMult;
          totalWages += (empHours - dailyDT) * wage * dtMult;
        }
      });

      return {
        date: format(day, 'EEE'),
        hours: totalHours,
        wages: totalWages,
        isActual: false
      };
    });
  }, [shifts, profiles, weekDays, shiftWages, actualLabor, laborRules]);
  const weeklyTotals = useMemo(() => {
    const totalHours = dailyTotals.reduce((sum, day) => sum + day.hours, 0);
    const totalWages = dailyTotals.reduce((sum, day) => sum + day.wages, 0);
    const totalSales = Object.values(projectedSales).reduce((sum, sale) => sum + sale, 0);
    const avgLaborPercent = totalSales > 0 ? totalWages / totalSales * 100 : 0;
    return {
      hours: totalHours,
      wages: totalWages,
      sales: totalSales,
      laborPercent: avgLaborPercent
    };
  }, [dailyTotals, projectedSales]);

  const [isToolsOpen, setIsToolsOpen] = useState(false);

  // Day phase helper: completed days get a shaded column, today is in progress, future days stay clean
  const getDayPhase = (index: number): 'completed' | 'today' | 'future' => {
    const dayStr = format(weekDays[index], 'yyyy-MM-dd');
    const todayStr = getTodayPST();
    if (dayStr < todayStr) return 'completed';
    if (dayStr === todayStr) return 'today';
    return 'future';
  };

  // Only show labor totals to users who can view sales/labor
  // (shift managers and above, OR team members with location setting enabled)
  if (!canSeeSales) {
    return null;
  }

  const insightGrid = "grid grid-cols-[96px_repeat(7,1fr)] md:grid-cols-[116px_repeat(7,1fr)] lg:grid-cols-[150px_repeat(7,1fr)] xl:grid-cols-[170px_repeat(7,1fr)] gap-0";

  return <div className="text-xs min-w-[700px]">
      {/* Week Insights tab - dark floating pill */}
      <div className="-mt-5 mb-2 relative z-10 flex">
        <button
          onClick={() => setIsToolsOpen(!isToolsOpen)}
          className={`
            px-4 py-1.5 flex items-center gap-2 rounded-full text-sm font-semibold border shadow-lg
            transition-all duration-200 cursor-pointer
            ${isToolsOpen
              ? 'bg-slate-900 text-slate-100 border-slate-700/60'
              : 'bg-slate-800/90 text-slate-300 border-slate-700/40 hover:bg-slate-900 hover:text-slate-100'}
          `}
        >
          <BarChart3 className="h-4 w-4" />
          <span>Week Insights</span>
          {isToolsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Dark dock panel */}
      {isToolsOpen && (
        <div className="rounded-2xl bg-slate-900/95 backdrop-blur-sm border border-slate-700/60 shadow-[0_18px_50px_-12px_rgba(2,6,23,0.7)] overflow-hidden animate-accordion-down mb-2 text-slate-200">
          {/* Day header */}
          <div className={`${insightGrid} border-b border-slate-700/40`}>
            <div className="px-3 py-1.5 bg-blue-950/40 flex items-center">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Week of {format(weekDays[0], 'MMM d')}</span>
            </div>
            {weekDays.map((day, index) => {
              const phase = getDayPhase(index);
              return (
                <div key={index} className={`px-2 py-1.5 border-r border-slate-700/30 last:border-r-0 text-center whitespace-nowrap ${phase === 'completed' ? 'bg-white/[0.03]' : phase === 'today' ? 'bg-blue-500/15' : ''}`}>
                  <span className={`text-xs font-bold ${phase === 'today' ? 'text-blue-300' : phase === 'completed' ? 'text-slate-500' : 'text-slate-300'}`}>
                    {format(day, 'EEE')}
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium ml-1">{format(day, 'M/d')}</span>
                </div>
              );
            })}
          </div>

          {/* Hours row */}
          <div className={`${insightGrid} border-b border-slate-700/40`}>
            <div className="px-3 py-2 bg-blue-950/40 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Hours</span>
              <span className="text-sm font-bold text-slate-100">{weeklyTotals.hours.toFixed(1)}h</span>
              {canViewAllWages && <span className="text-[11px] font-bold text-blue-300">(${weeklyTotals.wages.toFixed(0)})</span>}
            </div>
            {dailyTotals.map((day, index) => {
              const phase = getDayPhase(index);
              return (
                <div key={index} className={`px-2 py-2 border-r border-slate-700/30 last:border-r-0 text-center flex items-center justify-center gap-1.5 ${phase === 'completed' ? 'bg-white/[0.03]' : phase === 'today' ? 'bg-blue-500/10' : ''}`}>
                  <span className={`text-sm font-bold ${phase === 'completed' ? 'text-slate-500' : 'text-slate-100'}`}>{day.hours.toFixed(1)}h</span>
                  {canViewAllWages && <span className="text-[11px] text-slate-500">(${day.wages.toFixed(0)})</span>}
                </div>
              );
            })}
          </div>

          {/* Labor % row */}
          <div className={`${insightGrid} border-b border-slate-700/40`}>
            <div className="px-3 py-2 bg-blue-950/40 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Labor %</span>
              {weeklyTotals.sales > 0 ? <span className={`text-sm font-bold ${weeklyTotals.laborPercent <= 30 ? 'text-green-400' : weeklyTotals.laborPercent <= 35 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {weeklyTotals.laborPercent.toFixed(1)}%
                </span> : <span className="text-xs text-slate-500">-</span>}
            </div>
            {dailyTotals.map((day, index) => {
              const phase = getDayPhase(index);
              const sales = projectedSales[index] || 0;
              const laborPercent = sales > 0 ? day.wages / sales * 100 : 0;
              const isGood = laborPercent > 0 && laborPercent <= 30;
              const isWarning = laborPercent > 30 && laborPercent <= 35;
              const isBad = laborPercent > 35;
              return <div key={index} className={`px-2 py-2 border-r border-slate-700/30 last:border-r-0 text-center flex items-center justify-center ${phase === 'completed' ? 'bg-white/[0.03]' : phase === 'today' ? 'bg-blue-500/10' : ''}`}>
                    {isLoadingSales ? <span className="text-xs text-slate-500">...</span> : sales > 0 ? <span className={`text-sm font-bold ${isGood ? 'text-green-400' : isWarning ? 'text-yellow-400' : isBad ? 'text-red-400' : 'text-slate-100'}`}>
                        {laborPercent.toFixed(1)}%
                      </span> : <span className="text-xs text-slate-500">-</span>}
                  </div>;
            })}
          </div>

          {/* $/LH row */}
          <div className={`${insightGrid} border-b border-slate-700/40`}>
            <div className="px-3 py-2 bg-blue-950/40 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">$/LH</span>
              {(() => {
                const weeklySalesPerLH = weeklyTotals.hours > 0 ? weeklyTotals.sales / weeklyTotals.hours : 0;
                return weeklySalesPerLH > 0 ? <span className="text-sm font-bold text-slate-100">${weeklySalesPerLH.toFixed(2)}</span> : <span className="text-xs text-slate-500">-</span>;
              })()}
            </div>
            {dailyTotals.map((day, index) => {
              const phase = getDayPhase(index);
              const salesPerLH = day.hours > 0 ? (projectedSales[index] || 0) / day.hours : 0;
              return <div key={index} className={`px-2 py-2 border-r border-slate-700/30 last:border-r-0 text-center flex items-center justify-center ${phase === 'completed' ? 'bg-white/[0.03]' : phase === 'today' ? 'bg-blue-500/10' : ''}`}>
                    {isLoadingSales ? <span className="text-xs text-slate-500">...</span> : day.hours > 0 && salesPerLH > 0 ? <span className={`text-sm font-bold ${phase === 'completed' ? 'text-slate-500' : 'text-slate-100'}`}>
                        ${salesPerLH.toFixed(2)}
                      </span> : <span className="text-xs text-slate-500">-</span>}
                  </div>;
            })}
          </div>

          {/* Sales row */}
          <div className={insightGrid}>
            <div className="px-3 py-2 bg-blue-950/40 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Sales</span>
              {isLoadingQuSales && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
              <span className="text-sm font-bold text-slate-100">${weeklyTotals.sales.toFixed(0)}</span>
            </div>
            {weekDays.map((day, index) => {
              const source = salesSource[index];
              const isLiving = source === 'living';
              const isInitial = source === 'initial' || source === 'ai';
              const isHistorical = source === 'historical';
              const isOverride = source === 'override' || source === 'manual';
              
              const dayStr = format(day, 'yyyy-MM-dd');
              const todayPST = getTodayPST();
              const isPastDay = dayStr <= todayPST;
              const isToday = dayStr === todayPST;
              const phase = getDayPhase(index);
              
              const canReload = isOverride && !isPastDay;
              
              const bgClass = isHistorical ? 'bg-green-500/10' : 
                             isOverride ? 'bg-amber-500/10' : 
                             isLiving ? 'bg-blue-500/5' :
                             phase === 'completed' ? 'bg-white/[0.03]' : isToday ? 'bg-blue-500/10' : '';
              
              return (
                 <div key={index} className={`p-1.5 border-r border-slate-700/30 last:border-r-0 text-center relative ${bgClass}`}>
                  {isEditable ? (
                    <div className="relative flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setProjectionDialogDay(index)}
                        data-sales-cell={dayStr}
                        className={`h-8 flex-1 rounded-lg border text-sm font-bold transition-colors hover:bg-white/5 ${
                          isLiving ? 'border-blue-400/40 bg-blue-500/10 text-blue-200' :
                          isInitial ? 'border-blue-400/20 bg-blue-500/5 text-blue-200' :
                          isOverride ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' :
                          isHistorical ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-slate-600/50 text-slate-100'
                        }`}
                      >
                        {isLoadingSales || isLoadingQuSales ? '...' : projectedSales[index] ? `$${projectedSales[index].toFixed(0)}` : '$0'}
                      </button>
                      {isLiving && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Radio className="h-3 w-3 text-blue-300 animate-pulse shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>Live AI Projection</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {isInitial && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Sparkles className="h-3 w-3 text-blue-300/60 shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>AI Projection</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {isHistorical && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>Actual Sales</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {canReload && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0 shrink-0"
                              onClick={() => handleReloadProjection(index)}
                            >
                              <RotateCcw className="h-3 w-3 text-slate-400 hover:text-blue-300" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>Clear override & reload AI projection</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setProjectionDialogDay(index)}
                      data-sales-cell={dayStr}
                      className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <p className={`text-sm font-bold ${phase === 'completed' ? 'text-slate-500' : 'text-slate-100'}`}>
                        {isLoadingSales || isLoadingQuSales ? '...' : projectedSales[index] ? `$${projectedSales[index].toFixed(0)}` : '-'}
                      </p>
                      {isLiving && <Radio className="h-2.5 w-2.5 text-blue-300 animate-pulse" />}
                      {isInitial && <Sparkles className="h-2.5 w-2.5 text-blue-300/60" />}
                      {isHistorical && <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {projectionDialogDay !== null && (
        <SalesProjectionDialog
          open={projectionDialogDay !== null}
          onOpenChange={open => { if (!open) setProjectionDialogDay(null); }}
          locationId={currentLocation?.id}
          dateStr={format(weekDays[projectionDialogDay], 'yyyy-MM-dd')}
          todayStr={getTodayPST()}
          currentValue={projectedSales[projectionDialogDay] || 0}
          currentSource={salesSource[projectionDialogDay]}
          canEdit={isEditable}
          onSaveOverride={async (value, excludedDates) => {
            await handleSalesChange(projectionDialogDay!, String(value), excludedDates);
            toast.success('Sales number saved');
          }}
          onResetToProjection={async () => {
            await handleReloadProjection(projectionDialogDay!);
          }}
        />
      )}
    </div>;
}