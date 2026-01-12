import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
  const [includeBreak, setIncludeBreak] = useState(false);
  const [breakStartTime, setBreakStartTime] = useState('');
  const [breakEndTime, setBreakEndTime] = useState('');
  const [breakType, setBreakType] = useState<'paid' | 'unpaid'>('unpaid');
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
      const breakStart = sortedPunches.find(p => p.punch_type === 'break_start');
      let breakEnd = sortedPunches.find(p => p.punch_type === 'break_end');
      
      // If no explicit break_end, check if a clock_in follows the break_start (used to end break)
      if (breakStart && !breakEnd) {
        const breakStartTime = new Date(breakStart.punch_time).getTime();
        const clockInAfterBreak = sortedPunches.find(p => 
          p.punch_type === 'clock_in' && 
          new Date(p.punch_time).getTime() > breakStartTime
        );
        if (clockInAfterBreak) {
          breakEnd = clockInAfterBreak;
        }
      }

      setClockInTime(clockIn ? formatInTimeZone(parseISO(clockIn.punch_time), timezone, 'HH:mm') : '');
      const clockOutTimeVal = clockOut ? formatInTimeZone(parseISO(clockOut.punch_time), timezone, 'HH:mm') : '';
      setClockOutTime(clockOutTimeVal);
      setShowClockOut(!!clockOutTimeVal); // Only show clock out field if there's an existing clock out
      
      if (breakStart) {
        setIncludeBreak(true);
        setBreakStartTime(formatInTimeZone(parseISO(breakStart.punch_time), timezone, 'HH:mm'));
        // Parse type from notes
        if (breakStart.notes?.includes('unpaid')) {
          setBreakType('unpaid');
        } else {
          setBreakType('paid');
        }
      } else {
        setIncludeBreak(false);
        setBreakStartTime('');
        setBreakType('unpaid');
      }

      if (breakEnd) {
        setBreakEndTime(formatInTimeZone(parseISO(breakEnd.punch_time), timezone, 'HH:mm'));
      } else {
        setBreakEndTime('');
      }
    } catch (error) {
      console.error('Error fetching punches:', error);
      toast.error('Failed to load punch data');
    } finally {
      setLoading(false);
    }
  };

  // Calculate break duration in minutes
  const getBreakDurationMinutes = () => {
    if (!breakStartTime || !breakEndTime) return 0;
    const [startH, startM] = breakStartTime.split(':').map(Number);
    const [endH, endM] = breakEndTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return endMinutes - startMinutes;
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
    if (includeBreak) {
      if (breakStartTime && isTimeInFuture(breakStartTime)) {
        toast.error('Break start time cannot be in the future');
        return;
      }
      if (breakEndTime && isTimeInFuture(breakEndTime)) {
        toast.error('Break end time cannot be in the future');
        return;
      }
    }

    // Validate break duration if break is included
    if (includeBreak && breakStartTime && breakEndTime) {
      const breakDuration = getBreakDurationMinutes();
      const requiredMinutes = breakType === 'unpaid' ? 30 : 10;
      
      if (breakDuration < requiredMinutes) {
        toast.error(`${breakType === 'unpaid' ? 'Meal' : 'Paid'} break must be at least ${requiredMinutes} minutes`);
        return;
      }
    }
    setSaving(true);
    try {
      const breakNotes = `${breakType} break`;
      const { data: { user } } = await supabase.auth.getUser();
      const currentUserId = user?.id || null;
      const now = new Date().toISOString();

      // Helper to determine if a time crosses midnight relative to clock-in
      const getAdjustedDateForTime = (timeStr: string, referenceTimeStr: string, baseDate: string): string => {
        const [timeHour] = timeStr.split(':').map(Number);
        const [refHour] = referenceTimeStr.split(':').map(Number);
        
        // If the time is significantly earlier than reference (e.g., 01:30 vs 18:00)
        // it means the time crosses midnight and should be on the next day
        if (timeHour < 12 && refHour >= 12) {
          const nextDay = new Date(baseDate);
          nextDay.setDate(nextDay.getDate() + 1);
          return nextDay.toISOString().slice(0, 10);
        }
        return baseDate;
      };

      // Update or create each punch type
      const updates: Array<{ type: string; time: string; existingId?: string; notes?: string }> = [];

      const clockIn = punches.find(p => p.punch_type === 'clock_in');
      if (clockInTime) {
        updates.push({ type: 'clock_in', time: clockInTime, existingId: clockIn?.id });
      }

      const clockOut = punches.find(p => p.punch_type === 'clock_out');
      if (showClockOut && clockOutTime) {
        updates.push({ type: 'clock_out', time: clockOutTime, existingId: clockOut?.id });
      }

      const breakStart = punches.find(p => p.punch_type === 'break_start');
      const breakEnd = punches.find(p => p.punch_type === 'break_end');

      if (includeBreak && breakStartTime) {
        updates.push({ type: 'break_start', time: breakStartTime, existingId: breakStart?.id, notes: breakNotes });
        if (breakEndTime) {
          updates.push({ type: 'break_end', time: breakEndTime, existingId: breakEnd?.id, notes: breakNotes });
        }
      }

      for (const update of updates) {
        // Use timezone-aware conversion to ISO string with midnight-crossing adjustment
        const adjustedDate = update.type === 'clock_in' 
          ? punchDate 
          : getAdjustedDateForTime(update.time, clockInTime, punchDate);
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
      
      // Delete break punches if break is disabled
      if (!includeBreak || !breakStartTime) {
        if (punches.find(p => p.punch_type === 'break_start')) {
          await supabase.from('time_punches').delete().eq('id', punches.find(p => p.punch_type === 'break_start')!.id);
        }
        if (punches.find(p => p.punch_type === 'break_end')) {
          await supabase.from('time_punches').delete().eq('id', punches.find(p => p.punch_type === 'break_end')!.id);
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

              {/* Break Toggle */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Include Break</Label>
                  <p className="text-xs text-muted-foreground">Add a break to this shift</p>
                </div>
                <Switch checked={includeBreak} onCheckedChange={setIncludeBreak} />
              </div>

              {/* Break Options - shown when break is enabled */}
              {includeBreak && (
                <div className="space-y-3 p-3 border rounded-lg bg-background">
                  <div className="space-y-2">
                    <Label>Break Type</Label>
                    <Select value={breakType} onValueChange={(v) => setBreakType(v as 'paid' | 'unpaid')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid break</SelectItem>
                        <SelectItem value="unpaid">Unpaid break</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Break Start</Label>
                      <Input
                        type="time"
                        value={breakStartTime}
                        onChange={(e) => setBreakStartTime(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Break End</Label>
                      <Input
                        type="time"
                        value={breakEndTime}
                        onChange={(e) => setBreakEndTime(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {breakType === 'unpaid' ? 'Unpaid - deducted from hours' : 'Paid - not deducted'}
                  </p>
                </div>
              )}
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
              disabled={saving || !clockInTime || (includeBreak && !breakStartTime)}
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
