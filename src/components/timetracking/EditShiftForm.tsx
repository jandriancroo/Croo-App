import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import { BreakRow, AddBreakButton } from '@/components/breaks/BreakRow';
import {
  toISOStringInTimezone,
  formatDateTimeInTimezone,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';
import { findShiftStartClockIns } from '@/utils/payrollDayBucketing';
import { must, recheckSnapshot, friendlyPunchError, STALE_SHIFT_MESSAGE } from '@/lib/punchEditGuard';

// Edit Shift Form Component - Full shift editing with clock in/out and breaks
export function EditShiftForm({ 
  dayPunches, 
  userId,
  locationId,
  shiftDate,
  timezone,
  onSave, 
  onCancel,
  onDelete,
  onStale,
}: { 
  dayPunches: any[]; 
  userId: string;
  locationId: string;
  shiftDate: string;
  timezone: string;
  onSave: () => void; 
  onCancel: () => void;
  onDelete: () => void;
  /** Called with the latest punches when someone else changed this shift while the form was open. */
  onStale?: (freshPunches: any[]) => void;
}) {
  // Sort punches chronologically
  const sortedPunches = [...dayPunches].sort((a: any, b: any) => 
    new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );
  
  // Identify SHIFT-STARTING clock_ins (not return-from-break clock_ins)
  const shiftStartClockIns: any[] = findShiftStartClockIns(sortedPunches);

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
  const pairedIds = new Set(initialShifts.flatMap(s => s.punchIds));
  const unpairedPunches = sortedPunches.filter((p: any) => !pairedIds.has(p.id));
  const PUNCH_LABEL: Record<string, string> = {
    clock_in: 'Clock in', clock_out: 'Clock out', break_start: 'Break start', break_end: 'Break end',
  };

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

  const handleRemovePunch = async (id: string) => {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke('delete-time-punches', {
        body: { location_id: locationId, punch_ids: [id] },
      });
      if (error) { toast.error('Failed to remove punch'); return; }
      toast.success('Punch removed');
      onSave();
    } catch {
      toast.error('Failed to remove punch');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSingleShift = async (idx: number) => {
    const target = shiftStates[idx];
    if (target.punchIds.length === 0) {
      setShiftStates(prev => prev.filter((_, i) => i !== idx));
      setDeletingShiftIdx(null);
      return;
    }
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
      // NOTE: This compares UTC timestamps, so it's timezone-safe.
      // The punch time is converted to UTC via toISOStringInTimezone(),
      // and Date.now() is already UTC.
      const validateNotFuture = (isoTime: string, label: string): boolean => {
        if (new Date(isoTime).getTime() > nowMs + 60_000) { // 1 min buffer
          toast.error(`${label} cannot be set in the future`);
          return false;
        }
        return true;
      };
      
      // Validate every shift before writing anything
      const ranges: { start: number; end: number; n: number }[] = [];
      for (let i = 0; i < shiftStates.length; i++) {
        const sh = shiftStates[i];
        if (!sh.clockInTime) continue;
        const inMs = new Date(toISOStringInTimezone(shiftDate, sh.clockInTime, timezone)).getTime();
        let outMs = Infinity;
        if (sh.clockOutTime) {
          const outDate = getAdjustedDateForClockOut(sh.clockOutTime, sh.clockInTime, shiftDate);
          outMs = new Date(toISOStringInTimezone(outDate, sh.clockOutTime, timezone)).getTime();
          if (outMs <= inMs) {
            toast.error(`Shift #${i + 1}: clock out must be after clock in`);
            setSaving(false);
            return;
          }
        }
        ranges.push({ start: inMs, end: outMs, n: i + 1 });
      }
      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          if (ranges[i].start < ranges[j].end && ranges[j].start < ranges[i].end) {
            toast.error(`Shift #${ranges[i].n} and Shift #${ranges[j].n} overlap`);
            setSaving(false);
            return;
          }
        }
      }

      // Re-read this shift right before writing: stop if another manager or the kiosk changed it.
      if (dayPunches.length > 0) {
        const { fresh, changed } = await recheckSnapshot(userId, locationId, dayPunches);
        if (changed) {
          toast.error(STALE_SHIFT_MESSAGE, { duration: 8000 });
          onStale?.(fresh);
          setSaving(false);
          return;
        }
      }

      for (const shift of shiftStates) {
        // New shift added in this form: skip if no clock-in time
        if (!shift.clockInId && !shift.clockInTime) continue;
        if (!shift.clockInId && shift.clockInTime) {
          const newClockIn = toISOStringInTimezone(shiftDate, shift.clockInTime, timezone);
          if (!validateNotFuture(newClockIn, 'Clock in')) { setSaving(false); return; }
          must(await supabase.from('time_punches').insert({
            user_id: userId,
            location_id: locationId,
            punch_type: 'clock_in',
            punch_time: newClockIn,
            created_by: currentUserId,
          }));
        }

        // Update clock in
        if (shift.clockInId && shift.clockInTime) {
          const newClockInTime = toISOStringInTimezone(shiftDate, shift.clockInTime, timezone);
          if (!validateNotFuture(newClockInTime, 'Clock in')) { setSaving(false); return; }
          must(await supabase.from('time_punches').update({ 
            punch_time: newClockInTime,
            edited_by: currentUserId,
            edited_at: now
          }).eq('id', shift.clockInId));
        }

        // Update clock out
        if (shift.clockOutId && shift.clockOutTime) {
          const clockOutDate = getAdjustedDateForClockOut(shift.clockOutTime, shift.clockInTime, shiftDate);
          const newClockOutTime = toISOStringInTimezone(clockOutDate, shift.clockOutTime, timezone);
          if (!validateNotFuture(newClockOutTime, 'Clock out')) { setSaving(false); return; }
          must(await supabase.from('time_punches').update({ 
            punch_time: newClockOutTime,
            edited_by: currentUserId,
            edited_at: now,
            is_auto_punched_out: false
          }).eq('id', shift.clockOutId));
        } else if (!shift.clockOutId && shift.clockOutTime) {
          const clockOutDate = getAdjustedDateForClockOut(shift.clockOutTime, shift.clockInTime, shiftDate);
          const newClockOutTime = toISOStringInTimezone(clockOutDate, shift.clockOutTime, timezone);
          if (!validateNotFuture(newClockOutTime, 'Clock out')) { setSaving(false); return; }
          must(await supabase.from('time_punches').insert({
            user_id: userId,
            location_id: locationId,
            punch_type: 'clock_out',
            punch_time: newClockOutTime,
            shift_id: shift.shiftId || null,
            created_by: currentUserId
          }));
        }

        // Handle breaks
        for (const brk of shift.breaks) {
          if (!brk.startTime) continue;
          const breakNotes = brk.type === 'unpaid' ? '30 minute unpaid break' : '10 minute paid break';
          const breakStartIso = toISOStringInTimezone(shiftDate, brk.startTime, timezone);
          if (!validateNotFuture(breakStartIso, 'Break start')) { setSaving(false); return; }

          if (brk.id) {
            must(await supabase.from('time_punches').update({
              punch_time: breakStartIso, notes: breakNotes,
              edited_by: currentUserId, edited_at: now,
            }).eq('id', brk.id));
          } else {
            must(await supabase.from('time_punches').insert({
              user_id: userId, location_id: locationId,
              punch_type: 'break_start', punch_time: breakStartIso,
              shift_id: shift.shiftId || null,
              notes: breakNotes, created_by: currentUserId,
            }));
          }

          if (brk.endTime) {
            const breakEndIso = toISOStringInTimezone(shiftDate, brk.endTime, timezone);
            if (!validateNotFuture(breakEndIso, 'Break end')) { setSaving(false); return; }
            if (brk.endId) {
              must(await supabase.from('time_punches').update({
                punch_time: breakEndIso, notes: breakNotes,
                edited_by: currentUserId, edited_at: now,
              }).eq('id', brk.endId));
            } else {
              must(await supabase.from('time_punches').insert({
                user_id: userId, location_id: locationId,
                punch_type: 'break_end', punch_time: breakEndIso,
                shift_id: shift.shiftId || null,
                notes: breakNotes, created_by: currentUserId,
              }));
            }
          }
        }
      }

      // Delete removed breaks
      const existingBreakStartIds = new Set(shiftStates.flatMap(s => s.breaks.map(b => b.id).filter(Boolean) as string[]));
      const existingBreakEndIds = new Set(shiftStates.flatMap(s => s.breaks.map(b => b.endId).filter(Boolean) as string[]));

      for (const p of dayPunches.filter((p: any) => p.punch_type === 'break_start')) {
        if (!existingBreakStartIds.has(p.id)) {
          must(await supabase.from('time_punches').delete().eq('id', p.id));
        }
      }
      for (const p of dayPunches.filter((p: any) => p.punch_type === 'break_end')) {
        if (!existingBreakEndIds.has(p.id)) {
          must(await supabase.from('time_punches').delete().eq('id', p.id));
        }
      }

      toast.success('Shift updated');
      onSave();
    } catch (error) {
      console.error('[EditShiftForm] save failed', error);
      toast.error(friendlyPunchError(error));
      // Some rows may have saved before the failure — reload so the screen shows the truth.
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2">
      <div className="text-sm text-muted-foreground mb-2">
        {formatDateTimeInTimezone(parseDateStringInTimezone(shiftDate, timezone), timezone, {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        })}
      </div>
      <div className="grid grid-cols-[52px_1fr_1fr_52px_28px] gap-2 items-center px-2 text-xs text-muted-foreground">
        <span /><span>In</span><span>Out</span><span className="text-right">Hrs</span><span />
      </div>
      {shiftStates.map((shift, idx) => (
        <div key={idx} className="p-2 border rounded-lg space-y-2">
          <div className="grid grid-cols-[52px_1fr_1fr_52px_28px] gap-2 items-center">
            <span className="text-xs font-medium">Shift {idx + 1}</span>
            <div className="relative min-w-0">
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--clock-in))]" />
              <Input type="time" aria-label={`Shift ${idx + 1} clock in`} className="h-9 min-h-0 w-full min-w-0 pl-4 pr-1 !text-xs [&::-webkit-calendar-picker-indicator]:hidden" value={shift.clockInTime} onChange={(e) => updateShift(idx, { clockInTime: e.target.value })} />
            </div>
            <div className="relative min-w-0">
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--clock-out))]" />
              <Input type="time" aria-label={`Shift ${idx + 1} clock out`} className="h-9 min-h-0 w-full min-w-0 pl-4 pr-1 !text-xs [&::-webkit-calendar-picker-indicator]:hidden" value={shift.clockOutTime} onChange={(e) => updateShift(idx, { clockOutTime: e.target.value })} />
            </div>
            <span className="text-xs tabular-nums text-right text-muted-foreground">
              {shift.clockInTime && shift.clockOutTime ? (
                ((Number(shift.clockOutTime.slice(0, 2)) * 60 + Number(shift.clockOutTime.slice(3, 5)) - Number(shift.clockInTime.slice(0, 2)) * 60 - Number(shift.clockInTime.slice(3, 5)) + (Number(shift.clockOutTime.slice(0, 2)) < Number(shift.clockInTime.slice(0, 2)) ? 1440 : 0)) - shift.breaks.reduce((minutes, brk) => minutes + (brk.type === 'unpaid' && brk.startTime && brk.endTime ? Number(brk.endTime.slice(0, 2)) * 60 + Number(brk.endTime.slice(3, 5)) - Number(brk.startTime.slice(0, 2)) * 60 - Number(brk.startTime.slice(3, 5)) : 0), 0)) / 60
              ).toFixed(2) : '—'}
            </span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 p-0 text-destructive" aria-label="Delete shift" title="Delete shift" onClick={() => setDeletingShiftIdx(idx)} disabled={saving}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="ml-[60px] space-y-1.5">
            {shift.breaks.map((brk, bIdx) => (
              <BreakRow key={`${brk.id || 'new'}-${bIdx}`} value={brk}
                onChange={patch => updateShift(idx, { breaks: shift.breaks.map((b, i) => i === bIdx ? { ...b, ...patch } : b) })}
                onRemove={() => updateShift(idx, { breaks: shift.breaks.filter((_, i) => i !== bIdx) })} />
            ))}
            <AddBreakButton disabled={!shift.clockInTime} onClick={() => updateShift(idx, { breaks: [...shift.breaks, { startTime: '', endTime: '', type: 'unpaid' }] })} />
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => setShiftStates(prev => [...prev, { clockInTime: '', clockOutTime: '', breaks: [], punchIds: [] }])}
      >
        Add shift
      </Button>

      {unpairedPunches.length > 0 && (
        <div className="p-3 border rounded-lg space-y-2">
          <div className="text-sm font-medium">Other punches this day (not part of a shift above)</div>
          {unpairedPunches.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {PUNCH_LABEL[p.punch_type] || p.punch_type}{' '}
                <span className="tabular-nums text-muted-foreground">{formatTimeForEdit(p)}</span>
              </span>
              <Button size="xs"
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive px-2 text-xs"
                onClick={() => handleRemovePunch(p.id)}
                disabled={saving}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

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

      </div>
      <div className="shrink-0 border-t px-5 py-3 flex justify-end gap-2">
        <Button variant="destructive" size="icon" onClick={onDelete} disabled={saving} className="shrink-0 mr-auto" aria-label="Delete All" title="Delete All">
          <Trash2 className="h-4 w-4" />
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
