import { useMemo, useEffect, useState } from 'react';
import { format, addDays, isBefore, isToday, startOfDay } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { Sparkles, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
export function LaborTotals({
  shifts,
  profiles,
  currentWeekStart,
  scheduleId,
  isEditable = false
}: LaborTotalsProps) {
  const { canViewAllWages } = useUserRole();
  const { currentLocation } = useAppLocation();
  const weekDays = Array.from({
    length: 7
  }, (_, i) => addDays(currentWeekStart, i));
  const [shiftWages, setShiftWages] = useState<Record<string, number>>({});
  const [isLoadingWages, setIsLoadingWages] = useState(true);
  const [projectedSales, setProjectedSales] = useState<Record<number, number>>({});
  const [salesSource, setSalesSource] = useState<Record<number, 'manual' | 'historical' | 'ai'>>({});
  const [isLoadingSales, setIsLoadingSales] = useState(true);
  const [isLoadingQuSales, setIsLoadingQuSales] = useState(false);
  
  useEffect(() => {
    const fetchWages = async () => {
      setIsLoadingWages(true);
      const wages: Record<string, number> = {};

      // Group shifts by user to reduce queries
      const shiftsByUser = shifts.reduce((acc, shift) => {
        if (!shift.user_id) return acc;
        if (!acc[shift.user_id]) acc[shift.user_id] = [];
        acc[shift.user_id].push(shift);
        return acc;
      }, {} as Record<string, ScheduledShift[]>);

      // Fetch wages for all users in parallel, one query per user
      await Promise.all(Object.entries(shiftsByUser).map(async ([userId, userShifts]) => {
        // Get unique dates for this user
        const uniqueDates = [...new Set(userShifts.map(s => s.shift_date))];

        // Fetch wage for each unique date
        const userWages = await Promise.all(uniqueDates.map(async date => {
          try {
            const {
              data,
              error
            } = await supabase.rpc('get_current_wage', {
              p_user_id: userId,
              p_date: date
            });
            if (!error && data !== null) {
              return {
                date,
                wage: data
              };
            }
          } catch (error) {
            console.error('Error fetching wage:', error);
          }
          return null;
        }));

        // Map wages to shifts
        userShifts.forEach(shift => {
          const wageData = userWages.find(w => w?.date === shift.shift_date);
          if (wageData) {
            wages[shift.id] = wageData.wage;
          }
        });
      }));
      setShiftWages(wages);
      setIsLoadingWages(false);
    };
    if (shifts.length > 0) {
      fetchWages();
    } else {
      setIsLoadingWages(false);
    }
  }, [shifts]);

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
        const sources: Record<number, 'manual' | 'historical' | 'ai'> = {};
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

  // Auto-fill from Qu data - always fetch for all days and use for days without manual entries
  useEffect(() => {
    const fetchQuSalesData = async () => {
      if (!currentLocation?.id || isLoadingSales) return;
      
      const today = startOfDay(new Date());
      
      setIsLoadingQuSales(true);
      try {
        // Fetch sales data for ALL days in the week
        const salesPromises = weekDays.map(async (day, dayIndex) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isPast = isBefore(day, today);
          const isTodayDate = isToday(day);
          
          try {
            const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
              body: { locationId: currentLocation.id, targetDate: dateStr }
            });
            
            if (!error && data) {
              if (isPast || isTodayDate) {
                // Use historical/current data - round to 2 decimals
                const salesValue = Math.round((data.daily || 0) * 100) / 100;
                return { dayIndex, sales: salesValue, source: 'historical' as const };
              } else {
                // Use AI projection for future days - round to 2 decimals
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
        const newSources: Record<number, 'manual' | 'historical' | 'ai'> = { ...salesSource };
        
        results.forEach(result => {
          // Only auto-fill if no manual entry exists
          if (result && result.sales > 0 && !projectedSales[result.dayIndex]) {
            newSales[result.dayIndex] = result.sales;
            newSources[result.dayIndex] = result.source;
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
  }, [currentLocation?.id, isLoadingSales, weekDays.map(d => format(d, 'yyyy-MM-dd')).join(',')]);

  const handleSalesChange = async (dayIndex: number, value: string) => {
    if (!scheduleId) return;
    const numValue = parseFloat(value) || 0;
    setProjectedSales(prev => ({
      ...prev,
      [dayIndex]: numValue
    }));
    setSalesSource(prev => ({
      ...prev,
      [dayIndex]: 'manual'
    }));
    try {
      const {
        error
      } = await supabase.from('schedule_projected_sales').upsert({
        schedule_id: scheduleId,
        day_of_week: dayIndex,
        projected_sales: numValue
      }, {
        onConflict: 'schedule_id,day_of_week'
      });
      if (error) throw error;
    } catch (error) {
      console.error('Error saving projected sales:', error);
      toast.error('Failed to save projected sales');
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
  // Only show labor totals to users who can view wages
  if (!canViewAllWages) {
    return null;
  }

  return <div className="border-t border-border bg-muted/30 text-xs">
      {/* Daily Labor Totals */}
      <div className="grid grid-cols-8 gap-0 border-b border-border">
        <div className="p-2 border-r border-border bg-muted/50">
          <p className="text-xs font-semibold">Week







        </p>
          <p className="text-xs font-bold mt-1">{weeklyTotals.hours.toFixed(1)}h</p>
          <p className="text-[10px] font-bold text-primary">${weeklyTotals.wages.toFixed(0)}</p>
        </div>
        {dailyTotals.map((day, index) => <div key={index} className="p-2 border-r border-border text-center">
            {isLoadingWages ? <p className="text-xs text-muted-foreground">...</p> : <>
                <p className="text-xs font-semibold">{day.hours.toFixed(1)}h</p>
                <p className="text-[10px] text-muted-foreground">${day.wages.toFixed(0)}</p>
              </>}
          </div>)}
      </div>

      {/* Projected Sales Row */}
      <div className="grid grid-cols-8 gap-0 border-b border-border">
        <div className="p-2 border-r border-border bg-muted/50">
          <div className="flex items-center gap-1">
            <p className="text-xs font-semibold">Sales</p>
            {isLoadingQuSales && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs font-bold mt-1">${weeklyTotals.sales.toFixed(0)}</p>
        </div>
        {weekDays.map((day, index) => {
          const source = salesSource[index];
          const isAI = source === 'ai';
          const isHistorical = source === 'historical';
          
          return (
            <div key={index} className="p-1 border-r border-border text-center relative">
              {isEditable ? (
                <div className="relative">
                  <Input 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    value={projectedSales[index] || ''} 
                    onChange={e => handleSalesChange(index, e.target.value)} 
                    className={`h-7 text-center text-xs p-1 ${isAI ? 'pr-5 border-primary/30' : ''}`} 
                    placeholder="$0" 
                  />
                  {isAI && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Sparkles className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-primary" />
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs">AI Projection</p>
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
                  {isAI && <Sparkles className="h-2.5 w-2.5 text-primary" />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Labor Percentage Row */}
      <div className="grid grid-cols-8 gap-0 border-b border-border">
        <div className="p-2 border-r border-border bg-muted/50">
          <p className="text-xs font-semibold">Labor %</p>
          {weeklyTotals.sales > 0 ? <p className={`text-xs font-bold mt-1 ${weeklyTotals.laborPercent <= 30 ? 'text-green-600' : weeklyTotals.laborPercent <= 35 ? 'text-yellow-600' : 'text-red-600'}`}>
              {weeklyTotals.laborPercent.toFixed(1)}%
            </p> : <p className="text-xs text-muted-foreground mt-1">-</p>}
        </div>
        {dailyTotals.map((day, index) => {
        const sales = projectedSales[index] || 0;
        const laborPercent = sales > 0 ? day.wages / sales * 100 : 0;
        const isGood = laborPercent > 0 && laborPercent <= 30;
        const isWarning = laborPercent > 30 && laborPercent <= 35;
        const isBad = laborPercent > 35;
        return <div key={index} className="p-2 border-r border-border text-center">
              {isLoadingWages || isLoadingSales ? <p className="text-xs text-muted-foreground">...</p> : sales > 0 ? <p className={`text-xs font-semibold ${isGood ? 'text-green-600' : isWarning ? 'text-yellow-600' : isBad ? 'text-red-600' : ''}`}>
                  {laborPercent.toFixed(1)}%
                </p> : <p className="text-xs text-muted-foreground">-</p>}
            </div>;
      })}
      </div>

      {/* Sales Per Labor Hour Row */}
      <div className="grid grid-cols-8 gap-0">
        <div className="p-2 border-r border-border bg-muted/50">
          <p className="text-xs font-semibold">$/LH</p>
          {(() => {
          const weeklySalesPerLH = weeklyTotals.hours > 0 ? weeklyTotals.sales / weeklyTotals.hours : 0;
          return weeklySalesPerLH > 0 ? <p className="text-xs font-bold mt-1">${weeklySalesPerLH.toFixed(2)}</p> : <p className="text-xs text-muted-foreground mt-1">-</p>;
        })()}
        </div>
        {dailyTotals.map((day, index) => {
        const salesPerLH = day.hours > 0 ? (projectedSales[index] || 0) / day.hours : 0;
        return <div key={index} className="p-2 border-r border-border text-center">
              {isLoadingWages || isLoadingSales ? <p className="text-xs text-muted-foreground">...</p> : day.hours > 0 && salesPerLH > 0 ? <p className="text-xs font-semibold text-foreground">
                  ${salesPerLH.toFixed(2)}
                </p> : <p className="text-xs text-muted-foreground">-</p>}
            </div>;
      })}
      </div>
    </div>;
}