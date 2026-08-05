/**
 * Shared payroll calculation utilities
 * Used by both PayrollReview (Time Tracking) and usePersonalPayData (My Wallet)
 * This is the SINGLE SOURCE OF TRUTH for all hours/pay calculations
 */

export interface TimePunch {
  id: string;
  user_id: string;
  punch_type: string;
  punch_time: string;
  notes: string | null;
}

export interface LaborRules {
  daily_overtime_threshold?: number;
  daily_double_time_threshold?: number;
  weekly_overtime_threshold?: number;
  overtime_multiplier?: number;
  double_time_multiplier?: number;
}

export interface OvertimeBreakdown {
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
}

export interface GrossPayCalculation extends OvertimeBreakdown {
  grossPay: number;
}

// Helper to calculate hours between two timestamps, handling midnight crossover
export const calculateTimeDifferenceHours = (startTime: Date, endTime: Date): number => {
  let hours = (endTime.getTime() - startTime.getTime()) / 3600000;
  if (hours < 0) hours += 24;
  return hours;
};

// Deterministic punch sort: timestamp first, then type priority.
// This prevents edge-cases where break_start and clock_in share the same timestamp
export const sortPunches = (punches: TimePunch[]) => {
  const priority: Record<string, number> = {
    clock_in: 0,
    break_start: 1,
    break_end: 2,
    clock_out: 3,
  };

  return [...punches].sort((a, b) => {
    const t = new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime();
    if (t !== 0) return t;
    const pa = priority[a.punch_type] ?? 99;
    const pb = priority[b.punch_type] ?? 99;
    if (pa !== pb) return pa - pb;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
};

// Calculate hours for a single day's punches
export const calculateDayHours = (dayPunches: TimePunch[], showLive = true): number => {
  const sortedPunches = sortPunches(dayPunches);
  
  if (sortedPunches.length === 0) return 0;
  
  const shiftStartClockIns: TimePunch[] = [];
  
  sortedPunches.forEach((punch, idx) => {
    if (punch.punch_type !== 'clock_in') return;
    
    if (idx === 0) {
      shiftStartClockIns.push(punch);
      return;
    }
    
    const prevPunch = sortedPunches[idx - 1];
    
    // A clock_in after a clock_out starts a new shift
    if (prevPunch.punch_type === 'clock_out') {
      shiftStartClockIns.push(punch);
      return;
    }
    
    // A clock_in after a break_start is an IMPLICIT break_end (return from break)
    // NOT a new shift start - skip adding to shiftStartClockIns
    if (prevPunch.punch_type === 'break_start') {
      return;
    }
    
    // A clock_in after another clock_in or break_end is unusual - treat as new shift if no open break
    // Check if there's an unclosed break_start before this
    const hasOpenBreak = sortedPunches.slice(0, idx).some((p, i) => {
      if (p.punch_type !== 'break_start') return false;
      // Check if this break_start was closed before current punch
      const hasMatchingEnd = sortedPunches.slice(i + 1, idx).some(
        np => np.punch_type === 'break_end' || np.punch_type === 'clock_in'
      );
      return !hasMatchingEnd;
    });
    
    if (!hasOpenBreak) {
      shiftStartClockIns.push(punch);
    }
  });
  
  const clockOuts = sortedPunches.filter(p => p.punch_type === 'clock_out');
  
  if (shiftStartClockIns.length === 0) return 0;
  
  let totalHours = 0;
  const usedClockOutIds = new Set<string>();
  
  const earliestClockInTime = shiftStartClockIns.length > 0 
    ? new Date(shiftStartClockIns[0].punch_time).getTime() 
    : Infinity;
  
  shiftStartClockIns.forEach((clockIn, index) => {
    const clockInTime = new Date(clockIn.punch_time).getTime();
    const nextShiftStart = shiftStartClockIns[index + 1];
    const nextShiftStartTime = nextShiftStart ? new Date(nextShiftStart.punch_time).getTime() : Infinity;
    
    const shiftClockOuts = clockOuts.filter(co => {
      const coTime = new Date(co.punch_time).getTime();
      return coTime > clockInTime && coTime < nextShiftStartTime && !usedClockOutIds.has(co.id) && coTime > earliestClockInTime;
    });
    const clockOut = shiftClockOuts.length > 0 ? shiftClockOuts[shiftClockOuts.length - 1] : null;

    const lastPunchInWindow = sortedPunches
      .filter(p => {
        const t = new Date(p.punch_time).getTime();
        return t >= clockInTime && t < nextShiftStartTime;
      })
      .at(-1);

    const endTime = clockOut
      ? new Date(clockOut.punch_time)
      : (lastPunchInWindow ? new Date(lastPunchInWindow.punch_time) : null);
    
    if (!endTime) return;
    
    if (clockOut) usedClockOutIds.add(clockOut.id);
    
    let hours = calculateTimeDifferenceHours(new Date(clockIn.punch_time), endTime);
    
    const clockOutTime = endTime.getTime();
    const shiftBreaks = sortedPunches.filter(p => 
      p.punch_type === 'break_start' && 
      p.notes?.includes('30 minute') &&
      new Date(p.punch_time).getTime() > clockInTime &&
      new Date(p.punch_time).getTime() < clockOutTime
    );
    
    shiftBreaks.forEach(breakStart => {
      const breakStartTime = new Date(breakStart.punch_time).getTime();
      
      const breakEnd = sortedPunches.find(p => {
        const pTime = new Date(p.punch_time).getTime();
        // Match a break_end that follows this break_start (notes check not required —
        // the break_start already confirmed it's a 30-min unpaid break)
        if (p.punch_type === 'break_end') {
          return pTime > breakStartTime && pTime < clockOutTime;
        }
        // A clock_in immediately after a break_start acts as an implicit break_end
        if (p.punch_type === 'clock_in' && pTime > breakStartTime && pTime < clockOutTime) {
          const nextPunchAfterBreak = sortedPunches.find(np => 
            new Date(np.punch_time).getTime() > breakStartTime
          );
          return nextPunchAfterBreak?.id === p.id;
        }
        return false;
      });
      
      if (breakEnd) {
        const breakHours = calculateTimeDifferenceHours(
          new Date(breakStart.punch_time), 
          new Date(breakEnd.punch_time)
        );
        hours -= breakHours;
      }
    });
    
    totalHours += hours;
  });
  
  return totalHours;
};

// Get week start (Monday) for a given date string
export const getWeekStartForDate = (dateStr: string, timezone: string): string => {
  // Parse as a *local* date (no timezone conversion) by using numeric constructor.
  // Using a midday anchor avoids edge cases around midnight.
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);

  // Get weekday in the target timezone
  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const dow = map[weekdayShort] ?? 0;

  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - dow);

  // IMPORTANT: return a YYYY-MM-DD for the target timezone (don’t use toISOString())
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(weekStart);
};

