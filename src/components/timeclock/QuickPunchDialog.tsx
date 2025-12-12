import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Clock, Coffee } from 'lucide-react';
import { useLocation } from '@/hooks/useLocation';

interface QuickPunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function QuickPunchDialog({ open, onOpenChange, onSuccess }: QuickPunchDialogProps) {
  const { currentLocation } = useLocation();
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [includeMealBreak, setIncludeMealBreak] = useState(false);
  const [mealBreakStart, setMealBreakStart] = useState('12:00');
  const [mealBreakEnd, setMealBreakEnd] = useState('12:30');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchEmployees();
      // Default clock in to current time
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setClockIn(`${hours}:${minutes}`);
      setClockOut('');
      setSelectedEmployee('');
      setIncludeMealBreak(false);
      setDate(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [open]);

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

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }
    if (!clockIn) {
      toast.error('Please enter a clock in time');
      return;
    }

    setSaving(true);
    try {
      const punches: any[] = [
        {
          user_id: selectedEmployee,
          punch_type: 'clock_in',
          punch_time: new Date(`${date}T${clockIn}`).toISOString(),
          location_id: currentLocation?.id
        }
      ];

      // Only add clock out if provided
      if (clockOut) {
        // Add meal break if included (before clock out)
        if (includeMealBreak) {
          punches.push({
            user_id: selectedEmployee,
            punch_type: 'break_start',
            punch_time: new Date(`${date}T${mealBreakStart}`).toISOString(),
            location_id: currentLocation?.id,
            notes: '30 minute meal break'
          });
          punches.push({
            user_id: selectedEmployee,
            punch_type: 'break_end',
            punch_time: new Date(`${date}T${mealBreakEnd}`).toISOString(),
            location_id: currentLocation?.id,
            notes: '30 minute meal break'
          });
        }
        
        punches.push({
          user_id: selectedEmployee,
          punch_type: 'clock_out',
          punch_time: new Date(`${date}T${clockOut}`).toISOString(),
          location_id: currentLocation?.id
        });
      }

      const { error } = await supabase
        .from('time_punches')
        .insert(punches);

      if (error) throw error;

      toast.success(clockOut ? 'Shift recorded' : 'Employee punched in');
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Quick Punch
          </DialogTitle>
          <DialogDescription>
            Punch in an employee or record a complete shift
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
              <span className="font-medium">{selectedProfile.full_name}</span>
            </div>
          )}

          {/* Time Inputs */}
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
          {clockOut && (
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={saving || !selectedEmployee || !clockIn}
            className="flex-1"
          >
            {saving ? 'Saving...' : clockOut ? 'Record Shift' : 'Punch In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
