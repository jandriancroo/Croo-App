/**
 * Labor calculation utilities for overtime and double time
 * Based on California-style labor rules
 */

export interface DailyHours {
  date: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
}

export interface WeeklyLaborSummary {
  totalRegularHours: number;
  totalOvertimeHours: number;
  totalDoubleTimeHours: number;
  totalHours: number;
  dailyBreakdown: DailyHours[];
}

export interface LaborRule {
  daily_overtime_threshold: number; // e.g., 8 hours
  daily_double_time_threshold: number; // e.g., 12 hours
  weekly_overtime_threshold: number; // e.g., 40 hours
  overtime_multiplier: number; // e.g., 1.5
  double_time_multiplier: number; // e.g., 2.0
  meal_break_hours: number | null; // e.g., 5 hours triggers break
  meal_break_duration: number | null; // e.g., 30 minutes
}

/**
 * Calculate hours worked in a shift, accounting for unpaid meal breaks
 */
export function calculateShiftHoursWithBreaks(
  startTime: string,
  endTime: string,
  mealBreakHours: number | null,
  mealBreakDuration: number | null
): number {
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let hours = endHour - startHour;
  let minutes = endMin - startMin;
  
  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }
  
  let totalHours = hours + minutes / 60;
  
  // Deduct unpaid meal break if shift exceeds threshold
  if (mealBreakHours && mealBreakDuration && totalHours > mealBreakHours) {
    totalHours -= mealBreakDuration / 60;
  }
  
  return Math.max(0, totalHours);
}

/**
 * Calculate daily hours breakdown (regular, OT, DT)
 */
export function calculateDailyHours(
  dailyTotalHours: number,
  rule: LaborRule
): Omit<DailyHours, 'date'> {
  let regularHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;

  if (dailyTotalHours <= rule.daily_overtime_threshold) {
    // All regular time
    regularHours = dailyTotalHours;
  } else if (dailyTotalHours <= rule.daily_double_time_threshold) {
    // Regular + OT
    regularHours = rule.daily_overtime_threshold;
    overtimeHours = dailyTotalHours - rule.daily_overtime_threshold;
  } else {
    // Regular + OT + DT
    regularHours = rule.daily_overtime_threshold;
    overtimeHours = rule.daily_double_time_threshold - rule.daily_overtime_threshold;
    doubleTimeHours = dailyTotalHours - rule.daily_double_time_threshold;
  }

  return {
    regularHours,
    overtimeHours,
    doubleTimeHours,
    totalHours: dailyTotalHours,
  };
}

/**
 * Calculate weekly labor with California-style overtime rules:
 * - Daily OT: Hours over 8 per day
 * - Daily DT: Hours over 12 per day
 * - Weekly OT: Total hours over 40 per week
 * - Employee gets the HIGHER of (sum of daily OT) or (weekly OT)
 */
export function calculateWeeklyLabor(
  dailyHours: { date: string; hours: number }[],
  rule: LaborRule
): WeeklyLaborSummary {
  // Step 1: Calculate daily breakdowns
  const dailyBreakdown: DailyHours[] = dailyHours.map(day => ({
    date: day.date,
    ...calculateDailyHours(day.hours, rule),
  }));

  // Step 2: Sum up daily overtime and double time
  const totalDailyOT = dailyBreakdown.reduce((sum, day) => sum + day.overtimeHours, 0);
  const totalDailyDT = dailyBreakdown.reduce((sum, day) => sum + day.doubleTimeHours, 0);
  
  // Step 3: Calculate total weekly hours
  const totalWeeklyHours = dailyBreakdown.reduce((sum, day) => sum + day.totalHours, 0);
  
  // Step 4: Calculate weekly overtime (total hours over threshold)
  const weeklyOT = Math.max(0, totalWeeklyHours - rule.weekly_overtime_threshold);
  
  // Step 5: Use the HIGHER of daily OT sum or weekly OT
  const actualOvertimeHours = Math.max(totalDailyOT, weeklyOT);
  
  // Step 6: Calculate regular hours
  // Regular = Total - OT - DT
  const totalRegularHours = totalWeeklyHours - actualOvertimeHours - totalDailyDT;

  return {
    totalRegularHours: Math.max(0, totalRegularHours),
    totalOvertimeHours: actualOvertimeHours,
    totalDoubleTimeHours: totalDailyDT,
    totalHours: totalWeeklyHours,
    dailyBreakdown,
  };
}

/**
 * Calculate total labor cost for a week
 */
export function calculateWeeklyLaborCost(
  summary: WeeklyLaborSummary,
  hourlyWage: number,
  rule: LaborRule
): {
  regularPay: number;
  overtimePay: number;
  doubleTimePay: number;
  totalPay: number;
} {
  const regularPay = summary.totalRegularHours * hourlyWage;
  const overtimePay = summary.totalOvertimeHours * hourlyWage * rule.overtime_multiplier;
  const doubleTimePay = summary.totalDoubleTimeHours * hourlyWage * rule.double_time_multiplier;
  const totalPay = regularPay + overtimePay + doubleTimePay;

  return {
    regularPay,
    overtimePay,
    doubleTimePay,
    totalPay,
  };
}

/**
 * Format hours for display
 */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}
