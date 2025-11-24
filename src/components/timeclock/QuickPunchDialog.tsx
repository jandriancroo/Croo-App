import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface QuickPunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function QuickPunchDialog({ open, onOpenChange, onSuccess }: QuickPunchDialogProps) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [clockIn, setClockIn] = useState('09:00');
  const [clockOut, setClockOut] = useState('17:00');
  const [mealBreakStart, setMealBreakStart] = useState('12:00');
  const [mealBreakEnd, setMealBreakEnd] = useState('12:30');
  const [includeMealBreak, setIncludeMealBreak] = useState(true);

  useEffect(() => {
    if (open) {
      fetchEmployees();
    }
  }, [open]);

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('full_name');
    
    if (data) setEmployees(data);
  };

  const handleSubmit = async () => {
    if (!selectedEmployee) {
      toast.error('Please select an employee');
      return;
    }

    const punches = [
      {
        user_id: selectedEmployee,
        punch_type: 'clock_in',
        punch_time: new Date(`${date}T${clockIn}`).toISOString(),
      },
      ...(includeMealBreak ? [
        {
          user_id: selectedEmployee,
          punch_type: 'break_start',
          punch_time: new Date(`${date}T${mealBreakStart}`).toISOString(),
          notes: '30 minute unpaid break'
        },
        {
          user_id: selectedEmployee,
          punch_type: 'break_end',
          punch_time: new Date(`${date}T${mealBreakEnd}`).toISOString(),
          notes: '30 minute unpaid break'
        }
      ] : []),
      {
        user_id: selectedEmployee,
        punch_type: 'clock_out',
        punch_time: new Date(`${date}T${clockOut}`).toISOString(),
      }
    ];

    const { error } = await supabase
      .from('time_punches')
      .insert(punches);

    if (error) {
      toast.error('Failed to add punch entries');
      return;
    }

    toast.success('Punch entries added successfully');
    onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Quick Punch Entry</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              <select
                className="w-full border rounded-md p-2 bg-background"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
              >
                <option value="">Select employee...</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>Date</Label>
              <input
                type="date"
                className="w-full border rounded-md p-2 bg-background"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Clock In Time</Label>
              <input
                type="time"
                className="w-full border rounded-md p-2 bg-background"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Clock Out Time</Label>
              <input
                type="time"
                className="w-full border rounded-md p-2 bg-background"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="includeMealBreak"
                checked={includeMealBreak}
                onChange={(e) => setIncludeMealBreak(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="includeMealBreak">Include 30 Minute Meal Break</Label>
            </div>
            
            {includeMealBreak && (
              <div className="grid grid-cols-2 gap-4 pl-6">
                <div className="space-y-2">
                  <Label>Break Start</Label>
                  <input
                    type="time"
                    className="w-full border rounded-md p-2 bg-background"
                    value={mealBreakStart}
                    onChange={(e) => setMealBreakStart(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Break End</Label>
                  <input
                    type="time"
                    className="w-full border rounded-md p-2 bg-background"
                    value={mealBreakEnd}
                    onChange={(e) => setMealBreakEnd(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!selectedEmployee}>
              Add Punch Entries
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
