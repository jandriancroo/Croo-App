import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { startOfWeek, endOfWeek, addDays, differenceInMinutes, parseISO } from 'date-fns';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { calculateCutoffHour } from '@/utils/timezoneUtils';

export interface ShiftEntry {
  date: string;
  clockIn: Date;
  clockOut: Date | null;
  hours: number;
  estimatedPay: number;
}

export interface PersonalPayData {
  hoursWeek: number;
  hoursPayroll: number;
  payWeek: number;
  payPayroll: number;
  shifts: ShiftEntry[];
  payPeriodStart: string;
  payPeriodEnd: string;
  hourlyWage: number;
}

interface TimePunch {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
  notes: string | null;
}

// Baseline for pay periods: Nov 3, 2025 (Monday)
const PAY_PERIOD_BASELINE = new Date(2025, 10, 3);

export function getPayPeriodDates(periodOffset: number = 0, timezone: string = 'America/Los_Angeles'): { start: Date; end: Date; startStr: string; endStr: string } {
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);
  
  // Calculate days since baseline
  const daysSinceBaseline = Math.floor((zonedNow.getTime() - PAY_PERIOD_BASELINE.getTime()) / (1000 * 60 * 60 * 24));
  
  // Each pay period is 14 days
  const periodsElapsed = Math.floor(daysSinceBaseline / 14) + periodOffset;
  
  // Calculate period start
  const periodStart = new Date(PAY_PERIOD_BASELINE);
  periodStart.setDate(PAY_PERIOD_BASELINE.getDate() + (periodsElapsed * 14));
  
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodStart.getDate() + 13);
  
  return {
    start: periodStart,
    end: periodEnd,
    startStr: formatTZ(periodStart, 'yyyy-MM-dd', { timeZone: timezone }),
    endStr: formatTZ(periodEnd, 'yyyy-MM-dd', { timeZone: timezone }),
  };
}

