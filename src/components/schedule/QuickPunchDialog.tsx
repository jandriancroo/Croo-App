import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { Switch } from '@/components/ui/switch';

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
  const { timezone, toISO, getTodayInTimezone } = useLocationTimezone();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [punchDate, setPunchDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [showClockOut, setShowClockOut] = useState(false);
  const [includeBreak, setIncludeBreak] = useState(false);
  const [breakStartTime, setBreakStartTime] = useState('');
  const [breakEndTime, setBreakEndTime] = useState('');
  const [breakType, setBreakType] = useState<'paid' | 'unpaid'>('unpaid');
  const [saving, setSaving] = useState(false);

  // Reset and set defaults when dialog opens
  useEffect(() => {
    if (open) {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setStartTime(`${hours}:${minutes}`);
      setEndTime('');
      setShowClockOut(false);
      setBreakStartTime('');
      setBreakEndTime('');
      setBreakType('unpaid');
      setIncludeBreak(false);
      setSelectedUserId('');
      // Default to the selected date from schedule
      setPunchDate(format(selectedDate, 'yyyy-MM-dd'));
    }
  }, [open, selectedDate]);

  // Check if a time is in the future (using location timezone, not device time)
  const isTimeInFuture = (time: string): boolean => {
    if (!time || punchDate !== getTodayInTimezone()) return false;
    // Compare against location's current time, not device time
    const nowTime = formatInTimeZone(new Date(), timezone, 'HH:mm');
    return time > nowTime;
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

  const handleQuickPunchNow = async () => {
    if (!selectedUserId) {
      toast.error('Please select an employee');
      return;
    }

    // Validate no future times
    if (isTimeInFuture(startTime)) {
      toast.error('Clock in time cannot be in the future');
      return;
    }
    if (showClockOut && endTime && isTimeInFuture(endTime)) {
      toast.error('Clock out time cannot be in the future');
      return;
    }
    if (includeBreak && breakStartTime && isTimeInFuture(breakStartTime)) {
      toast.error('Break start time cannot be in the future');
      return;
    }
    if (includeBreak && breakEndTime && isTimeInFuture(breakEndTime)) {
      toast.error('Break end time cannot be in the future');
      return;
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
      // Use timezone-aware conversion to ISO string
      const clockInISO = toISO(punchDate, startTime);

      // Create clock-in punch
      const { error: clockInError } = await supabase
        .from('time_punches')
        .insert({
          user_id: selectedUserId,
          punch_type: 'clock_in',
          punch_time: clockInISO,
          location_id: currentLocation?.id
        });

      if (clockInError) throw clockInError;

      // If break included, create break punches
      // IMPORTANT: Use full format "30 minute unpaid break" or "10 minute paid break"
      // to match PunchClock.tsx format - otherwise break enforcement reads wrong duration
      if (includeBreak && breakStartTime) {
        const breakStartISO = toISO(punchDate, breakStartTime);
        const duration = breakType === 'unpaid' ? 30 : 10;
        const breakNotes = `${duration} minute ${breakType} break`;
        
        const { error: breakStartError } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedUserId,
            punch_type: 'break_start',
            punch_time: breakStartISO,
            notes: breakNotes,
            location_id: currentLocation?.id
          });
        if (breakStartError) throw breakStartError;

        // Create break end if provided
        if (breakEndTime) {
          const breakEndISO = toISO(punchDate, breakEndTime);
          const { error: breakEndError } = await supabase
            .from('time_punches')
            .insert({
              user_id: selectedUserId,
              punch_type: 'break_end',
              punch_time: breakEndISO,
              notes: breakNotes,
              location_id: currentLocation?.id
            });
          if (breakEndError) throw breakEndError;
        }
      }

      // If end time provided and clock out is shown, also create clock-out
      if (showClockOut && endTime) {
        const clockOutISO = toISO(punchDate, endTime);
        const { error: clockOutError } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedUserId,
            punch_type: 'clock_out',
            punch_time: clockOutISO,
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
          {/* Date Selector */}
          <div className="space-y-2">
            <Label>Date</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  const current = new Date(punchDate + 'T12:00:00');
                  setPunchDate(format(subDays(current, 1), 'yyyy-MM-dd'));
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={punchDate}
                onChange={(e) => setPunchDate(e.target.value)}
                max={getTodayInTimezone()}
                className="flex-1 text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => {
                  const current = new Date(punchDate + 'T12:00:00');
                  const today = getTodayInTimezone();
                  const nextDate = format(new Date(current.getTime() + 86400000), 'yyyy-MM-dd');
                  if (nextDate <= today) {
                    setPunchDate(nextDate);
                  }
                }}
                disabled={punchDate >= getTodayInTimezone()}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
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
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Clock In</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            
            {showClockOut ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Clock Out</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-muted-foreground"
                    onClick={() => {
                      setShowClockOut(false);
                      setEndTime('');
                    }}
                  >
                    Remove
                  </Button>
                </div>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowClockOut(true)}
              >
                + Add Clock Out
              </Button>
            )}
          </div>

          {/* Break Toggle - only available when clock-in time is set */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Include Break</Label>
              <p className="text-xs text-muted-foreground">
                {!startTime ? 'Enter clock-in time first' : 'Add a break to this shift'}
              </p>
            </div>
            <Switch 
              checked={includeBreak} 
              onCheckedChange={setIncludeBreak}
              disabled={!startTime}
            />
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

          {!showClockOut && (
            <p className="text-xs text-muted-foreground text-center">
              Clock out can be added later when they leave.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleQuickPunchNow} 
            disabled={saving || !selectedUserId || !startTime || (includeBreak && !breakStartTime) || (showClockOut && !endTime)}
            className="flex-1"
          >
            {saving ? 'Saving...' : (showClockOut && endTime) ? 'Record Shift' : 'Punch In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}