import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addDays, startOfWeek } from "date-fns";

interface EditShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: any;
  profiles: any[];
  templates: any[];
  onUpdate: () => void;
  scheduleId: string;
  currentWeekStart: Date;
}

export function EditShiftDialog({ 
  open, 
  onOpenChange, 
  shift, 
  profiles, 
  templates,
  onUpdate,
  scheduleId,
  currentWeekStart
}: EditShiftDialogProps) {
  const [startTime, setStartTime] = useState(shift.start_time);
  const [endTime, setEndTime] = useState(shift.end_time);
  const [selectedUserId, setSelectedUserId] = useState(shift.user_id || "unassigned");
  const [position, setPosition] = useState(shift.template_id || "");
  const [selectedDays, setSelectedDays] = useState<number[]>([shift.day_of_week]);
  const [saving, setSaving] = useState(false);

  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const handleDayToggle = (dayIndex: number) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(d => d !== dayIndex)
        : [...prev, dayIndex]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update the current shift
      const { error: updateError } = await supabase
        .from("scheduled_shifts")
        .update({
          start_time: startTime,
          end_time: endTime,
          user_id: selectedUserId === "unassigned" ? null : selectedUserId,
          template_id: position || null,
        })
        .eq("id", shift.id);

      if (updateError) throw updateError;

      // If multiple days selected, create/update shifts for other days
      for (const dayIndex of selectedDays) {
        if (dayIndex === shift.day_of_week) continue; // Skip current day

        const shiftDate = format(addDays(currentWeekStart, dayIndex), "yyyy-MM-dd");
        
        // Check if shift already exists for this user/day
        const { data: existing } = await supabase
          .from("scheduled_shifts")
          .select("id")
          .eq("schedule_id", scheduleId)
          .eq("day_of_week", dayIndex)
          .eq("user_id", selectedUserId === "unassigned" ? null : selectedUserId)
          .maybeSingle();

        if (existing) {
          // Update existing shift
          await supabase
            .from("scheduled_shifts")
            .update({
              start_time: startTime,
              end_time: endTime,
              template_id: position || null,
            })
            .eq("id", existing.id);
        } else {
          // Create new shift
          await supabase
            .from("scheduled_shifts")
            .insert({
              schedule_id: scheduleId,
              day_of_week: dayIndex,
              shift_date: shiftDate,
              start_time: startTime,
              end_time: endTime,
              user_id: selectedUserId === "unassigned" ? null : selectedUserId,
              template_id: position || null,
              is_time_off: false,
            });
        }
      }

      toast.success("Shift updated");
      onUpdate();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error updating shift:", error);
      toast.error("Failed to update shift");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Shift</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time</Label>
              <Input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time</Label>
              <Input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employee">Employee</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger id="employee">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="position">Position</Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger id="position">
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.position || template.template_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Apply to Days</Label>
            <div className="space-y-2">
              {weekDays.map((day, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Checkbox
                    id={`day-${index}`}
                    checked={selectedDays.includes(index)}
                    onCheckedChange={() => handleDayToggle(index)}
                  />
                  <label
                    htmlFor={`day-${index}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {day}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
