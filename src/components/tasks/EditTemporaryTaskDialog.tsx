import { useState, useEffect } from "react";
import { ASSIGNABLE_ROLE_OPTIONS } from '@/hooks/useUserRole';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, X, Trash2, Camera, CheckSquare, AlarmClock, ClipboardList, Bell, Send, Users } from "lucide-react";
import { AccentColorPicker } from "./AccentColorPicker";
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

interface Subtask {
  id?: string;
  title: string;
  item_type: "checkbox" | "photo";
  isNew?: boolean;
  toDelete?: boolean;
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

const ROLE_OPTIONS = ASSIGNABLE_ROLE_OPTIONS;

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
  const [taskStyle, setTaskStyle] = useState<"standard" | "alarm" | "team">("standard");
  
  // Alarm task fields
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [frequencyType, setFrequencyType] = useState("60");
  const [customTimes, setCustomTimes] = useState<string[]>([]);
  const [newCustomTime, setNewCustomTime] = useState("");
  const [alarmStartTime, setAlarmStartTime] = useState("09:00");
  const [alarmEndTime, setAlarmEndTime] = useState("21:00");
  const [notifyOnlyWorking, setNotifyOnlyWorking] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [showOnPunchClock, setShowOnPunchClock] = useState(false);
  const [showOnDashboard, setShowOnDashboard] = useState(true);
  
  // Assignment
  const [assignmentType, setAssignmentType] = useState<"employees" | "roles">("employees");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  // Subtasks
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [newSubtaskType, setNewSubtaskType] = useState<"checkbox" | "photo">("checkbox");
  
  const [shareable, setShareable] = useState(false);
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

  // Fetch existing subtasks
  const { data: existingSubtasks = [] } = useQuery({
    queryKey: ['task-subtasks', task?.id],
    queryFn: async () => {
      if (!task?.id) return [];
      const { data, error } = await supabase
        .from('temporary_task_subtasks')
        .select('id, title, item_type, order_index')
        .eq('task_id', task.id)
        .order('order_index');
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!task?.id,
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
      // Parse time from DB format (HH:MM:SS or HH:MM) to input format (HH:MM)
      setAlarmStartTime(task.alarm_start_time?.slice(0, 5) || "09:00");
      setAlarmEndTime(task.alarm_end_time?.slice(0, 5) || "21:00");
      setNotifyOnlyWorking(task.notify_only_working ?? true);
      setPushEnabled(task.push_enabled ?? true);
      setShowOnPunchClock(task.show_on_punch_clock ?? false);
      setShowOnDashboard(task.show_on_dashboard ?? true);
      setShareable(task.shareable ?? false);
      
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
      
      // Reset subtasks state - will be populated from query
      setSubtasks([]);
      setNewSubtask("");
      setNewSubtaskType("checkbox");
    }
  }, [open, task]);

  // Sync subtasks from query when loaded
  useEffect(() => {
    if (existingSubtasks.length > 0 && subtasks.length === 0) {
      setSubtasks(existingSubtasks.map((s: any) => ({
        id: s.id,
        title: s.title,
        item_type: s.item_type as "checkbox" | "photo",
      })));
    }
  }, [existingSubtasks]);

  const handleAddSubtask = () => {
    if (newSubtask.trim()) {
      setSubtasks([...subtasks, { 
        title: newSubtask.trim(), 
        item_type: newSubtaskType,
        isNew: true 
      }]);
      setNewSubtask("");
    }
  };

  const handleRemoveSubtask = (index: number) => {
    const subtask = subtasks[index];
    if (subtask.id) {
      // Mark existing subtask for deletion
      setSubtasks(subtasks.map((s, i) => i === index ? { ...s, toDelete: true } : s));
    } else {
      // Remove new subtask entirely
      setSubtasks(subtasks.filter((_, i) => i !== index));
    }
  };

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
    
    if (taskStyle !== "team") {
      if (assignmentType === "employees" && selectedEmployees.length === 0) {
        toast.error("Please select at least one employee");
        return;
      }
      
      if (assignmentType === "roles" && selectedRoles.length === 0) {
        toast.error("Please select at least one role");
        return;
      }
    }

