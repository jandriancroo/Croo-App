import { useMemo, useEffect, useState } from 'react';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

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
}

export function LaborTotals({ shifts, profiles, currentWeekStart }: LaborTotalsProps) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  const [shiftWages, setShiftWages] = useState<Record<string, number>>({});
  const [isLoadingWages, setIsLoadingWages] = useState(true);

  useEffect(() => {
    const fetchWages = async () => {
      setIsLoadingWages(true);
      const wages: Record<string, number> = {};
      
      // Fetch wage for each shift individually based on shift date
      await Promise.all(
        shifts.map(async (shift) => {
          if (!shift.user_id) return;
          
          try {
            const { data, error } = await supabase.rpc('get_current_wage', {
              p_user_id: shift.user_id,
              p_date: shift.shift_date
            });
            
            if (!error && data !== null) {
              wages[shift.id] = data;
            } else if (error) {
              console.error('Error fetching wage for shift:', shift.id, error);
            }
          } catch (error) {
            console.error('Error fetching wage:', error);
          }
        })
      );
      
      setShiftWages(wages);
      setIsLoadingWages(false);
    };

    if (shifts.length > 0) {
      fetchWages();
    } else {
      setIsLoadingWages(false);
    }
  }, [shifts]);

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

  return (
    <div className="border-t border-border bg-muted/30">
      <div className="grid grid-cols-8 gap-0">
        <div className="p-3 border-r border-border">
          <p className="text-sm font-semibold">Daily Totals</p>
        </div>
        {dailyTotals.map((day, index) => (
          <div key={index} className="p-3 border-r last:border-r-0 border-border text-center">
            {isLoadingWages ? (
              <p className="text-sm text-muted-foreground">...</p>
            ) : (
              <>
                <p className="text-sm font-semibold">{day.hours.toFixed(1)}h</p>
                <p className="text-xs text-muted-foreground">${day.wages.toFixed(0)}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}