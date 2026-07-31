import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { startOfWeek, endOfWeek, addDays } from 'date-fns';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { calculateCutoffHour } from '@/utils/timezoneUtils';
import { 
  calculateDayHours, 
  calculateOvertimeBreakdown, 
  calculateGrossPay,
  type TimePunch as SharedTimePunch,
  type LaborRules 
} from '@/utils/payrollCalculations';

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
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
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
      const { data: wageValue, error: profileError } = await supabase.rpc('get_current_wage', {
        p_user_id: user.id,
      });

      if (profileError) {
        console.error('[usePersonalPayData] Error fetching wage:', profileError);
        return null;
      }

      const hourlyWage = Number(wageValue) || 0;

      // Fetch labor rules for OT thresholds (passed to shared utility)
      const { data: laborRules } = await supabase
        .from('labor_rules')
        .select('daily_overtime_threshold, daily_double_time_threshold, weekly_overtime_threshold, overtime_multiplier, double_time_multiplier')
        .eq('location_id', currentLocation.id)
        .maybeSingle();

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
          
          // If punch is at or before cutoff hour, it might belong to previous business day
          // Use <= to include punches exactly at the cutoff hour (e.g., 3:00 AM when cutoff is 3)
          if (punch.punch_type !== 'clock_in' && punchHour <= cutoffHour) {
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

          // Identify SHIFT-STARTING clock_ins (not return-from-break clock_ins)
          // A clock_in that follows a clock_out starts a new shift
          // A clock_in that follows a break_start is just returning from break
          const shiftStartClockIns: TimePunch[] = [];
          dayPunches.forEach((punch, idx) => {
            if (punch.punch_type !== 'clock_in') return;
            
            if (idx === 0) {
              shiftStartClockIns.push(punch);
              return;
            }
            
            const prevPunch = dayPunches[idx - 1];
            // Only consider it a new shift if previous punch was clock_out
            if (prevPunch.punch_type === 'clock_out') {
              shiftStartClockIns.push(punch);
            }
          });

          if (shiftStartClockIns.length === 0) return;

          const clockOuts = dayPunches.filter(p => p.punch_type === 'clock_out');
          const usedClockOutIds = new Set<string>();
          
          // Find earliest clock_in to exclude orphaned clock_outs from previous day
          const earliestClockInTime = new Date(shiftStartClockIns[0].punch_time).getTime();

          // Process each distinct shift
          shiftStartClockIns.forEach((clockIn, index) => {
            const clockInTime = new Date(clockIn.punch_time).getTime();
            const nextShiftStart = shiftStartClockIns[index + 1];
            const nextShiftStartTime = nextShiftStart ? new Date(nextShiftStart.punch_time).getTime() : Infinity;
            
            // Find clock_out for THIS shift (after this clock_in, before next shift, not already used)
            const shiftClockOuts = clockOuts.filter(co => {
              const coTime = new Date(co.punch_time).getTime();
              return coTime > clockInTime && 
                     coTime < nextShiftStartTime && 
                     !usedClockOutIds.has(co.id) &&
                     coTime > earliestClockInTime;
            });
            
            const clockOut = shiftClockOuts.length > 0 ? shiftClockOuts[shiftClockOuts.length - 1] : null;
            
            // Calculate shift duration
            let shiftEnd: Date | null = null;
            if (clockOut) {
              shiftEnd = new Date(clockOut.punch_time);
              usedClockOutIds.add(clockOut.id);
            } else if (periodOffset === 0) {
              // Still clocked in - only for current period
              shiftEnd = new Date();
            }
            
            if (!shiftEnd) return;
            
            const shiftStart = new Date(clockIn.punch_time);
            // Use millisecond math (not differenceInMinutes) to avoid rounding down partial minutes
            const grossMinutes = (shiftEnd.getTime() - shiftStart.getTime()) / 60000;

            // Subtract 30-minute meal breaks within this shift (same logic as PayrollReview)
            const clockOutTime = shiftEnd.getTime();
            const shiftBreakStarts = dayPunches.filter(p => 
              p.punch_type === 'break_start' && 
              p.notes?.includes('30 minute') &&
              new Date(p.punch_time).getTime() > clockInTime &&
              new Date(p.punch_time).getTime() < clockOutTime
            );
            
            let breakMinutes = 0;
            shiftBreakStarts.forEach(breakStart => {
              const breakStartTime = new Date(breakStart.punch_time).getTime();
              
              // Find the clock_in that ends this break (return from break, not a new shift)
              const breakEndPunch = dayPunches.find(p => {
                const pTime = new Date(p.punch_time).getTime();
                if (p.punch_type !== 'clock_in') return false;
                if (pTime <= breakStartTime || pTime >= clockOutTime) return false;
                // Must NOT be a shift-starting clock_in
                return !shiftStartClockIns.some(s => s.id === p.id);
              });
              
               if (breakEndPunch) {
                 breakMinutes += (new Date(breakEndPunch.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000;
               }
            });

            const netMinutes = Math.max(0, grossMinutes - breakMinutes);
            totalMinutes += netMinutes;
            
            const shiftHours = netMinutes / 60;
            shiftEntries.push({
              date: day,
              clockIn: shiftStart,
              clockOut: clockOut ? shiftEnd : null,
              hours: shiftHours,
              estimatedPay: shiftHours * hourlyWage,
            });
          });
        });

        // Sort shifts by date descending, then by clockIn time descending
        shiftEntries.sort((a, b) => {
          const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
          if (dateCompare !== 0) return dateCompare;
          return b.clockIn.getTime() - a.clockIn.getTime();
        });

        return { hours: totalMinutes / 60, shifts: shiftEntries };
      };

      const weekResult = calculateHoursAndShifts(weekStartStr, weekEndStr);
      const payrollResult = calculateHoursAndShifts(payPeriodStartStr, payPeriodEndStr);

      // Build punchesByDay for the shared calculateDayHours function
      // This ensures we use the EXACT same calculation as PayrollReview
      const punchesByDayForCalc: Record<string, SharedTimePunch[]> = {};
      punchesByBusinessDay.forEach((dayPunches, day) => {
        if (day >= payPeriodStartStr && day < payPeriodEndStr) {
          punchesByDayForCalc[day] = dayPunches;
        }
      });

      // Use shared utility for OT breakdown (same as PayrollReview)
      const hoursByDay: Record<string, number> = {};
      Object.entries(punchesByDayForCalc).forEach(([day, punches]) => {
        hoursByDay[day] = calculateDayHours(punches, false);
      });

      // Use shared utility for overtime calculation (California rules)
      const otBreakdown = calculateOvertimeBreakdown(hoursByDay, laborRules, timezone);

      // Use shared utility for gross pay calculation
      const payPayroll = calculateGrossPay(otBreakdown, hourlyWage, laborRules);

      return {
        hoursWeek: weekResult.hours,
        hoursPayroll: payrollResult.hours,
        payWeek: weekResult.hours * hourlyWage,
        payPayroll,
        regularHours: otBreakdown.regularHours,
        overtimeHours: otBreakdown.overtimeHours,
        doubleTimeHours: otBreakdown.doubleTimeHours,
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