    if (taskStyle === "alarm" || taskStyle === "team") {
      if (daysOfWeek.length === 0) {
        toast.error("Please select at least one day of the week");
        return;
      }
      if (taskStyle === "alarm" && frequencyType === "custom" && customTimes.length === 0) {
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
        push_enabled: pushEnabled,
        show_on_dashboard: showOnDashboard,
        shareable: subtasks.filter(s => !s.toDelete).length > 0 || subtasks.some(s => s.isNew && !s.toDelete) ? shareable : false,
      };

      if (taskStyle === "alarm") {
        taskData.days_of_week = daysOfWeek;
        taskData.frequency_type = frequencyType === "custom" ? "custom" : "interval";
        taskData.frequency_minutes = frequencyType !== "custom" ? parseInt(frequencyType) : null;
        taskData.custom_times = frequencyType === "custom" ? customTimes : null;
        taskData.alarm_start_time = alarmStartTime;
        taskData.alarm_end_time = alarmEndTime;
        taskData.notify_only_working = notifyOnlyWorking;
        taskData.show_on_punch_clock = showOnPunchClock;
      } else if (taskStyle === "team") {
        taskData.days_of_week = daysOfWeek;
      }

      // Update the task
      const { error: taskError } = await supabase
        .from('temporary_tasks')
        .update(taskData)
        .eq('id', task.id);

      if (taskError) throw taskError;

      // Delete existing assignments and create new ones (skip for team tasks)
      if (taskStyle !== "team") {
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
      }

      // Handle subtasks
      // Delete subtasks marked for deletion
      const subtasksToDelete = subtasks.filter(s => s.toDelete && s.id);
      if (subtasksToDelete.length > 0) {
        await supabase
          .from('temporary_task_subtasks')
          .delete()
          .in('id', subtasksToDelete.map(s => s.id!));
      }

      // Add new subtasks
      const newSubtasks = subtasks.filter(s => s.isNew && !s.toDelete);
      if (newSubtasks.length > 0) {
        const existingCount = subtasks.filter(s => !s.isNew && !s.toDelete).length;
        const subtaskRecords = newSubtasks.map((subtask, index) => ({
          task_id: task.id,
          title: subtask.title,
          item_type: subtask.item_type,
          order_index: existingCount + index,
        }));

        const { error: subtaskError } = await supabase
          .from('temporary_task_subtasks')
          .insert(subtaskRecords);

        if (subtaskError) throw subtaskError;
      }

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
            ) : taskStyle === "team" ? (
              <Users className="h-5 w-5" />
            ) : (
              <ClipboardList className="h-5 w-5" />
            )}
            Edit {taskStyle === "alarm" ? "Alarm" : taskStyle === "team" ? "Team" : "Standard"} Task
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
            <AccentColorPicker value={accentColor} onChange={setAccentColor} />
          </div>

          {/* Push Notification Toggle - for all task types */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <div className="space-y-0.5">
                <Label>Push notifications</Label>
                <p className="text-xs text-muted-foreground">
                  {taskStyle === "alarm" 
                    ? "Send push notification at each reminder time"
                    : "Send push notification when task is created"
                  }
                </p>
              </div>
            </div>
            <Switch
              checked={pushEnabled}
              onCheckedChange={setPushEnabled}
            />
          </div>

          {/* Show on Dashboard Toggle - for standard tasks only */}
          {taskStyle === "standard" && (
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Show on Dashboard</Label>
                <p className="text-xs text-muted-foreground">
                  Display task card on employee dashboard
                </p>
              </div>
              <Switch
                checked={showOnDashboard}
                onCheckedChange={setShowOnDashboard}
              />
            </div>
          )}

          {/* Team Task: Active Days */}
          {taskStyle === "team" && (
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
          )}

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
                      {customTimes.map(time => {
                        // Convert 24h to 12h format for display
                        const [h, m] = time.split(':').map(Number);
                        const period = h >= 12 ? 'PM' : 'AM';
                        const h12 = h % 12 || 12;
                        const display = `${h12}:${m.toString().padStart(2, '0')} ${period}`;
                        return (
                        <Badge key={time} variant="secondary" className="gap-1">
                          {display}
                          <X 
                            className="h-3 w-3 cursor-pointer" 
                            onClick={() => handleRemoveCustomTime(time)}
                          />
                        </Badge>
                      );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Active Hours (Time Window) */}
              <div className="space-y-2">
                <Label>Active Hours</Label>
                <p className="text-xs text-muted-foreground">
                  Alarm will only trigger between these times
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={alarmStartTime}
                    onChange={(e) => setAlarmStartTime(e.target.value)}
                    className="flex-1"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={alarmEndTime}
                    onChange={(e) => setAlarmEndTime(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>

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

              {/* Show on Dashboard Toggle */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Show on Dashboard</Label>
                  <p className="text-xs text-muted-foreground">
                    Display task card on employee dashboard
                  </p>
                </div>
                <Switch
                  checked={showOnDashboard}
                  onCheckedChange={setShowOnDashboard}
                />
              </div>
            </>
          )}

          {/* Assignment - hidden for team tasks */}
          {taskStyle !== "team" && (
            <>
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
            </>
          )}

          {/* Subtasks */}
          <div className="space-y-2">
            <Label>Subtasks</Label>
            <div className="flex gap-2">
              <Input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="Add a subtask"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSubtask())}
              />
              <Select value={newSubtaskType} onValueChange={(v) => setNewSubtaskType(v as "checkbox" | "photo")}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checkbox">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="h-3.5 w-3.5" />
                      Check
                    </div>
                  </SelectItem>
                  <SelectItem value="photo">
                    <div className="flex items-center gap-2">
                      <Camera className="h-3.5 w-3.5" />
                      Photo
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button 
                type="button" 
                size="icon" 
                variant="outline"
                onClick={handleAddSubtask}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {subtasks.filter(s => !s.toDelete).length > 0 && (
              <div className="border rounded-lg p-3 space-y-2">
                {subtasks.map((subtask, index) => {
                  if (subtask.toDelete) return null;
                  return (
                    <div key={subtask.id || `new-${index}`} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {subtask.item_type === "photo" ? (
                          <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <span className="text-sm">{subtask.title}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          {subtask.item_type === "photo" ? "Photo" : "Check"}
                        </Badge>
                        {subtask.isNew && (
                          <Badge variant="secondary" className="text-[10px] px-1.5">
                            New
                          </Badge>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => handleRemoveSubtask(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Shareable Toggle - only when subtasks exist */}
          {subtasks.filter(s => !s.toDelete).length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-muted-foreground" />
                <div className="space-y-0.5">
                  <Label>Allow sharing to chat</Label>
                  <p className="text-xs text-muted-foreground">
                    Show send button on the task card
                  </p>
                </div>
              </div>
              <Switch
                checked={shareable}
                onCheckedChange={setShareable}
              />
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