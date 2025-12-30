import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { useLocation } from '@/hooks/useLocation';

interface Profile {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

interface QuickPunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
  selectedDate: Date;
  onPunchCreated?: () => void;
}

export function QuickPunchDialog({
  open,
  onOpenChange,
  profiles,
  selectedDate,
  onPunchCreated
}: QuickPunchDialogProps) {
  const { currentLocation } = useLocation();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakStartTime, setBreakStartTime] = useState('');
  const [breakEndTime, setBreakEndTime] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset and set defaults when dialog opens
  useEffect(() => {
    if (open) {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setStartTime(`${hours}:${minutes}`);
      setEndTime('');
      setBreakStartTime('');
      setBreakEndTime('');
      setSelectedUserId('');
    }
  }, [open]);

  const handleQuickPunchNow = async () => {
    if (!selectedUserId) {
      toast.error('Please select an employee');
      return;
    }

    setSaving(true);
    try {
      const punchDate = format(selectedDate, 'yyyy-MM-dd');
      const clockInTime = new Date(`${punchDate}T${startTime}:00`);

      // Create clock-in punch
      const { error: clockInError } = await supabase
        .from('time_punches')
        .insert({
          user_id: selectedUserId,
          punch_type: 'clock_in',
          punch_time: clockInTime.toISOString(),
          location_id: currentLocation?.id
        });

      if (clockInError) throw clockInError;

      // If break times provided, create break punches
      if (breakStartTime) {
        const breakStartPunch = new Date(`${punchDate}T${breakStartTime}:00`);
        const { error: breakStartError } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedUserId,
            punch_type: 'break_start',
            punch_time: breakStartPunch.toISOString(),
            location_id: currentLocation?.id
          });
        if (breakStartError) throw breakStartError;
      }

      if (breakEndTime) {
        const breakEndPunch = new Date(`${punchDate}T${breakEndTime}:00`);
        const { error: breakEndError } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedUserId,
            punch_type: 'break_end',
            punch_time: breakEndPunch.toISOString(),
            location_id: currentLocation?.id
          });
        if (breakEndError) throw breakEndError;
      }

      // If end time provided, also create clock-out
      if (endTime) {
        const clockOutTime = new Date(`${punchDate}T${endTime}:00`);
        const { error: clockOutError } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedUserId,
            punch_type: 'clock_out',
            punch_time: clockOutTime.toISOString(),
            location_id: currentLocation?.id
          });

        if (clockOutError) throw clockOutError;
        toast.success('Shift recorded successfully');
      } else {
        toast.success('Employee punched in');
      }

      onPunchCreated?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating punch:', error);
      toast.error('Failed to create punch');
    } finally {
      setSaving(false);
    }
  };

  const selectedProfile = profiles.find(p => p.id === selectedUserId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Quick Punch
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date Display */}
          <div className="text-center p-2 bg-muted rounded-lg">
            <span className="text-sm font-medium">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</span>
          </div>

          {/* Employee Selection */}
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={p.profile_photo_url || undefined} />
                        <AvatarFallback className="text-xs">{p.full_name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {p.full_name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selected Employee Preview */}
          {selectedProfile && (
            <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg border">
              <Avatar className="h-10 w-10">
                <AvatarImage src={selectedProfile.profile_photo_url || undefined} />
                <AvatarFallback>{selectedProfile.full_name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="font-medium">{selectedProfile.full_name}</span>
            </div>
          )}

          {/* Time Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Clock In</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Clock Out <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="Leave blank"
              />
            </div>
          </div>

          {/* Break Time Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Break Start <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="time"
                value={breakStartTime}
                onChange={(e) => setBreakStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Break End <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                type="time"
                value={breakEndTime}
                onChange={(e) => setBreakEndTime(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Leave clock out blank to just punch them in. They can clock out later.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleQuickPunchNow} 
            disabled={saving || !selectedUserId || !startTime}
            className="flex-1"
          >
            {saving ? 'Saving...' : endTime ? 'Record Shift' : 'Punch In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}