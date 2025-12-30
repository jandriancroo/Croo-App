import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
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

interface EditPunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  punchId: string;
  userId: string;
  userName: string;
  userPhoto: string | null;
  punchTime: string;
  timezone: string;
  onPunchUpdated?: () => void;
}

export function EditPunchDialog({
  open,
  onOpenChange,
  punchId,
  userId,
  userName,
  userPhoto,
  punchTime,
  timezone,
  onPunchUpdated
}: EditPunchDialogProps) {
  const [clockInTime, setClockInTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (open && punchTime) {
      // Convert punch time to local time input format
      const time = formatInTimeZone(parseISO(punchTime), timezone, 'HH:mm');
      setClockInTime(time);
    }
  }, [open, punchTime, timezone]);

  const handleSave = async () => {
    if (!clockInTime) {
      toast.error('Please enter a valid time');
      return;
    }

    setSaving(true);
    try {
      // Get the date from the original punch
      const originalDate = formatInTimeZone(parseISO(punchTime), timezone, 'yyyy-MM-dd');
      const newPunchTime = new Date(`${originalDate}T${clockInTime}:00`);

      const { error } = await supabase
        .from('time_punches')
        .update({ punch_time: newPunchTime.toISOString() })
        .eq('id', punchId);

      if (error) throw error;

      toast.success('Punch time updated');
      onPunchUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating punch:', error);
      toast.error('Failed to update punch');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('time_punches')
        .delete()
        .eq('id', punchId);

      if (error) throw error;

      toast.success('Punch deleted');
      setDeleteDialogOpen(false);
      onPunchUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error deleting punch:', error);
      toast.error('Failed to delete punch');
    } finally {
      setSaving(false);
    }
  };

  const punchDate = punchTime ? formatInTimeZone(parseISO(punchTime), timezone, 'EEEE, MMMM d, yyyy') : '';

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

          <div className="space-y-4 py-4">
            {/* Date Display */}
            <div className="text-center p-2 bg-muted rounded-lg">
              <span className="text-sm font-medium">{punchDate}</span>
            </div>

            {/* Employee Info */}
            <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border">
              <Avatar className="h-10 w-10">
                <AvatarImage src={userPhoto || undefined} />
                <AvatarFallback>{userName.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="font-medium">{userName}</span>
            </div>

            {/* Time Input */}
            <div className="space-y-2">
              <Label>Clock In Time</Label>
              <Input
                type="time"
                value={clockInTime}
                onChange={(e) => setClockInTime(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button 
              variant="destructive" 
              size="icon"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={saving}
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
            <AlertDialogTitle>Delete Punch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this clock-in record for {userName}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
