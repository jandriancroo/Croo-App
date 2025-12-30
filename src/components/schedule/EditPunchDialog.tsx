import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { parseISO } from 'date-fns';
import { Clock, Trash2 } from 'lucide-react';
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
  const [breakStartTime, setBreakStartTime] = useState('');
  const [breakEndTime, setBreakEndTime] = useState('');
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
      // Get all punches for this user on this date, accounting for timezone
      // Use wider range to catch punches that rolled into next UTC day
      const startOfDay = new Date(`${punchDate}T00:00:00`);
      const endOfDay = new Date(`${punchDate}T23:59:59`);
      endOfDay.setHours(endOfDay.getHours() + 12); // Add buffer for timezone edge cases

      const { data, error } = await supabase
        .from('time_punches')
        .select('id, punch_time, punch_type')
        .eq('user_id', userId)
        .eq('location_id', locationId)
        .gte('punch_time', startOfDay.toISOString())
        .lte('punch_time', endOfDay.toISOString())
        .order('punch_time', { ascending: true });

      if (error) throw error;

      setPunches(data || []);

      // Set form values from punches
      const clockIn = data?.find(p => p.punch_type === 'clock_in');
      const clockOut = data?.find(p => p.punch_type === 'clock_out');
      const breakStart = data?.find(p => p.punch_type === 'break_start');
      const breakEnd = data?.find(p => p.punch_type === 'break_end');

      setClockInTime(clockIn ? formatInTimeZone(parseISO(clockIn.punch_time), timezone, 'HH:mm') : '');
      setClockOutTime(clockOut ? formatInTimeZone(parseISO(clockOut.punch_time), timezone, 'HH:mm') : '');
      setBreakStartTime(breakStart ? formatInTimeZone(parseISO(breakStart.punch_time), timezone, 'HH:mm') : '');
      setBreakEndTime(breakEnd ? formatInTimeZone(parseISO(breakEnd.punch_time), timezone, 'HH:mm') : '');
    } catch (error) {
      console.error('Error fetching punches:', error);
      toast.error('Failed to load punch data');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!clockInTime) {
      toast.error('Clock in time is required');
      return;
    }

    setSaving(true);
    try {
      // Update or create each punch type
      const updates: Array<{ type: string; time: string; existingId?: string }> = [];

      const clockIn = punches.find(p => p.punch_type === 'clock_in');
      if (clockInTime) {
        updates.push({ type: 'clock_in', time: clockInTime, existingId: clockIn?.id });
      }

      const clockOut = punches.find(p => p.punch_type === 'clock_out');
      if (clockOutTime) {
        updates.push({ type: 'clock_out', time: clockOutTime, existingId: clockOut?.id });
      }

      const breakStart = punches.find(p => p.punch_type === 'break_start');
      if (breakStartTime) {
        updates.push({ type: 'break_start', time: breakStartTime, existingId: breakStart?.id });
      }

      const breakEnd = punches.find(p => p.punch_type === 'break_end');
      if (breakEndTime) {
        updates.push({ type: 'break_end', time: breakEndTime, existingId: breakEnd?.id });
      }

      for (const update of updates) {
        const punchTime = new Date(`${punchDate}T${update.time}:00`).toISOString();

        if (update.existingId) {
          // Update existing punch
          const { error } = await supabase
            .from('time_punches')
            .update({ punch_time: punchTime })
            .eq('id', update.existingId);
          if (error) throw error;
        } else {
          // Create new punch
          const { error } = await supabase
            .from('time_punches')
            .insert({
              user_id: userId,
              punch_type: update.type,
              punch_time: punchTime,
              location_id: locationId
            });
          if (error) throw error;
        }
      }

      // Delete punches that were cleared
      if (!clockOutTime && punches.find(p => p.punch_type === 'clock_out')) {
        await supabase.from('time_punches').delete().eq('id', punches.find(p => p.punch_type === 'clock_out')!.id);
      }
      if (!breakStartTime && punches.find(p => p.punch_type === 'break_start')) {
        await supabase.from('time_punches').delete().eq('id', punches.find(p => p.punch_type === 'break_start')!.id);
      }
      if (!breakEndTime && punches.find(p => p.punch_type === 'break_end')) {
        await supabase.from('time_punches').delete().eq('id', punches.find(p => p.punch_type === 'break_end')!.id);
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
        <DialogContent className="max-w-sm">
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Clock In</Label>
                  <Input
                    type="time"
                    value={clockInTime}
                    onChange={(e) => setClockInTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Clock Out</Label>
                  <Input
                    type="time"
                    value={clockOutTime}
                    onChange={(e) => setClockOutTime(e.target.value)}
                  />
                </div>
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
