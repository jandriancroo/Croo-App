import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, X, Trash2, Camera, CheckSquare, AlarmClock, ClipboardList, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

interface EditTemporaryTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  task: any;
}

const ACCENT_COLORS = [
  { value: "#8B5CF6", label: "Purple" },
  { value: "#10B981", label: "Green" },
  { value: "#F59E0B", label: "Orange" },
  { value: "#EF4444", label: "Red" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#EC4899", label: "Pink" },
  { value: "#14B8A6", label: "Teal" },
];

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "general_manager", label: "General Manager" },
  { value: "shift_manager", label: "Shift Manager" },
  { value: "team_member", label: "Team Member" },
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const FREQUENCY_OPTIONS = [
  { value: "30", label: "Every 30 minutes", minutes: 30 },
  { value: "60", label: "Every hour", minutes: 60 },
  { value: "120", label: "Every 2 hours", minutes: 120 },
  { value: "custom", label: "Custom times", minutes: null },
];

export function EditTemporaryTaskDialog({ open, onOpenChange, onSuccess, task }: EditTemporaryTaskDialogProps) {
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  
  // Basic fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState("#8B5CF6");
  
  // Task style (read-only for editing)
  const [taskStyle, setTaskStyle] = useState<"standard" | "alarm">("standard");
  
  // Alarm task fields
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [frequencyType, setFrequencyType] = useState("60");
  const [customTimes, setCustomTimes] = useState<string[]>([]);
  const [newCustomTime, setNewCustomTime] = useState("");
  const [notifyOnlyWorking, setNotifyOnlyWorking] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [showOnPunchClock, setShowOnPunchClock] = useState(false);
  
  // Assignment
  const [assignmentType, setAssignmentType] = useState<"employees" | "roles">("employees");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch employees at the location
  const { data: employees = [] } = useQuery({
    queryKey: ['location-employees', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const { data: userLocations } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);
      
      if (!userLocations?.length) return [];
      
      const userIds = userLocations.map(ul => ul.user_id);
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)
        .eq('is_active', true)
        .order('full_name');
      
      return profiles || [];
    },
    enabled: open && !!currentLocation?.id,
  });

  // Load task data when dialog opens
  useEffect(() => {
    if (open && task) {
      setTitle(task.title || "");
      setDescription(task.description || "");
      setAccentColor(task.accent_color || "#8B5CF6");
      setTaskStyle(task.task_style || "standard");
      setDaysOfWeek(task.days_of_week || [1, 2, 3, 4, 5]);
      setFrequencyType(
        task.frequency_type === "custom" 
          ? "custom" 
          : task.frequency_minutes?.toString() || "60"
      );
      setCustomTimes(task.custom_times || []);
      setNotifyOnlyWorking(task.notify_only_working ?? true);
      setPushEnabled(task.push_enabled ?? true);
      setShowOnPunchClock(task.show_on_punch_clock ?? false);
      
      // Load assignments
      const assignments = task.assignments || [];
      const hasUserAssignments = assignments.some((a: any) => a.user_id);
      const hasRoleAssignments = assignments.some((a: any) => a.role);
      
      if (hasUserAssignments) {
        setAssignmentType("employees");
        setSelectedEmployees(assignments.filter((a: any) => a.user_id).map((a: any) => a.user_id));
        setSelectedRoles([]);
      } else if (hasRoleAssignments) {
        setAssignmentType("roles");
        setSelectedRoles(assignments.filter((a: any) => a.role).map((a: any) => a.role));
        setSelectedEmployees([]);
      }
    }
  }, [open, task]);

  const handleAddCustomTime = () => {
    if (newCustomTime && !customTimes.includes(newCustomTime)) {
      setCustomTimes([...customTimes, newCustomTime].sort());
      setNewCustomTime("");
    }
  };

  const handleRemoveCustomTime = (time: string) => {
    setCustomTimes(customTimes.filter(t => t !== time));
  };

  const toggleDayOfWeek = (day: number) => {
    setDaysOfWeek(prev =>
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    );
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Please enter a task title");
      return;
    }
    
    if (assignmentType === "employees" && selectedEmployees.length === 0) {
      toast.error("Please select at least one employee");
      return;
    }
    
    if (assignmentType === "roles" && selectedRoles.length === 0) {
      toast.error("Please select at least one role");
      return;
    }

    if (taskStyle === "alarm") {
      if (daysOfWeek.length === 0) {
        toast.error("Please select at least one day of the week");
        return;
      }
      if (frequencyType === "custom" && customTimes.length === 0) {
        toast.error("Please add at least one custom time");
        return;
      }
    }

    setIsSubmitting(true);
    
    try {
      // Prepare task data
      const taskData: any = {
        title: title.trim(),
        description: description.trim() || null,
        accent_color: accentColor,
      };

      if (taskStyle === "alarm") {
        taskData.days_of_week = daysOfWeek;
        taskData.frequency_type = frequencyType === "custom" ? "custom" : "interval";
        taskData.frequency_minutes = frequencyType !== "custom" ? parseInt(frequencyType) : null;
        taskData.custom_times = frequencyType === "custom" ? customTimes : null;
        taskData.notify_only_working = notifyOnlyWorking;
        taskData.push_enabled = pushEnabled;
        taskData.show_on_punch_clock = showOnPunchClock;
      }

      // Update the task
      const { error: taskError } = await supabase
        .from('temporary_tasks')
        .update(taskData)
        .eq('id', task.id);

      if (taskError) throw taskError;

      // Delete existing assignments and create new ones
      await supabase
        .from('temporary_task_assignments')
        .delete()
        .eq('task_id', task.id);

      const assignments = assignmentType === "employees"
        ? selectedEmployees.map(userId => ({ task_id: task.id, user_id: userId, role: null }))
        : selectedRoles.map(role => ({ task_id: task.id, user_id: null, role }));

      const { error: assignmentError } = await supabase
        .from('temporary_task_assignments')
        .insert(assignments);

      if (assignmentError) throw assignmentError;

      toast.success("Task updated");
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error updating task:", error);
      toast.error("Failed to update task");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployees(prev =>
      prev.includes(employeeId)
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {taskStyle === "alarm" ? (
              <AlarmClock className="h-5 w-5" />
            ) : (
              <ClipboardList className="h-5 w-5" />
            )}
            Edit {taskStyle === "alarm" ? "Alarm" : "Standard"} Task
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Task Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter task title"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={2}
            />
          </div>

          {/* Accent Color */}
          <div className="space-y-2">
            <Label>Accent Color</Label>
            <Select value={accentColor} onValueChange={setAccentColor}>
              <SelectTrigger>
                <div className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded-full" 
                    style={{ backgroundColor: accentColor }}
                  />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {ACCENT_COLORS.map(color => (
                  <SelectItem key={color.value} value={color.value}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: color.value }}
                      />
                      {color.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Alarm Task Fields */}
          {taskStyle === "alarm" && (
            <>
              {/* Days of Week */}
              <div className="space-y-2">
                <Label>Active Days *</Label>
                <div className="flex gap-1">
                  {DAYS_OF_WEEK.map(day => (
                    <Button
                      key={day.value}
                      type="button"
                      size="sm"
                      variant={daysOfWeek.includes(day.value) ? "default" : "outline"}
                      className="flex-1 px-1 text-xs"
                      onClick={() => toggleDayOfWeek(day.value)}
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Frequency */}
              <div className="space-y-2">
                <Label>Reminder Frequency</Label>
                <Select value={frequencyType} onValueChange={setFrequencyType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Times */}
              {frequencyType === "custom" && (
                <div className="space-y-2">
                  <Label>Custom Times</Label>
                  <div className="flex gap-2">
                    <Input
                      type="time"
                      value={newCustomTime}
                      onChange={(e) => setNewCustomTime(e.target.value)}
                      className="flex-1"
                    />
                    <Button 
                      type="button" 
                      size="icon" 
                      variant="outline"
                      onClick={handleAddCustomTime}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {customTimes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {customTimes.map(time => (
                        <Badge key={time} variant="secondary" className="gap-1">
                          {time}
                          <X 
                            className="h-3 w-3 cursor-pointer" 
                            onClick={() => handleRemoveCustomTime(time)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Only Working Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Only notify working staff</Label>
                  <p className="text-xs text-muted-foreground">
                    Only sends to assigned staff who are clocked in or on break
                  </p>
                </div>
                <Switch
                  checked={notifyOnlyWorking}
                  onCheckedChange={setNotifyOnlyWorking}
                />
              </div>

              {/* Push Notification Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label>Push notifications</Label>
                    <p className="text-xs text-muted-foreground">
                      Send push notification at each reminder time
                    </p>
                  </div>
                </div>
                <Switch
                  checked={pushEnabled}
                  onCheckedChange={setPushEnabled}
                />
              </div>

              {/* Show on Punch Clock Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Show on Punch Clock</Label>
                  <p className="text-xs text-muted-foreground">
                    Display alarm overlay on punch clock screen
                  </p>
                </div>
                <Switch
                  checked={showOnPunchClock}
                  onCheckedChange={setShowOnPunchClock}
                />
              </div>
            </>
          )}

          {/* Assignment Type */}
          <div className="space-y-2">
            <Label>Assign To</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={assignmentType === "employees" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setAssignmentType("employees");
                  setSelectedRoles([]);
                }}
              >
                Employees
              </Button>
              <Button
                type="button"
                variant={assignmentType === "roles" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setAssignmentType("roles");
                  setSelectedEmployees([]);
                }}
              >
                Roles
              </Button>
            </div>
          </div>

          {/* Employee Selection */}
          {assignmentType === "employees" && (
            <div className="space-y-2">
              <Label>Select Employees *</Label>
              <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employees found</p>
                ) : (
                  employees.map((employee: any) => (
                    <div key={employee.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`edit-emp-${employee.id}`}
                        checked={selectedEmployees.includes(employee.id)}
                        onCheckedChange={() => toggleEmployee(employee.id)}
                      />
                      <label
                        htmlFor={`edit-emp-${employee.id}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {employee.full_name}
                      </label>
                    </div>
                  ))
                )}
              </div>
              {selectedEmployees.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedEmployees.map(empId => {
                    const emp = employees.find((e: any) => e.id === empId);
                    return emp ? (
                      <Badge key={empId} variant="secondary" className="gap-1">
                        {emp.full_name}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() => toggleEmployee(empId)}
                        />
                      </Badge>
                    ) : null;
                  })}
                </div>
              )}
            </div>
          )}

          {/* Role Selection */}
          {assignmentType === "roles" && (
            <div className="space-y-2">
              <Label>Select Roles *</Label>
              <div className="border rounded-lg p-3 space-y-2">
                {ROLE_OPTIONS.map(role => (
                  <div key={role.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`edit-role-${role.value}`}
                      checked={selectedRoles.includes(role.value)}
                      onCheckedChange={() => toggleRole(role.value)}
                    />
                    <label
                      htmlFor={`edit-role-${role.value}`}
                      className="text-sm cursor-pointer flex-1"
                    >
                      {role.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}