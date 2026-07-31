import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { PROFILE_SAFE_COLUMNS } from '@/lib/profileColumns';
import { toast } from 'sonner';
import { format, startOfDay, endOfDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Clock, LogOut, Plus, X } from 'lucide-react';
import { getDisplayName } from '@/utils/displayName';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

interface QuickPunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ActivePunch {
  id: string;
  punch_time: string;
  user_id: string;
}

interface BreakEntry {
  startTime: string;
  endTime: string;
  type: 'paid' | 'unpaid';
}

export function QuickPunchDialog({ open, onOpenChange, onSuccess }: QuickPunchDialogProps) {
  const { currentLocation } = useLocation();
  const { timezone, toISO } = useLocationTimezone();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [date, setDate] = useState('');
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [showClockOut, setShowClockOut] = useState(false);
  const [breaks, setBreaks] = useState<BreakEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [activePunches, setActivePunches] = useState<Record<string, ActivePunch>>({});
  const [mode, setMode] = useState<'new' | 'punchout'>('new');

  // Get today's date in location timezone
  const getTodayStr = () => {
    return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  };

  useEffect(() => {
    if (open) {
      fetchEmployees();
      fetchActivePunches();
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setClockIn(`${hours}:${minutes}`);
      setClockOut('');
      setShowClockOut(false);
      setSelectedEmployee('');
      setBreaks([]);
      setDate(getTodayStr());
      setMode('new');
    }
  }, [open, timezone]);

  // When employee is selected, check if they're clocked in — but ONLY for today
  useEffect(() => {
    const todayStr = getTodayStr();
    if (selectedEmployee && activePunches[selectedEmployee] && date === todayStr) {
      setMode('punchout');
    } else {
      setMode('new');
    }
  }, [selectedEmployee, activePunches, date, timezone]);

  // Check if a time on the selected date is in the future
  const isTimeInFuture = (timeStr: string): boolean => {
    if (!timeStr) return false;
    const todayStr = getTodayStr();
    // If the date is in the past, no time is "in the future"
    if (date < todayStr) return false;
    // If the date IS today, compare times
    if (date === todayStr) {
      const nowTime = formatInTimeZone(new Date(), timezone, 'HH:mm');
      return timeStr > nowTime;
    }
    // Date is in the future — everything is future (shouldn't happen with max validation)
    return true;
  };

  // Check if selected date is in the future
  const isDateInFuture = (): boolean => {
    return date > getTodayStr();
  };

  const fetchEmployees = async () => {
    if (!currentLocation) return;
    
    const { data: userLocations } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', currentLocation.id);

    const userIds = userLocations?.map(ul => ul.user_id) || [];

    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_SAFE_COLUMNS)
      .eq('is_active', true)
      .in('id', userIds)
      .order('full_name');
    
    if (data) setEmployees(data);
  };

  const fetchActivePunches = async () => {
    if (!currentLocation) return;
    
    const today = new Date();
    const startOfToday = startOfDay(today).toISOString();
    const endOfToday = endOfDay(today).toISOString();

    const { data: clockIns } = await supabase
      .from('time_punches')
      .select('id, user_id, punch_time')
      .eq('location_id', currentLocation.id)
      .eq('punch_type', 'clock_in')
      .gte('punch_time', startOfToday)
      .lte('punch_time', endOfToday);

    const { data: clockOuts } = await supabase
      .from('time_punches')
      .select('user_id, punch_time')
      .eq('location_id', currentLocation.id)
      .eq('punch_type', 'clock_out')
      .gte('punch_time', startOfToday)
      .lte('punch_time', endOfToday);

    const activeMap: Record<string, ActivePunch> = {};
    
    clockIns?.forEach(punch => {
      const hasClockOut = clockOuts?.some(co => 
        co.user_id === punch.user_id && 
        new Date(co.punch_time) > new Date(punch.punch_time)
      );
      
      if (!hasClockOut) {
        activeMap[punch.user_id] = punch;
      }
    });

    setActivePunches(activeMap);
  };

  // Break helpers
  const addBreak = () => {
    setBreaks([...breaks, { startTime: '', endTime: '', type: 'unpaid' }]);
  };

  const removeBreak = (index: number) => {
    setBreaks(breaks.filter((_, i) => i !== index));
  };

  const updateBreak = (index: number, field: keyof BreakEntry, value: string) => {
    const newBreaks = [...breaks];
    if (field === 'type') {
      newBreaks[index].type = value as 'paid' | 'unpaid';
    } else {
      newBreaks[index][field] = value;
    }
    setBreaks(newBreaks);
  };

  const getBreakDurationMinutes = (startTime: string, endTime: string) => {
    if (!startTime || !endTime) return 0;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    return (endH * 60 + endM) - (startH * 60 + startM);
  };

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    // HARD GUARD: never write a punch with NULL location_id
    if (!currentLocation?.id) {
      toast.error('Location not loaded yet. Please wait a moment and try again.');
      return;
    }

    // Block future dates
    if (isDateInFuture()) {
      toast.error('Cannot create punches for future dates');
      return;
    }

    // Mode: Punch out an already clocked-in employee
    if (mode === 'punchout') {
      if (!clockOut) {
        toast.error('Please enter a clock out time');
        setSaving(false);
        return;
      }
      if (isTimeInFuture(clockOut)) {
        toast.error('Clock out time cannot be in the future');
        return;
      }

      setSaving(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const createdBy = user?.id;

        const { error } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedEmployee,
            punch_type: 'clock_out',
            punch_time: toISO(date, clockOut),
            location_id: currentLocation?.id,
            created_by: createdBy,
            notes: 'Manual entry by manager'
          });

        if (error) throw error;

        toast.success('Employee punched out');
        onSuccess();
        onOpenChange(false);
      } catch (error) {
        console.error('Error creating punch:', error);
        toast.error('Failed to punch out');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Mode: Create new shift
    if (!clockIn) {
      toast.error('Please enter a clock in time');
      return;
    }

    // Validate no future times
    if (isTimeInFuture(clockIn)) {
      toast.error('Clock in time cannot be in the future');
      return;
    }
    if (showClockOut && clockOut && isTimeInFuture(clockOut)) {
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
      const createdBy = user?.id;

      const punches: any[] = [
        {
          user_id: selectedEmployee,
          punch_type: 'clock_in',
          punch_time: toISO(date, clockIn),
          location_id: currentLocation?.id,
          created_by: createdBy,
          notes: 'Manual entry by manager'
        }
      ];

      // Add breaks
      for (const brk of breaks) {
        if (!brk.startTime) continue;
        const duration = brk.type === 'unpaid' ? 30 : 10;
        const breakNotes = `${duration} minute ${brk.type} break`;
        
        punches.push({
          user_id: selectedEmployee,
          punch_type: 'break_start',
          punch_time: toISO(date, brk.startTime),
          location_id: currentLocation?.id,
          created_by: createdBy,
          notes: breakNotes
        });

        if (brk.endTime) {
          punches.push({
            user_id: selectedEmployee,
            punch_type: 'break_end',
            punch_time: toISO(date, brk.endTime),
            location_id: currentLocation?.id,
            created_by: createdBy,
            notes: breakNotes
          });
        }
      }

      // Add clock out if provided
      if (showClockOut && clockOut) {
        // Handle midnight crossover for clock-out
        let clockOutDate = date;
        const [outHour] = clockOut.split(':').map(Number);
        const [inHour] = clockIn.split(':').map(Number);
        if (outHour < inHour) {
          const nextDay = new Date(date + 'T12:00:00');
          nextDay.setDate(nextDay.getDate() + 1);
          clockOutDate = format(nextDay, 'yyyy-MM-dd');
        }

        punches.push({
          user_id: selectedEmployee,
          punch_type: 'clock_out',
          punch_time: toISO(clockOutDate, clockOut),
          location_id: currentLocation?.id,
          created_by: createdBy,
          notes: 'Manual entry by manager'
        });
      }

      const { error } = await supabase
        .from('time_punches')
        .insert(punches);

      if (error) throw error;

      toast.success(showClockOut && clockOut ? 'Shift recorded' : 'Employee punched in');
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating punch:', error);
      toast.error('Failed to add punch entries');
    } finally {
      setSaving(false);
    }
  };

  const selectedProfile = employees.find(e => e.id === selectedEmployee);
  const todayStr = getTodayStr();
  const isEmployeeClockedIn = selectedEmployee && activePunches[selectedEmployee] && date === todayStr;
  const clockedInTime = isEmployeeClockedIn 
    ? format(new Date(activePunches[selectedEmployee].punch_time), 'h:mm a')
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'punchout' ? (
              <>
                <LogOut className="h-5 w-5" />
                Punch Out
              </>
            ) : (
              <>
                <Clock className="h-5 w-5" />
                Add Punch
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === 'punchout' 
              ? 'Clock out an employee who is currently working'
              : 'Create a complete shift with clock in, breaks, and clock out'
            }
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          {/* Date */}
          <div className="space-y-2">
            <Label>Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayStr}
            />
          </div>

          {/* Employee Selection */}
          <div className="space-y-2">
            <Label>Employee</Label>
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map(emp => (
                  <SelectItem key={emp.id} value={emp.id}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={emp.profile_photo_url || undefined} />
                        <AvatarFallback className="text-xs">{getDisplayName(emp.full_name, emp.nickname)?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {getDisplayName(emp.full_name, emp.nickname)}
                      {activePunches[emp.id] && date === todayStr && (
                        <Badge variant="secondary" className="ml-1 text-xs">
                          Clocked In
                        </Badge>
                      )}
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
                <AvatarFallback>{getDisplayName(selectedProfile.full_name, selectedProfile.nickname)?.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <span className="font-medium">{getDisplayName(selectedProfile.full_name, selectedProfile.nickname)}</span>
                {isEmployeeClockedIn && (
                  <p className="text-xs text-muted-foreground">Clocked in at {clockedInTime}</p>
                )}
              </div>
            </div>
          )}

          {/* Punch Out Mode */}
          {mode === 'punchout' ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Clock Out Time</Label>
                <Input
                  type="time"
                  value={clockOut}
                  onChange={(e) => setClockOut(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                This will clock out {getDisplayName(selectedProfile?.full_name, selectedProfile?.nickname)} who clocked in at {clockedInTime}
              </p>
            </div>
          ) : (
            <>
              {/* Time Inputs for new shift */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Clock In</Label>
                    <Input
                      type="time"
                      value={clockIn}
                      onChange={(e) => setClockIn(e.target.value)}
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
                            setClockOut('');
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                      <Input
                        type="time"
                        value={clockOut}
                        onChange={(e) => setClockOut(e.target.value)}
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
                        + Clock Out
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Breaks Section */}
              <div className="space-y-2">
                {breaks.map((brk, index) => (
                  <div key={index} className="p-3 border rounded-lg bg-background space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Break {index + 1}</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => removeBreak(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <Select value={brk.type} onValueChange={(v) => updateBreak(index, 'type', v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid break (10 min)</SelectItem>
                        <SelectItem value="unpaid">Meal break (30 min)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Start</Label>
                        <Input
                          type="time"
                          value={brk.startTime}
                          onChange={(e) => updateBreak(index, 'startTime', e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">End</Label>
                        <Input
                          type="time"
                          value={brk.endTime}
                          onChange={(e) => updateBreak(index, 'endTime', e.target.value)}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1"
                  onClick={addBreak}
                >
                  <Plus className="h-3 w-3" />
                  Add Break
                </Button>
              </div>

              {!showClockOut && (
                <p className="text-xs text-muted-foreground text-center">
                  Clock out can be added later when they leave.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={saving || !selectedEmployee || (mode === 'new' && !clockIn) || (mode === 'punchout' && !clockOut)}
            className="flex-1"
          >
            {saving ? 'Saving...' : mode === 'punchout' ? 'Punch Out' : (showClockOut && clockOut ? 'Record Shift' : 'Punch In')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
