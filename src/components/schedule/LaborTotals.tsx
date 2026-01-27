import { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, isBefore, isToday, startOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Loader2, RotateCcw, CheckCircle2, Radio, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getCachedSalesData, setCachedSalesData } from '@/utils/salesCache';
import { resolveProjection, ProjectionSource } from '@/hooks/useResolvedProjection';
import { useAuth } from '@/lib/auth';
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
  const weekDays = Array.from({
    length: 7
  }, (_, i) => addDays(currentWeekStart, i));
  const [projectedSales, setProjectedSales] = useState<Record<number, number>>({});
  const [salesSource, setSalesSource] = useState<Record<number, 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial'>>({});
  const [isLoadingSales, setIsLoadingSales] = useState(true);
  const [isLoadingQuSales, setIsLoadingQuSales] = useState(false);
  const { user } = useAuth();

  // Compute a stable key for shifts to trigger wage refetch
  const shiftsKey = useMemo(() => {
    return shifts.map(s => `${s.id}-${s.user_id}-${s.shift_date}`).join('|');
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
  // - Past days: use localStorage cache or fetch actuals
  // - Today: fetch live from API (real-time pace)
  // - Future days: read from sales_cache.projected_sales (fixed monthly projection)
  useEffect(() => {
    const fetchQuSalesData = async () => {
      if (!currentLocation?.id || isLoadingSales) return;
      
      const today = startOfDay(new Date());
      
      setIsLoadingQuSales(true);
      try {
        // Collect all future dates to batch-fetch from sales_cache
        const futureDates: string[] = [];
        const futureDayIndexMap: Record<string, number> = {};
        
        weekDays.forEach((day, dayIndex) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, today);
          const isTodayDate = isToday(day);
          
          if (!isPast && !isTodayDate) {
            futureDates.push(dateStr);
            futureDayIndexMap[dateStr] = dayIndex;
          }
        });
        
        // Batch fetch cached projections for future dates from sales_cache
        // Use new projection columns: override_projection > living_projection > initial_projection
        let cachedProjections: Record<string, { value: number; source: 'override' | 'living' | 'initial' | 'ai' }> = {};
        if (futureDates.length > 0) {
          const { data: cacheData } = await supabase
            .from('sales_cache')
            .select('sale_date, initial_projection, living_projection, override_projection, projected_sales')
            .eq('location_id', currentLocation.id)
            .in('sale_date', futureDates);
          
          if (cacheData) {
            cacheData.forEach(row => {
              // Resolution priority: override > living > initial > legacy
              const resolved = resolveProjection({
                initial_projection: row.initial_projection,
                living_projection: row.living_projection,
                override_projection: row.override_projection,
                projected_sales: row.projected_sales
              });
              
              if (resolved.value && resolved.value > 0) {
                cachedProjections[row.sale_date] = { 
                  value: resolved.value, 
                  source: resolved.source === 'legacy' ? 'ai' : resolved.source as 'override' | 'living' | 'initial'
                };
              }
            });
          }
        }
        
        // Process all days
        const salesPromises = weekDays.map(async (day, dayIndex) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, today);
          const isTodayDate = isToday(day);
          
          // PAST DAYS: Check localStorage cache first
          if (isPast) {
            const cached = getCachedSalesData(currentLocation.id, dateStr);
            if (cached) {
              const salesValue = Math.round(cached.daily * 100) / 100;
              return { dayIndex, sales: salesValue, source: 'historical' as const };
            }
          }
          
          // FUTURE DAYS: Use cached projection from sales_cache (with resolution priority)
          if (!isPast && !isTodayDate) {
            const cachedProjection = cachedProjections[dateStr];
            if (cachedProjection) {
              return { dayIndex, sales: Math.round(cachedProjection.value * 100) / 100, source: cachedProjection.source };
            }
            // No cached projection - will need to trigger a fetch to populate it
          }
          
          // TODAY or cache miss: Fetch live from API
          try {
            // For "today", don't pass targetDate - let edge function use PST "today"
            // This avoids timezone mismatch where browser thinks it's "tomorrow" but store is still "today"
            const body = isTodayDate 
              ? { locationId: currentLocation.id }
              : { locationId: currentLocation.id, targetDate: dateStr };
            
            const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", { body });
            
            if (!error && data) {
              // Cache past data for future use (localStorage)
              if (isPast && data.daily > 0) {
                setCachedSalesData(currentLocation.id, dateStr, {
                  daily: data.daily,
                  hourly: data.hourly || [],
                  guestCount: data.guestCount || { daily: 0 }
                });
              }
              
              if (isPast) {
                // Past days: use actual sales (historical)
                const salesValue = Math.round((data.daily || 0) * 100) / 100;
                return { dayIndex, sales: salesValue, source: 'historical' as const };
              } else {
                // Today and future: use projection (goal/target)
                const salesValue = Math.round((data.projections?.todayProjected || 0) * 100) / 100;
                return { dayIndex, sales: salesValue, source: 'ai' as const };
              }
            }
          } catch (err) {
            console.error(`Failed to fetch Qu sales for ${dateStr}:`, err);
          }
          return null;
        });
        
        const results = await Promise.all(salesPromises);
        
        const newSales: Record<number, number> = { ...projectedSales };
        const newSources: Record<number, 'manual' | 'historical' | 'ai' | 'override' | 'living' | 'initial'> = { ...salesSource };
        
        results.forEach(result => {
          if (result && result.sales > 0) {
            const day = weekDays[result.dayIndex];
            const isPastDay = isBefore(day, today) || isToday(day);
            
            // For past/today days: always use actuals and mark as historical
            // For future days: only auto-fill if no manual entry exists
            if (isPastDay) {
              newSales[result.dayIndex] = result.sales;
              newSources[result.dayIndex] = 'historical';
            } else if (!projectedSales[result.dayIndex]) {
              newSales[result.dayIndex] = result.sales;
              newSources[result.dayIndex] = result.source;
            }
          }
        });
        
        setProjectedSales(newSales);
        setSalesSource(newSources);
      } catch (error) {
        console.error('Error fetching Qu sales data:', error);
      } finally {
        setIsLoadingQuSales(false);
      }
    };
    
    fetchQuSalesData();
  }, [currentLocation?.id, isLoadingSales, weekDatesKey]);

  const handleSalesChange = async (dayIndex: number, value: string) => {
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
      const { error } = await supabase
        .from('sales_cache')
        .upsert({
          location_id: currentLocation.id,
          sale_date: dateStr,
          override_projection: numValue,
          override_at: new Date().toISOString(),
          override_by: user?.id || null
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
    const today = startOfDay(new Date());
    const isPast = isBefore(day, today);
    const isTodayDate = isToday(day);
    
    try {
      // Clear override from sales_cache
      await supabase
        .from('sales_cache')
        .update({
          override_projection: null,
          override_at: null,
          override_by: null
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
          const sourceLabel = source === 'living' ? 'Live AI projection' : 
                             source === 'initial' ? 'AI projection' : 
                             source === 'historical' ? 'actual sales' : 'AI projection';
          toast.success(`Reloaded ${sourceLabel} for ${format(day, 'EEE')}`);
        } else {
          toast.info(`No projection available for ${format(day, 'EEE')}`);
        }
      } else {
        // No cache data, try fetching from API
        const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
          body: { locationId: currentLocation.id, targetDate: dateStr }
        });
        
        if (!error && data) {
          let salesValue: number;
          let source: 'historical' | 'living';
          
          if (isPast || isTodayDate) {
            salesValue = Math.round((data.daily || 0) * 100) / 100;
            source = 'historical';
          } else {
            salesValue = Math.round((data.projections?.todayProjected || 0) * 100) / 100;
            source = 'living';
          }
          
          if (salesValue > 0) {
            setProjectedSales(prev => ({ ...prev, [dayIndex]: salesValue }));
            setSalesSource(prev => ({ ...prev, [dayIndex]: source }));
            toast.success(`Reloaded ${source === 'living' ? 'Live AI projection' : 'actual sales'} for ${format(day, 'EEE')}`);
          } else {
            toast.info(`No projection available for ${format(day, 'EEE')}`);
          }
        } else {
          toast.error('Failed to reload projection');
        }
      }
    } catch (error) {
      console.error('Error reloading projection:', error);
      toast.error('Failed to reload projection');
    }
  };
  
  const dailyTotals = useMemo(() => {
    return weekDays.map((day, dayIndex) => {
      const dayShifts = shifts.filter(s => s.day_of_week === dayIndex);
      let totalHours = 0;
      let totalWages = 0;
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
        // Handle midnight crossover (e.g., 6pm-12am = 18:00-00:00)
        if (hours < 0) {
          hours += 24;
        }
        let shiftHours = hours + minutes / 60;

        // Deduct 30 minutes if shift is over 5 hours
        if (shiftHours > 5) {
          shiftHours -= 0.5;
        }
        totalHours += shiftHours;

        // Use wage from database function for this specific shift, fallback to profile wage, then to default
        const wage = shiftWages[shift.id] ?? profile?.hourly_wage ?? 15;
        totalWages += shiftHours * wage;
      });
      return {
        date: format(day, 'EEE'),
        hours: totalHours,
        wages: totalWages
      };
    });
  }, [shifts, profiles, weekDays, shiftWages, isLoadingWages]);
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
  // Only show labor totals to users who can view sales/labor
  // (shift managers and above, OR team members with location setting enabled)
  if (!canSeeSales) {
    return null;
  }

  return <div className="border-t border-border bg-muted/30 text-xs min-w-[700px]">
      {/* Daily Labor Totals */}
      <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0 border-b border-border">
        <div className="px-2 py-1 border-r border-border bg-muted/50 flex items-center gap-1.5">
          <span className="text-xs font-semibold">Week</span>
          <span className="text-xs font-bold">{weeklyTotals.hours.toFixed(1)}h</span>
          {canViewAllWages && <span className="text-[10px] font-bold text-primary">(${weeklyTotals.wages.toFixed(0)})</span>}
        </div>
        {dailyTotals.map((day, index) => <div key={index} className="px-2 py-1 border-r border-border text-center flex items-center justify-center gap-1">
            {isLoadingWages ? <span className="text-xs text-muted-foreground">...</span> : <>
                <span className="text-xs font-semibold">{day.hours.toFixed(1)}h</span>
                {canViewAllWages && <span className="text-[10px] text-muted-foreground">(${day.wages.toFixed(0)})</span>}
              </>}
          </div>)}
      </div>

      {/* Projected Sales Row */}
      <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0 border-b border-border">
        <div className="px-2 py-1 border-r border-border bg-muted/50 flex items-center gap-1.5">
          <span className="text-xs font-semibold">Sales</span>
          {isLoadingQuSales && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <span className="text-xs font-bold">${weeklyTotals.sales.toFixed(0)}</span>
        </div>
        {weekDays.map((day, index) => {
          const source = salesSource[index];
          const isLiving = source === 'living';
          const isInitial = source === 'initial' || source === 'ai';
          const isHistorical = source === 'historical';
          const isOverride = source === 'override' || source === 'manual';
          
          // Determine if this is a past day (no reload possible - use actuals)
          const today = startOfDay(new Date());
          const isPastDay = isBefore(day, today) || isToday(day);
          
          // Only show reload button for future days with overrides
          const canReload = isOverride && !isPastDay;
          
          // Determine background color based on source
          const bgClass = isHistorical ? 'bg-green-500/10' : 
                         isOverride ? 'bg-amber-500/10' : 
                         isLiving ? 'bg-primary/5' : '';
          
          return (
            <div key={index} className={`p-1 border-r border-border text-center relative ${bgClass}`}>
              {isEditable ? (
                <div className="relative flex items-center gap-0.5">
                  <Input 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    value={projectedSales[index] || ''} 
                    onChange={e => handleSalesChange(index, e.target.value)} 
                    className={`h-7 text-center text-xs p-1 flex-1 ${
                      isLiving ? 'border-primary/30' : 
                      isInitial ? 'border-primary/20' : 
                      isOverride ? 'border-amber-500/30 bg-amber-500/5' :
                      isHistorical ? 'border-green-500/30 bg-green-500/5' : ''
                    }`} 
                    placeholder="$0" 
                  />
                  {isLiving && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Radio className="h-3 w-3 text-primary animate-pulse shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs">Live AI Projection</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {isInitial && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Sparkles className="h-3 w-3 text-primary/60 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs">AI Projection</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {/* Pencil icon removed - amber border already indicates override */}
                  {isHistorical && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs">Actual Sales</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {canReload && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 p-0 shrink-0"
                            onClick={() => handleReloadProjection(index)}
                          >
                            <RotateCcw className="h-3 w-3 text-muted-foreground hover:text-primary" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs">Clear override & reload AI projection</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center gap-0.5 py-1">
                  <p className="text-xs">
                    {isLoadingSales || isLoadingQuSales ? '...' : projectedSales[index] ? `$${projectedSales[index].toFixed(0)}` : '-'}
                  </p>
                  {isLiving && <Radio className="h-2.5 w-2.5 text-primary animate-pulse" />}
                  {isInitial && <Sparkles className="h-2.5 w-2.5 text-primary/60" />}
                  {/* Pencil icon removed - amber border already indicates override */}
                  {isHistorical && <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Labor Percentage Row */}
      <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0 border-b border-border">
        <div className="px-2 py-1 border-r border-border bg-muted/50 flex items-center gap-1.5">
          <span className="text-xs font-semibold">Labor %</span>
          {weeklyTotals.sales > 0 ? <span className={`text-xs font-bold ${weeklyTotals.laborPercent <= 30 ? 'text-green-600' : weeklyTotals.laborPercent <= 35 ? 'text-yellow-600' : 'text-red-600'}`}>
              {weeklyTotals.laborPercent.toFixed(1)}%
            </span> : <span className="text-xs text-muted-foreground">-</span>}
        </div>
        {dailyTotals.map((day, index) => {
        const sales = projectedSales[index] || 0;
        const laborPercent = sales > 0 ? day.wages / sales * 100 : 0;
        const isGood = laborPercent > 0 && laborPercent <= 30;
        const isWarning = laborPercent > 30 && laborPercent <= 35;
        const isBad = laborPercent > 35;
        return <div key={index} className="px-2 py-1 border-r border-border text-center flex items-center justify-center">
              {isLoadingWages || isLoadingSales ? <span className="text-xs text-muted-foreground">...</span> : sales > 0 ? <span className={`text-xs font-semibold ${isGood ? 'text-green-600' : isWarning ? 'text-yellow-600' : isBad ? 'text-red-600' : ''}`}>
                  {laborPercent.toFixed(1)}%
                </span> : <span className="text-xs text-muted-foreground">-</span>}
            </div>;
      })}
      </div>

      {/* Sales Per Labor Hour Row */}
      <div className="grid grid-cols-[110px_repeat(7,1fr)] md:grid-cols-[130px_repeat(7,1fr)] lg:grid-cols-[180px_repeat(7,1fr)] xl:grid-cols-[200px_repeat(7,1fr)] gap-0">
        <div className="px-2 py-1 border-r border-border bg-muted/50 flex items-center gap-1.5">
          <span className="text-xs font-semibold">$/LH</span>
          {(() => {
          const weeklySalesPerLH = weeklyTotals.hours > 0 ? weeklyTotals.sales / weeklyTotals.hours : 0;
          return weeklySalesPerLH > 0 ? <span className="text-xs font-bold">${weeklySalesPerLH.toFixed(2)}</span> : <span className="text-xs text-muted-foreground">-</span>;
        })()}
        </div>
        {dailyTotals.map((day, index) => {
        const salesPerLH = day.hours > 0 ? (projectedSales[index] || 0) / day.hours : 0;
        return <div key={index} className="px-2 py-1 border-r border-border text-center flex items-center justify-center">
              {isLoadingWages || isLoadingSales ? <span className="text-xs text-muted-foreground">...</span> : day.hours > 0 && salesPerLH > 0 ? <span className="text-xs font-semibold text-foreground">
                  ${salesPerLH.toFixed(2)}
                </span> : <span className="text-xs text-muted-foreground">-</span>}
            </div>;
      })}
      </div>
    </div>;
}