// Calculate overtime breakdown from hours grouped by day
// Uses California-style rules: Daily OT > 8hrs, Daily DT > 12hrs, Weekly OT > 40hrs
export const calculateOvertimeBreakdown = (
  hoursByDay: Record<string, number>,
  laborRules: LaborRules | null,
  timezone: string
): OvertimeBreakdown => {
  // A 0/null daily threshold means the state has NO daily OT/DT rule (e.g. TX, GA, IN).
  // Treat it as disabled — otherwise every hour spills into double time and Reg reads 0.
  const rawDailyOT = laborRules?.daily_overtime_threshold;
  const rawDailyDT = laborRules?.daily_double_time_threshold;
  const dailyOTThreshold = rawDailyOT && rawDailyOT > 0 ? rawDailyOT : Infinity;
  const dailyDTThreshold = rawDailyDT && rawDailyDT > 0 ? rawDailyDT : Infinity;
  const weeklyOTThreshold = laborRules?.weekly_overtime_threshold ?? 40;

  // Group days by week
  const hoursByWeek: Record<string, Record<string, number>> = {};
  Object.entries(hoursByDay).forEach(([day, hours]) => {
    const weekStart = getWeekStartForDate(day, timezone);
    if (!hoursByWeek[weekStart]) {
      hoursByWeek[weekStart] = {};
    }
    hoursByWeek[weekStart][day] = hours;
  });

  let totalRegular = 0;
  let totalOT = 0;
  let totalDT = 0;
  let totalHours = 0;
  
  Object.values(hoursByWeek).forEach(weekDays => {
    const dailyHoursList = Object.values(weekDays);
    
    let weeklyDailyOT = 0;
    let weeklyDailyDT = 0;
    let weeklyDailyRegular = 0;
    let weeklyTotalHours = 0;
    
    dailyHoursList.forEach(hours => {
      weeklyTotalHours += hours;
      
      if (hours <= dailyOTThreshold) {
        weeklyDailyRegular += hours;
      } else if (hours <= dailyDTThreshold) {
        weeklyDailyRegular += dailyOTThreshold;
        weeklyDailyOT += hours - dailyOTThreshold;
      } else {
        weeklyDailyRegular += dailyOTThreshold;
        weeklyDailyOT += dailyDTThreshold - dailyOTThreshold;
        weeklyDailyDT += hours - dailyDTThreshold;
      }
    });
    
    // Weekly OT (hours over 40 in the week)
    const weeklyOT = Math.max(0, weeklyTotalHours - weeklyOTThreshold);
    
    // Use the HIGHER of daily OT sum or weekly OT (California rule)
    const actualOT = Math.max(weeklyDailyOT, weeklyOT);
    
    // Regular = Total - OT - DT
    const actualRegular = weeklyTotalHours - actualOT - weeklyDailyDT;
    
    totalRegular += Math.max(0, actualRegular);
    totalOT += actualOT;
    totalDT += weeklyDailyDT;
    totalHours += weeklyTotalHours;
  });

  return {
    regularHours: totalRegular,
    overtimeHours: totalOT,
    doubleTimeHours: totalDT,
    totalHours,
  };
};

// Calculate gross pay from overtime breakdown
export const calculateGrossPay = (
  breakdown: OvertimeBreakdown,
  hourlyWage: number,
  laborRules: LaborRules | null
): number => {
  const otMultiplier = laborRules?.overtime_multiplier ?? 1.5;
  const dtMultiplier = laborRules?.double_time_multiplier ?? 2.0;
  
  return (breakdown.regularHours * hourlyWage) + 
         (breakdown.overtimeHours * hourlyWage * otMultiplier) + 
         (breakdown.doubleTimeHours * hourlyWage * dtMultiplier);
};

// Full calculation: from punches grouped by day to gross pay
export const calculatePayFromPunches = (
  punchesByDay: Record<string, TimePunch[]>,
  hourlyWage: number,
  laborRules: LaborRules | null,
  timezone: string
): GrossPayCalculation => {
  // Calculate hours for each day using the shared function
  const hoursByDay: Record<string, number> = {};
  Object.entries(punchesByDay).forEach(([day, punches]) => {
    hoursByDay[day] = calculateDayHours(punches, false);
  });
  
  // Get overtime breakdown
  const breakdown = calculateOvertimeBreakdown(hoursByDay, laborRules, timezone);
  
  // Calculate gross pay
  const grossPay = calculateGrossPay(breakdown, hourlyWage, laborRules);
  
  return {
    ...breakdown,
    grossPay,
  };
};
