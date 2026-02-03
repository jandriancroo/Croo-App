import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { parseISO } from 'date-fns';
import { toISOStringInTimezone } from '@/utils/timezoneUtils';
import { Clock, Trash2, Plus, X } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface PunchRecord {
  id: string;
  punch_time: string;
  punch_type: string;
  notes?: string | null;
}

interface EditPunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userPhoto: string | null;
  punchDate: string; // The date in YYYY-MM-DD format
  timezone: string;
  locationId: string;
  onPunchUpdated?: () => void;
}

export function EditPunchDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userPhoto,
  punchDate,
  timezone,
  locationId,
  onPunchUpdated
}: EditPunchDialogProps) {
  const [clockInTime, setClockInTime] = useState('');
  const [clockOutTime, setClockOutTime] = useState('');
  const [showClockOut, setShowClockOut] = useState(false);
  // Support multiple breaks
  interface BreakEntry {
    id?: string; // existing punch ID for break_start
    endId?: string; // existing punch ID for break_end
    startTime: string;
    endTime: string;
    type: 'paid' | 'unpaid';
  }
  const [breaks, setBreaks] = useState<BreakEntry[]>([]);
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (open && userId && punchDate && locationId) {
      fetchPunches();
    }
  }, [open, userId, punchDate, locationId]);

  const fetchPunches = async () => {
    setLoading(true);
    try {
      // Use timezone-aware date range to properly capture punches
      // The punchDate is in YYYY-MM-DD format representing the local date
      // We need to find punches that occurred during that local date
      const { data, error } = await supabase
        .from('time_punches')
        .select('id, punch_time, punch_type, notes')
        .eq('user_id', userId)
        .eq('location_id', locationId)
        .order('punch_time', { ascending: true });

      if (error) throw error;

      // Filter punches to those that fall on the target date in the location's timezone
      const filteredPunches = (data || []).filter(punch => {
        const punchLocalDate = formatInTimeZone(parseISO(punch.punch_time), timezone, 'yyyy-MM-dd');
        return punchLocalDate === punchDate;
      });

      setPunches(filteredPunches);

      // Set form values from punches - sorted by time
      const sortedPunches = [...filteredPunches].sort((a, b) => 
        new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
      );
      
      const clockIn = sortedPunches.find(p => p.punch_type === 'clock_in');
      const clockOut = sortedPunches.find(p => p.punch_type === 'clock_out');
      
      // Find ALL break_start and break_end punches
      const breakStarts = sortedPunches.filter(p => p.punch_type === 'break_start');
      const breakEnds = sortedPunches.filter(p => p.punch_type === 'break_end');
      // Also get clock_ins that could serve as break ends (legacy behavior)
      const clockIns = sortedPunches.filter(p => p.punch_type === 'clock_in');

      setClockInTime(clockIn ? formatInTimeZone(parseISO(clockIn.punch_time), timezone, 'HH:mm') : '');
      const clockOutTimeVal = clockOut ? formatInTimeZone(parseISO(clockOut.punch_time), timezone, 'HH:mm') : '';
      setClockOutTime(clockOutTimeVal);
      setShowClockOut(!!clockOutTimeVal);
      
      // Build breaks array - pair each break_start with its corresponding break_end
      // Use a set to track which break_ends have been matched
      const parsedBreaks: BreakEntry[] = [];
      const usedEndIds = new Set<string>();
      
      for (let i = 0; i < breakStarts.length; i++) {
        const start = breakStarts[i];
        const startTime = new Date(start.punch_time).getTime();
        
        // Find the next break_start to establish an upper bound
        const nextStart = breakStarts[i + 1];
        const nextStartTime = nextStart ? new Date(nextStart.punch_time).getTime() : Infinity;
        
        // First, try to find a break_end punch
        let matchingEnd = breakEnds.find(end => {
          if (usedEndIds.has(end.id)) return false;
          const endTime = new Date(end.punch_time).getTime();
          return endTime > startTime && endTime < nextStartTime;
        });
        
        // If no break_end found, look for a clock_in that's NOT the first one (which is the shift start)
        // A clock_in can serve as a break_end in legacy punch clock behavior
        if (!matchingEnd) {
          matchingEnd = clockIns.find(ci => {
            if (usedEndIds.has(ci.id)) return false;
            if (ci === clockIn) return false; // Skip the shift's clock_in
            const endTime = new Date(ci.punch_time).getTime();
            return endTime > startTime && endTime < nextStartTime;
          });
        }
        
        if (matchingEnd) {
          usedEndIds.add(matchingEnd.id);
        }
        
        // Detect break type from notes - "meal" or "30 minute" = unpaid, otherwise paid
        const notes = start.notes?.toLowerCase() || '';
        const breakType = notes.includes('meal') || notes.includes('unpaid') || notes.includes('30 minute') ? 'unpaid' : 'paid';
        
        parsedBreaks.push({
          id: start.id,
          endId: matchingEnd?.id,
          startTime: formatInTimeZone(parseISO(start.punch_time), timezone, 'HH:mm'),
          endTime: matchingEnd ? formatInTimeZone(parseISO(matchingEnd.punch_time), timezone, 'HH:mm') : '',
          type: breakType
        });
      }
      setBreaks(parsedBreaks);
    } catch (error) {
      console.error('Error fetching punches:', error);
      toast.error('Failed to load punch data');
    } finally {
      setLoading(false);
    }
  };

  // Calculate break duration in minutes for a specific break
  const getBreakDurationMinutes = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return 0;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return endMinutes - startMinutes;
  };

  // Add a new break
  const addBreak = () => {
    setBreaks([...breaks, { startTime: '', endTime: '', type: 'unpaid' }]);
  };

  // Remove a break
  const removeBreak = (index: number) => {
    setBreaks(breaks.filter((_, i) => i !== index));
  };

  // Update a break
  const updateBreak = (index: number, field: keyof BreakEntry, value: string) => {
    const newBreaks = [...breaks];
    if (field === 'type') {
      newBreaks[index].type = value as 'paid' | 'unpaid';
    } else if (field === 'startTime' || field === 'endTime') {
      newBreaks[index][field] = value;
    }
    setBreaks(newBreaks);
  };

  // Helper to check if a time is in the future
  const isTimeInFuture = (timeStr: string): boolean => {
    if (!timeStr) return false;
    const now = new Date();
    const nowInTimezone = formatInTimeZone(now, timezone, 'yyyy-MM-dd HH:mm');
    const [nowDate, nowTime] = nowInTimezone.split(' ');
    
    // If the punch date is in the future, allow any time
    if (punchDate > nowDate) return true;
    // If the punch date is in the past, no time is "in the future"
    if (punchDate < nowDate) return false;
    // Same day - compare times
    return timeStr > nowTime;
  };

  const handleSave = async () => {
    if (!clockInTime) {
      toast.error('Clock in time is required');
      return;
    }

    // Validate that punch times are not in the future
    if (isTimeInFuture(clockInTime)) {
      toast.error('Clock in time cannot be in the future');
      return;
    }
    if (showClockOut && clockOutTime && isTimeInFuture(clockOutTime)) {
      toast.error('Clock out time cannot be in the future');
      return;
    }
    
    // Validate all breaks
    for (let i = 0; i < breaks.length; i++) {
      const brk = breaks[i];
      if (brk.startTime && isTimeInFuture(brk.startTime)) {
        toast.error(`Break ${i + 1} start time cannot be in the future`);
        return;
      }
      if (brk.endTime && isTimeInFuture(brk.endTime)) {
        toast.error(`Break ${i + 1} end time cannot be in the future`);
        return;
      }
      if (brk.startTime && brk.endTime) {
        const breakDuration = getBreakDurationMinutes(brk.startTime, brk.endTime);
        const requiredMinutes = brk.type === 'unpaid' ? 30 : 10;
        if (breakDuration < requiredMinutes) {
          toast.error(`Break ${i + 1}: ${brk.type === 'unpaid' ? 'Meal' : 'Paid'} break must be at least ${requiredMinutes} minutes`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || null;
      const now = new Date().toISOString();

      // Helper to determine if clock-out crosses midnight relative to clock-in
      // ONLY applies to clock_out - breaks and clock_in always use the base date
      // This prevents bugs where backdating a break (e.g., 8:30 AM with 1 PM clock-in)
      // incorrectly rolls to the next day
      const getAdjustedDateForClockOut = (clockOutTime: string, clockInTime: string, baseDate: string): string => {
        const [outHour] = clockOutTime.split(':').map(Number);
        const [inHour] = clockInTime.split(':').map(Number);
        
        // Only advance date if clock-out hour is earlier than clock-in hour
        // (indicating overnight shift, e.g., in at 10 PM, out at 2 AM)
        if (outHour < inHour) {
          const nextDay = new Date(baseDate);
          nextDay.setDate(nextDay.getDate() + 1);
          return nextDay.toISOString().slice(0, 10);
        }
        return baseDate;
      };

      // Update or create clock in/out
      const updates: Array<{ type: string; time: string; existingId?: string; notes?: string }> = [];

      const clockIn = punches.find(p => p.punch_type === 'clock_in');
      if (clockInTime) {
        updates.push({ type: 'clock_in', time: clockInTime, existingId: clockIn?.id });
      }

      const clockOut = punches.find(p => p.punch_type === 'clock_out');
      if (showClockOut && clockOutTime) {
        updates.push({ type: 'clock_out', time: clockOutTime, existingId: clockOut?.id });
      }

      // Add all breaks to updates
      // IMPORTANT: Use full format "30 minute unpaid break" or "10 minute paid break"
      // to match PunchClock.tsx format - otherwise break enforcement reads wrong duration
      for (const brk of breaks) {
        if (brk.startTime) {
          const duration = brk.type === 'unpaid' ? 30 : 10;
          const breakNotes = `${duration} minute ${brk.type} break`;
          updates.push({ type: 'break_start', time: brk.startTime, existingId: brk.id, notes: breakNotes });
          if (brk.endTime) {
            updates.push({ type: 'break_end', time: brk.endTime, existingId: brk.endId, notes: breakNotes });
          }
        }
      }

      for (const update of updates) {
        // Use timezone-aware conversion to ISO string
        // Only clock_out can cross midnight - all other punch types stay on the shift's start date
        const adjustedDate = update.type === 'clock_out' 
          ? getAdjustedDateForClockOut(update.time, clockInTime, punchDate)
          : punchDate;
        const punchTime = toISOStringInTimezone(adjustedDate, update.time, timezone);

        if (update.existingId) {
          // Update existing punch - use edited_by (not created_by), clear auto_punched flag if clock_out
          const updateData: Record<string, unknown> = { 
            punch_time: punchTime, 
            notes: update.notes || null,
            edited_by: currentUserId,
            edited_at: now
          };
          
          // If editing a clock_out, clear the auto-punched flag since it's now a manual edit
          if (update.type === 'clock_out') {
            updateData.is_auto_punched_out = false;
          }
          
          const { error } = await supabase
            .from('time_punches')
            .update(updateData)
            .eq('id', update.existingId);
          if (error) throw error;
        } else {
          // Create new punch - use created_by for inserts
          const { error } = await supabase
            .from('time_punches')
            .insert({
              user_id: userId,
              punch_type: update.type,
              punch_time: punchTime,
              notes: update.notes || null,
              location_id: locationId,
              created_by: currentUserId
            });
          if (error) throw error;
        }
      }

      // Delete clock-out punch if it was removed (showClockOut is false but punch exists)
      if (!showClockOut && punches.find(p => p.punch_type === 'clock_out')) {
        await supabase.from('time_punches').delete().eq('id', punches.find(p => p.punch_type === 'clock_out')!.id);
      }
      
      // Delete break punches that no longer exist in the breaks array
      const existingBreakStartIds = new Set(breaks.map(b => b.id).filter(Boolean));
      const existingBreakEndIds = new Set(breaks.map(b => b.endId).filter(Boolean));
      
      for (const punch of punches.filter(p => p.punch_type === 'break_start')) {
        if (!existingBreakStartIds.has(punch.id)) {
          await supabase.from('time_punches').delete().eq('id', punch.id);
        }
      }
      for (const punch of punches.filter(p => p.punch_type === 'break_end')) {
        if (!existingBreakEndIds.has(punch.id)) {
          await supabase.from('time_punches').delete().eq('id', punch.id);
        }
      }

      toast.success('Punch times updated');
      onPunchUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating punches:', error);
      toast.error('Failed to update punch times');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    setSaving(true);
    try {
      const punchIds = punches.map(p => p.id);
      if (punchIds.length > 0) {
        const { error } = await supabase
          .from('time_punches')
          .delete()
          .in('id', punchIds);
        if (error) throw error;
      }

      toast.success('All punches deleted');
      setDeleteDialogOpen(false);
      onPunchUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error deleting punches:', error);
      toast.error('Failed to delete punches');
    } finally {
      setSaving(false);
    }
  };

  const formattedDate = punchDate ? formatInTimeZone(new Date(punchDate), timezone, 'EEEE, MMMM d, yyyy') : '';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-sm"
          onOpenAutoFocus={(e) => {
            // Prevent Radix from auto-focusing the first input (iOS opens the native time picker immediately)
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Edit Punch
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-4 py-4">
              {/* Date Display */}
              <div className="text-center p-2 bg-muted rounded-lg">
                <span className="text-sm font-medium">{formattedDate}</span>
              </div>

              {/* Employee Info */}
              <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={userPhoto || undefined} />
                  <AvatarFallback>{userName.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="font-medium">{userName}</span>
              </div>

              {/* Time Inputs */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Clock In</Label>
                    <Input
                      type="time"
                      value={clockInTime}
                      onChange={(e) => setClockInTime(e.target.value)}
                    />
                  </div>
                  {showClockOut ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Clock Out</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => {
                            setShowClockOut(false);
                            setClockOutTime('');
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <Input
                        type="time"
                        value={clockOutTime}
                        onChange={(e) => setClockOutTime(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => setShowClockOut(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Clock Out
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Breaks Section - only show if clock-in time exists */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Breaks</Label>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={addBreak}
                    disabled={!clockInTime}
                    title={!clockInTime ? 'Enter clock-in time first' : undefined}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Break
                  </Button>
                </div>
                
                {!clockInTime ? (
                  <p className="text-xs text-muted-foreground">Enter clock-in time to add breaks</p>
                ) : breaks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No breaks recorded</p>
                ) : null}
                
                {breaks.map((brk, index) => (
                  <div key={index} className="space-y-2 p-3 border rounded-lg bg-background">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Break {index + 1}</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeBreak(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    
                    <Select 
                      value={brk.type} 
                      onValueChange={(v) => updateBreak(index, 'type', v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid (10 min)</SelectItem>
                        <SelectItem value="unpaid">Unpaid (30 min)</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Start</Label>
                        <Input
                          type="time"
                          className="h-8 text-sm"
                          value={brk.startTime}
                          onChange={(e) => updateBreak(index, 'startTime', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End</Label>
                        <Input
                          type="time"
                          className="h-8 text-sm"
                          value={brk.endTime}
                          onChange={(e) => updateBreak(index, 'endTime', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button 
              variant="destructive" 
              size="icon"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={saving || punches.length === 0}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={saving || !clockInTime}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Punches?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all time punches for {userName} on this date. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
