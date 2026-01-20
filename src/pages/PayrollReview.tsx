import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, addWeeks } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { useTipDistribution } from '@/hooks/useTipDistribution';
import { toast } from 'sonner';
import { ChevronLeft, AlertTriangle, Trash2, Clock, CheckCircle2, Lock, AlertCircle, Coffee, Download, FileSpreadsheet, Calendar, DollarSign, ChevronDown, Pencil } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Layout } from '@/components/Layout';
import { QuickPunchDialog } from '@/components/timeclock/QuickPunchDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import autoPunchIcon from '@/assets/auto-punch-icon.jpg';
import { DesktopTimeTrackingTable } from '@/components/timetracking/DesktopTimeTrackingTable';
import {
  toISOStringInTimezone,
  formatTimeDisplay,
  formatDateTimeInTimezone,
  getStartOfTodayInTimezone,
  getDateInTimezone,
  parseDateStringInTimezone,
  getEndOfDateStringInTimezone,
  calculateCutoffHour,
} from '@/utils/timezoneUtils';

// Edit Shift Form Component - Full shift editing with clock in/out and breaks
function EditShiftForm({ 
  dayPunches, 
  userId,
  locationId,
  shiftDate,
  timezone,
  onSave, 
  onCancel,
  onDelete
}: { 
  dayPunches: any[]; 
  userId: string;
  locationId: string;
  shiftDate: string;
  timezone: string;
  onSave: () => void; 
  onCancel: () => void;
  onDelete: () => void;
}) {
  // Sort punches chronologically to identify first clock_in and last clock_out
  const sortedPunches = [...dayPunches].sort((a: any, b: any) => 
    new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );
  
  // Identify SHIFT-STARTING clock_ins (not return-from-break clock_ins)
  const shiftStartClockIns: any[] = [];
  sortedPunches.forEach((punch: any, idx: number) => {
    if (punch.punch_type !== 'clock_in') return;
    if (idx === 0) {
      shiftStartClockIns.push(punch);
      return;
    }
    const prevPunch = sortedPunches[idx - 1];
    if (prevPunch.punch_type === 'clock_out') {
      shiftStartClockIns.push(punch);
    }
  });
  
  // For single-shift editing: use the FIRST shift-starting clock_in
  const clockIn = shiftStartClockIns[0] || null;
  
  // Find the LAST clock_out of the day (for the shift that started with clockIn)
  const clockOuts = sortedPunches.filter((p: any) => p.punch_type === 'clock_out');
  // If there are multiple shifts, get the clock_out that belongs to the first shift
  // (the one before the next shift-starting clock_in, or the last if only one shift)
  let clockOut: any = null;
  if (shiftStartClockIns.length === 1) {
    // Single shift - use last clock_out
    clockOut = clockOuts[clockOuts.length - 1] || null;
  } else if (shiftStartClockIns.length > 1 && clockIn) {
    // Multiple shifts - find clock_out between first and second shift
    const firstShiftStart = new Date(clockIn.punch_time).getTime();
    const secondShiftStart = new Date(shiftStartClockIns[1].punch_time).getTime();
    clockOut = clockOuts.find((co: any) => {
      const coTime = new Date(co.punch_time).getTime();
      return coTime > firstShiftStart && coTime < secondShiftStart;
    }) || null;
  }
  
  const mealBreakStart = sortedPunches.find((p: any) => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
  let mealBreakEnd = sortedPunches.find((p: any) => p.punch_type === 'break_end' && p.notes?.includes('30 minute'));
  
  // Fallback: If no explicit break_end, check if a clock_in follows the break_start (used to end break)
  if (mealBreakStart && !mealBreakEnd) {
    const breakStartTime = new Date(mealBreakStart.punch_time).getTime();
    const clockInAfterBreak = sortedPunches.find((p: any) => 
      p.punch_type === 'clock_in' && 
      new Date(p.punch_time).getTime() > breakStartTime &&
      !shiftStartClockIns.includes(p) // Must NOT be a shift-starting clock_in
    );
    if (clockInAfterBreak) {
      mealBreakEnd = clockInAfterBreak;
    }
  }

  // Format times in the location's timezone for display/editing
  const formatTimeForEdit = (punch: any): string => {
    if (!punch) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(punch.punch_time));
  };

  const [clockInTime, setClockInTime] = useState(formatTimeForEdit(clockIn) || '');
  const [clockOutTime, setClockOutTime] = useState(formatTimeForEdit(clockOut) || '');
  const [hasMealBreak, setHasMealBreak] = useState(!!mealBreakStart);
  const [mealBreakStartTime, setMealBreakStartTime] = useState(formatTimeForEdit(mealBreakStart) || '12:00');
  const [mealBreakEndTime, setMealBreakEndTime] = useState(formatTimeForEdit(mealBreakEnd) || '12:30');
  const [saving, setSaving] = useState(false);

  // Helper to determine if a time crosses midnight relative to clock-in
  // If clock-out time is earlier than clock-in time (e.g., clock-in 18:00, clock-out 01:30)
  // then clock-out is on the next calendar day
  const getAdjustedDateForTime = (timeStr: string, referenceTimeStr: string, baseDate: string): string => {
    const [timeHour] = timeStr.split(':').map(Number);
    const [refHour] = referenceTimeStr.split(':').map(Number);
    
    // If the time is significantly earlier than reference (e.g., 01:30 vs 18:00)
    // it means the time crosses midnight and should be on the next day
    // Use threshold: if time is < 12 and reference is >= 12, it's likely next day
    if (timeHour < 12 && refHour >= 12) {
      const nextDay = new Date(baseDate);
      nextDay.setDate(nextDay.getDate() + 1);
      return nextDay.toISOString().slice(0, 10);
    }
    return baseDate;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Get current user for change tracking
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || null;
      const now = new Date().toISOString();
      
      // Update clock in - use timezone-aware conversion
      // Note: Do NOT update created_by on edits - track edits via edited_by
      if (clockIn && clockInTime) {
        const newClockInTime = toISOStringInTimezone(shiftDate, clockInTime, timezone);
        await supabase.from('time_punches').update({ 
          punch_time: newClockInTime,
          edited_by: currentUserId,
          edited_at: now
        }).eq('id', clockIn.id);
      }

      // Update clock out - clear auto_punched flag when manager edits
      // Handle midnight-crossing: if clock-out time < clock-in time, use next day
      if (clockOut && clockOutTime) {
        const clockOutDate = getAdjustedDateForTime(clockOutTime, clockInTime, shiftDate);
        const newClockOutTime = toISOStringInTimezone(clockOutDate, clockOutTime, timezone);
        await supabase.from('time_punches').update({ 
          punch_time: newClockOutTime,
          edited_by: currentUserId,
          edited_at: now,
          is_auto_punched_out: false // Clear flag when manager edits
        }).eq('id', clockOut.id);
      } else if (!clockOut && clockOutTime) {
        // Add missing clock out - this IS an insert, so set created_by
        const clockOutDate = getAdjustedDateForTime(clockOutTime, clockInTime, shiftDate);
        const newClockOutTime = toISOStringInTimezone(clockOutDate, clockOutTime, timezone);
        await supabase.from('time_punches').insert({
          user_id: userId,
          location_id: locationId,
          punch_type: 'clock_out',
          punch_time: newClockOutTime,
          created_by: currentUserId
        });
      }

      // Handle meal break
      if (hasMealBreak) {
        // Break times should also handle midnight crossing relative to clock-in
        const breakStartDate = getAdjustedDateForTime(mealBreakStartTime, clockInTime, shiftDate);
        const breakEndDate = getAdjustedDateForTime(mealBreakEndTime, clockInTime, shiftDate);
        const breakStartTime = toISOStringInTimezone(breakStartDate, mealBreakStartTime, timezone);
        const breakEndTime = toISOStringInTimezone(breakEndDate, mealBreakEndTime, timezone);

        if (mealBreakStart) {
          // Update - use edited_by, not created_by
          await supabase.from('time_punches').update({ 
            punch_time: breakStartTime,
            edited_by: currentUserId,
            edited_at: now
          }).eq('id', mealBreakStart.id);
        } else {
          // Insert - use created_by
          await supabase.from('time_punches').insert({
            user_id: userId,
            location_id: locationId,
            punch_type: 'break_start',
            punch_time: breakStartTime,
            notes: '30 minute meal break',
            created_by: currentUserId
          });
        }

        if (mealBreakEnd) {
          // Update - use edited_by, not created_by
          await supabase.from('time_punches').update({ 
            punch_time: breakEndTime,
            edited_by: currentUserId,
            edited_at: now
          }).eq('id', mealBreakEnd.id);
        } else {
          // Insert - use created_by
          await supabase.from('time_punches').insert({
            user_id: userId,
            location_id: locationId,
            punch_type: 'break_end',
            punch_time: breakEndTime,
            notes: '30 minute meal break',
            created_by: currentUserId
          });
        }
      } else {
        // Remove meal break if unchecked
        if (mealBreakStart) await supabase.from('time_punches').delete().eq('id', mealBreakStart.id);
        if (mealBreakEnd) await supabase.from('time_punches').delete().eq('id', mealBreakEnd.id);
      }

      toast.success('Shift updated');
      onSave();
    } catch (error) {
      toast.error('Failed to update shift');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground mb-2">
        {formatDateTimeInTimezone(parseDateStringInTimezone(shiftDate, timezone), timezone, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Clock In
          </label>
          <Input
            type="time"
            value={clockInTime}
            onChange={(e) => setClockInTime(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Clock Out
          </label>
          <Input
            type="time"
            value={clockOutTime}
            onChange={(e) => setClockOutTime(e.target.value)}
          />
        </div>
      </div>

      <div className="border-t pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="meal-break"
            checked={hasMealBreak}
            onCheckedChange={(checked) => setHasMealBreak(checked as boolean)}
          />
          <label htmlFor="meal-break" className="text-sm font-medium flex items-center gap-2 cursor-pointer">
            <Coffee className="h-4 w-4 text-amber-600" />
            30-Minute Meal Break
          </label>
        </div>

        {hasMealBreak && (
          <div className="grid grid-cols-2 gap-4 pl-6">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Break Start</label>
              <Input
                type="time"
                value={mealBreakStartTime}
                onChange={(e) => setMealBreakStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Break End</label>
              <Input
                type="time"
                value={mealBreakEndTime}
                onChange={(e) => setMealBreakEndTime(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-2 pt-4 border-t">
        <Button variant="destructive" onClick={onDelete} disabled={saving} className="gap-2">
          <Trash2 className="h-4 w-4" />
          Delete Shift
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function PayrollReview() {
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const [payPeriods, setPayPeriods] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [editingShift, setEditingShift] = useState<{ dayPunches: any[], userId: string, locationId: string, shiftDate: string } | null>(null);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [includeApproved, setIncludeApproved] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState<string>('all');
  const [filterDay, setFilterDay] = useState<string>('all');
  const [periodStatuses, setPeriodStatuses] = useState<Record<string, any>>({});
  const [approvalWarning, setApprovalWarning] = useState<{ punches: any[], type: 'day' | 'all', hasBreakViolation?: boolean, hasAutoClockOut?: boolean, hasOvertime?: boolean, hasExtendedBreak?: boolean, flaggedShifts?: { employeeName: string, date: string, flags: string[] }[], cleanPunchIds?: string[], shiftInfo?: { dayPunches: any[], userId: string, locationId: string, shiftDate: string } } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ dayPunches: any[], shiftDate: string } | null>(null);
  const [laborRules, setLaborRules] = useState<any>(null);
  const [approvingPunchIds, setApprovingPunchIds] = useState<Set<string>>(new Set());

  // Check if current period is closed (for tip fetching optimization)
  // Use composite key format that matches how periodStatuses is keyed
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
    selectedPeriod?.start || null,
    selectedPeriod?.end || null,
    timeCards,
    periodClosedForTips // Only fetch tips when period is closed
  );

  useEffect(() => {
    if ((isAdmin || isManager) && currentLocation) {
      fetchLaborRules();
    }
  }, [isAdmin, isManager, currentLocation]);

  useEffect(() => {
    if (laborRules) {
      generatePayPeriods();
    }
  }, [laborRules]);

  useEffect(() => {
    // Wait for timezone to load; otherwise we group punches into the wrong day (UTC) and the UI can show 0.0 hrs.
    if (selectedPeriod && currentLocation && timezone) {
      fetchTimeCards();
    }
  }, [selectedPeriod, currentLocation, timezone]);

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

  const generatePayPeriods = async () => {
    const today = getStartOfTodayInTimezone(timezone);
    const periods: any[] = [];

    const payPeriodType = laborRules?.pay_period_type || 'biweekly';

    // Treat pay_period_start_date as a *calendar date in the location timezone*
    // (never parse YYYY-MM-DD via new Date(dateStr) because it is interpreted as UTC).
    const baseStartDateStr = laborRules?.pay_period_start_date || '2025-11-03';
    const baseStart = parseDateStringInTimezone(baseStartDateStr, timezone);

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

    if (payPeriodType === 'weekly') {
      for (let i = 0; i <= 12; i++) {
        const start = addWeeks(baseStart, i);
        const endDateStr = getDateInTimezone(addDays(start, 6), timezone);
        const startDateStr = getDateInTimezone(start, timezone);
        const end = getEndOfDateStringInTimezone(endDateStr, timezone);

        if (start <= today) {
          periods.push({
            start,
            end,
            startDate: startDateStr,
            endDate: endDateStr,
            label: makeLabel(startDateStr, endDateStr),
          });
        }
      }
    } else if (payPeriodType === 'biweekly') {
      for (let i = 0; i <= 9; i++) {
        const start = addWeeks(baseStart, i * 2);
        const endDateStr = getDateInTimezone(addDays(start, 13), timezone);
        const startDateStr = getDateInTimezone(start, timezone);
        const end = getEndOfDateStringInTimezone(endDateStr, timezone);

        if (start <= today) {
          periods.push({
            start,
            end,
            startDate: startDateStr,
            endDate: endDateStr,
            label: makeLabel(startDateStr, endDateStr),
          });
        }
      }
    } else if (payPeriodType === 'semimonthly') {
      // Semi-monthly is based on local calendar days; build from date strings.
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
            start: firstStart,
            end: firstEnd,
            startDate: firstStartStr,
            endDate: firstEndStr,
            label: makeLabel(firstStartStr, firstEndStr),
          });
        }

        // Second half: 16th - end of month
        const secondStartStr = `${year}-${mm}-16`;
        const secondStart = parseDateStringInTimezone(secondStartStr, timezone);

        // Compute month end by taking first day of next month minus 1 day
        const nextMonth = new Date(Date.UTC(year, actualMonth + 1, 1));
        const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), 0));
        const lastDayStr = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay.getUTCDate()).padStart(2, '0')}`;
        const secondEnd = getEndOfDateStringInTimezone(lastDayStr, timezone);

        if (secondStart <= today) {
          periods.push({
            start: secondStart,
            end: secondEnd,
            startDate: secondStartStr,
            endDate: lastDayStr,
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
            start,
            end,
            startDate: startDateStr,
            endDate: endDateStr,
            label: makeLabel(startDateStr, endDateStr),
          });
        }
      }
    }

    periods.reverse();
    setPayPeriods(periods);

    // Fetch period statuses from database
    const { data: statuses } = await supabase.from('pay_periods').select('*');

    const statusMap: Record<string, any> = {};
    statuses?.forEach((status) => {
      const key = `${status.start_date}_${status.end_date}`;
      statusMap[key] = status;
    });
    setPeriodStatuses(statusMap);
  };

  // Helper to calculate hours between two timestamps, handling midnight crossover
  const calculateTimeDifferenceHours = (startTime: Date, endTime: Date): number => {
    let hours = (endTime.getTime() - startTime.getTime()) / 3600000;
    if (hours < 0) hours += 24;
    return hours;
  };

  // Deterministic punch sort: timestamp first, then type priority.
  // This prevents edge-cases where break_start and clock_in share the same timestamp
  // (which can otherwise produce 0.0 hrs because the first punch isn't clock_in).
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
      // final tie-breaker for stable-ish ordering
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });
  };

  // Calculate day hours - used for both totalHours calculation and UI display
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
    
    // Find the earliest clock_in time to identify orphaned clock_outs that precede all clock_ins
    const earliestClockInTime = shiftStartClockIns.length > 0 
      ? new Date(shiftStartClockIns[0].punch_time).getTime() 
      : Infinity;
    
    shiftStartClockIns.forEach((clockIn, index) => {
      const clockInTime = new Date(clockIn.punch_time).getTime();
      const nextShiftStart = shiftStartClockIns[index + 1];
      const nextShiftStartTime = nextShiftStart ? new Date(nextShiftStart.punch_time).getTime() : Infinity;
      
      const shiftClockOuts = clockOuts.filter(co => {
        const coTime = new Date(co.punch_time).getTime();
        // Must be after this clock_in, before next clock_in, not already used
        // AND must be after the earliest clock_in (to exclude orphaned early AM clock_outs from previous day)
        return coTime > clockInTime && coTime < nextShiftStartTime && !usedClockOutIds.has(co.id) && coTime > earliestClockInTime;
      });
      const clockOut = shiftClockOuts.length > 0 ? shiftClockOuts[shiftClockOuts.length - 1] : null;

      // If there's no clock_out, do NOT extend the shift to "now" for past days.
      // Instead, cap at the last recorded punch inside this day/shift window (so we don't show 54+ hour shifts).
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
          if (p.punch_type === 'break_end' && p.notes?.includes('30 minute')) {
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

  const fetchTimeCards = async () => {
    if (!selectedPeriod || !currentLocation || !timezone) return;

    // Expand punch query window to safely capture overnight shifts that cross day/period boundaries.
    // We still FILTER display/totals to the selectedPeriod's date range later.
    const punchQueryStart = new Date(selectedPeriod.start.getTime() - 24 * 60 * 60 * 1000);
    const punchQueryEnd = new Date(selectedPeriod.end.getTime() + 24 * 60 * 60 * 1000);

    // Fetch location hours for all days to get dynamic cutoff times
    const { data: locationHours } = await supabase
      .from('location_hours')
      .select('day_of_week, close_time')
      .eq('location_id', currentLocation.id);
    
    // Create map of day_of_week -> cutoff hour (close_time + 3 hours)
    const cutoffByDayOfWeek = new Map<number, number>();
    (locationHours || []).forEach((h: { day_of_week: number; close_time: string | null }) => {
      cutoffByDayOfWeek.set(h.day_of_week, calculateCutoffHour(h.close_time));
    });
    // Default cutoff if no hours configured
    const defaultCutoff = 5;

    // Get users assigned to current location
    const { data: userLocations } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', currentLocation.id);

    const assignedUserIds = new Set(userLocations?.map(ul => ul.user_id) || []);

    // Also get users who have punches at this location in the selected period
    // (they may have punched in without being assigned to the location)
    const { data: punchUsers } = await supabase
      .from('time_punches')
      .select('user_id')
      .eq('location_id', currentLocation.id)
      .gte('punch_time', punchQueryStart.toISOString())
      .lte('punch_time', punchQueryEnd.toISOString());

    const punchUserIds = new Set(punchUsers?.map(p => p.user_id) || []);
    
    // Combine both sets of user IDs
    const allUserIds = [...new Set([...assignedUserIds, ...punchUserIds])];

    if (allUserIds.length === 0) {
      setTimeCards([]);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .in('id', allUserIds)
      .order('full_name');

    if (!profiles) return;

    const cards = await Promise.all(
      profiles.map(async (profile) => {
        // Fetch punches and scheduled shifts in parallel
        const [punchesResult, shiftsResult, wageResult] = await Promise.all([
          supabase
            .from('time_punches')
            .select('*')
            .eq('user_id', profile.id)
            .eq('location_id', currentLocation.id)
            .gte('punch_time', punchQueryStart.toISOString())
            .lte('punch_time', punchQueryEnd.toISOString())
            .order('punch_time'),
          (supabase
            .from('scheduled_shifts' as any)
            .select('shift_date, start_time, end_time, is_time_off')
            .eq('user_id', profile.id)
            .gte('shift_date', selectedPeriod.startDate)
            .lte('shift_date', selectedPeriod.endDate) as any),
          supabase.rpc('get_current_wage', { p_user_id: profile.id })
        ]);
        
        const punches = punchesResult.data;
        const scheduledShifts = shiftsResult.data || [];
        const currentWage = wageResult.data;
        
        // Create a map of scheduled shifts by date
        const shiftsByDate = new Map<string, { start_time: string; end_time: string; is_time_off: boolean }>();
        scheduledShifts.forEach((shift: any) => {
          shiftsByDate.set(shift.shift_date, {
            start_time: shift.start_time,
            end_time: shift.end_time,
            is_time_off: shift.is_time_off
          });
        });

        // Fetch creator profiles for punches made by someone other than the employee
        const creatorIds = [...new Set((punches || [])
          .filter(p => p.created_by && p.created_by !== profile.id)
          .map(p => p.created_by))] as string[];
        
        const { data: creatorProfiles } = creatorIds.length > 0
          ? await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', creatorIds)
          : { data: [] };
        
        const creatorMap = new Map((creatorProfiles || []).map(p => [p.id, p.full_name]));

        // Group punches by day (in the location timezone) and attach creator names
        // IMPORTANT: Handle overnight shifts - if a clock_out is early AM (before cutoff) without
        // a clock_in on the same day, associate it with the previous day's shift
        // Uses dynamic cutoff based on location's close_time + 3 hours
        const punchesByDay: { [key: string]: any[] } = {};
        const allPunches = punches || [];
        
        // Helper to get cutoff hour for a given date
        const getCutoffForDate = (dateStr: string): number => {
          const d = new Date(dateStr + 'T12:00:00Z');
          const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, etc.
          return cutoffByDayOfWeek.get(dayOfWeek) ?? defaultCutoff;
        };
        
        // First pass: identify all clock_ins by day
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
          
          // Get the cutoff hour for this calendar day (based on previous day's close time)
          // Since cutoff is close_time + 3hrs, a 1 AM punch on Tuesday uses Monday's cutoff
          const cutoffHour = getCutoffForDate(day);
          
          // Check if this is an overnight clock_out (early AM before cutoff without clock_in on same day BEFORE it)
          if (punch.punch_type === 'clock_out') {
            // If clock_out is before the cutoff hour (dynamic, not hardcoded 6)
            if (punchHour < cutoffHour) {
              const sameDayClockIn = clockInsByDay.get(day);
              // Move to previous day if:
              // 1. No clock_in on same day, OR
              // 2. The clock_in on same day is AFTER this clock_out (meaning clock_out belongs to prev day)
              const shouldMoveToPrevDay = !sameDayClockIn || 
                new Date(sameDayClockIn.punch_time).getTime() > punchTime.getTime();
              
              if (shouldMoveToPrevDay) {
                // Calculate previous day using UTC to avoid browser timezone issues
                const localDateStr = formatInTimeZone(punchTime, timezone, 'yyyy-MM-dd');
                const dateAtNoon = new Date(localDateStr + 'T12:00:00Z');
                dateAtNoon.setUTCDate(dateAtNoon.getUTCDate() - 1);
                const prevDay = dateAtNoon.toISOString().slice(0, 10);
                // Only reassign if previous day has a clock_in
                if (clockInsByDay.has(prevDay)) {
                  day = prevDay;
                }
              }
            }
          }
          
          // Also handle break_start/break_end that might belong to previous day's overnight shift
          if (punch.punch_type === 'break_end' || punch.punch_type === 'break_start') {
            if (punchHour < cutoffHour) {
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
          // Only keep days inside the selected period (dates are yyyy-MM-dd so string compare is safe)
          if (day < selectedPeriod.startDate || day > selectedPeriod.endDate) {
            return;
          }

          if (!punchesByDay[day]) punchesByDay[day] = [];
          // Attach creator/editor name if different from employee
          const createdByName = punch.created_by && punch.created_by !== profile.id
            ? creatorMap.get(punch.created_by) || null
            : null;
          const editedByName = punch.edited_by && punch.edited_by !== profile.id
            ? creatorMap.get(punch.edited_by) || null
            : null;
          punchesByDay[day].push({ ...punch, created_by_name: createdByName, edited_by_name: editedByName });
        });

        // Issues are tracked but hours calculation moved to render time for consistency
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

        // Calculate totalHours by summing each day's hours using the same calculateDayHours logic
        // This ensures consistency with weekly totals displayed in the UI
        const totalHours = Object.values(punchesByDay).reduce((sum: number, dayPunches: any[]) => {
          return sum + calculateDayHours(dayPunches, false);
        }, 0);

        return {
          profile: {
            ...profile,
            hourly_wage: currentWage || profile.hourly_wage || 15
          },
          punches: punches || [],
          punchesByDay,
          shiftsByDate,
          totalHours,
          issues
        };
      })
    );

    setTimeCards(cards);
  };


  const hasDayIssues = (dayPunches: any[]) => {
    const sortedPunches = sortPunches(dayPunches);
    
    const clockIns = sortedPunches.filter(p => p.punch_type === 'clock_in');
    const clockOuts = sortedPunches.filter(p => p.punch_type === 'clock_out');
    const mealBreaks = sortedPunches.filter(p => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
    
    // Identify orphaned clock_outs (those before any clock_in) - don't count them
    const earliestClockInTime = clockIns.length > 0 ? new Date(clockIns[0].punch_time).getTime() : Infinity;
    const validClockOuts = clockOuts.filter(co => new Date(co.punch_time).getTime() > earliestClockInTime);
    
    // Check if any clock_in is missing a clock_out (using valid clock_outs only)
    if (clockIns.length > validClockOuts.length) return true;
    
    // Check each shift for meal break violations
    const usedClockOutIds = new Set<string>();
    
    for (const clockIn of clockIns) {
      const clockInTime = new Date(clockIn.punch_time).getTime();
      
      const clockOut = validClockOuts.find(co => {
        const coTime = new Date(co.punch_time).getTime();
        return coTime > clockInTime && !usedClockOutIds.has(co.id);
      });
      
      if (!clockOut) return true; // Missing clock out
      
      usedClockOutIds.add(clockOut.id);
      const clockOutTime = new Date(clockOut.punch_time).getTime();
      
      let hours = (clockOutTime - clockInTime) / 3600000;
      if (hours < 0) hours += 24;
      
      // Check if this shift has a meal break
      const hasMealBreak = mealBreaks.some(mb => {
        const mbTime = new Date(mb.punch_time).getTime();
        return mbTime > clockInTime && mbTime < clockOutTime;
      });
      
      if (hours > 5 && !hasMealBreak) return true;
    }
    
    return false;
  };

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
      // If RLS blocked the old path, this can happen if the id is wrong or already deleted.
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

    const { data, error } = await supabase.functions.invoke('delete-time-punches', {
      body: {
        location_id: currentLocation.id,
        punch_ids: punchIds,
      },
    });

    if (error) {
      console.error('[PayrollReview] delete-time-punches error:', error);
      toast.error('Failed to delete shift');
      return;
    }

    if (!data?.deleted_ids?.length) {
      toast.error('Nothing was deleted');
      return;
    }

    toast.success('Shift deleted');
    setEditingShift(null);
    setDeleteConfirmation(null);
    fetchTimeCards();
  };

  // handleEditPunch moved to EditShiftForm component

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

  const handleUnapproveDay = async (dayPunches: any[]) => {
    const punchIds = dayPunches.map(p => p.id);
    
    // Optimistic update - immediately mark punches as approving
    setApprovingPunchIds(prev => new Set([...prev, ...punchIds]));
    
    // Optimistically update local state for instant UI feedback
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

    const { error } = await supabase
      .from('time_punches')
      .update({ 
        approved_by: null,
        approved_at: null
      })
      .in('id', punchIds);

    // Clear approving state
    setApprovingPunchIds(prev => {
      const next = new Set(prev);
      punchIds.forEach(id => next.delete(id));
      return next;
    });

    if (error) {
      toast.error('Failed to unapprove shift');
      fetchTimeCards(); // Revert on error
      return;
    }

    toast.success('Shift unapproved');
    // No need to refetch - we already updated optimistically
  };

  const handleApproveDay = async (dayPunches: any[]) => {
    // Check for flagged punches
    const hasAutoClockOut = dayPunches.some((p: any) => p.is_auto_punched_out);
    const hasOvertime = dayPunches.some((p: any) => p.has_overtime);
    const hasExtendedBreak = dayPunches.some((p: any) => p.has_extended_break);
    
    // Check for break violation - shift over 5 hours without meal break
    const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
    const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
    const mealBreakStart = dayPunches.find((p: any) => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
    
    let hasBreakViolation = false;
    if (clockIn && clockOut) {
      let hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
      if (hours < 0) hours += 24; // Handle midnight crossover
      if (hours > 5 && !mealBreakStart) {
        hasBreakViolation = true;
      }
    }
    
    if (hasAutoClockOut || hasBreakViolation || hasOvertime || hasExtendedBreak) {
      // Find the shift date from the punches (location timezone)
      const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
      const shiftDate = clockIn ? getDateInTimezone(new Date(clockIn.punch_time), timezone) : '';
      const userId = clockIn?.user_id || '';
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

  const handleApproveAll = async () => {
    // Separate clean and flagged shifts
    const cleanPunchIds: string[] = [];
    const flaggedShifts: { employeeName: string, date: string, flags: string[] }[] = [];
    let hasAnyFlags = false;
    
    filteredCards.forEach(card => {
      Object.entries(card.punchesByDay).forEach(([day, dayPunches]: [string, any]) => {
        const hasUnapproved = dayPunches.some((p: any) => !p.approved_at);
        if (!hasUnapproved) return;
        
        // Check for flags
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
        
        // Check for break violation
        const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
        const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
        const mealBreakStart = dayPunches.find((p: any) => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
        
        if (clockIn && clockOut) {
          let hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
          if (hours < 0) hours += 24; // Handle midnight crossover
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
          // Only add clean (unflagged) punches
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
      // Show warning with flagged shifts list - user must handle those manually
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

  const approvePunches = async (punchIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic update - immediately mark punches as approving
    setApprovingPunchIds(prev => new Set([...prev, ...punchIds]));
    
    // Optimistically update local state for instant UI feedback
    const now = new Date().toISOString();
    setTimeCards(prev => prev.map(card => ({
      ...card,
      punchesByDay: Object.fromEntries(
        Object.entries(card.punchesByDay).map(([day, dayPunches]: [string, any]) => [
          day,
          dayPunches.map((p: any) => 
            punchIds.includes(p.id) 
              ? { ...p, approved_by: user.id, approved_at: now }
              : p
          )
        ])
      )
    })));

    const { error } = await supabase
      .from('time_punches')
      .update({ 
        approved_by: user.id,
        approved_at: now
      })
      .in('id', punchIds);

    // Clear approving state
    setApprovingPunchIds(prev => {
      const next = new Set(prev);
      punchIds.forEach(id => next.delete(id));
      return next;
    });

    if (error) {
      toast.error('Failed to approve punches');
      // Revert on error
      fetchTimeCards();
      return;
    }

    setApprovalWarning(null);
    // No need to refetch - we already updated optimistically
  };

  // Generate list of dates in selected period for the filter
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

  // Filter cards by employee and day
  const filteredCards = useMemo(() => {
    let cards = filterEmployee === 'all' 
      ? timeCards 
      : timeCards.filter(card => card.profile.id === filterEmployee);
    
    // If filtering by specific date
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
    
    return cards;
  }, [timeCards, filterEmployee, filterDay]);

  // Count shifts (unique days) awaiting approval, not individual punch records
  const countShiftsAwaitingApproval = (cards: typeof timeCards) => {
    return cards.reduce((sum, card) => {
      // Count days that have any unapproved punches
      const daysWithUnapproved = Object.values(card.punchesByDay).filter(
        (dayPunches: any[]) => dayPunches.some((p: any) => !p.approved_at)
      );
      return sum + daysWithUnapproved.length;
    }, 0);
  };

  // Total across all employees (for badge)
  const totalPunchesAwaitingApproval = countShiftsAwaitingApproval(timeCards);

  // Total for filtered view (for button)
  const filteredPunchesAwaitingApproval = countShiftsAwaitingApproval(filteredCards);

  const getPeriodStatus = (period: any) => {
    const key = `${period.startDate}_${period.endDate}`;
    return periodStatuses[key];
  };

  const handleClosePeriod = async () => {
    if (!selectedPeriod) return;

    // Check if all shifts are approved
    if (totalPunchesAwaitingApproval > 0) {
      toast.error(`Cannot close pay period: ${totalPunchesAwaitingApproval} shift(s) still need approval`);
      return;
    }

    const startDate = selectedPeriod.startDate;
    const endDate = selectedPeriod.endDate;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

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

  const [ptoData, setPtoData] = useState<Record<string, number>>({});

  // Fetch PTO data when period is selected
  useEffect(() => {
    const fetchPtoData = async () => {
      if (!selectedPeriod || !currentLocation) return;

      const startDate = selectedPeriod.startDate;
      const endDate = selectedPeriod.endDate;

      // Fetch approved PTO requests for this period
      const { data: ptoRequests } = await supabase
        .from('availability_requests')
        .select('user_id, hours_requested, request_type')
        .eq('location_id', currentLocation.id)
        .eq('status', 'approved')
        .in('request_type', ['paid', 'vacation', 'sick']) // Paid time off types
        .gte('start_date', startDate)
        .lte('start_date', endDate);

      // Group PTO hours by user
      const ptoByUser: Record<string, number> = {};
      ptoRequests?.forEach((req) => {
        if (!ptoByUser[req.user_id]) ptoByUser[req.user_id] = 0;
        ptoByUser[req.user_id] += req.hours_requested || 0;
      });

      setPtoData(ptoByUser);
    };

    fetchPtoData();
  }, [selectedPeriod, currentLocation]);

  // Helper to get week start (Monday) for a given date string in timezone
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
    // Get thresholds from labor rules or use defaults
    const dailyOTThreshold = laborRules?.daily_overtime_threshold ?? 8;
    const dailyDTThreshold = laborRules?.daily_double_time_threshold ?? 12;
    const weeklyOTThreshold = laborRules?.weekly_overtime_threshold ?? 40;
    const otMultiplier = laborRules?.overtime_multiplier ?? 1.5;
    const dtMultiplier = laborRules?.double_time_multiplier ?? 2.0;

    const summary = timeCards.map(card => {
      const ptoHours = ptoData[card.profile.id] || 0;
      const wage = card.profile.hourly_wage || 15;
      
      // Group hours by week (Mon-Sun) for proper weekly OT calculation
      const hoursByWeek: { [weekStart: string]: { dailyHours: { [day: string]: number } } } = {};
      
      Object.entries(card.punchesByDay).forEach(([day, punches]) => {
        const weekStart = getWeekStartForDate(day);
        if (!hoursByWeek[weekStart]) {
          hoursByWeek[weekStart] = { dailyHours: {} };
        }
        hoursByWeek[weekStart].dailyHours[day] = calculateDayHours(punches as any[], false);
      });
      
      // Calculate OT per week using California-style rules:
      // - Daily OT: hours > 8 per day
      // - Daily DT: hours > 12 per day
      // - Weekly OT: hours > 40 per week (use higher of daily OT sum or weekly OT)
      let totalRegular = 0;
      let totalOT = 0;
      let totalDT = 0;
      
      Object.values(hoursByWeek).forEach(week => {
        const dailyHoursList = Object.values(week.dailyHours);
        
        // Calculate daily breakdown first
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
        
        // Calculate weekly OT (hours over 40 in the week)
        const weeklyOT = Math.max(0, weeklyTotalHours - weeklyOTThreshold);
        
        // Use the HIGHER of daily OT sum or weekly OT (California rule)
        const actualOT = Math.max(weeklyDailyOT, weeklyOT);
        
        // Regular = Total - OT - DT
        const actualRegular = weeklyTotalHours - actualOT - weeklyDailyDT;
        
        totalRegular += Math.max(0, actualRegular);
        totalOT += actualOT;
        totalDT += weeklyDailyDT;
      });
      
      // Include PTO hours in gross wages calculation (paid at regular rate)
      const grossWages = (totalRegular * wage) + (totalOT * wage * otMultiplier) + (totalDT * wage * dtMultiplier) + (ptoHours * wage);
      
      // Get tip share for this employee
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

    const totals = summary.reduce((acc, emp) => ({
      regularHours: acc.regularHours + emp.regularHours,
      overtimeHours: acc.overtimeHours + emp.overtimeHours,
      doubleOvertimeHours: acc.doubleOvertimeHours + emp.doubleOvertimeHours,
      ptoHours: acc.ptoHours + emp.ptoHours,
      tips: acc.tips + emp.tips,
      grossWages: acc.grossWages + emp.grossWages,
      totalCompensation: acc.totalCompensation + emp.totalCompensation
    }), { regularHours: 0, overtimeHours: 0, doubleOvertimeHours: 0, ptoHours: 0, tips: 0, grossWages: 0, totalCompensation: 0 });

    return { employees: summary, totals };
  };

  // Group punches by week for display - ONLY include days within the selected pay period
  const groupPunchesByWeek = (punchesByDay: { [key: string]: any[] }) => {
    const weeks: {
      [weekKey: string]: { start: Date; end: Date; days: { [day: string]: any[] } };
    } = {};

    const getWeekStartStr = (dateStr: string) => {
      // Monday=0 ... Sunday=6 (in location timezone)
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

      // Filter out days outside the selected pay period
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

  // Export functions
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
    // Create a printable version
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

  if (!isAdmin && !isManager) {
    return (
      <Layout>
        <Card>
          <CardContent className="p-6 text-center">
            <p>You do not have permission to view payroll data.</p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {!selectedPeriod ? (
          <>
            <div>
              <h1 className="text-3xl font-bold">Time Tracking</h1>
              <p className="text-muted-foreground">Select a pay period to review time cards</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {payPeriods.map((period, index) => {
                const status = getPeriodStatus(period);
                const isClosed = status?.status === 'closed';
                const periodLabel = index === 0 ? 'This Period' : index === 1 ? 'Last Period' : null;
                
                return (
                  <Card
                    key={index}
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => setSelectedPeriod(period)}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <CardTitle className="text-lg truncate">{period.label}</CardTitle>
                          {periodLabel && (
                            <Badge 
                              variant={index === 0 ? "default" : "secondary"}
                              className="shrink-0 text-xs"
                            >
                              {periodLabel}
                            </Badge>
                          )}
                        </div>
                        {isClosed ? (
                          <Badge variant="outline" className="bg-muted shrink-0">
                            <Lock className="mr-1 h-3 w-3" />
                            Closed
                          </Badge>
                        ) : (
                          <Badge variant="default" className="shrink-0">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Open
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="space-y-4">
              <Button variant="ghost" onClick={() => setSelectedPeriod(null)} className="pl-0">
                <ChevronLeft className="mr-2 h-4 w-4" />
                Pay Periods
              </Button>
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold">Payroll Period</h1>
                  <p className="text-muted-foreground">{selectedPeriod.label}</p>
                </div>
                <div className="flex gap-2">
                  {isPeriodClosed ? (
                    <Button variant="outline" onClick={handleReopenPeriod}>
                      Re-Open Pay Period
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={handleClosePeriod}>
                      Close Pay Period
                    </Button>
                  )}
                  {!isPeriodClosed && (
                    <Button onClick={() => setShowQuickEntry(true)}>
                      <Calendar className="mr-2 h-4 w-4" />
                      Add punch
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 gap-3">
              <Select value={filterDay} onValueChange={setFilterDay}>
                <SelectTrigger>
                  <SelectValue placeholder="All days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All days</SelectItem>
                  {periodDates.map(date => (
                    <SelectItem key={date.value} value={date.value}>
                      {date.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger>
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {timeCards.map(card => (
                    <SelectItem key={card.profile.id} value={card.profile.id}>
                      {card.profile.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tips Summary Card - Collapsible */}
            {totalTipPool > 0 && (
              <Collapsible>
                <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                  <CollapsibleTrigger asChild>
                    <CardContent className="p-3 cursor-pointer hover:bg-green-100/50 dark:hover:bg-green-900/20 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-green-500 text-white flex items-center justify-center">
                            <DollarSign className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">
                              ${totalTipPool.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">tips</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {dailyTips.filter(d => d.totalTips > 0).length} day{dailyTips.filter(d => d.totalTips > 0).length !== 1 ? 's' : ''}
                          </span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
                        </div>
                      </div>
                    </CardContent>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-green-200 dark:border-green-900 px-3 py-2">
                      <div className="grid gap-1">
                        {(() => {
                          // Generate all dates in the pay period
                          const allDates: string[] = [];
                          if (selectedPeriod) {
                            const current = new Date(selectedPeriod.start);
                            const end = new Date(selectedPeriod.end);
                            while (current <= end) {
                              allDates.push(format(current, 'yyyy-MM-dd'));
                              current.setDate(current.getDate() + 1);
                            }
                          }
                          return allDates.map(dateStr => {
                            const tipDay = dailyTips.find(d => d.date === dateStr);
                            const totalTips = tipDay?.totalTips || 0;
                            return (
                              <div key={dateStr} className="flex items-center justify-between text-sm py-1">
                                <span className="text-muted-foreground">
                                  {format(new Date(dateStr + 'T12:00:00'), 'EEE, MMM d')}
                                </span>
                                <span className={totalTips > 0 ? 'font-medium text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                                  {totalTips > 0 ? `$${totalTips.toFixed(2)}` : '-'}
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>
                      {totalHoursWithTips > 0 && (
                        <div className="border-t border-green-200 dark:border-green-900 mt-2 pt-2 text-xs text-muted-foreground">
                          Avg: ${(totalDistributedTips / totalHoursWithTips).toFixed(2)}/hr worked
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {tipsLoading && (
              <Card className="border-muted">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                    <div>
                      <p className="text-sm text-muted-foreground">Loading tips data...</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {isPeriodClosed ? (
              /* Payroll Summary */
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Payroll Summary</CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={exportToCSV}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export to CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToPDF}>
                        <Download className="h-4 w-4 mr-2" />
                        Export to PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Reg</TableHead>
                        <TableHead className="text-right">OT</TableHead>
                        <TableHead className="text-right">PTO</TableHead>
                        <TableHead className="text-right">Tips</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calculatePayrollSummary().employees.map((emp, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{emp.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${emp.wage.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{emp.regularHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{emp.overtimeHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{emp.ptoHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right text-green-600">{emp.tips > 0 ? `$${emp.tips.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="text-right font-semibold">${emp.grossWages.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-muted/50">
                        <TableCell>TOTALS</TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.regularHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.overtimeHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.ptoHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-green-600">{calculatePayrollSummary().totals.tips > 0 ? `$${calculatePayrollSummary().totals.tips.toFixed(2)}` : '-'}</TableCell>
                        <TableCell className="text-right text-lg">${calculatePayrollSummary().totals.grossWages.toFixed(2)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                  
                  {/* Tip Distribution Explanation */}
                  {totalTipPool > 0 && (
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                      <p className="font-medium text-foreground mb-1">Tip Distribution</p>
                      <p>Tips are pooled daily and distributed based on hours worked. Each employee receives a share proportional to their hours relative to total hours worked that day.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Punches Awaiting Approval */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-sm font-bold">
                          {totalPunchesAwaitingApproval}
                        </div>
                        <span className="font-medium text-sm">Shifts awaiting approval</span>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id="include-approved"
                            checked={!includeApproved}
                            onCheckedChange={(checked) => setIncludeApproved(!checked as boolean)}
                            className="h-4 w-4"
                          />
                          <label htmlFor="include-approved" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                            Hide approved
                          </label>
                        </div>
                        <Button size="sm" onClick={handleApproveAll} disabled={filteredPunchesAwaitingApproval === 0}>
                          Approve All ({filteredPunchesAwaitingApproval})
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Desktop/Tablet Table View - sm and up */}
                <div className="hidden sm:block">
                  <DesktopTimeTrackingTable
                    filteredCards={filteredCards}
                    timezone={timezone}
                    includeApproved={includeApproved}
                    onApproveDay={handleApproveDay}
                    onUnapproveDay={handleUnapproveDay}
                    onEditShift={setEditingShift}
                    calculateDayHours={calculateDayHours}
                    hasDayIssues={hasDayIssues}
                    sortPunches={sortPunches}
                    groupPunchesByWeek={groupPunchesByWeek}
                    currentLocationId={currentLocation?.id || ''}
                    approvingPunchIds={approvingPunchIds}
                  />
                </div>

                {/* Mobile Cards View - below sm */}
                <div className="block sm:hidden space-y-4">
                  {filteredCards.map((card) => {
                    const weekGroups = groupPunchesByWeek(card.punchesByDay);
                    
                    return (
                      <Card key={card.profile.id} className="overflow-hidden">
                        {/* Employee Header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={card.profile.profile_photo_url || undefined} />
                              <AvatarFallback className="text-xs">{card.profile.full_name?.[0] || 'U'}</AvatarFallback>
                            </Avatar>
                            <span className="font-semibold">{card.profile.full_name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-lg">{card.totalHours.toFixed(1)}</span>
                            <span className="text-muted-foreground text-sm ml-1">hrs</span>
                          </div>
                        </div>

                        <CardContent className="p-0">
                          {weekGroups.map(([weekKey, weekData]) => {
                            // Calculate week total hours
                            const weekTotalHours = Object.values(weekData.days).reduce((sum: number, dayPunches: any) => {
                              return sum + calculateDayHours(dayPunches);
                            }, 0);
                            
                            return (
                            <div key={weekKey}>
                              {/* Week Header - always show with hours total */}
                              <div className="px-4 py-2 bg-secondary/30 border-b text-xs font-medium text-muted-foreground flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-3 w-3" />
                                  Week of {format(weekData.start, 'MMM d')} - {format(weekData.end, 'MMM d')}
                                </div>
                                <div className="font-semibold text-foreground">
                                  {weekTotalHours.toFixed(1)} hrs
                                </div>
                              </div>
                              
                              {/* Compact Day Rows */}
                              <div className="divide-y">
                                {Object.entries(weekData.days)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([day, dayPunches]: [string, any]) => {
                                    // Sort punches chronologically (with stable tie-breakers)
                                    const sortedPunches = sortPunches(dayPunches);
                                    
                                    // Identify distinct shifts (a shift starts with clock_in after clock_out or first punch)
                                    const shifts: { clockIn: any; clockOut: any | null; breaks: any[] }[] = [];
                                    let currentShift: { clockIn: any; clockOut: any | null; breaks: any[] } | null = null;
                                    
                                    sortedPunches.forEach((punch: any, idx: number) => {
                                      if (punch.punch_type === 'clock_in') {
                                        const prevPunch = idx > 0 ? sortedPunches[idx - 1] : null;
                                        // Start new shift if: first punch, or previous was clock_out
                                        if (!prevPunch || prevPunch.punch_type === 'clock_out') {
                                          if (currentShift) shifts.push(currentShift);
                                          currentShift = { clockIn: punch, clockOut: null, breaks: [] };
                                        }
                                        // If previous was break_start, this is return from break (not new shift)
                                      } else if (punch.punch_type === 'clock_out' && currentShift) {
                                        currentShift.clockOut = punch;
                                      } else if (punch.punch_type === 'break_start' && currentShift) {
                                        currentShift.breaks.push(punch);
                                      }
                                    });
                                    if (currentShift) shifts.push(currentShift);
                                    
                                    const breakStarts = dayPunches.filter((p: any) => p.punch_type === 'break_start');
                                    const dayDate = parseDateStringInTimezone(day, timezone);
                                    const dayHours = calculateDayHours(dayPunches);
                                    const isApproved = dayPunches.every((p: any) => p.approved_at);
                                    const hasAutoClockOut = dayPunches.some((p: any) => p.is_auto_punched_out);
                                    const hasOvertime = dayPunches.some((p: any) => p.has_overtime);
                                    const hasExtendedBreak = dayPunches.some((p: any) => p.has_extended_break);
                                    
                                    // Get scheduled shift for this day
                                    const scheduledShift = card.shiftsByDate?.get(day);
                                    
                                    // Calculate break violation for any shift over 5 hours without meal break
                                    let hasBreakViolation = false;
                                    shifts.forEach(shift => {
                                      if (shift.clockIn && shift.clockOut) {
                                        let shiftHours = (new Date(shift.clockOut.punch_time).getTime() - new Date(shift.clockIn.punch_time).getTime()) / 3600000;
                                        if (shiftHours < 0) shiftHours += 24;
                                        const shiftHasMealBreak = shift.breaks.some((b: any) => b.notes?.includes('30 minute'));
                                        if (shiftHours > 5 && !shiftHasMealBreak) {
                                          hasBreakViolation = true;
                                        }
                                      }
                                    });
                                    
                                    const hasIssue = hasDayIssues(dayPunches);
                                    const hasAnyFlag = hasAutoClockOut || hasBreakViolation || hasOvertime || hasExtendedBreak;
                                    const isApproving = dayPunches.some((p: any) => approvingPunchIds.has(p.id));

                                    // Skip approved if not showing
                                    if (!includeApproved && isApproved) return null;

                                    return (
                                      <div 
                                        key={day} 
                                        className={`flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer ${hasAnyFlag ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}
                                        onClick={() => setEditingShift({ dayPunches, userId: card.profile.id, locationId: currentLocation?.id || '', shiftDate: day })}
                                      >
                                        {/* Day Badge */}
                                        <div className="w-9 text-center shrink-0">
                                          <div className="text-[10px] text-muted-foreground">{format(dayDate, 'EEE')}</div>
                                          <div className="font-semibold text-xs">{format(dayDate, 'd')}</div>
                                        </div>

                                        {/* Time Range and Breaks */}
                                        <div className="flex-1 min-w-0">
                                          {/* Show each shift on its own line */}
                                          {shifts.map((shift, shiftIdx) => (
                                            <div key={shiftIdx} className="flex items-center gap-1.5 text-sm">
                                              {shifts.length > 1 && (
                                                <span className="text-[10px] text-muted-foreground font-medium mr-1">#{shiftIdx + 1}</span>
                                              )}
                                              <span className="text-green-600 dark:text-green-400 font-medium whitespace-nowrap">
                                                {shift.clockIn ? formatTimeDisplay(shift.clockIn.punch_time, timezone) : '—'}
                                              </span>
                                              <span className="text-muted-foreground">→</span>
                                              <span className="text-red-600 dark:text-red-400 font-medium whitespace-nowrap">
                                                {shift.clockOut ? formatTimeDisplay(shift.clockOut.punch_time, timezone) : '—'}
                                              </span>

                                              {/* Status Badges - inline with times (only on first shift row) */}
                                              {shiftIdx === 0 && (
                                                <>
                                                  {hasBreakViolation && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-amber-600 border-amber-300 dark:border-amber-700 gap-0.5 shrink-0">
                                                      <Coffee className="h-2.5 w-2.5" />
                                                    </Badge>
                                                  )}
                                                  {hasAutoClockOut && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-orange-600 border-orange-300 dark:border-orange-700 gap-0.5 shrink-0">
                                                      <img src={autoPunchIcon} alt="Auto" className="h-3 w-3" />
                                                    </Badge>
                                                  )}
                                                  {hasOvertime && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-purple-600 border-purple-300 dark:border-purple-700 gap-0.5 shrink-0">
                                                      <Clock className="h-2.5 w-2.5" />
                                                    </Badge>
                                                  )}
                                                  {hasExtendedBreak && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-blue-600 border-blue-300 dark:border-blue-700 gap-0.5 shrink-0">
                                                      <Coffee className="h-2.5 w-2.5" />
                                                    </Badge>
                                                  )}
                                                  {hasIssue && !hasBreakViolation && !shift.clockOut && (
                                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-destructive border-destructive/30 shrink-0">
                                                      !
                                                    </Badge>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          ))}
                                          
                                          {/* Scheduled time display */}
                                          {scheduledShift && !scheduledShift.is_time_off && (
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                              <Calendar className="h-2.5 w-2.5" />
                                              <span>Scheduled: {(() => {
                                                const formatScheduleTime = (timeStr: string | null | undefined) => {
                                                  if (!timeStr) return '—';
                                                  const [hours, minutes] = timeStr.split(':').map(Number);
                                                  const period = hours >= 12 ? 'PM' : 'AM';
                                                  const displayHours = hours % 12 || 12;
                                                  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
                                                };
                                                return `${formatScheduleTime(scheduledShift.start_time)} → ${formatScheduleTime(scheduledShift.end_time)}`;
                                              })()}</span>
                                            </div>
                                          )}
                                          {scheduledShift?.is_time_off && (
                                            <div className="flex items-center gap-1 text-xs text-blue-500 mt-0.5">
                                              <Calendar className="h-2.5 w-2.5" />
                                              <span>Scheduled: Time Off</span>
                                            </div>
                                          )}
                                          
                                          {/* Break times display */}
                                          {breakStarts.length > 0 && (
                                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                                              {breakStarts.map((breakStart: any, idx: number) => {
                                                // First try to find explicit break_end
                                                let breakEnd = dayPunches.find((p: any) => 
                                                  p.punch_type === 'break_end' && 
                                                  new Date(p.punch_time) > new Date(breakStart.punch_time)
                                                );
                                                // Fallback: clock_in after break_start can indicate break end
                                                if (!breakEnd) {
                                                  breakEnd = dayPunches.find((p: any) => 
                                                    p.punch_type === 'clock_in' && 
                                                    new Date(p.punch_time) > new Date(breakStart.punch_time)
                                                  );
                                                }
                                                const duration = breakStart.notes?.includes('30 minute') ? '30m' : '10m';
                                                
                                                // Calculate actual break duration if there's an end time
                                                let isLongBreak = false;
                                                if (breakEnd) {
                                                  const actualDurationMins = (new Date(breakEnd.punch_time).getTime() - new Date(breakStart.punch_time).getTime()) / 60000;
                                                  isLongBreak = actualDurationMins > 35; // Flag if over 35 mins (5 min buffer)
                                                }
                                                
                                                return (
                                                  <span 
                                                    key={idx} 
                                                    className={`flex items-center gap-0.5 ${isLongBreak ? 'text-red-600 font-medium bg-red-50 dark:bg-red-950/30 px-1 py-0 rounded' : ''}`}
                                                    title={isLongBreak ? 'Break exceeded 30 minutes - possible missed clock-in' : ''}
                                                  >
                                                    <Coffee className="h-2.5 w-2.5" />
                                                    {duration}: {formatTimeDisplay(breakStart.punch_time, timezone)}
                                                    {breakEnd && ` → ${formatTimeDisplay(breakEnd.punch_time, timezone)}`}
                                                    {isLongBreak && ' ⚠️'}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          )}
                                          
                                          {/* Manager edit indicator - show edited by (priority) or entered by */}
                                          {(() => {
                                            const editedPunch = dayPunches.find((p: any) => p.edited_by_name);
                                            const createdPunch = dayPunches.find((p: any) => p.created_by_name);
                                            if (editedPunch?.edited_by_name) {
                                              return (
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                                  <Pencil className="h-2.5 w-2.5" />
                                                  <span>Edited by {editedPunch.edited_by_name}</span>
                                                </div>
                                              );
                                            }
                                            if (createdPunch?.created_by_name) {
                                              return (
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                                  <Pencil className="h-2.5 w-2.5" />
                                                  <span>Entered by {createdPunch.created_by_name}</span>
                                                </div>
                                              );
                                            }
                                            return null;
                                          })()}
                                        </div>

                                        {/* Hours */}
                                        <div className="w-12 text-right font-medium text-xs shrink-0">
                                          {dayHours.toFixed(1)}
                                        </div>

                                        {/* Approve Button - Touch-friendly */}
                                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                                          {isApproved ? (
                                            <button 
                                              className={`h-10 w-10 rounded-xl flex items-center justify-center bg-green-100 dark:bg-green-900/30 border-2 border-green-500 text-green-600 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                                              onClick={() => handleUnapproveDay(dayPunches)}
                                              disabled={isApproving}
                                              title="Click to unapprove"
                                            >
                                              <CheckCircle2 className="h-5 w-5" />
                                            </button>
                                          ) : (hasBreakViolation || hasAutoClockOut) ? (
                                            <button 
                                              className={`h-10 w-10 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-400 hover:bg-amber-100 transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                                              onClick={() => handleApproveDay(dayPunches)}
                                              disabled={isApproving}
                                              title={hasBreakViolation ? 'Missing meal break' : 'Auto punched out'}
                                            >
                                              {hasBreakViolation ? (
                                                <Coffee className="h-5 w-5 text-amber-600" />
                                              ) : (
                                                <img src={autoPunchIcon} alt="Auto punch out" className="h-5 w-5" />
                                              )}
                                            </button>
                                          ) : (
                                            <button 
                                              className={`h-10 w-10 rounded-xl flex items-center justify-center bg-muted/50 border-2 border-border hover:bg-primary/10 hover:border-primary transition-colors ${isApproving ? 'opacity-50 pointer-events-none' : ''}`}
                                              onClick={() => handleApproveDay(dayPunches)}
                                              disabled={isApproving}
                                            >
                                              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          );})}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <QuickPunchDialog
          open={showQuickEntry}
          onOpenChange={setShowQuickEntry}
          onSuccess={fetchTimeCards}
        />

        <Dialog open={!!editingShift} onOpenChange={() => setEditingShift(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Shift</DialogTitle>
            </DialogHeader>
            {editingShift && (
              <EditShiftForm
                dayPunches={editingShift.dayPunches}
                userId={editingShift.userId}
                locationId={editingShift.locationId}
                shiftDate={editingShift.shiftDate}
                timezone={timezone}
                onSave={() => { setEditingShift(null); fetchTimeCards(); }}
                onCancel={() => setEditingShift(null)}
                onDelete={() => {
                  setDeleteConfirmation({ 
                    dayPunches: editingShift.dayPunches, 
                    shiftDate: editingShift.shiftDate 
                  });
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Approval Warning Dialog */}
        <Dialog open={!!approvalWarning} onOpenChange={() => setApprovalWarning(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                {approvalWarning?.type === 'all' ? 'Flagged Shifts Require Review' : 'Review Flagged Punches'}
              </DialogTitle>
              <DialogDescription>
                {approvalWarning?.type === 'all' 
                  ? 'The following shifts have flags and must be reviewed individually before approval.'
                  : 'The following issues were found with these punches. Please review before approving.'
                }
              </DialogDescription>
            </DialogHeader>
            {approvalWarning && (
              <div className="space-y-3">
                {/* Flag type summary */}
                <div className="space-y-2">
                  {approvalWarning.hasAutoClockOut && (
                    <div className="flex items-center gap-2 p-2 bg-orange-50 rounded border border-orange-200 text-sm">
                      <AlertCircle className="h-4 w-4 text-orange-600 shrink-0" />
                      <span className="text-orange-800">Auto Clock-Out</span>
                    </div>
                  )}
                  {approvalWarning.hasBreakViolation && (
                    <div className="flex items-center gap-2 p-2 bg-amber-50 rounded border border-amber-200 text-sm">
                      <Coffee className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-amber-800">Missing Meal Break</span>
                    </div>
                  )}
                  {approvalWarning.hasOvertime && (
                    <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200 text-sm">
                      <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                      <span className="text-purple-800">Overtime</span>
                    </div>
                  )}
                  {approvalWarning.hasExtendedBreak && (
                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200 text-sm">
                      <Coffee className="h-4 w-4 text-blue-600 shrink-0" />
                      <span className="text-blue-800">Extended Break</span>
                    </div>
                  )}
                </div>

                {/* List of flagged shifts for Approve All */}
                {approvalWarning.type === 'all' && approvalWarning.flaggedShifts && (
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {approvalWarning.flaggedShifts.map((shift, idx) => {
                      const shiftDate = parseDateStringInTimezone(shift.date, timezone);
                      return (
                        <div key={idx} className="px-3 py-2 flex items-center justify-between text-sm">
                          <div>
                            <span className="font-medium">{shift.employeeName}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatDateTimeInTimezone(shiftDate, timezone, { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div className="flex gap-1">
                            {shift.flags.map((flag, fIdx) => (
                              <Badge key={fIdx} variant="outline" className="text-[10px] px-1 py-0">
                                {flag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Show count of clean shifts that will be approved */}
                {approvalWarning.type === 'all' && approvalWarning.cleanPunchIds && approvalWarning.cleanPunchIds.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {approvalWarning.cleanPunchIds.length} clean punch records will be approved.
                  </p>
                )}
              </div>
            )}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setApprovalWarning(null)}>
                {approvalWarning?.type === 'all' ? 'Cancel' : 'Close'}
              </Button>
              {/* For single day approval, allow approve anyway */}
              {approvalWarning?.type === 'day' && approvalWarning?.shiftInfo && (
                <>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setEditingShift(approvalWarning.shiftInfo!);
                      setApprovalWarning(null);
                    }}
                  >
                    Fix Issues
                  </Button>
                  <Button 
                    variant="default"
                    onClick={() => approvalWarning && approvePunches(approvalWarning.punches.map((p: any) => p.id))}
                  >
                    Approve Anyway
                  </Button>
                </>
              )}
              {/* For Approve All, only approve clean shifts */}
              {approvalWarning?.type === 'all' && approvalWarning.cleanPunchIds && approvalWarning.cleanPunchIds.length > 0 && (
                <Button 
                  variant="default"
                  onClick={async () => {
                    await approvePunches(approvalWarning.cleanPunchIds!);
                    toast.success(`Approved ${approvalWarning.cleanPunchIds!.length} clean punches. ${approvalWarning.flaggedShifts?.length || 0} flagged shifts require manual review.`);
                  }}
                >
                  Approve Clean Shifts Only
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Shift Confirmation Dialog */}
        <Dialog open={!!deleteConfirmation} onOpenChange={() => setDeleteConfirmation(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                Delete Shift
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this entire shift? This will remove all clock-in, clock-out, and break records for this day. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            {deleteConfirmation && (
              <div className="py-2">
                <p className="text-sm text-muted-foreground">
                  Date: <span className="font-medium text-foreground">
                    {formatDateTimeInTimezone(parseDateStringInTimezone(deleteConfirmation.shiftDate, timezone), timezone, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Records to delete: <span className="font-medium text-foreground">{deleteConfirmation.dayPunches.length}</span>
                </p>
              </div>
            )}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setDeleteConfirmation(null)}>
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={() => deleteConfirmation && handleDeleteAllDayPunches(deleteConfirmation.dayPunches)}
              >
                Delete Shift
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
