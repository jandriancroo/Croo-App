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
  const [userWages, setUserWages] = useState<Record<string, number>>({});
  const [isLoadingWages, setIsLoadingWages] = useState(true);

  useEffect(() => {
    const fetchWages = async () => {
      setIsLoadingWages(true);
      const wages: Record<string, number> = {};
      
      // Get unique user IDs from shifts
      const uniqueUserIds = Array.from(new Set(shifts.filter(s => s.user_id).map(s => s.user_id)));
      
      // Fetch wage for each user
      await Promise.all(
        uniqueUserIds.map(async (userId) => {
          if (!userId) return;
          
          try {
            // Use the first shift date for this user, or current week start
            const userShift = shifts.find(s => s.user_id === userId);
            const dateToUse = userShift?.shift_date || format(currentWeekStart, 'yyyy-MM-dd');
            
            const { data, error } = await supabase.rpc('get_current_wage', {
              p_user_id: userId,
              p_date: dateToUse
            });
            
            if (!error && data !== null) {
              wages[userId] = data;
            } else if (error) {
              console.error('Error fetching wage for user:', userId, error);
            }
          } catch (error) {
            console.error('Error fetching wage:', error);
          }
        })
      );
      
      setUserWages(wages);
      setIsLoadingWages(false);
    };

    if (shifts.length > 0) {
      fetchWages();
    } else {
      setIsLoadingWages(false);
    }
  }, [shifts, currentWeekStart]);

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
        
        // Use wage from database function, fallback to profile wage, then to default
        const wage = userWages[shift.user_id] ?? profile?.hourly_wage ?? 15;
        totalWages += shiftHours * wage;
      });

      return {
        date: format(day, 'EEE'),
        hours: totalHours,
        wages: totalWages
      };
    });
  }, [shifts, profiles, weekDays, userWages, isLoadingWages]);

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