import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Coffee } from 'lucide-react';
import {
  toISOStringInTimezone,
  formatDateTimeInTimezone,
  parseDateStringInTimezone,
} from '@/utils/timezoneUtils';

// Edit Shift Form Component - Full shift editing with clock in/out and breaks
export function EditShiftForm({ 
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
      // Use location timezone for "now" to avoid device-timezone mismatch
      // (e.g., editing a CA store's punches from Hawaii would falsely reject valid times)
      const nowInLocationTz = toISOStringInTimezone(
        formatDateTimeInTimezone(new Date(), timezone).split(' ')[0], // date part
        formatDateTimeInTimezone(new Date(), timezone).split(' ')[1], // time part
        timezone
      );
      const nowMs = new Date(nowInLocationTz).getTime();

      // Helper: reject any punch time set in the future (relative to location timezone)
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
