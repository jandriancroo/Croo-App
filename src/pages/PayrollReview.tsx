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
import { ChevronLeft, AlertTriangle, Trash2, Clock, CheckCircle2, Lock, AlertCircle, Coffee, Download, FileSpreadsheet, Calendar, DollarSign, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Layout } from '@/components/Layout';
import { QuickPunchDialog } from '@/components/timeclock/QuickPunchDialog';

import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { DesktopTimeTrackingTable } from '@/components/timetracking/DesktopTimeTrackingTable';
import { DayByDayView } from '@/components/timetracking/DayByDayView';
import { MobileTimeTrackingCard } from '@/components/timetracking/MobileTimeTrackingCard';
import { MobileDayByDayCard } from '@/components/timetracking/MobileDayByDayCard';
import { Users, CalendarDays, Flag } from 'lucide-react';
import {
  toISOStringInTimezone,
  
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
  // Sort punches chronologically
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

  // Support multiple breaks
  interface BreakEntry {
    id?: string;
    endId?: string;
    startTime: string;
    endTime: string;
    type: 'paid' | 'unpaid';
  }

  interface ShiftData {
    clockIn: any;
    clockOut: any | null;
    breaks: BreakEntry[];
    punchIds: string[]; // all punch IDs belonging to this shift
  }

  const formatTimeForEdit = (punch: any): string => {
    if (!punch) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(punch.punch_time));
  };

  // Build shifts array - each shift has its own clock_in, clock_out, breaks
  const buildShifts = (): ShiftData[] => {
    const allClockOuts = sortedPunches.filter((p: any) => p.punch_type === 'clock_out');
    const allBreakStarts = sortedPunches.filter((p: any) => p.punch_type === 'break_start');
    const allBreakEnds = sortedPunches.filter((p: any) => p.punch_type === 'break_end');
    const allClockIns = sortedPunches.filter((p: any) => p.punch_type === 'clock_in');

    const shifts: ShiftData[] = [];

    for (let s = 0; s < shiftStartClockIns.length; s++) {
      const clockIn = shiftStartClockIns[s];
      const clockInMs = new Date(clockIn.punch_time).getTime();
      const nextShiftStart = shiftStartClockIns[s + 1];
      const nextShiftMs = nextShiftStart ? new Date(nextShiftStart.punch_time).getTime() : Infinity;

      // Find clock_out for this shift
      const clockOut = allClockOuts.find((co: any) => {
        const coMs = new Date(co.punch_time).getTime();
        return coMs > clockInMs && coMs <= nextShiftMs;
      }) || null;

      // Find break_starts within this shift's time window
      const shiftBreakStarts = allBreakStarts.filter((bs: any) => {
        const bsMs = new Date(bs.punch_time).getTime();
        return bsMs > clockInMs && bsMs < nextShiftMs;
      });

      // Build break entries
      const usedEndIds = new Set<string>();
      const breakEntries: BreakEntry[] = [];

      for (let i = 0; i < shiftBreakStarts.length; i++) {
        const start = shiftBreakStarts[i];
        const startMs = new Date(start.punch_time).getTime();
        const nextBreakStart = shiftBreakStarts[i + 1];
        const nextBreakMs = nextBreakStart ? new Date(nextBreakStart.punch_time).getTime() : nextShiftMs;

        let matchingEnd = allBreakEnds.find((end: any) => {
          if (usedEndIds.has(end.id)) return false;
          const endMs = new Date(end.punch_time).getTime();
          return endMs > startMs && endMs < nextBreakMs;
        });

        if (!matchingEnd) {
          matchingEnd = allClockIns.find((ci: any) => {
            if (usedEndIds.has(ci.id)) return false;
            if (shiftStartClockIns.includes(ci)) return false;
            const endMs = new Date(ci.punch_time).getTime();
            return endMs > startMs && endMs < nextBreakMs;
          });
        }

        if (matchingEnd) usedEndIds.add(matchingEnd.id);

        const notes = (start.notes || '').toLowerCase();
        const breakType: BreakEntry['type'] = notes.includes('30 minute') || notes.includes('meal') || notes.includes('unpaid') ? 'unpaid' : 'paid';

        breakEntries.push({
          id: start.id,
          endId: matchingEnd?.id,
          startTime: formatTimeForEdit(start) || '12:00',
          endTime: matchingEnd ? formatTimeForEdit(matchingEnd) : '',
          type: breakType,
        });
      }

      // Collect all punch IDs for this shift
      const punchIds = [clockIn.id];
      if (clockOut) punchIds.push(clockOut.id);
      shiftBreakStarts.forEach((bs: any) => punchIds.push(bs.id));
      [...usedEndIds].forEach(id => punchIds.push(id));

      shifts.push({ clockIn, clockOut, breaks: breakEntries, punchIds });
    }

    return shifts;
  };

  const initialShifts = buildShifts();

  // State: array of shift edit states
  interface ShiftEditState {
    clockInTime: string;
    clockOutTime: string;
    breaks: BreakEntry[];
    clockInId?: string;
    clockOutId?: string;
    shiftId?: string;
    punchIds: string[];
  }

  const [shiftStates, setShiftStates] = useState<ShiftEditState[]>(
    initialShifts.map(s => ({
      clockInTime: formatTimeForEdit(s.clockIn) || '',
      clockOutTime: formatTimeForEdit(s.clockOut) || '',
      breaks: s.breaks,
      clockInId: s.clockIn?.id,
      clockOutId: s.clockOut?.id,
      shiftId: s.clockIn?.shift_id || s.clockOut?.shift_id || undefined,
      punchIds: s.punchIds,
    }))
  );
  const [saving, setSaving] = useState(false);
  const [deletingShiftIdx, setDeletingShiftIdx] = useState<number | null>(null);

  const updateShift = (idx: number, update: Partial<ShiftEditState>) => {
    setShiftStates(prev => prev.map((s, i) => i === idx ? { ...s, ...update } : s));
  };

  // Midnight-crossing rule: only CLOCK OUT can roll into the next day
  const getAdjustedDateForClockOut = (clockOutTime: string, clockInTime: string, baseDate: string): string => {
    const [outHour] = clockOutTime.split(':').map(Number);
    const [inHour] = clockInTime.split(':').map(Number);
    if (Number.isNaN(outHour) || Number.isNaN(inHour)) return baseDate;
    if (outHour < inHour) {
      const nextDay = new Date(baseDate);
      nextDay.setDate(nextDay.getDate() + 1);
      return nextDay.toISOString().slice(0, 10);
    }
    return baseDate;
  };

  const handleDeleteSingleShift = async (idx: number) => {
    setSaving(true);
    try {
      const shift = shiftStates[idx];
      console.log('[EditShiftForm] Deleting shift:', { idx, punchIds: shift.punchIds, locationId });
      const { data, error } = await supabase.functions.invoke('delete-time-punches', {
        body: {
          location_id: locationId,
          punch_ids: shift.punchIds,
        },
      });
      console.log('[EditShiftForm] Delete response:', { data, error });
      if (error) {
        console.error('[EditShiftForm] Delete error:', error);
        toast.error('Failed to delete shift');
        return;
      }
      toast.success(`Shift #${idx + 1} deleted`);
      if (shiftStates.length === 1) {
        onSave();
      } else {
        setShiftStates(prev => prev.filter((_, i) => i !== idx));
        setDeletingShiftIdx(null);
      }
    } catch (err: any) {
      console.error('[EditShiftForm] Delete exception:', err);
      toast.error('Failed to delete shift');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || null;
      const now = new Date().toISOString();
      const nowMs = Date.now();

      // Helper: reject any punch time set in the future
      const validateNotFuture = (isoTime: string, label: string): boolean => {
        if (new Date(isoTime).getTime() > nowMs + 60_000) { // 1 min buffer
          toast.error(`${label} cannot be set in the future`);
          return false;
        }
        return true;
      };
      
      for (const shift of shiftStates) {
        // Update clock in
        if (shift.clockInId && shift.clockInTime) {
          const newClockInTime = toISOStringInTimezone(shiftDate, shift.clockInTime, timezone);
          if (!validateNotFuture(newClockInTime, 'Clock in')) { setSaving(false); return; }
          await supabase.from('time_punches').update({ 
            punch_time: newClockInTime,
            edited_by: currentUserId,
            edited_at: now
          }).eq('id', shift.clockInId);
        }

        // Update clock out
        if (shift.clockOutId && shift.clockOutTime) {
          const clockOutDate = getAdjustedDateForClockOut(shift.clockOutTime, shift.clockInTime, shiftDate);
          const newClockOutTime = toISOStringInTimezone(clockOutDate, shift.clockOutTime, timezone);
          if (!validateNotFuture(newClockOutTime, 'Clock out')) { setSaving(false); return; }
          await supabase.from('time_punches').update({ 
            punch_time: newClockOutTime,
            edited_by: currentUserId,
            edited_at: now,
            is_auto_punched_out: false
          }).eq('id', shift.clockOutId);
        } else if (!shift.clockOutId && shift.clockOutTime) {
          const clockOutDate = getAdjustedDateForClockOut(shift.clockOutTime, shift.clockInTime, shiftDate);
          const newClockOutTime = toISOStringInTimezone(clockOutDate, shift.clockOutTime, timezone);
          if (!validateNotFuture(newClockOutTime, 'Clock out')) { setSaving(false); return; }
          await supabase.from('time_punches').insert({
            user_id: userId,
            location_id: locationId,
            punch_type: 'clock_out',
            punch_time: newClockOutTime,
            shift_id: shift.shiftId || null,
            created_by: currentUserId
          });
        }

        // Handle breaks
        for (const brk of shift.breaks) {
          if (!brk.startTime) continue;
          const breakNotes = brk.type === 'unpaid' ? '30 minute unpaid break' : '10 minute paid break';
          const breakStartIso = toISOStringInTimezone(shiftDate, brk.startTime, timezone);
          if (!validateNotFuture(breakStartIso, 'Break start')) { setSaving(false); return; }

          if (brk.id) {
            await supabase.from('time_punches').update({
              punch_time: breakStartIso, notes: breakNotes,
              edited_by: currentUserId, edited_at: now,
            }).eq('id', brk.id);
          } else {
            await supabase.from('time_punches').insert({
              user_id: userId, location_id: locationId,
              punch_type: 'break_start', punch_time: breakStartIso,
              shift_id: shift.shiftId || null,
              notes: breakNotes, created_by: currentUserId,
            });
          }

          if (brk.endTime) {
            const breakEndIso = toISOStringInTimezone(shiftDate, brk.endTime, timezone);
            if (!validateNotFuture(breakEndIso, 'Break end')) { setSaving(false); return; }
            if (brk.endId) {
              await supabase.from('time_punches').update({
                punch_time: breakEndIso, notes: breakNotes,
                edited_by: currentUserId, edited_at: now,
              }).eq('id', brk.endId);
            } else {
              await supabase.from('time_punches').insert({
                user_id: userId, location_id: locationId,
                punch_type: 'break_end', punch_time: breakEndIso,
                shift_id: shift.shiftId || null,
                notes: breakNotes, created_by: currentUserId,
              });
            }
          }
        }
      }

      // Delete removed breaks
      const existingBreakStartIds = new Set(shiftStates.flatMap(s => s.breaks.map(b => b.id).filter(Boolean) as string[]));
      const existingBreakEndIds = new Set(shiftStates.flatMap(s => s.breaks.map(b => b.endId).filter(Boolean) as string[]));

      for (const p of dayPunches.filter((p: any) => p.punch_type === 'break_start')) {
        if (!existingBreakStartIds.has(p.id)) {
          await supabase.from('time_punches').delete().eq('id', p.id);
        }
      }
      for (const p of dayPunches.filter((p: any) => p.punch_type === 'break_end')) {
        if (!existingBreakEndIds.has(p.id)) {
          await supabase.from('time_punches').delete().eq('id', p.id);
        }
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

      {shiftStates.map((shift, idx) => (
        <div key={idx} className={`space-y-3 ${shiftStates.length > 1 ? 'p-3 border rounded-lg bg-muted/5' : ''}`}>
          {shiftStates.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Shift #{idx + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive h-7 px-2 text-xs"
                onClick={() => setDeletingShiftIdx(idx)}
                disabled={saving}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Clock In
              </label>
              <Input
                type="time"
                value={shift.clockInTime}
                onChange={(e) => updateShift(idx, { clockInTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Clock Out
              </label>
              <Input
                type="time"
                value={shift.clockOutTime}
                onChange={(e) => updateShift(idx, { clockOutTime: e.target.value })}
              />
            </div>
          </div>

          <div className="border-t pt-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Breaks</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!shift.clockInTime}
                onClick={() => updateShift(idx, { breaks: [...shift.breaks, { startTime: '', endTime: '', type: 'unpaid' }] })}
              >
                Add break
              </Button>
            </div>

            {shift.breaks.length === 0 ? (
              <div className="text-xs text-muted-foreground">No breaks</div>
            ) : (
              <div className="space-y-3">
                {shift.breaks.map((brk, bIdx) => (
                  <div key={`${brk.id || 'new'}-${bIdx}`} className="rounded-lg border bg-muted/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Coffee className="h-4 w-4 text-muted-foreground" />
                        <div className="text-sm font-medium">Break {bIdx + 1}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground"
                        onClick={() => updateShift(idx, { breaks: shift.breaks.filter((_, i) => i !== bIdx) })}
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Type</label>
                        <Select
                          value={brk.type}
                          onValueChange={(v) => updateShift(idx, { breaks: shift.breaks.map((b, i) => i === bIdx ? { ...b, type: v as 'paid' | 'unpaid' } : b) })}
                        >
                          <SelectTrigger className="bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-background z-50">
                            <SelectItem value="unpaid">Unpaid (30m)</SelectItem>
                            <SelectItem value="paid">Paid (10m)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Break Start</label>
                        <Input
                          type="time"
                          value={brk.startTime}
                          onChange={(e) => updateShift(idx, { breaks: shift.breaks.map((b, i) => i === bIdx ? { ...b, startTime: e.target.value } : b) })}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Break End</label>
                        <Input
                          type="time"
                          value={brk.endTime}
                          onChange={(e) => updateShift(idx, { breaks: shift.breaks.map((b, i) => i === bIdx ? { ...b, endTime: e.target.value } : b) })}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">  </label>
                        <div className="text-xs text-muted-foreground flex items-center h-10">
                          {brk.type === 'unpaid' ? 'Meal break' : 'Paid break'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Delete single shift confirmation */}
      {deletingShiftIdx !== null && (
        <div className="p-3 border border-destructive/30 rounded-lg bg-destructive/5 space-y-2">
          <p className="text-sm font-medium text-destructive">Delete Shift #{deletingShiftIdx + 1}?</p>
          <p className="text-xs text-muted-foreground">This will remove all punch records for this shift only.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDeletingShiftIdx(null)} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => handleDeleteSingleShift(deletingShiftIdx)} disabled={saving}>
              {saving ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-4 border-t">
        <Button variant="destructive" onClick={onDelete} disabled={saving} className="gap-2">
          <Trash2 className="h-4 w-4" />
          Delete All
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
  const [filterFlag, setFilterFlag] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'employee' | 'day'>('employee');
  const [periodStatuses, setPeriodStatuses] = useState<Record<string, any>>({});
  const [approvalWarning, setApprovalWarning] = useState<{ punches: any[], type: 'day' | 'all', hasBreakViolation?: boolean, hasAutoClockOut?: boolean, hasOvertime?: boolean, hasExtendedBreak?: boolean, flaggedShifts?: { employeeName: string, date: string, flags: string[] }[], cleanPunchIds?: string[], shiftInfo?: { dayPunches: any[], userId: string, locationId: string, shiftDate: string } } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ dayPunches: any[], shiftDate: string } | null>(null);
  const [laborRules, setLaborRules] = useState<any>(null);
  const [approvingPunchIds, setApprovingPunchIds] = useState<Set<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
  // Cache current user ID on mount for instant approve feedback
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

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
          // Match a break_end that follows this break_start (notes check not required —
          // the break_start already confirmed it's a 30-min unpaid break)
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

  // Shared flag detection (used by filters + UI) — keep in sync with EditPunchDialog keywords
  const getDayFlags = (dayPunches: any[]) => {
    const sortedPunches = sortPunches(dayPunches);

    // identify shift-starting clock-ins (not return-from-break clock-ins)
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

      // Find clock_out that belongs to THIS shift (same logic as calculateDayHours)
      const shiftClockOuts = clockOuts.filter((co: any) => {
        const coMs = new Date(co.punch_time).getTime();
        return coMs > clockInMs && coMs < nextStartMs && !usedClockOutIds.has(co.id) && coMs > earliestClockInTime;
      });
      const clockOut = shiftClockOuts.length ? shiftClockOuts[shiftClockOuts.length - 1] : null;
      
      // Check auto-punch flag ONLY on the clock_out that closes THIS shift
      if (clockOut) {
        usedClockOutIds.add(clockOut.id);
        if (clockOut.is_auto_punched_out) {
          hasAutoClockOut = true;
        }
        
        // Check break violation for this shift
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
        // No clock_out = open shift
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

  const fetchTimeCards = async () => {
    if (!selectedPeriod || !currentLocation || !timezone) return;

    // Expand punch query window to safely capture overnight shifts that cross day/period boundaries.
    // We still FILTER display/totals to the selectedPeriod's date range later.
    const punchQueryStart = new Date(selectedPeriod.start.getTime() - 24 * 60 * 60 * 1000);
    const punchQueryEnd = new Date(selectedPeriod.end.getTime() + 24 * 60 * 60 * 1000);

    // Fetch location hours, assigned users, and punch users in parallel
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
    
    // Create map of day_of_week -> cutoff hour (close_time + 3 hours)
    const cutoffByDayOfWeek = new Map<number, number>();
    (locationHours || []).forEach((h: { day_of_week: number; close_time: string | null }) => {
      cutoffByDayOfWeek.set(h.day_of_week, calculateCutoffHour(h.close_time));
    });
    // Default cutoff if no hours configured
    const defaultCutoff = 5;

    const assignedUserIds = new Set(userLocations?.map(ul => ul.user_id) || []);
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



    // BULK fetch all punches, shifts, and wages in parallel (instead of per-employee N+1)
    const [allPunchesResult, allShiftsResult, ...wageResults] = await Promise.all([
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
      ...allUserIds.map(uid => supabase.rpc('get_current_wage', { p_user_id: uid })),
    ]);

    // Build a wage map keyed by user_id so wage lookups are independent of array order
    const wageByUserId = new Map<string, number>();
    allUserIds.forEach((uid, idx) => {
      const wage = wageResults[idx]?.data;
      if (wage != null) wageByUserId.set(uid, wage);
    });

    // Index bulk data by user_id
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

    // Bulk fetch all creator profiles referenced in punches
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
        
        // Create a map of scheduled shifts by date
        const shiftsByDate = new Map<string, { start_time: string; end_time: string; is_time_off: boolean }>();
        scheduledShifts.forEach((shift: any) => {
          shiftsByDate.set(shift.shift_date, {
            start_time: shift.start_time,
            end_time: shift.end_time,
            is_time_off: shift.is_time_off
          });
        });

        const creatorMap = globalCreatorMap;

        // Group punches by day (in the location timezone) and attach creator names
        // IMPORTANT: Handle overnight shifts - if a clock_out is early AM (before cutoff) without
        // a clock_in on the same day, associate it with the previous day's shift
        // Uses dynamic cutoff based on location's close_time + 3 hours
        const punchesByDay: { [key: string]: any[] } = {};
        const allPunches = punches || [];
        
        // Helper to get cutoff hour for a given date based on PREVIOUS day's close time
        // (since overnight punches belong to the shift that started the previous day)
        const getCutoffForPreviousDay = (dateStr: string): number => {
          const d = new Date(dateStr + 'T12:00:00Z');
          // Get previous day's day_of_week
          const prevDayOfWeek = (d.getUTCDay() + 6) % 7; // Sunday->Saturday, Monday->Sunday, etc.
          return cutoffByDayOfWeek.get(prevDayOfWeek) ?? defaultCutoff;
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
          
          // Get the cutoff hour based on PREVIOUS day's close time
          // (since the overnight punch belongs to the shift that started the previous day)
          const cutoffHour = getCutoffForPreviousDay(day);
          
          // Check if this is an overnight clock_out (early AM before/at cutoff without clock_in on same day BEFORE it)
          if (punch.punch_type === 'clock_out') {
            // If clock_out is at or before the cutoff hour (dynamic, not hardcoded 6)
            // Use <= to include punches exactly at the cutoff hour (e.g., 3:00 AM when cutoff is 3)
            if (punchHour <= cutoffHour) {
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
      });
    

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

      // Accept success even if deleted_ids is missing (older response format)
      toast.success('Shift deleted');
      setEditingShift(null);
      setDeleteConfirmation(null);
      fetchTimeCards();
    } catch (err: any) {
      console.error('[PayrollReview] delete-time-punches exception:', err);
      toast.error('Failed to delete shift: ' + (err?.message || 'Unknown error'));
    }
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

  const handleUnapproveDay = (dayPunches: any[]) => {
    const punchIds = dayPunches.map(p => p.id);
    
    // Optimistically update local state FIRST for instant UI feedback
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

    // Fire-and-forget database update (no await for UI responsiveness)
    supabase
      .from('time_punches')
      .update({ 
        approved_by: null,
        approved_at: null
      })
      .in('id', punchIds)
      .then(({ error }) => {
        // Clear approving state
        setApprovingPunchIds(prev => {
          const next = new Set(prev);
          punchIds.forEach(id => next.delete(id));
          return next;
        });

        if (error) {
          toast.error('Failed to unapprove shift');
          fetchTimeCards(); // Revert on error
        }
      });
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
    // Separate clean and flagged shifts - SKIP open shifts entirely (they can't be approved)
    const cleanPunchIds: string[] = [];
    const flaggedShifts: { employeeName: string, date: string, flags: string[] }[] = [];
    let hasAnyFlags = false;
    
    filteredCards.forEach(card => {
      Object.entries(card.punchesByDay).forEach(([day, dayPunches]: [string, any]) => {
        const hasUnapproved = dayPunches.some((p: any) => !p.approved_at);
        if (!hasUnapproved) return;
        
        // Skip open shifts - they cannot be approved until closed
        const dayFlags = getDayFlags(dayPunches);
        if (dayFlags.hasOpenShift) return;
        
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
    // Use cached user ID for instant feedback - no await needed
    if (!currentUserId) return;

    // Optimistically update local state FIRST for instant UI feedback
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

    // Fire-and-forget database update (no await for UI responsiveness)
    supabase
      .from('time_punches')
      .update({ 
        approved_by: currentUserId,
        approved_at: now
      })
      .in('id', punchIds)
      .then(({ error }) => {
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
        } else {
          setApprovalWarning(null);
        }
      });
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

  // Filter cards by employee, day, and flags
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
    
    // Filter by flags
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

  // Count shifts (unique days) awaiting approval, not individual punch records
  // EXCLUDES open shifts - they cannot be approved until they have a clock-out
  const countShiftsAwaitingApproval = (cards: typeof timeCards) => {
    return cards.reduce((sum, card) => {
      // Count days that have any unapproved punches AND are NOT open shifts
      const daysWithUnapproved = Object.values(card.punchesByDay).filter(
        (dayPunches: any[]) => {
          const hasUnapproved = dayPunches.some((p: any) => !p.approved_at);
          if (!hasUnapproved) return false;
          // Exclude open shifts from approval count
          const flags = getDayFlags(dayPunches);
          return !flags.hasOpenShift;
        }
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

  const [closingPeriod, setClosingPeriod] = useState(false);

  const handleClosePeriod = async () => {
    if (!selectedPeriod || !currentLocation) return;

    // Check if all shifts are approved
    if (totalPunchesAwaitingApproval > 0) {
      toast.error(`Cannot close pay period: ${totalPunchesAwaitingApproval} shift(s) still need approval`);
      return;
    }

    const startDate = selectedPeriod.startDate;
    const endDate = selectedPeriod.endDate;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setClosingPeriod(true);

    // Step 1: Sync tips from QU for the full date range before closing
    try {
      toast.info('Syncing tips from QuBeyond...');

      // Use query param approach since sales-service routes via URL params
      const syncResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-service?action=sync-tips`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            locationId: currentLocation.id,
            startDate,
            endDate,
          }),
        }
      );

      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        console.log('[PayrollReview] Tips sync result:', syncData);
        if (syncData.synced > 0) {
          toast.success(`Synced tips for ${syncData.synced} days`);
        }
      } else {
        console.warn('[PayrollReview] Tips sync failed, continuing with close');
      }
    } catch (tipSyncError) {
      console.warn('[PayrollReview] Tips sync error (non-blocking):', tipSyncError);
    }

    // Step 2: Close the period
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

    // Filter out employees with zero hours, zero PTO, and zero tips
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

            {/* View Toggle + Filters */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 overflow-x-hidden">
              {/* View Mode Toggle */}
              <div className="flex rounded-lg border-2 border-border bg-muted/50 p-1 shrink-0 w-fit">
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'employee' 
                      ? 'bg-primary text-primary-foreground shadow-md' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  onClick={() => setViewMode('employee')}
                >
                  <Users className="h-4 w-4" />
                  <span className="hidden sm:inline">By Employee</span>
                </button>
                <button
                  className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-sm font-semibold transition-all ${
                    viewMode === 'day' 
                      ? 'bg-primary text-primary-foreground shadow-md' 
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  onClick={() => setViewMode('day')}
                >
                  <CalendarDays className="h-4 w-4" />
                  <span className="hidden sm:inline">By Day</span>
                </button>
              </div>

              {/* Filters */}
              <div className="flex-1 grid grid-cols-3 gap-2 max-w-md">
                <Select value={filterDay} onValueChange={setFilterDay}>
                  <SelectTrigger className="h-9 sm:h-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 sm:hidden shrink-0" />
                      <span className="hidden sm:inline"><SelectValue placeholder="All days" /></span>
                      <span className="sm:hidden text-xs">{filterDay === 'all' ? 'Days' : filterDay.slice(5)}</span>
                    </div>
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
                  <SelectTrigger className="h-9 sm:h-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-4 w-4 sm:hidden shrink-0" />
                      <span className="hidden sm:inline"><SelectValue placeholder="All employees" /></span>
                      <span className="sm:hidden text-xs truncate max-w-[60px]">{filterEmployee === 'all' ? 'Team' : timeCards.find(c => c.profile.id === filterEmployee)?.profile.full_name?.split(' ')[0] || 'Team'}</span>
                    </div>
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

                <Select value={filterFlag} onValueChange={setFilterFlag}>
                  <SelectTrigger className="h-9 sm:h-10 font-medium">
                    <div className="flex items-center gap-1.5">
                      <Flag className="h-4 w-4 sm:hidden shrink-0" />
                      <span className="hidden sm:inline"><SelectValue placeholder="All shifts" /></span>
                      <span className="sm:hidden text-xs">{filterFlag === 'all' ? 'Flags' : filterFlag === 'flagged' ? 'All' : filterFlag === 'open_shift' ? 'Open' : filterFlag === 'auto_punch' ? 'Auto' : 'Break'}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All shifts</SelectItem>
                    <SelectItem value="flagged">Flagged only</SelectItem>
                    <SelectItem value="open_shift">Open shifts</SelectItem>
                    <SelectItem value="auto_punch">Auto clock-out</SelectItem>
                    <SelectItem value="break_violation">Missed break</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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

            {/* Approval Controls - only show when period is open */}
            {!isPeriodClosed && (() => {
              const totalShifts = timeCards.reduce((sum, card) => sum + Object.keys(card.punchesByDay).length, 0);
              const approvedShifts = totalShifts - totalPunchesAwaitingApproval;
              
              return (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="include-approved"
                      checked={!includeApproved}
                      onCheckedChange={(checked) => setIncludeApproved(!checked as boolean)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="include-approved" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                      Hide approved
                    </label>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={handleApproveAll} 
                    disabled={filteredPunchesAwaitingApproval === 0}
                    className="font-semibold"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {approvedShifts}/{totalShifts} Approve All
                  </Button>
                </div>
              );
            })()}

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
                 {/* Desktop Table View - lg and up */}
                 <div className="hidden lg:block">
                   {viewMode === 'employee' ? (
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
                       getDayFlags={getDayFlags}
                     />
                   ) : (
                     <DayByDayView
                       filteredCards={filteredCards}
                       timezone={timezone}
                       includeApproved={includeApproved}
                       onApproveDay={handleApproveDay}
                       onUnapproveDay={handleUnapproveDay}
                       onEditShift={setEditingShift}
                       calculateDayHours={calculateDayHours}
                       sortPunches={sortPunches}
                       currentLocationId={currentLocation?.id || ''}
                       approvingPunchIds={approvingPunchIds}
                       periodDates={periodDates}
                       getDayFlags={getDayFlags}
                     />
                   )}
                 </div>

                 {/* Mobile/Tablet Cards View - below lg */}
                 <div className="block lg:hidden">
                   {viewMode === 'employee' ? (
                     <MobileTimeTrackingCard
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
                       getDayFlags={getDayFlags}
                     />
                   ) : (
                     <MobileDayByDayCard
                       filteredCards={filteredCards}
                       timezone={timezone}
                       includeApproved={includeApproved}
                       onApproveDay={handleApproveDay}
                       onUnapproveDay={handleUnapproveDay}
                       onEditShift={setEditingShift}
                       calculateDayHours={calculateDayHours}
                       sortPunches={sortPunches}
                       currentLocationId={currentLocation?.id || ''}
                       approvingPunchIds={approvingPunchIds}
                       getDayFlags={getDayFlags}
                     />
                   )}
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
