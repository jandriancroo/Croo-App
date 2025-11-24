import { useMemo } from 'react';
import { format, addDays } from 'date-fns';

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

  const dailyTotals = useMemo(() => {
    return weekDays.map((day, dayIndex) => {
      const dayShifts = shifts.filter(s => s.day_of_week === dayIndex);
      
      let totalHours = 0;
      let totalWages = 0;

      dayShifts.forEach(shift => {
        const profile = profiles.find(p => p.id === shift.user_id);
        if (!profile || !shift.user_id) return;

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
        totalWages += shiftHours * (profile.hourly_wage || 15);
      });

      return {
        date: format(day, 'EEE'),
        hours: totalHours,
        wages: totalWages
      };
    });
  }, [shifts, profiles, weekDays]);

  return (
    <div className="border-t border-border bg-muted/30">
      <div className="grid grid-cols-8 gap-0">
        <div className="p-3 border-r border-border">
          <p className="text-sm font-semibold">Daily Totals</p>
        </div>
        {dailyTotals.map((day, index) => (
          <div key={index} className="p-3 border-r last:border-r-0 border-border text-center">
            <p className="text-sm font-semibold">{day.hours.toFixed(1)}h</p>
            <p className="text-xs text-muted-foreground">${day.wages.toFixed(0)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}