export function usePersonalPayData(periodOffset: number = 0) {
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();

  return useQuery({
    queryKey: ['personal-pay-data', user?.id, currentLocation?.id, periodOffset],
    queryFn: async (): Promise<PersonalPayData | null> => {
      if (!user?.id || !currentLocation?.id) return null;

      // Get user's hourly wage
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('hourly_wage')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('[usePersonalPayData] Error fetching profile:', profileError);
        return null;
      }

      const hourlyWage = profile?.hourly_wage || 0;

      // Fetch location hours for dynamic cutoff calculation
      const { data: locationHours } = await supabase
        .from('location_hours')
        .select('day_of_week, close_time')
        .eq('location_id', currentLocation.id);
      
      // Create map of day_of_week -> cutoff hour (close_time + 3 hours)
      const cutoffByDayOfWeek = new Map<number, number>();
      (locationHours || []).forEach((h: { day_of_week: number; close_time: string | null }) => {
        cutoffByDayOfWeek.set(h.day_of_week, calculateCutoffHour(h.close_time));
      });
      const defaultCutoff = 5;

      // Calculate week start/end in timezone
      const now = new Date();
      const zonedNow = toZonedTime(now, timezone);
      const weekStart = startOfWeek(zonedNow, { weekStartsOn: 1 }); // Monday
      const weekEnd = endOfWeek(zonedNow, { weekStartsOn: 1 }); // Sunday
      
      const weekStartStr = formatTZ(weekStart, 'yyyy-MM-dd', { timeZone: timezone });
      const weekEndStr = formatTZ(addDays(weekEnd, 1), 'yyyy-MM-dd', { timeZone: timezone }); // Include full Sunday
      
      // Calculate pay period dates using shared function
      const payPeriod = getPayPeriodDates(periodOffset, timezone);
      const payPeriodStartStr = payPeriod.startStr;
      const payPeriodEndStr = formatTZ(addDays(payPeriod.end, 1), 'yyyy-MM-dd', { timeZone: timezone }); // day after end for < comparison

      // Fetch punches for both week and pay period (use wider range + buffer for overnight)
      const earlierDate = payPeriodStartStr < weekStartStr ? payPeriodStartStr : weekStartStr;
      const laterDate = payPeriodEndStr > weekEndStr ? payPeriodEndStr : weekEndStr;
      
      // Expand range by 1 day on each side to capture overnight shifts
      const queryStartDate = new Date(earlierDate);
      queryStartDate.setDate(queryStartDate.getDate() - 1);
      const queryEndDate = new Date(laterDate);
      queryEndDate.setDate(queryEndDate.getDate() + 1);
      
      const { data: punches, error: punchError } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_type, punch_time, notes')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .gte('punch_time', queryStartDate.toISOString())
        .lt('punch_time', queryEndDate.toISOString())
        .order('punch_time', { ascending: true });

      if (punchError) {
        console.error('[usePersonalPayData] Error fetching punches:', punchError);
        return null;
      }

      // Helper to get cutoff hour for a given date
      const getCutoffForDate = (dateStr: string): number => {
        const d = new Date(dateStr + 'T12:00:00Z');
        const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, etc.
        return cutoffByDayOfWeek.get(dayOfWeek) ?? defaultCutoff;
      };

      // Group punches by BUSINESS day (handling overnight shifts)
      const groupPunchesByBusinessDay = (allPunches: TimePunch[]): Map<string, TimePunch[]> => {
        const punchesByDay = new Map<string, TimePunch[]>();
        
        // First pass: identify all clock_ins by calendar day
        const clockInsByDay = new Map<string, TimePunch>();
        allPunches.forEach((punch) => {
          if (punch.punch_type === 'clock_in') {
            const punchDate = toZonedTime(new Date(punch.punch_time), timezone);
            const day = formatTZ(punchDate, 'yyyy-MM-dd', { timeZone: timezone });
            clockInsByDay.set(day, punch);
          }
        });
        
        // Second pass: assign punches to business days
        allPunches.forEach((punch) => {
          const punchTime = new Date(punch.punch_time);
          const punchDate = toZonedTime(punchTime, timezone);
          let day = formatTZ(punchDate, 'yyyy-MM-dd', { timeZone: timezone });
          const punchHour = parseInt(formatTZ(punchDate, 'H', { timeZone: timezone }));
          
          // Get dynamic cutoff for this calendar day
          const cutoffHour = getCutoffForDate(day);
          
          // If punch is before cutoff hour, it might belong to previous business day
          if (punch.punch_type !== 'clock_in' && punchHour < cutoffHour) {
            const sameDayClockIn = clockInsByDay.get(day);
            const shouldMoveToPrevDay = !sameDayClockIn || 
              new Date(sameDayClockIn.punch_time).getTime() > punchTime.getTime();
            
            if (shouldMoveToPrevDay) {
              // Calculate previous day
              const dateAtNoon = new Date(day + 'T12:00:00Z');
              dateAtNoon.setUTCDate(dateAtNoon.getUTCDate() - 1);
              const prevDay = dateAtNoon.toISOString().slice(0, 10);
              // Only reassign if previous day has a clock_in
              if (clockInsByDay.has(prevDay)) {
                day = prevDay;
              }
            }
          }
          
          if (!punchesByDay.has(day)) {
            punchesByDay.set(day, []);
          }
          punchesByDay.get(day)!.push(punch);
        });
        
        return punchesByDay;
      };

      const allPunches = (punches || []) as TimePunch[];
      const punchesByBusinessDay = groupPunchesByBusinessDay(allPunches);

      // Calculate hours and build shift entries for a given date range
      const calculateHoursAndShifts = (startDate: string, endDate: string): { hours: number; shifts: ShiftEntry[] } => {
        let totalMinutes = 0;
        const shiftEntries: ShiftEntry[] = [];

        punchesByBusinessDay.forEach((dayPunches, day) => {
          // Only count days within the requested range
          if (day < startDate || day >= endDate) return;
          
          // Sort by time
          dayPunches.sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());

          // Find first clock_in and last clock_out
          const clockIns = dayPunches.filter(p => p.punch_type === 'clock_in');
          const clockOuts = dayPunches.filter(p => p.punch_type === 'clock_out');
          const breakStarts = dayPunches.filter(p => p.punch_type === 'break_start');

          if (clockIns.length === 0) return;

          const firstClockIn = clockIns[0];
          const lastClockOut = clockOuts.length > 0 ? clockOuts[clockOuts.length - 1] : null;

          const shiftStart = new Date(firstClockIn.punch_time);
          const shiftEnd = lastClockOut ? new Date(lastClockOut.punch_time) : null;
          
          // Calculate gross minutes
          let grossMinutes = 0;
          if (shiftEnd) {
            grossMinutes = differenceInMinutes(shiftEnd, shiftStart);
          } else if (periodOffset === 0) {
            // Still clocked in - only count for current period
            grossMinutes = differenceInMinutes(new Date(), shiftStart);
          }

          // Subtract unpaid breaks
          let breakMinutes = 0;
          breakStarts.forEach(breakStart => {
            // Check if it's an unpaid break
            const isUnpaid = breakStart.notes?.toLowerCase().includes('unpaid');
            if (!isUnpaid) return;

            // Find the clock_in that ends this break (clock_in that comes after break_start)
            const breakStartTime = new Date(breakStart.punch_time);
            const breakEndPunch = clockIns.find(ci => 
              new Date(ci.punch_time) > breakStartTime && 
              ci.id !== firstClockIn.id
            );

            if (breakEndPunch) {
              const breakEndTime = new Date(breakEndPunch.punch_time);
              breakMinutes += differenceInMinutes(breakEndTime, breakStartTime);
            }
          });

          const netMinutes = Math.max(0, grossMinutes - breakMinutes);
          totalMinutes += netMinutes;
          
          const shiftHours = netMinutes / 60;
          shiftEntries.push({
            date: day,
            clockIn: shiftStart,
            clockOut: shiftEnd,
            hours: shiftHours,
            estimatedPay: shiftHours * hourlyWage,
          });
        });

        // Sort shifts by date descending
        shiftEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return { hours: totalMinutes / 60, shifts: shiftEntries };
      };

      const weekResult = calculateHoursAndShifts(weekStartStr, weekEndStr);
      const payrollResult = calculateHoursAndShifts(payPeriodStartStr, payPeriodEndStr);

      return {
        hoursWeek: weekResult.hours,
        hoursPayroll: payrollResult.hours,
        payWeek: weekResult.hours * hourlyWage,
        payPayroll: payrollResult.hours * hourlyWage,
        shifts: payrollResult.shifts,
        payPeriodStart: payPeriod.startStr,
        payPeriodEnd: formatTZ(payPeriod.end, 'yyyy-MM-dd', { timeZone: timezone }),
        hourlyWage,
      };
    },
    enabled: !!user?.id && !!currentLocation?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
}
