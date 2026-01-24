import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Clock, Coffee, LogOut } from 'lucide-react';
import { useLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import {
  getEndOfDateStringInTimezone,
  getStartOfTodayInTimezone,
  getTodayInTimezone,
  toISOStringInTimezone,
} from '@/utils/timezoneUtils';

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

export function QuickPunchDialog({ open, onOpenChange, onSuccess }: QuickPunchDialogProps) {
  const { currentLocation } = useLocation();
  const { timezone } = useLocationTimezone();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [date, setDate] = useState(() => getTodayInTimezone(timezone));
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [includeMealBreak, setIncludeMealBreak] = useState(false);
  const [mealBreakStart, setMealBreakStart] = useState('12:00');
  const [mealBreakEnd, setMealBreakEnd] = useState('12:30');
  const [saving, setSaving] = useState(false);
  const [activePunches, setActivePunches] = useState<Record<string, ActivePunch>>({});
  const [mode, setMode] = useState<'new' | 'punchout'>('new');

  useEffect(() => {
    if (open) {
      fetchEmployees();
      fetchActivePunches();
      // Default clock in/out to current time
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setClockIn(`${hours}:${minutes}`);
      setClockOut(`${hours}:${minutes}`);
      setSelectedEmployee('');
      setIncludeMealBreak(false);
      setDate(getTodayInTimezone(timezone));
      setMode('new');
    }
  }, [open, timezone]);

  // When employee is selected, check if they're clocked in
  useEffect(() => {
    if (selectedEmployee && activePunches[selectedEmployee]) {
      setMode('punchout');
    } else {
      setMode('new');
    }
  }, [selectedEmployee, activePunches]);

  const fetchEmployees = async () => {
    if (!currentLocation) return;
    
    const { data: userLocations } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', currentLocation.id);

    const userIds = userLocations?.map(ul => ul.user_id) || [];

    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .in('id', userIds)
      .order('full_name');
    
    if (data) setEmployees(data);
  };

  const fetchActivePunches = async () => {
    if (!currentLocation) return;
    
    // Get today's date range in the LOCATION timezone (prevents device timezone shifting)
    const startOfToday = getStartOfTodayInTimezone(timezone).toISOString();
    const endOfToday = getEndOfDateStringInTimezone(getTodayInTimezone(timezone), timezone).toISOString();

    // Fetch all clock_in punches for today at this location
    const { data: clockIns } = await supabase
      .from('time_punches')
      .select('id, user_id, punch_time')
      .eq('location_id', currentLocation.id)
      .eq('punch_type', 'clock_in')
      .gte('punch_time', startOfToday)
      .lte('punch_time', endOfToday);

    // Fetch all clock_out punches for today at this location
    const { data: clockOuts } = await supabase
      .from('time_punches')
      .select('user_id, punch_time')
      .eq('location_id', currentLocation.id)
      .eq('punch_type', 'clock_out')
      .gte('punch_time', startOfToday)
      .lte('punch_time', endOfToday);

    // Find employees who are clocked in but not clocked out
    const activeMap: Record<string, ActivePunch> = {};
    
    clockIns?.forEach(punch => {
      // If they don't have a clock_out after this clock_in, they're still clocked in
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

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    setSaving(true);
    try {
      // Get current user (the manager doing the punch)
      const { data: { user } } = await supabase.auth.getUser();
      const createdBy = user?.id;

      // Mode: Punch out an already clocked-in employee
      if (mode === 'punchout') {
        if (!clockOut) {
          toast.error('Please enter a clock out time');
          setSaving(false);
          return;
        }

        const { error } = await supabase
          .from('time_punches')
          .insert({
            user_id: selectedEmployee,
            punch_type: 'clock_out',
            punch_time: toISOStringInTimezone(date, clockOut, timezone),
            location_id: currentLocation?.id,
            created_by: createdBy, // Manager who entered this
            notes: 'Manual entry by manager'
          });

        if (error) throw error;

        toast.success('Employee punched out');
        onSuccess();
        onOpenChange(false);
        return;
      }

      // Mode: Create new shift
      if (!clockIn) {
        toast.error('Please enter a clock in time');
        setSaving(false);
        return;
      }

      const punches: any[] = [
        {
          user_id: selectedEmployee,
          punch_type: 'clock_in',
          punch_time: toISOStringInTimezone(date, clockIn, timezone),
          location_id: currentLocation?.id,
          created_by: createdBy,
          notes: 'Manual entry by manager'
        }
      ];

      // Only add clock out if provided
      if (clockOut && clockOut !== clockIn) {
        // Add meal break if included (before clock out)
        if (includeMealBreak) {
          punches.push({
            user_id: selectedEmployee,
            punch_type: 'break_start',
            punch_time: toISOStringInTimezone(date, mealBreakStart, timezone),
            location_id: currentLocation?.id,
            created_by: createdBy,
            notes: '30 minute meal break (manual entry)'
          });
          punches.push({
            user_id: selectedEmployee,
            punch_type: 'break_end',
            punch_time: toISOStringInTimezone(date, mealBreakEnd, timezone),
            location_id: currentLocation?.id,
            created_by: createdBy,
            notes: '30 minute meal break (manual entry)'
          });
        }
        
        punches.push({
          user_id: selectedEmployee,
          punch_type: 'clock_out',
          punch_time: toISOStringInTimezone(date, clockOut, timezone),
          location_id: currentLocation?.id,
          created_by: createdBy,
          notes: 'Manual entry by manager'
        });
      }

      const { error } = await supabase
        .from('time_punches')
        .insert(punches);

      if (error) throw error;

      toast.success(clockOut && clockOut !== clockIn ? 'Shift recorded' : 'Employee punched in');
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
  const isEmployeeClockedIn = selectedEmployee && activePunches[selectedEmployee];
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
                Quick Punch
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === 'punchout' 
              ? 'Clock out an employee who is currently working'
              : 'Punch in an employee or record a complete shift'
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
                        <AvatarFallback className="text-xs">{emp.full_name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {emp.full_name}
                      {activePunches[emp.id] && (
                        <Badge variant="secondary" className="ml-1 text-xs bg-green-100 text-green-700">
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
                <AvatarFallback>{selectedProfile.full_name?.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <span className="font-medium">{selectedProfile.full_name}</span>
                {isEmployeeClockedIn && (
                  <p className="text-xs text-green-600">Clocked in at {clockedInTime}</p>
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
                This will clock out {selectedProfile?.full_name} who clocked in at {clockedInTime}
              </p>
            </div>
          ) : (
            <>
              {/* Time Inputs for new shift */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Clock In</Label>
                  <Input
                    type="time"
                    value={clockIn}
                    onChange={(e) => setClockIn(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Clock Out <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    type="time"
                    value={clockOut}
                    onChange={(e) => setClockOut(e.target.value)}
                  />
                </div>
              </div>

              {/* Meal break option - only show if clock out is set */}
              {clockOut && clockOut !== clockIn && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="includeMealBreak"
                      checked={includeMealBreak}
                      onCheckedChange={(checked) => setIncludeMealBreak(checked as boolean)}
                    />
                    <label htmlFor="includeMealBreak" className="text-sm font-medium flex items-center gap-2 cursor-pointer">
                      <Coffee className="h-4 w-4 text-amber-600" />
                      Include 30-min meal break
                    </label>
                  </div>
                  
                  {includeMealBreak && (
                    <div className="grid grid-cols-2 gap-3 pl-6">
                      <div className="space-y-1">
                        <Label className="text-xs">Break Start</Label>
                        <Input
                          type="time"
                          value={mealBreakStart}
                          onChange={(e) => setMealBreakStart(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Break End</Label>
                        <Input
                          type="time"
                          value={mealBreakEnd}
                          onChange={(e) => setMealBreakEnd(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center">
                Leave clock out blank to just punch in. They can clock out later.
              </p>
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
            {saving ? 'Saving...' : mode === 'punchout' ? 'Punch Out' : (clockOut && clockOut !== clockIn ? 'Record Shift' : 'Punch In')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
