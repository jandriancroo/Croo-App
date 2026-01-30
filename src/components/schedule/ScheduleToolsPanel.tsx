import { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, isBefore, isToday, startOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useTeamSalesVisibility } from '@/hooks/useTeamSalesVisibility';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Loader2, RotateCcw, CheckCircle2, Radio, Sparkles, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getCachedSalesData, setCachedSalesData } from '@/utils/salesCache';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { useAuth } from '@/lib/auth';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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

interface ScheduleToolsPanelProps {
  shifts: ScheduledShift[];
  profiles: Profile[];
  currentWeekStart: Date;
  scheduleId?: string | null;
  isEditable?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function ScheduleToolsPanel({
  shifts,
  profiles,
  currentWeekStart,
  scheduleId,
  isEditable = false,
  open,
  onOpenChange
}: ScheduleToolsPanelProps) {
  const { canViewAllWages } = useUserRole();
  const { canSeeSales } = useTeamSalesVisibility();
  const { currentLocation } = useAppLocation();
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
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
      
      const shiftsByUser = shifts.reduce((acc, shift) => {
        if (!shift.user_id) return acc;
        if (!acc[shift.user_id]) acc[shift.user_id] = [];
        acc[shift.user_id].push(shift);
        return acc;
      }, {} as Record<string, ScheduledShift[]>);

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
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
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
        const { data, error } = await supabase
          .from('schedule_projected_sales')
          .select('*')
          .eq('schedule_id', scheduleId);
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

  // Auto-fill from Qu data
  useEffect(() => {
    const fetchQuSalesData = async () => {
      if (!currentLocation?.id || isLoadingSales) return;
      
      const today = startOfDay(new Date());
      
      setIsLoadingQuSales(true);
      try {
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
        
        let cachedProjections: Record<string, { value: number; source: 'override' | 'living' | 'initial' | 'ai' }> = {};
        if (futureDates.length > 0) {
          const { data: cacheData } = await supabase
            .from('sales_cache')
            .select('sale_date, initial_projection, living_projection, override_projection, projected_sales')
            .eq('location_id', currentLocation.id)
            .in('sale_date', futureDates);
          
          if (cacheData) {
            cacheData.forEach(row => {
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
        
        const salesPromises = weekDays.map(async (day, dayIndex) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, today);
          const isTodayDate = isToday(day);
          
          if (isPast) {
            const cached = getCachedSalesData(currentLocation.id, dateStr);
            if (cached) {
              const salesValue = Math.round(cached.daily * 100) / 100;
              return { dayIndex, sales: salesValue, source: 'historical' as const };
            }
          }
          
          if (!isPast && !isTodayDate) {
            const cachedProjection = cachedProjections[dateStr];
            if (cachedProjection) {
              return { dayIndex, sales: Math.round(cachedProjection.value * 100) / 100, source: cachedProjection.source };
            }
          }
          
          try {
            const body = isTodayDate 
              ? { locationId: currentLocation.id }
              : { locationId: currentLocation.id, targetDate: dateStr };
            
            const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", { body });
            
            if (!error && data) {
              if (isPast && data.daily > 0) {
                setCachedSalesData(currentLocation.id, dateStr, {
                  daily: data.daily,
                  hourly: data.hourly || [],
                  guestCount: data.guestCount || { daily: 0 }
                });
              }
              
              if (isPast) {
                const salesValue = Math.round((data.daily || 0) * 100) / 100;
                return { dayIndex, sales: salesValue, source: 'historical' as const };
              } else {
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
    
    setProjectedSales(prev => ({ ...prev, [dayIndex]: numValue }));
    setSalesSource(prev => ({ ...prev, [dayIndex]: 'override' }));
    
    try {
      const { error } = await supabase
        .from('sales_cache')
        .upsert({
          location_id: currentLocation.id,
          sale_date: dateStr,
          override_projection: numValue,
          override_at: new Date().toISOString(),
          override_by: user?.id || null
        }, { onConflict: 'location_id,sale_date' });
      
      if (error) throw error;
      
      if (scheduleId) {
        await supabase.from('schedule_projected_sales').upsert({
          schedule_id: scheduleId,
          day_of_week: dayIndex,
          projected_sales: numValue
        }, { onConflict: 'schedule_id,day_of_week' });
      }
    } catch (error) {
      console.error('Error saving override projection:', error);
      toast.error('Failed to save override');
    }
  };

  const handleReloadProjection = async (dayIndex: number) => {
    if (!currentLocation?.id) return;
    
    const day = weekDays[dayIndex];
    const dateStr = format(day, 'yyyy-MM-dd');
    const today = startOfDay(new Date());
    const isPast = isBefore(day, today);
    const isTodayDate = isToday(day);
    
    try {
      await supabase
        .from('sales_cache')
        .update({
          override_projection: null,
          override_at: null,
          override_by: null
        })
        .eq('location_id', currentLocation.id)
        .eq('sale_date', dateStr);
      
      if (scheduleId) {
        await supabase
          .from('schedule_projected_sales')
          .delete()
          .eq('schedule_id', scheduleId)
          .eq('day_of_week', dayIndex);
      }
      
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
          salesValue = Math.round((cacheData.net_sales || 0) * 100) / 100;
          source = 'historical';
        } else {
          const resolved = resolveProjection({
            initial_projection: cacheData.initial_projection,
            living_projection: cacheData.living_projection,
            override_projection: null,
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

        if (shiftHours > 5) {
          shiftHours -= 0.5;
        }
        totalHours += shiftHours;

        const wage = shiftWages[shift.id] ?? profile?.hourly_wage ?? 15;
        totalWages += shiftHours * wage;
      });
      return {
        date: format(day, 'EEE'),
        fullDate: format(day, 'MMM d'),
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

  if (!canSeeSales) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Schedule Tools
          </SheetTitle>
        </SheetHeader>

        <div className="py-4 space-y-6">
          {/* Weekly Summary Card */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold">Weekly Summary</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Hours</p>
                <p className="text-lg font-bold">{weeklyTotals.hours.toFixed(1)}h</p>
              </div>
              {canViewAllWages && (
                <div>
                  <p className="text-xs text-muted-foreground">Total Wages</p>
                  <p className="text-lg font-bold text-primary">${weeklyTotals.wages.toFixed(0)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Total Sales</p>
                <p className="text-lg font-bold flex items-center gap-1">
                  ${weeklyTotals.sales.toFixed(0)}
                  {isLoadingQuSales && <Loader2 className="h-3 w-3 animate-spin" />}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Labor %</p>
                <p className={`text-lg font-bold ${
                  weeklyTotals.laborPercent <= 30 ? 'text-green-600' : 
                  weeklyTotals.laborPercent <= 35 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {weeklyTotals.laborPercent.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          {/* Daily Breakdown */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Daily Breakdown</h3>
            <div className="space-y-2">
              {dailyTotals.map((day, index) => {
                const sales = projectedSales[index] || 0;
                const laborPercent = sales > 0 ? day.wages / sales * 100 : 0;
                const salesPerLH = day.hours > 0 ? sales / day.hours : 0;
                const source = salesSource[index];
                const isLiving = source === 'living';
                const isInitial = source === 'initial' || source === 'ai';
                const isHistorical = source === 'historical';
                const isOverride = source === 'override' || source === 'manual';
                
                const today = startOfDay(new Date());
                const dayDate = weekDays[index];
                const isPastDay = isBefore(dayDate, today) || isToday(dayDate);
                const canReload = isOverride && !isPastDay;

                return (
                  <div 
                    key={index} 
                    className={`rounded-lg border p-3 space-y-2 ${
                      isHistorical ? 'bg-green-500/5 border-green-500/20' :
                      isOverride ? 'bg-amber-500/5 border-amber-500/20' :
                      isLiving ? 'bg-primary/5 border-primary/20' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{day.date}</span>
                        <span className="text-xs text-muted-foreground">{day.fullDate}</span>
                        {isLiving && <Radio className="h-3 w-3 text-primary animate-pulse" />}
                        {isInitial && <Sparkles className="h-3 w-3 text-primary/60" />}
                        {isHistorical && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                      </div>
                      {canReload && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleReloadProjection(index)}
                              >
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Clear override & reload AI projection</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Hours</p>
                        <p className="font-semibold">
                          {isLoadingWages ? '...' : `${day.hours.toFixed(1)}h`}
                        </p>
                      </div>
                      {canViewAllWages && (
                        <div>
                          <p className="text-muted-foreground">Wages</p>
                          <p className="font-semibold">
                            {isLoadingWages ? '...' : `$${day.wages.toFixed(0)}`}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-muted-foreground">Labor %</p>
                        <p className={`font-semibold ${
                          laborPercent <= 30 ? 'text-green-600' : 
                          laborPercent <= 35 ? 'text-yellow-600' : 
                          laborPercent > 35 ? 'text-red-600' : ''
                        }`}>
                          {sales > 0 ? `${laborPercent.toFixed(1)}%` : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">$/LH</p>
                        <p className="font-semibold">
                          {day.hours > 0 && salesPerLH > 0 ? `$${salesPerLH.toFixed(0)}` : '-'}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Sales</p>
                      {isEditable ? (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={projectedSales[index] || ''}
                          onChange={e => handleSalesChange(index, e.target.value)}
                          className="h-8 text-sm"
                          placeholder="$0"
                        />
                      ) : (
                        <p className="font-semibold">
                          {isLoadingSales || isLoadingQuSales ? '...' : 
                           projectedSales[index] ? `$${projectedSales[index].toFixed(0)}` : '-'}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
