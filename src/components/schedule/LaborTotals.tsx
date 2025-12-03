import { useMemo, useEffect, useState } from 'react';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
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
  const { isAdmin } = useUserRole();
  const weekDays = Array.from({
    length: 7
  }, (_, i) => addDays(currentWeekStart, i));
  const [shiftWages, setShiftWages] = useState<Record<string, number>>({});
  const [isLoadingWages, setIsLoadingWages] = useState(true);
  const [projectedSales, setProjectedSales] = useState<Record<number, number>>({});
  const [isLoadingSales, setIsLoadingSales] = useState(true);
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
        data?.forEach(item => {
          sales[item.day_of_week] = Number(item.projected_sales);
        });
        setProjectedSales(sales);
      } catch (error) {
        console.error('Error fetching projected sales:', error);
      } finally {
        setIsLoadingSales(false);
      }
    };
    fetchProjectedSales();
  }, [scheduleId]);
  const handleSalesChange = async (dayIndex: number, value: string) => {
    if (!scheduleId) return;
    const numValue = parseFloat(value) || 0;
    setProjectedSales(prev => ({
      ...prev,
      [dayIndex]: numValue
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
  // Only show labor totals to admins
  if (!isAdmin) {
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
          <p className="text-xs font-semibold">Sales</p>
          <p className="text-xs font-bold mt-1">${weeklyTotals.sales.toFixed(0)}</p>
        </div>
        {weekDays.map((day, index) => <div key={index} className="p-1 border-r border-border text-center">
            {isEditable ? <Input type="number" step="0.01" min="0" value={projectedSales[index] || ''} onChange={e => handleSalesChange(index, e.target.value)} className="h-7 text-center text-xs p-1" placeholder="$0" /> : <p className="text-xs py-1">
                {isLoadingSales ? '...' : projectedSales[index] ? `$${projectedSales[index].toFixed(0)}` : '-'}
              </p>}
          </div>)}
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