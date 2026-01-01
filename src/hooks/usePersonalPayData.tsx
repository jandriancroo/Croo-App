import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { startOfWeek, endOfWeek, addDays, differenceInMinutes, parseISO } from 'date-fns';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';

interface PersonalPayData {
  hoursWeek: number;
  hoursPayroll: number;
  payWeek: number;
  payPayroll: number;
}

interface TimePunch {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
  notes: string | null;
}

export function usePersonalPayData() {
  const { user } = useAuth();
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();

  return useQuery({
    queryKey: ['personal-pay-data', user?.id, currentLocation?.id],
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

      // Get labor rules for pay period info
      const { data: laborRules } = await supabase
        .from('labor_rules')
        .select('pay_period_type, pay_period_start_date, meal_break_hours, meal_break_duration')
        .eq('location_id', currentLocation.id)
        .single();

      // Calculate week start/end in timezone
      const now = new Date();
      const zonedNow = toZonedTime(now, timezone);
      const weekStart = startOfWeek(zonedNow, { weekStartsOn: 1 }); // Monday
      const weekEnd = endOfWeek(zonedNow, { weekStartsOn: 1 }); // Sunday
      
      const weekStartStr = formatTZ(weekStart, 'yyyy-MM-dd', { timeZone: timezone });
      const weekEndStr = formatTZ(addDays(weekEnd, 1), 'yyyy-MM-dd', { timeZone: timezone }); // Include full Sunday
      
      console.log('[usePersonalPayData] Week range:', weekStartStr, 'to', weekEndStr, 'timezone:', timezone);

      // Calculate pay period dates
      let payPeriodStart: Date;
      let payPeriodEnd: Date;
      
      if (laborRules?.pay_period_start_date) {
        const periodStartBase = parseISO(laborRules.pay_period_start_date);
        const periodLengthDays = laborRules.pay_period_type === 'biweekly' ? 14 : 7;
        
        // Find the current pay period
        const daysSinceBase = Math.floor((now.getTime() - periodStartBase.getTime()) / (1000 * 60 * 60 * 24));
        const periodsElapsed = Math.floor(daysSinceBase / periodLengthDays);
        payPeriodStart = addDays(periodStartBase, periodsElapsed * periodLengthDays);
        payPeriodEnd = addDays(payPeriodStart, periodLengthDays);
      } else {
        // Default to current week if no pay period configured
        payPeriodStart = weekStart;
        payPeriodEnd = addDays(weekEnd, 1);
      }
      
      const payPeriodStartStr = formatTZ(payPeriodStart, 'yyyy-MM-dd', { timeZone: timezone });
      const payPeriodEndStr = formatTZ(payPeriodEnd, 'yyyy-MM-dd', { timeZone: timezone });

      // Fetch punches for both week and pay period (use wider range)
      const earlierDate = payPeriodStartStr < weekStartStr ? payPeriodStartStr : weekStartStr;
      const laterDate = payPeriodEndStr > weekEndStr ? payPeriodEndStr : weekEndStr;
      
      const { data: punches, error: punchError } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_type, punch_time, notes')
        .eq('user_id', user.id)
        .eq('location_id', currentLocation.id)
        .gte('punch_time', earlierDate)
        .lt('punch_time', laterDate)
        .order('punch_time', { ascending: true });

      if (punchError) {
        console.error('[usePersonalPayData] Error fetching punches:', punchError);
        return null;
      }
      
      console.log('[usePersonalPayData] Query range:', earlierDate, 'to', laterDate);
      console.log('[usePersonalPayData] Fetched punches count:', punches?.length);

      // Calculate hours for a given date range
      const calculateHours = (startDate: string, endDate: string): number => {
        console.log('[usePersonalPayData] calculateHours for range:', startDate, 'to', endDate);
        
        const rangePunches = (punches || []).filter((p) => {
          // Convert punch_time to local date in timezone
          const punchDate = toZonedTime(new Date(p.punch_time), timezone);
          const punchDateStr = formatTZ(punchDate, 'yyyy-MM-dd', { timeZone: timezone });
          const inRange = punchDateStr >= startDate && punchDateStr < endDate;
          return inRange;
        }) as TimePunch[];
        
        console.log('[usePersonalPayData] Punches in range:', rangePunches.length);

        // Group punches by date (in local timezone)
        const punchesByDate = new Map<string, TimePunch[]>();
        rangePunches.forEach((punch) => {
          const punchDate = toZonedTime(new Date(punch.punch_time), timezone);
          const dateStr = formatTZ(punchDate, 'yyyy-MM-dd', { timeZone: timezone });
          if (!punchesByDate.has(dateStr)) {
            punchesByDate.set(dateStr, []);
          }
          punchesByDate.get(dateStr)!.push(punch);
        });

        let totalMinutes = 0;

        punchesByDate.forEach((dayPunches) => {
          // Sort by time
          dayPunches.sort((a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime());

          // Find first clock_in and last clock_out
          const clockIns = dayPunches.filter(p => p.punch_type === 'clock_in');
          const clockOuts = dayPunches.filter(p => p.punch_type === 'clock_out');
          const breakStarts = dayPunches.filter(p => p.punch_type === 'break_start');

          if (clockIns.length === 0) return;

          const firstClockIn = clockIns[0];
          const lastClockOut = clockOuts.length > 0 ? clockOuts[clockOuts.length - 1] : null;

          if (!lastClockOut) return; // Still clocked in

          const shiftStart = new Date(firstClockIn.punch_time);
          const shiftEnd = new Date(lastClockOut.punch_time);
          const grossMinutes = differenceInMinutes(shiftEnd, shiftStart);

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

          totalMinutes += Math.max(0, grossMinutes - breakMinutes);
        });

        return totalMinutes / 60; // Convert to hours
      };

      const hoursWeek = calculateHours(weekStartStr, weekEndStr);
      const hoursPayroll = calculateHours(payPeriodStartStr, payPeriodEndStr);
      
      console.log('[usePersonalPayData] Final result - hoursWeek:', hoursWeek, 'hoursPayroll:', hoursPayroll, 'wage:', hourlyWage);

      return {
        hoursWeek,
        hoursPayroll,
        payWeek: hoursWeek * hourlyWage,
        payPayroll: hoursPayroll * hourlyWage,
      };
    },
    enabled: !!user?.id && !!currentLocation?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
}
