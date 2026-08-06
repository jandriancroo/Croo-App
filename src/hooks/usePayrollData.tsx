/**
 * usePayrollData – single hook that owns ALL payroll state, data-fetching,
 * calculation helpers and mutation actions.
 *
 * ⚠️  IMPORTANT: Every calculation function in this file was copied VERBATIM
 * from the original PayrollReview.tsx monolith.  Do NOT modify any time-tracking,
 * overtime, overnight-grouping, or shift-pairing logic without explicit approval.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PROFILE_SAFE_COLUMNS } from '@/lib/profileColumns';
import { format, addDays, addWeeks } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { useTipDistribution } from '@/hooks/useTipDistribution';
import { toast } from 'sonner';
import {
  toISOStringInTimezone,
  formatDateTimeInTimezone,
  getStartOfTodayInTimezone,
  getDateInTimezone,
  parseDateStringInTimezone,
  getEndOfDateStringInTimezone,
  calculateCutoffHour,
} from '@/utils/timezoneUtils';

export function usePayrollData() {
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { timezone, loading: timezoneLoading } = useLocationTimezone();
  const [payPeriods, setPayPeriods] = useState<any[]>([]);
  const [periodSummaries, setPeriodSummaries] = useState<Record<string, { hours: number; cost: number; sales: number; laborPercent: number | null }>>({});
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [editingShift, setEditingShift] = useState<{ dayPunches: any[], userId: string, locationId: string, shiftDate: string } | null>(null);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [includeApproved, setIncludeApproved] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState<string>('all');
  const [filterDay, setFilterDay] = useState<string>('all');
  const [filterFlag, setFilterFlag] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'employee' | 'day'>('employee');
  const [periodStatuses, setPeriodStatuses] = useState<Record<string, any>>({});
  const [approvalWarning, setApprovalWarning] = useState<{ punches: any[], type: 'day' | 'all', hasBreakViolation?: boolean, hasAutoClockOut?: boolean, hasOvertime?: boolean, hasExtendedBreak?: boolean, flaggedShifts?: { employeeName: string, date: string, flags: string[] }[], cleanPunchIds?: string[], shiftInfo?: { dayPunches: any[], userId: string, locationId: string, shiftDate: string } } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ dayPunches: any[], shiftDate: string } | null>(null);
  const [laborRules, setLaborRules] = useState<any>(null);
  const [approvingPunchIds, setApprovingPunchIds] = useState<Set<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [closingPeriod, setClosingPeriod] = useState(false);
  const [ptoData, setPtoData] = useState<Record<string, number>>({});

  // Cache guard: skip refetch if data was loaded within STALE_MS for same period+location
  const STALE_MS = 5 * 60 * 1000; // 5 minutes
  const lastFetchRef = useRef<{ key: string; at: number } | null>(null);

  // Cache current user ID on mount for instant approve feedback
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  // Check if current period is closed (for tip fetching optimization)
  const periodStatusKey = selectedPeriod?.startDate && selectedPeriod?.endDate 
    ? `${selectedPeriod.startDate}_${selectedPeriod.endDate}` 
    : null;
  const periodClosedForTips = periodStatusKey && periodStatuses[periodStatusKey]?.status === 'closed';

  // Tip distribution hook - only fetch when period is closed (for export/summary)
  const { 
    isLoading: tipsLoading, 
    employeeTipShares, 
    totalTipPool,
    totalDistributedTips,
    totalHoursWithTips,
    dailyTips 
  } = useTipDistribution(
    currentLocation?.id || null,
    selectedPeriod?.startDate || null,
    selectedPeriod?.endDate || null,
    timeCards,
    periodClosedForTips
  );

  useEffect(() => {
    if ((isAdmin || isManager) && currentLocation) {
      fetchLaborRules();
    }
  }, [isAdmin, isManager, currentLocation]);

  useEffect(() => {
    // Wait for the location's real timezone before building period boundaries —
    // generating them against the default zone silently shifts the end date.
    if (laborRules && !timezoneLoading) {
      generatePayPeriods();
    }
  }, [laborRules, timezone, timezoneLoading]);


  useEffect(() => {
    if (selectedPeriod && currentLocation && timezone) {
      const cacheKey = `${selectedPeriod.startDate}_${selectedPeriod.endDate}_${currentLocation.id}`;
      const now = Date.now();
      if (
        lastFetchRef.current &&
        lastFetchRef.current.key === cacheKey &&
        now - lastFetchRef.current.at < STALE_MS &&
        timeCards.length > 0
      ) {
        return; // Data is still fresh, skip refetch
      }
      fetchTimeCards();
    }
  }, [selectedPeriod, currentLocation, timezone]);

  // Fetch PTO data when period is selected
  useEffect(() => {
    const fetchPtoData = async () => {
      if (!selectedPeriod || !currentLocation) return;

      const startDate = selectedPeriod.startDate;
      const endDate = selectedPeriod.endDate;

      const { data: ptoRequests } = await supabase
        .from('availability_requests')
        .select('user_id, hours_requested, request_type')
        .eq('location_id', currentLocation.id)
        .eq('status', 'approved')
        .in('request_type', ['paid', 'vacation', 'sick'])
        .gte('start_date', startDate)
        .lte('start_date', endDate);

      const ptoByUser: Record<string, number> = {};
      ptoRequests?.forEach((req) => {
        if (!ptoByUser[req.user_id]) ptoByUser[req.user_id] = 0;
        ptoByUser[req.user_id] += req.hours_requested || 0;
      });

      setPtoData(ptoByUser);
    };

    fetchPtoData();
  }, [selectedPeriod, currentLocation]);

  // ─── Labor Rules ───────────────────────────────────────────────────
  const fetchLaborRules = async () => {
    if (!currentLocation) return;
    
    const { data } = await supabase
      .from('labor_rules')
      .select('*')
      .eq('location_id', currentLocation.id)
      .limit(1)
      .single();
    
    setLaborRules(data);
  };

  // ─── Pay Periods ───────────────────────────────────────────────────
  const getPeriodKey = (period: any) => `${period.startDate}_${period.endDate}`;

  /**
   * Pay-period summary cards.
   *
   * Hours/cost come from the SAME punch data and the SAME calculateDayHours()
   * engine the payroll grid uses, so the card can never disagree with the grid.
   * labor_cache is used only as a fallback for days with no punches (e.g.
   * POS-sourced labor at locations that don't use the punch clock).
   */
  const fetchPeriodSummaries = async (periods: any[]) => {
    if (!currentLocation?.id || periods.length === 0) {
      setPeriodSummaries({});
      return;
    }

    const oldestPeriod = periods[periods.length - 1];
    const newestPeriod = periods[0];

    // Widen the punch query past the period edges so overnight shifts that
    // roll back a day are still captured.
    const punchQueryStart = parseDateStringInTimezone(oldestPeriod.startDate, timezone);
    punchQueryStart.setDate(punchQueryStart.getDate() - 1);
    const punchQueryEnd = new Date(
      getEndOfDateStringInTimezone(newestPeriod.endDate, timezone)
    );
    punchQueryEnd.setDate(punchQueryEnd.getDate() + 1);

    const [salesResult, laborResult, punchesResult, hoursResult] = await Promise.all([
      supabase
        .from('sales_cache')
        .select('sale_date, net_sales')
        .eq('location_id', currentLocation.id)
        .gte('sale_date', oldestPeriod.startDate)
        .lte('sale_date', newestPeriod.endDate),
      supabase
        .from('labor_cache')
        .select('labor_date, labor_hours, labor_cost, source')
        .eq('location_id', currentLocation.id)
        .gte('labor_date', oldestPeriod.startDate)
        .lte('labor_date', newestPeriod.endDate),
      supabase
        .from('time_punches')
        .select('id, user_id, punch_type, punch_time, notes')
        .eq('location_id', currentLocation.id)
        .gte('punch_time', punchQueryStart.toISOString())
        .lte('punch_time', punchQueryEnd.toISOString())
        .order('punch_time', { ascending: true }),
      supabase
        .from('location_hours')
        .select('day_of_week, close_time')
        .eq('location_id', currentLocation.id),
    ]);

    if (salesResult.error || laborResult.error) {
      console.error('[PayrollReview] period summary query error:', salesResult.error || laborResult.error);
      setPeriodSummaries({});
      return;
    }

    const salesByDate = new Map<string, number>();
    (salesResult.data || []).forEach((row: any) => {
      salesByDate.set(row.sale_date, (salesByDate.get(row.sale_date) || 0) + (Number(row.net_sales) || 0));
    });

    // ── Punch-derived hours/cost (authoritative, matches the payroll grid) ──
    const cutoffByDayOfWeek = new Map<number, number>();
    ((hoursResult as any).data || []).forEach((h: any) => {
      cutoffByDayOfWeek.set(h.day_of_week, calculateCutoffHour(h.close_time));
    });

    const allPunches = (punchesResult as any).data || [];
    const punchUserIds = [...new Set(allPunches.map((p: any) => p.user_id))] as string[];

    const wageByUserId = new Map<string, number>();
    if (punchUserIds.length > 0) {
      const { data: wageRows } = await supabase.rpc('get_current_wages_batch', {
        p_user_ids: punchUserIds,
      });
      ((wageRows as any[]) || []).forEach((row: any) => {
        if (row.hourly_wage != null) wageByUserId.set(row.user_id, Number(row.hourly_wage));
      });
    }

    const punchByDate = new Map<string, { hours: number; cost: number }>();
    if (allPunches.length > 0) {
      const bucketed = bucketPunchesByUserAndDay(allPunches, timezone, cutoffByDayOfWeek, 5);
      bucketed.forEach((daysForUser, userId) => {
        const wage = wageByUserId.get(userId) ?? 15;
        Object.entries(daysForUser).forEach(([day, dayPunches]) => {
          const hours = calculateDayHours(dayPunches as any[], false);
          if (!(hours > 0)) return;
          const existing = punchByDate.get(day) || { hours: 0, cost: 0 };
          existing.hours += hours;
          existing.cost += hours * wage;
          punchByDate.set(day, existing);
        });
      });
    }

    // ── labor_cache fallback (POS-sourced labor, punch-clock-free stores) ──
    const laborByDate = new Map<string, { hours: number; cost: number; priority: number }>();
    (laborResult.data || []).forEach((row: any) => {
      const priority = row.source === 'punch_clock' ? 2 : 1;
      const existing = laborByDate.get(row.labor_date);
      if (!existing || priority > existing.priority) {
        laborByDate.set(row.labor_date, {
          hours: Number(row.labor_hours) || 0,
          cost: Number(row.labor_cost) || 0,
          priority,
        });
      }
    });

    const nextSummaries = periods.reduce((acc: Record<string, { hours: number; cost: number; sales: number; laborPercent: number | null }>, period) => {
      let hours = 0;
      let cost = 0;
      let sales = 0;

      salesByDate.forEach((value, date) => {
        if (date >= period.startDate && date <= period.endDate) sales += value;
      });

      // Walk each day in the period: punches win, cache fills the gaps.
      const dayCursor = new Set<string>([
        ...Array.from(punchByDate.keys()),
        ...Array.from(laborByDate.keys()),
      ]);
      dayCursor.forEach((date) => {
        if (date < period.startDate || date > period.endDate) return;
        const fromPunches = punchByDate.get(date);
        if (fromPunches) {
          hours += fromPunches.hours;
          cost += fromPunches.cost;
          return;
        }
        const fromCache = laborByDate.get(date);
        if (fromCache) {
          hours += fromCache.hours;
          cost += fromCache.cost;
        }
      });

      acc[getPeriodKey(period)] = {
        hours,
        cost,
        sales,
        laborPercent: sales > 0 ? (cost / sales) * 100 : null,
      };
      return acc;
    }, {});

    setPeriodSummaries(nextSummaries);
  };


  const generatePayPeriods = async () => {
    const today = getStartOfTodayInTimezone(timezone);
    const periods: any[] = [];

    const payPeriodType = laborRules?.pay_period_type || 'biweekly';
    const baseStartDateStr = laborRules?.pay_period_start_date || '2025-11-03';
    const baseStart = parseDateStringInTimezone(baseStartDateStr, timezone);

    // DST-safe: add days using pure calendar arithmetic on date strings
    // This avoids addDays/addWeeks which use 24h ms increments and break on DST boundaries
    const addCalendarDays = (dateStr: string, days: number): string => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const result = new Date(Date.UTC(y, m - 1, d + days));
      return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(result.getUTCDate()).padStart(2, '0')}`;
    };

    const makeLabel = (startDateStr: string, endDateStr: string) => {
      const startLabel = formatDateTimeInTimezone(
        parseDateStringInTimezone(startDateStr, timezone),
        timezone,
        { weekday: 'short', month: 'short', day: 'numeric' }
      );
      const endLabel = formatDateTimeInTimezone(
        parseDateStringInTimezone(endDateStr, timezone),
        timezone,
        { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
      );
      return `${startLabel} - ${endLabel}`;
    };

    // Dynamically calculate how many periods exist between base date and today
    const daysSinceBase = Math.max(0, Math.floor((today.getTime() - baseStart.getTime()) / 86400000));

    if (payPeriodType === 'weekly') {
      const maxPeriods = Math.floor(daysSinceBase / 7) + 1;
      for (let i = 0; i <= maxPeriods; i++) {
        const startDateStr = addCalendarDays(baseStartDateStr, i * 7);
        const endDateStr = addCalendarDays(startDateStr, 6);
        const start = parseDateStringInTimezone(startDateStr, timezone);
        const end = getEndOfDateStringInTimezone(endDateStr, timezone);

        if (start <= today) {
          periods.push({
            start, end, startDate: startDateStr, endDate: endDateStr,
            label: makeLabel(startDateStr, endDateStr),
          });
        }
      }
    } else if (payPeriodType === 'biweekly') {
      const maxPeriods = Math.floor(daysSinceBase / 14) + 1;
      for (let i = 0; i <= maxPeriods; i++) {
        const startDateStr = addCalendarDays(baseStartDateStr, i * 14);
        const endDateStr = addCalendarDays(startDateStr, 13);
        const start = parseDateStringInTimezone(startDateStr, timezone);
        const end = getEndOfDateStringInTimezone(endDateStr, timezone);

        if (start <= today) {
          periods.push({
            start, end, startDate: startDateStr, endDate: endDateStr,
            label: makeLabel(startDateStr, endDateStr),
          });
        }
      }
    } else if (payPeriodType === 'semimonthly') {
      const currentYear = Number(getDateInTimezone(today, timezone).slice(0, 4));
      const currentMonth = today.getMonth();

      for (let monthOffset = -3; monthOffset <= 0; monthOffset++) {
        const month = currentMonth + monthOffset;
        const year = currentYear + Math.floor(month / 12);
        const actualMonth = ((month % 12) + 12) % 12;
        const mm = String(actualMonth + 1).padStart(2, '0');

        const firstStartStr = `${year}-${mm}-01`;
        const firstEndStr = `${year}-${mm}-15`;
        const firstStart = parseDateStringInTimezone(firstStartStr, timezone);
        const firstEnd = getEndOfDateStringInTimezone(firstEndStr, timezone);

        if (firstStart <= today) {
          periods.push({
            start: firstStart, end: firstEnd,
            startDate: firstStartStr, endDate: firstEndStr,
            label: makeLabel(firstStartStr, firstEndStr),
          });
        }

        const secondStartStr = `${year}-${mm}-16`;
        const secondStart = parseDateStringInTimezone(secondStartStr, timezone);

        const nextMonth = new Date(Date.UTC(year, actualMonth + 1, 1));
        const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 0));
        const lastDayStr = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay.getUTCDate()).padStart(2, '0')}`;
        const secondEnd = getEndOfDateStringInTimezone(lastDayStr, timezone);

        if (secondStart <= today) {
          periods.push({
            start: secondStart, end: secondEnd,
            startDate: secondStartStr, endDate: lastDayStr,
            label: makeLabel(secondStartStr, lastDayStr),
          });
        }
      }
    } else if (payPeriodType === 'monthly') {
      const currentYear = Number(getDateInTimezone(today, timezone).slice(0, 4));
      const currentMonth = today.getMonth();

      for (let monthOffset = -3; monthOffset <= 0; monthOffset++) {
        const month = currentMonth + monthOffset;
        const year = currentYear + Math.floor(month / 12);
        const actualMonth = ((month % 12) + 12) % 12;
        const mm = String(actualMonth + 1).padStart(2, '0');

        const startDateStr = `${year}-${mm}-01`;
        const start = parseDateStringInTimezone(startDateStr, timezone);

        const nextMonth = new Date(Date.UTC(year, actualMonth + 1, 1));
        const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 0));
        const endDateStr = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay.getUTCDate()).padStart(2, '0')}`;
        const end = getEndOfDateStringInTimezone(endDateStr, timezone);

        if (start <= today) {
          periods.push({
            start, end, startDate: startDateStr, endDate: endDateStr,
            label: makeLabel(startDateStr, endDateStr),
          });
        }
      }
    }

    periods.reverse();
    setPayPeriods(periods);
    await fetchPeriodSummaries(periods);

    const { data: statuses } = await supabase.from('pay_periods').select('*');

    const statusMap: Record<string, any> = {};
    statuses?.forEach((status) => {
      const key = `${status.start_date}_${status.end_date}`;
      statusMap[key] = status;
    });
    setPeriodStatuses(statusMap);
  };

  // ─── Calculation helpers (VERBATIM from original) ─────────────────
  const calculateTimeDifferenceHours = (startTime: Date, endTime: Date): number => {
    let hours = (endTime.getTime() - startTime.getTime()) / 3600000;
    if (hours < 0) hours += 24;
    return hours;
  };

  const sortPunches = (punches: any[]) => {
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

  const calculateDayHours = (dayPunches: any[], showLive = true) => {
    const sortedPunches = sortPunches(dayPunches);
    
    if (sortedPunches.length === 0) return 0;
    
    const shiftStartClockIns: any[] = [];
    
    sortedPunches.forEach((punch, idx) => {
      if (punch.punch_type !== 'clock_in') return;
      
      if (idx === 0) {
        shiftStartClockIns.push(punch);
        return;
      }
      
      const prevPunch = sortedPunches[idx - 1];
      if (prevPunch.punch_type === 'clock_out') {
        shiftStartClockIns.push(punch);
        return;
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
          if (p.punch_type === 'break_end') {
            return pTime > breakStartTime && pTime < clockOutTime;
          }
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

  // Shared flag detection
  const getDayFlags = (dayPunches: any[]) => {
    const sortedPunches = sortPunches(dayPunches);

    const shiftStartClockIns: any[] = [];
    sortedPunches.forEach((punch: any, idx: number) => {
      if (punch.punch_type !== 'clock_in') return;
      if (idx === 0) {
        shiftStartClockIns.push(punch);
        return;
      }
      const prev = sortedPunches[idx - 1];
      if (prev.punch_type === 'clock_out') shiftStartClockIns.push(punch);
    });

    const clockOuts = sortedPunches.filter((p: any) => p.punch_type === 'clock_out');
    const unpaidBreakStarts = sortedPunches.filter((p: any) => {
      if (p.punch_type !== 'break_start') return false;
      const notes = String(p.notes || '').toLowerCase();
      return notes.includes('30 minute') || notes.includes('meal') || notes.includes('unpaid');
    });

    let hasAutoClockOut = false;
    let hasBreakViolation = false;
    let hasOpenShift = false;
    const usedClockOutIds = new Set<string>();
    const earliestClockInTime = shiftStartClockIns.length > 0 
      ? new Date(shiftStartClockIns[0].punch_time).getTime() 
      : Infinity;

    shiftStartClockIns.forEach((clockIn: any, idx: number) => {
      const clockInMs = new Date(clockIn.punch_time).getTime();
      const nextStart = shiftStartClockIns[idx + 1];
      const nextStartMs = nextStart ? new Date(nextStart.punch_time).getTime() : Infinity;

      const shiftClockOuts = clockOuts.filter((co: any) => {
        const coMs = new Date(co.punch_time).getTime();
        return coMs > clockInMs && coMs < nextStartMs && !usedClockOutIds.has(co.id) && coMs > earliestClockInTime;
      });
      const clockOut = shiftClockOuts.length ? shiftClockOuts[shiftClockOuts.length - 1] : null;
      
      if (clockOut) {
        usedClockOutIds.add(clockOut.id);
        if (clockOut.is_auto_punched_out) {
          hasAutoClockOut = true;
        }
        
        const clockOutMs = new Date(clockOut.punch_time).getTime();
        const shiftHours = (clockOutMs - clockInMs) / 3600000;
        if (shiftHours > 5) {
          const hasMealBreak = unpaidBreakStarts.some((b: any) => {
            const bMs = new Date(b.punch_time).getTime();
            return bMs > clockInMs && bMs < clockOutMs;
          });
          if (!hasMealBreak) hasBreakViolation = true;
        }
      } else {
        hasOpenShift = true;
      }
    });

    return {
      hasAutoClockOut,
      hasBreakViolation,
      hasOpenShift,
      hasAnyFlag: hasAutoClockOut || hasBreakViolation || hasOpenShift,
    };
  };

  const hasDayIssues = (dayPunches: any[]) => {
    const sortedPunches = sortPunches(dayPunches);
    
    const clockIns = sortedPunches.filter(p => p.punch_type === 'clock_in');
    const clockOuts = sortedPunches.filter(p => p.punch_type === 'clock_out');
    const mealBreaks = sortedPunches.filter(p => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
    
    const earliestClockInTime = clockIns.length > 0 ? new Date(clockIns[0].punch_time).getTime() : Infinity;
    const validClockOuts = clockOuts.filter(co => new Date(co.punch_time).getTime() > earliestClockInTime);
    
    if (clockIns.length > validClockOuts.length) return true;
    
    const usedClockOutIds = new Set<string>();
    
    for (const clockIn of clockIns) {
      const clockInTime = new Date(clockIn.punch_time).getTime();
      
      const clockOut = validClockOuts.find(co => {
        const coTime = new Date(co.punch_time).getTime();
        return coTime > clockInTime && !usedClockOutIds.has(co.id);
      });
      
      if (!clockOut) return true;
      
      usedClockOutIds.add(clockOut.id);
      const clockOutTime = new Date(clockOut.punch_time).getTime();
      
      let hours = (clockOutTime - clockInTime) / 3600000;
      if (hours < 0) hours += 24;
      
      const hasMealBreak = mealBreaks.some(mb => {
        const mbTime = new Date(mb.punch_time).getTime();
        return mbTime > clockInTime && mbTime < clockOutTime;
      });
      
      if (hours > 5 && !hasMealBreak) return true;
    }
    
    return false;
  };

  // ─── Fetch Time Cards ─────────────────────────────────────────────
  const fetchTimeCards = async () => {
    if (!selectedPeriod || !currentLocation || !timezone) return;

    const punchQueryStart = new Date(selectedPeriod.start.getTime() - 24 * 60 * 60 * 1000);
    const punchQueryEnd = new Date(selectedPeriod.end.getTime() + 24 * 60 * 60 * 1000);

    const [{ data: locationHours }, { data: userLocations }, { data: punchUsers }] = await Promise.all([
      supabase
        .from('location_hours')
        .select('day_of_week, close_time')
        .eq('location_id', currentLocation.id),
      supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id),
      supabase
        .from('time_punches')
        .select('user_id')
        .eq('location_id', currentLocation.id)
        .gte('punch_time', punchQueryStart.toISOString())
        .lte('punch_time', punchQueryEnd.toISOString()),
    ]);
    
    const cutoffByDayOfWeek = new Map<number, number>();
    (locationHours || []).forEach((h: { day_of_week: number; close_time: string | null }) => {
      cutoffByDayOfWeek.set(h.day_of_week, calculateCutoffHour(h.close_time));
    });
    const defaultCutoff = 5;

    const assignedUserIds = new Set(userLocations?.map(ul => ul.user_id) || []);
    const punchUserIds = new Set(punchUsers?.map(p => p.user_id) || []);
    
    const allUserIds = [...new Set([...assignedUserIds, ...punchUserIds])];

    if (allUserIds.length === 0) {
      setTimeCards([]);
      return;
    }

    // Include inactive employees too — payroll history must surface
    // punches from deactivated users for legal/audit compliance.
    const { data: profilesRaw } = await supabase
      .from('profiles')
      .select(PROFILE_SAFE_COLUMNS)
      .in('id', allUserIds)
      .order('full_name');
    const profiles = (profilesRaw || []) as any[];

    if (!profiles) return;

    const [allPunchesResult, allShiftsResult, wagesResult] = await Promise.all([
      supabase
        .from('time_punches')
        .select('*')
        .eq('location_id', currentLocation.id)
        .in('user_id', allUserIds)
        .gte('punch_time', punchQueryStart.toISOString())
        .lte('punch_time', punchQueryEnd.toISOString())
        .order('punch_time'),
      supabase
        .from('scheduled_shifts' as any)
        .select('user_id, shift_date, start_time, end_time, is_time_off')
        .in('user_id', allUserIds)
        .gte('shift_date', selectedPeriod.startDate)
        .lte('shift_date', selectedPeriod.endDate) as any,
      supabase.rpc('get_current_wages_batch', { p_user_ids: allUserIds }),
    ]);

    const wageByUserId = new Map<string, number>();
    ((wagesResult.data as any[]) || []).forEach((row: any) => {
      if (row.hourly_wage != null) wageByUserId.set(row.user_id, row.hourly_wage);
    });

    const punchesByUser = new Map<string, any[]>();
    (allPunchesResult.data || []).forEach((p: any) => {
      const arr = punchesByUser.get(p.user_id) || [];
      arr.push(p);
      punchesByUser.set(p.user_id, arr);
    });

    const shiftsByUser = new Map<string, any[]>();
    ((allShiftsResult as any).data || []).forEach((s: any) => {
      const arr = shiftsByUser.get(s.user_id) || [];
      arr.push(s);
      shiftsByUser.set(s.user_id, arr);
    });

    const allCreatorIds = [...new Set(
      (allPunchesResult.data || [])
        .filter((p: any) => p.created_by || p.edited_by)
        .flatMap((p: any) => [p.created_by, p.edited_by].filter(Boolean))
    )] as string[];
    
    const { data: allCreatorProfiles } = allCreatorIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', allCreatorIds)
      : { data: [] };
    
    const globalCreatorMap = new Map((allCreatorProfiles || []).map((p: any) => [p.id, p.full_name]));

    const cards = profiles.map((profile) => {
        const punches = punchesByUser.get(profile.id) || [];
        const scheduledShifts = shiftsByUser.get(profile.id) || [];
        const currentWage = wageByUserId.get(profile.id) ?? null;
        
        const shiftsByDate = new Map<string, { start_time: string; end_time: string; is_time_off: boolean }>();
        scheduledShifts.forEach((shift: any) => {
          shiftsByDate.set(shift.shift_date, {
            start_time: shift.start_time,
            end_time: shift.end_time,
            is_time_off: shift.is_time_off
          });
        });

        const creatorMap = globalCreatorMap;

        const punchesByDay: { [key: string]: any[] } = {};
        const allPunches = punches || [];
        
        const getCutoffForPreviousDay = (dateStr: string): number => {
          const d = new Date(dateStr + 'T12:00:00Z');
          const prevDayOfWeek = (d.getUTCDay() + 6) % 7;
          return cutoffByDayOfWeek.get(prevDayOfWeek) ?? defaultCutoff;
        };
        
        const clockInsByDay = new Map<string, any>();
        allPunches.forEach((punch) => {
          if (punch.punch_type === 'clock_in') {
            const day = getDateInTimezone(new Date(punch.punch_time), timezone);
            clockInsByDay.set(day, punch);
          }
        });
        
        allPunches.forEach((punch) => {
          const punchTime = new Date(punch.punch_time);
          let day = getDateInTimezone(punchTime, timezone);
          const punchHour = parseInt(formatInTimeZone(punchTime, timezone, 'H'));
          
          const cutoffHour = getCutoffForPreviousDay(day);
          
          if (punch.punch_type === 'clock_out') {
            if (punchHour <= cutoffHour) {
              const sameDayClockIn = clockInsByDay.get(day);
              const shouldMoveToPrevDay = !sameDayClockIn || 
                new Date(sameDayClockIn.punch_time).getTime() > punchTime.getTime();
              
              if (shouldMoveToPrevDay) {
                const localDateStr = formatInTimeZone(punchTime, timezone, 'yyyy-MM-dd');
                const dateAtNoon = new Date(localDateStr + 'T12:00:00Z');
                dateAtNoon.setUTCDate(dateAtNoon.getUTCDate() - 1);
                const prevDay = dateAtNoon.toISOString().slice(0, 10);
                if (clockInsByDay.has(prevDay)) {
                  day = prevDay;
                }
              }
            }
          }
          
          if (punch.punch_type === 'break_end' || punch.punch_type === 'break_start') {
            if (punchHour <= cutoffHour) {
              const sameDayClockIn = clockInsByDay.get(day);
              const shouldMoveToPrevDay = !sameDayClockIn || 
                new Date(sameDayClockIn.punch_time).getTime() > punchTime.getTime();
              
              if (shouldMoveToPrevDay) {
                const localDateStr = formatInTimeZone(punchTime, timezone, 'yyyy-MM-dd');
                const dateAtNoon = new Date(localDateStr + 'T12:00:00Z');
                dateAtNoon.setUTCDate(dateAtNoon.getUTCDate() - 1);
                const prevDay = dateAtNoon.toISOString().slice(0, 10);
                if (clockInsByDay.has(prevDay)) {
                  day = prevDay;
                }
              }
            }
          }
          if (day < selectedPeriod.startDate || day > selectedPeriod.endDate) {
            return;
          }

          if (!punchesByDay[day]) punchesByDay[day] = [];
          const createdByName = punch.created_by && punch.created_by !== profile.id
            ? creatorMap.get(punch.created_by) || null
            : null;
          const editedByName = punch.edited_by && punch.edited_by !== profile.id
            ? creatorMap.get(punch.edited_by) || null
            : null;
          punchesByDay[day].push({ ...punch, created_by_name: createdByName, edited_by_name: editedByName });
        });

        const issues: string[] = [];
        
        Object.entries(punchesByDay).forEach(([day, dayPunches]) => {
          const sortedPunches = [...dayPunches].sort((a, b) => 
            new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
          );
          
          const clockIns = sortedPunches.filter(p => p.punch_type === 'clock_in');
          const clockOuts = sortedPunches.filter(p => p.punch_type === 'clock_out');
          const usedClockOutIds = new Set<string>();
          
          clockIns.forEach((clockIn, shiftIndex) => {
            const clockInTime = new Date(clockIn.punch_time).getTime();
            const nextClockIn = clockIns[shiftIndex + 1];
            const nextClockInTime = nextClockIn ? new Date(nextClockIn.punch_time).getTime() : Infinity;
            
            const clockOut = clockOuts.find(co => {
              const coTime = new Date(co.punch_time).getTime();
              return coTime > clockInTime && coTime < nextClockInTime && !usedClockOutIds.has(co.id);
            });
            
            if (!clockOut) {
              issues.push(`${day}: Missing clock out${clockIns.length > 1 ? ` (shift ${shiftIndex + 1})` : ''}`);
              return;
            }
            
            usedClockOutIds.add(clockOut.id);
            const clockOutTime = new Date(clockOut.punch_time).getTime();
            
            let hours = (clockOutTime - clockInTime) / 3600000;
            if (hours < 0) hours += 24;
            
            const shiftBreaks = sortedPunches.filter(p => 
              p.punch_type === 'break_start' && 
              p.notes?.includes('30 minute') &&
              new Date(p.punch_time).getTime() > clockInTime &&
              new Date(p.punch_time).getTime() < clockOutTime
            );
            
            if (hours > 5 && shiftBreaks.length === 0) {
              issues.push(`${day}: Missing required meal break${clockIns.length > 1 ? ` (shift ${shiftIndex + 1})` : ''}`);
            }
          });
        });

        const totalHours = Object.values(punchesByDay).reduce((sum: number, dayPunches: any[]) => {
          return sum + calculateDayHours(dayPunches, false);
        }, 0);

        return {
          profile: {
            ...profile,
            hourly_wage: currentWage || 15
          },
          punches: punches || [],
          punchesByDay,
          shiftsByDate,
          totalHours,
          issues
        };
      });

    setTimeCards(cards);
    // Stamp cache so navigating away/back skips refetch for 5 min
    if (selectedPeriod && currentLocation) {
      lastFetchRef.current = {
        key: `${selectedPeriod.startDate}_${selectedPeriod.endDate}_${currentLocation.id}`,
        at: Date.now(),
      };
    }
  };

  // ─── Delete handlers ──────────────────────────────────────────────
  const handleDeletePunch = async (punchId: string) => {
    if (!currentLocation?.id) {
      toast.error('No location selected');
      return;
    }

    const { data, error } = await supabase.functions.invoke('delete-time-punches', {
      body: {
        location_id: currentLocation.id,
        punch_ids: [punchId],
      },
    });

    if (error) {
      console.error('[PayrollReview] delete-time-punches error:', error);
      toast.error('Failed to delete punch');
      return;
    }

    if (!data?.deleted_ids?.length) {
      toast.error('Nothing was deleted');
      return;
    }

    toast.success('Punch deleted');
    fetchTimeCards();
  };

  const handleDeleteAllDayPunches = async (dayPunches: any[]) => {
    if (!currentLocation?.id) {
      toast.error('No location selected');
      return;
    }

    const punchIds = dayPunches.map((p) => p.id).filter(Boolean);
    console.log('[PayrollReview] Deleting punches:', { location_id: currentLocation.id, punch_ids: punchIds, count: punchIds.length });

    if (punchIds.length === 0) {
      toast.error('No punch records to delete');
      setDeleteConfirmation(null);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('delete-time-punches', {
        body: {
          location_id: currentLocation.id,
          punch_ids: punchIds,
        },
      });

      console.log('[PayrollReview] delete-time-punches response:', { data, error });

      if (error) {
        console.error('[PayrollReview] delete-time-punches error:', error);
        toast.error('Failed to delete shift');
        return;
      }

      toast.success('Shift deleted');
      setEditingShift(null);
      setDeleteConfirmation(null);
      fetchTimeCards();
    } catch (err: any) {
      console.error('[PayrollReview] delete-time-punches exception:', err);
      toast.error('Failed to delete shift: ' + (err?.message || 'Unknown error'));
    }
  };

  // ─── Approval handlers ────────────────────────────────────────────
  const handleApprovePunch = async (punchId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('time_punches')
      .update({ 
        approved_by: user.id,
        approved_at: new Date().toISOString()
      })
      .eq('id', punchId);

    if (error) {
      toast.error('Failed to approve punch');
      return;
    }

    toast.success('Punch approved');
    fetchTimeCards();
  };

  const handleUnapproveDay = (dayPunches: any[]) => {
    const punchIds = dayPunches.map(p => p.id);
    
    setApprovingPunchIds(prev => new Set([...prev, ...punchIds]));
    setTimeCards(prev => prev.map(card => ({
      ...card,
      punchesByDay: Object.fromEntries(
        Object.entries(card.punchesByDay).map(([day, dpunches]: [string, any]) => [
          day,
          dpunches.map((p: any) => 
            punchIds.includes(p.id) 
              ? { ...p, approved_by: null, approved_at: null }
              : p
          )
        ])
      )
    })));

    supabase
      .from('time_punches')
      .update({ 
        approved_by: null,
        approved_at: null
      })
      .in('id', punchIds)
      .then(({ error }) => {
        setApprovingPunchIds(prev => {
          const next = new Set(prev);
          punchIds.forEach(id => next.delete(id));
          return next;
        });

        if (error) {
          toast.error('Failed to unapprove shift');
          fetchTimeCards();
        }
      });
  };

  const approvePunches = async (punchIds: string[]) => {
    if (!currentUserId) return;

    const now = new Date().toISOString();
    setApprovingPunchIds(prev => new Set([...prev, ...punchIds]));
    setTimeCards(prev => prev.map(card => ({
      ...card,
      punchesByDay: Object.fromEntries(
        Object.entries(card.punchesByDay).map(([day, dayPunches]: [string, any]) => [
          day,
          dayPunches.map((p: any) => 
            punchIds.includes(p.id) 
              ? { ...p, approved_by: currentUserId, approved_at: now }
              : p
          )
        ])
      )
    })));

    supabase
      .from('time_punches')
      .update({ 
        approved_by: currentUserId,
        approved_at: now
      })
      .in('id', punchIds)
      .then(({ error }) => {
        setApprovingPunchIds(prev => {
          const next = new Set(prev);
          punchIds.forEach(id => next.delete(id));
          return next;
        });

        if (error) {
          toast.error('Failed to approve punches');
          fetchTimeCards();
        } else {
          setApprovalWarning(null);
        }
      });
  };

  const handleApproveDay = async (dayPunches: any[]) => {
    const hasAutoClockOut = dayPunches.some((p: any) => p.is_auto_punched_out);
    const hasOvertime = dayPunches.some((p: any) => p.has_overtime);
    const hasExtendedBreak = dayPunches.some((p: any) => p.has_extended_break);
    
    const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
    const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
    const mealBreakStart = dayPunches.find((p: any) => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
    
    let hasBreakViolation = false;
    if (clockIn && clockOut) {
      let hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
      if (hours < 0) hours += 24;
      if (hours > 5 && !mealBreakStart) {
        hasBreakViolation = true;
      }
    }
    
    if (hasAutoClockOut || hasBreakViolation || hasOvertime || hasExtendedBreak) {
      const shiftClockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
      const shiftDate = shiftClockIn ? getDateInTimezone(new Date(shiftClockIn.punch_time), timezone) : '';
      const userId = shiftClockIn?.user_id || '';
      const locationId = currentLocation?.id || '';

      setApprovalWarning({
        punches: dayPunches,
        type: 'day',
        hasBreakViolation,
        hasAutoClockOut,
        hasOvertime,
        hasExtendedBreak,
        shiftInfo: { dayPunches, userId, locationId, shiftDate },
      });
      return;
    }
    await approvePunches(dayPunches.map(p => p.id));
  };

  // ─── Filtering & counts ───────────────────────────────────────────
  const periodDates = useMemo(() => {
    if (!selectedPeriod) return [];

    const dates: { value: string; label: string }[] = [];
    let current = parseDateStringInTimezone(selectedPeriod.startDate, timezone);
    const end = parseDateStringInTimezone(selectedPeriod.endDate, timezone);

    while (current <= end) {
      const value = getDateInTimezone(current, timezone);
      dates.push({
        value,
        label: formatDateTimeInTimezone(current, timezone, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
      });
      current = addDays(current, 1);
    }

    return dates;
  }, [selectedPeriod, timezone]);

  const filteredCards = useMemo(() => {
    let cards = filterEmployee === 'all' 
      ? timeCards 
      : timeCards.filter(card => card.profile.id === filterEmployee);
    
    if (filterDay !== 'all') {
      cards = cards.map(card => {
        const filteredPunchesByDay: { [key: string]: any[] } = {};
        Object.entries(card.punchesByDay).forEach(([day, punches]) => {
          if (day === filterDay) {
            filteredPunchesByDay[day] = punches as any[];
          }
        });
        return {
          ...card,
          punchesByDay: filteredPunchesByDay
        };
      }).filter(card => Object.keys(card.punchesByDay).length > 0);
    }
    
    if (filterFlag !== 'all') {
      cards = cards
        .map((card) => {
          const filteredPunchesByDay: { [key: string]: any[] } = {};

          Object.entries(card.punchesByDay).forEach(([day, dayPunches]: [string, any]) => {
            const flags = getDayFlags(dayPunches);

            if (filterFlag === 'flagged' && flags.hasAnyFlag) {
              filteredPunchesByDay[day] = dayPunches;
              return;
            }

            if (filterFlag === 'auto_punch' && flags.hasAutoClockOut) {
              filteredPunchesByDay[day] = dayPunches;
              return;
            }

            if (filterFlag === 'break_violation' && flags.hasBreakViolation) {
              filteredPunchesByDay[day] = dayPunches;
              return;
            }

            if (filterFlag === 'open_shift' && flags.hasOpenShift) {
              filteredPunchesByDay[day] = dayPunches;
            }
          });

          return {
            ...card,
            punchesByDay: filteredPunchesByDay,
          };
        })
        .filter((card) => Object.keys(card.punchesByDay).length > 0);
    }

    return cards;
  }, [timeCards, filterEmployee, filterDay, filterFlag]);

  const countShiftsAwaitingApproval = (cards: typeof timeCards) => {
    return cards.reduce((sum, card) => {
      const daysWithUnapproved = Object.values(card.punchesByDay).filter(
        (dayPunches: any[]) => {
          const hasUnapproved = dayPunches.some((p: any) => !p.approved_at);
          if (!hasUnapproved) return false;
          const flags = getDayFlags(dayPunches);
          return !flags.hasOpenShift;
        }
      );
      return sum + daysWithUnapproved.length;
    }, 0);
  };

  const totalPunchesAwaitingApproval = countShiftsAwaitingApproval(timeCards);
  const filteredPunchesAwaitingApproval = countShiftsAwaitingApproval(filteredCards);

  const handleApproveAll = async () => {
    const cleanPunchIds: string[] = [];
    const flaggedShifts: { employeeName: string, date: string, flags: string[] }[] = [];
    let hasAnyFlags = false;
    
    filteredCards.forEach(card => {
      Object.entries(card.punchesByDay).forEach(([day, dayPunches]: [string, any]) => {
        const hasUnapproved = dayPunches.some((p: any) => !p.approved_at);
        if (!hasUnapproved) return;
        
        const dayFlags = getDayFlags(dayPunches);
        if (dayFlags.hasOpenShift) return;
        
        const flags: string[] = [];
        
        if (dayPunches.some((p: any) => p.is_auto_punched_out)) {
          flags.push('Auto Clock-Out');
        }
        
        if (dayPunches.some((p: any) => p.has_overtime)) {
          flags.push('Overtime');
        }
        
        if (dayPunches.some((p: any) => p.has_extended_break)) {
          flags.push('Extended Break');
        }
        
        const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
        const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
        const mealBreakStart = dayPunches.find((p: any) => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
        
        if (clockIn && clockOut) {
          let hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
          if (hours < 0) hours += 24;
          if (hours > 5 && !mealBreakStart) {
            flags.push('Missing Meal Break');
          }
        }
        
        if (flags.length > 0) {
          hasAnyFlags = true;
          flaggedShifts.push({
            employeeName: card.profile.full_name,
            date: day,
            flags
          });
        } else {
          dayPunches.forEach((p: any) => {
            if (!p.approved_at) cleanPunchIds.push(p.id);
          });
        }
      });
    });

    if (cleanPunchIds.length === 0 && flaggedShifts.length === 0) {
      toast.info('No punches to approve');
      return;
    }

    if (hasAnyFlags) {
      setApprovalWarning({ 
        punches: [], 
        type: 'all', 
        flaggedShifts,
        cleanPunchIds,
        hasAutoClockOut: flaggedShifts.some(s => s.flags.includes('Auto Clock-Out')),
        hasBreakViolation: flaggedShifts.some(s => s.flags.includes('Missing Meal Break')),
        hasOvertime: flaggedShifts.some(s => s.flags.includes('Overtime')),
        hasExtendedBreak: flaggedShifts.some(s => s.flags.includes('Extended Break'))
      });
      return;
    }
    
    await approvePunches(cleanPunchIds);
  };

  // ─── Period status & close/reopen ─────────────────────────────────
  const getPeriodStatus = (period: any) => {
    const key = `${period.startDate}_${period.endDate}`;
    return periodStatuses[key];
  };

  const handleClosePeriod = async (opts?: { resyncTips?: boolean }) => {
    if (!selectedPeriod || !currentLocation) return;

    if (totalPunchesAwaitingApproval > 0) {
      toast.error(`Cannot close pay period: ${totalPunchesAwaitingApproval} shift(s) still need approval`);
      return;
    }

    const startDate = selectedPeriod.startDate;
    const endDate = selectedPeriod.endDate;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setClosingPeriod(true);

    // ── Closed-period guard ──────────────────────────────────────────
    // A period that was already closed once has audited tip numbers. Re-closing
    // it (after a reopen) must NOT silently re-pull tips from the POS and restate
    // history — only an explicit resyncTips request may do that.
    let hasBeenClosedBefore = false;
    try {
      const { data: existingPeriod } = await supabase
        .from('pay_periods')
        .select('closed_at')
        .eq('start_date', startDate)
        .eq('end_date', endDate)
        .maybeSingle();
      hasBeenClosedBefore = !!existingPeriod?.closed_at;
    } catch { /* non-blocking */ }

    const shouldSyncTips = opts?.resyncTips === true || !hasBeenClosedBefore;

    if (!shouldSyncTips) {
      console.log('[PayrollReview] Closed-period guard: skipping tip re-sync (period previously closed)');
    }

    if (shouldSyncTips) try {

      // Detect which POS this location uses so we sync tips from the right source
      const { data: cloverIntegration } = await supabase
        .from('location_integrations')
        .select('id')
        .eq('location_id', currentLocation.id)
        .eq('integration_type', 'clover')
        .eq('is_active', true)
        .maybeSingle();

      const isClover = !!cloverIntegration;
      toast.info(isClover ? 'Syncing tips from Clover...' : 'Syncing tips from QuBeyond...');

      const url = isClover
        ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clover-sync`
        : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-service?action=sync-tips`;

      const payload = isClover
        ? { action: 'sync_range', locationId: currentLocation.id, startDate, endDate }
        : { locationId: currentLocation.id, startDate, endDate };

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      const syncResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify(payload),
      });

      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        console.log('[PayrollReview] Tips sync result:', syncData);
        const syncedDays = isClover
          ? (Array.isArray(syncData.results) ? syncData.results.length : 0)
          : (syncData.synced ?? 0);
        if (syncedDays > 0) {
          toast.success(`Synced tips for ${syncedDays} days`);
        }
      } else {
        console.warn('[PayrollReview] Tips sync failed, continuing with close');
      }
    } catch (tipSyncError) {
      console.warn('[PayrollReview] Tips sync error (non-blocking):', tipSyncError);
    }


    const { error } = await supabase
      .from('pay_periods')
      .upsert(
        {
          start_date: startDate,
          end_date: endDate,
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: user.id,
        },
        { onConflict: 'start_date,end_date' }
      );

    setClosingPeriod(false);

    if (error) {
      toast.error('Failed to close pay period');
      return;
    }

    toast.success('Pay period closed');
    generatePayPeriods();
  };

  const handleReopenPeriod = async () => {
    if (!selectedPeriod) return;

    const startDate = selectedPeriod.startDate;
    const endDate = selectedPeriod.endDate;

    const { error } = await supabase
      .from('pay_periods')
      .update({
        status: 'open',
        closed_at: null,
        closed_by: null,
      })
      .eq('start_date', startDate)
      .eq('end_date', endDate);

    if (error) {
      toast.error('Failed to reopen pay period');
      return;
    }

    toast.success('Pay period reopened');
    generatePayPeriods();
  };

  // ─── Payroll Summary & Exports ────────────────────────────────────
  const getWeekStartForDate = (dateStr: string): string => {
    const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
      parseDateStringInTimezone(dateStr, timezone)
    );
    const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const dow = map[weekdayShort] ?? 0;
    const weekStart = addDays(parseDateStringInTimezone(dateStr, timezone), -dow);
    return getDateInTimezone(weekStart, timezone);
  };

  const calculatePayrollSummary = () => {
    // A 0/null daily threshold means no daily OT/DT rule for that state — treat as disabled
    // so hours land in Regular instead of collapsing into double time.
    const rawDailyOT = laborRules?.daily_overtime_threshold;
    const rawDailyDT = laborRules?.daily_double_time_threshold;
    const dailyOTThreshold = rawDailyOT && rawDailyOT > 0 ? rawDailyOT : Infinity;
    const dailyDTThreshold = rawDailyDT && rawDailyDT > 0 ? rawDailyDT : Infinity;
    const weeklyOTThreshold = laborRules?.weekly_overtime_threshold ?? 40;
    const otMultiplier = laborRules?.overtime_multiplier ?? 1.5;
    const dtMultiplier = laborRules?.double_time_multiplier ?? 2.0;

    const summary = timeCards.map(card => {
      const ptoHours = ptoData[card.profile.id] || 0;
      const wage = card.profile.hourly_wage || 15;
      
      const hoursByWeek: { [weekStart: string]: { dailyHours: { [day: string]: number } } } = {};
      
      Object.entries(card.punchesByDay).forEach(([day, punches]) => {
        const weekStart = getWeekStartForDate(day);
        if (!hoursByWeek[weekStart]) {
          hoursByWeek[weekStart] = { dailyHours: {} };
        }
        hoursByWeek[weekStart].dailyHours[day] = calculateDayHours(punches as any[], false);
      });
      
      let totalRegular = 0;
      let totalOT = 0;
      let totalDT = 0;
      
      Object.values(hoursByWeek).forEach(week => {
        const dailyHoursList = Object.values(week.dailyHours);
        
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
        
        const weeklyOT = Math.max(0, weeklyTotalHours - weeklyOTThreshold);
        
        const actualOT = Math.max(weeklyDailyOT, weeklyOT);
        
        const actualRegular = weeklyTotalHours - actualOT - weeklyDailyDT;
        
        totalRegular += Math.max(0, actualRegular);
        totalOT += actualOT;
        totalDT += weeklyDailyDT;
      });
      
      const grossWages = (totalRegular * wage) + (totalOT * wage * otMultiplier) + (totalDT * wage * dtMultiplier) + (ptoHours * wage);
      
      const tipShare = employeeTipShares.find(t => t.userId === card.profile.id);
      const tips = tipShare?.totalTips || 0;
      
      return {
        name: card.profile.full_name,
        odId: card.profile.id,
        wage,
        regularHours: totalRegular,
        overtimeHours: totalOT,
        ptoHours,
        doubleOvertimeHours: totalDT,
        tips,
        grossWages,
        totalCompensation: grossWages + tips
      };
    });

    const filteredSummary = summary.filter(emp => 
      emp.regularHours > 0 || emp.overtimeHours > 0 || emp.doubleOvertimeHours > 0 || emp.ptoHours > 0 || emp.tips > 0
    );

    const totals = filteredSummary.reduce((acc, emp) => ({
      regularHours: acc.regularHours + emp.regularHours,
      overtimeHours: acc.overtimeHours + emp.overtimeHours,
      doubleOvertimeHours: acc.doubleOvertimeHours + emp.doubleOvertimeHours,
      ptoHours: acc.ptoHours + emp.ptoHours,
      tips: acc.tips + emp.tips,
      grossWages: acc.grossWages + emp.grossWages,
      totalCompensation: acc.totalCompensation + emp.totalCompensation
    }), { regularHours: 0, overtimeHours: 0, doubleOvertimeHours: 0, ptoHours: 0, tips: 0, grossWages: 0, totalCompensation: 0 });

    return { employees: filteredSummary, totals };
  };

  const groupPunchesByWeek = (punchesByDay: { [key: string]: any[] }) => {
    const weeks: {
      [weekKey: string]: { start: Date; end: Date; days: { [day: string]: any[] } };
    } = {};

    const getWeekStartStr = (dateStr: string) => {
      const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
        parseDateStringInTimezone(dateStr, timezone)
      );
      const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const dow = map[weekdayShort] ?? 0;
      const weekStart = addDays(parseDateStringInTimezone(dateStr, timezone), -dow);
      return getDateInTimezone(weekStart, timezone);
    };

    Object.entries(punchesByDay).forEach(([day, punches]) => {
      const dayDate = parseDateStringInTimezone(day, timezone);

      if (selectedPeriod) {
        if (dayDate < selectedPeriod.start || dayDate > selectedPeriod.end) return;
      }

      const weekStartStr = getWeekStartStr(day);
      const weekStart = parseDateStringInTimezone(weekStartStr, timezone);
      const weekEndStr = getDateInTimezone(addDays(weekStart, 6), timezone);
      const weekEnd = getEndOfDateStringInTimezone(weekEndStr, timezone);
      const weekKey = weekStartStr;

      if (!weeks[weekKey]) {
        weeks[weekKey] = { start: weekStart, end: weekEnd, days: {} };
      }
      weeks[weekKey].days[day] = punches;
    });

    return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
  };

  const exportToCSV = () => {
    const summary = calculatePayrollSummary();
    const headers = ['Employee', 'Hourly Wage', 'Regular Hours', 'Overtime Hours', 'PTO Hours', 'Tips', 'Gross Wages', 'Total Compensation'];
    const rows = summary.employees.map(emp => [
      emp.name,
      emp.wage.toFixed(2),
      emp.regularHours.toFixed(2),
      emp.overtimeHours.toFixed(2),
      emp.ptoHours.toFixed(2),
      emp.tips.toFixed(2),
      emp.grossWages.toFixed(2),
      emp.totalCompensation.toFixed(2)
    ]);
    rows.push(['TOTALS', '', summary.totals.regularHours.toFixed(2), summary.totals.overtimeHours.toFixed(2), summary.totals.ptoHours.toFixed(2), summary.totals.tips.toFixed(2), summary.totals.grossWages.toFixed(2), summary.totals.totalCompensation.toFixed(2)]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${selectedPeriod.startDate}-to-${selectedPeriod.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const exportToPDF = () => {
    const summary = calculatePayrollSummary();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to export PDF');
      return;
    }
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Payroll Report - ${selectedPeriod.label}</title>
          <style>
            body { font-family: system-ui, sans-serif; padding: 40px; }
            h1 { font-size: 24px; margin-bottom: 8px; }
            h2 { font-size: 14px; color: #666; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #f5f5f5; font-weight: 600; }
            .right { text-align: right; }
            .total { font-weight: bold; background: #f0f0f0; }
            .summary { margin-top: 24px; padding: 16px; background: #f9f9f9; border-radius: 8px; }
            .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
            .summary-total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; margin-top: 8px; padding-top: 8px; }
          </style>
        </head>
        <body>
          <h1>Payroll Report</h1>
          <h2>${selectedPeriod.label}</h2>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th class="right">Hourly Wage</th>
                <th class="right">Regular Hours</th>
                <th class="right">Overtime</th>
                <th class="right">PTO</th>
                <th class="right">Gross Wages</th>
              </tr>
            </thead>
            <tbody>
              ${summary.employees.map(emp => `
                <tr>
                  <td>${emp.name}</td>
                  <td class="right">$${emp.wage.toFixed(2)}</td>
                  <td class="right">${emp.regularHours.toFixed(2)}</td>
                  <td class="right">${emp.overtimeHours.toFixed(2)}</td>
                  <td class="right">${emp.ptoHours.toFixed(2)}</td>
                  <td class="right">$${emp.grossWages.toFixed(2)}</td>
                </tr>
              `).join('')}
              <tr class="total">
                <td>TOTALS</td>
                <td></td>
                <td class="right">${summary.totals.regularHours.toFixed(2)}</td>
                <td class="right">${summary.totals.overtimeHours.toFixed(2)}</td>
                <td class="right">${summary.totals.ptoHours.toFixed(2)}</td>
                <td class="right">$${summary.totals.grossWages.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-row"><span>Total Regular Hours:</span><span>${summary.totals.regularHours.toFixed(2)}</span></div>
            <div class="summary-row"><span>Total Overtime Hours:</span><span>${summary.totals.overtimeHours.toFixed(2)}</span></div>
            <div class="summary-row"><span>Approved PTO Hours:</span><span>${summary.totals.ptoHours.toFixed(2)}</span></div>
            <div class="summary-row summary-total"><span>Total Gross Wages:</span><span>$${summary.totals.grossWages.toFixed(2)}</span></div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const currentPeriodStatus = selectedPeriod ? getPeriodStatus(selectedPeriod) : null;
  const isPeriodClosed = currentPeriodStatus?.status === 'closed';

  return {
    // Auth / location
    isAdmin,
    isManager,
    currentLocation,
    timezone,

    // Pay periods
    payPeriods,
    periodSummaries,
    selectedPeriod,
    setSelectedPeriod,
    getPeriodStatus,
    currentPeriodStatus,
    isPeriodClosed,
    closingPeriod,
    handleClosePeriod,
    handleReopenPeriod,

    // Time cards & punches
    timeCards,
    fetchTimeCards,
    editingShift,
    setEditingShift,
    showQuickEntry,
    setShowQuickEntry,
    deleteConfirmation,
    setDeleteConfirmation,
    handleDeletePunch,
    handleDeleteAllDayPunches,

    // Filters
    includeApproved,
    setIncludeApproved,
    filterEmployee,
    setFilterEmployee,
    filterDay,
    setFilterDay,
    filterFlag,
    setFilterFlag,
    viewMode,
    setViewMode,
    periodDates,
    filteredCards,

    // Approvals
    approvalWarning,
    setApprovalWarning,
    approvingPunchIds,
    handleApprovePunch,
    handleApproveDay,
    handleUnapproveDay,
    handleApproveAll,
    approvePunches,
    totalPunchesAwaitingApproval,
    filteredPunchesAwaitingApproval,

    // Calculations (passed to child components)
    calculateDayHours,
    sortPunches,
    getDayFlags,
    hasDayIssues,
    groupPunchesByWeek,

    // Payroll summary & exports
    calculatePayrollSummary,
    exportToCSV,
    exportToPDF,

    // Tips
    tipsLoading,
    employeeTipShares,
    totalTipPool,
    totalDistributedTips,
    totalHoursWithTips,
    dailyTips,
  };
}
