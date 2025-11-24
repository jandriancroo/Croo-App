import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface Shift {
  id: string;
  user_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
  template?: {
    position: string | null;
    color: string | null;
  };
}

interface MobileShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  profiles: Profile[];
  isAdmin: boolean;
  onShiftUpdated?: () => void;
}

export function MobileShiftDialog({ 
  open, 
  onOpenChange, 
  shift, 
  profiles,
  isAdmin,
  onShiftUpdated 
}: MobileShiftDialogProps) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (shift) {
      setStartTime(shift.start_time);
      setEndTime(shift.end_time);
      setSelectedUserId(shift.user_id || '');
    }
  }, [shift]);

  if (!shift) return null;

  const profile = profiles.find(p => p.id === shift.user_id);

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleSave = async () => {
    if (!isAdmin) return;

    setSaving(true);
    try {
      // Update the shift
      const { error: shiftError } = await supabase
        .from('scheduled_shifts')
        .update({
          start_time: startTime,
          end_time: endTime,
          user_id: selectedUserId || null
        })
        .eq('id', shift.id);

      if (shiftError) throw shiftError;

      // Mark schedule as unpublished since changes were made
      const { data: scheduleData } = await supabase
        .from('schedules')
        .select('id')
        .eq('week_start_date', shift.shift_date.split('T')[0])
        .single();

      if (scheduleData) {
        await supabase
          .from('schedules')
          .update({ is_published: false })
          .eq('id', scheduleData.id);
      }

      toast.success('Shift updated');
      onShiftUpdated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating shift:', error);
      toast.error('Failed to update shift');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shift Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Employee Info */}
          {profile && (
            <div className="flex items-center gap-3 pb-4 border-b">
              <Avatar className="h-12 w-12">
                <AvatarImage src={profile.profile_photo_url || undefined} />
                <AvatarFallback>{profile.full_name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{profile.full_name}</p>
                <p className="text-sm text-muted-foreground">{shift.template?.position}</p>
              </div>
            </div>
          )}

          {/* Date */}
          <div>
            <Label className="text-muted-foreground">Date</Label>
            <p className="font-medium">{new Date(shift.shift_date).toLocaleDateString()}</p>
          </div>

          {/* Time Range */}
          {isAdmin ? (
            <div className="space-y-2">
              <Label>Shift Times</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <span>-</span>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-muted-foreground">Time</Label>
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {formatTime(shift.start_time)} - {formatTime(shift.end_time)}
                </p>
                {shiftHasBreak(shift.start_time, shift.end_time) && (
                  <BreakIndicator hasBreak={true} size="sm" />
                )}
              </div>
            </div>
          )}

          {/* Break Indicator for Admin */}
          {isAdmin && shiftHasBreak(startTime, endTime) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BreakIndicator hasBreak={true} size="sm" />
              <span>30-minute unpaid break (shift over 5 hours)</span>
            </div>
          )}

          {/* Employee Assignment - Admin Only */}
          {isAdmin && (
            <div className="space-y-2">
              <Label>Assigned Employee</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAdmin ? 'Cancel' : 'Close'}
          </Button>
          {isAdmin && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
