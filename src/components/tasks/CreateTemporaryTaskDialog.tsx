import { useState, useEffect } from "react";
import { ROLE_OPTIONS as ROLE_OPTIONS_ALL } from '@/hooks/useUserRole';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, X, Trash2, Camera, CheckSquare, AlarmClock, ClipboardList, Bell, QrCode, Send, Users } from "lucide-react";
import { AccentColorPicker } from "./AccentColorPicker";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRTaskCodeDialog } from "./QRTaskCodeDialog";
import { AssigneePicker } from "@/components/shared/AssigneePicker";

interface CreateTemporaryTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialTemplate?: any;
}

interface Subtask {
  title: string;
  item_type: "checkbox" | "photo";
  days_of_week?: number[];
  quantity?: number;
}

const DURATION_OPTIONS = [
  { value: "1h", label: "1 Hour", hours: 1 },
  { value: "3h", label: "3 Hours", hours: 3 },
  { value: "1d", label: "1 Day", hours: 24 },
  { value: "3d", label: "3 Days", hours: 72 },
  { value: "1w", label: "1 Week", hours: 168 },
  { value: "1m", label: "1 Month", hours: 720 },
  { value: "none", label: "Until Complete", hours: null },
];

const ACCENT_COLORS = [
  { value: "#8B5CF6", label: "Purple" },
  { value: "#10B981", label: "Green" },
  { value: "#F59E0B", label: "Orange" },
  { value: "#EF4444", label: "Red" },
  { value: "#3B82F6", label: "Blue" },
  { value: "#EC4899", label: "Pink" },
  { value: "#14B8A6", label: "Teal" },
];

const ROLE_OPTIONS = ROLE_OPTIONS_ALL;

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

export function CreateTemporaryTaskDialog({ open, onOpenChange, onSuccess, initialTemplate }: CreateTemporaryTaskDialogProps) {
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  
  // Basic fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState("#8B5CF6");
  
  // Task style
  const [taskStyle, setTaskStyle] = useState<"standard" | "alarm" | "qr" | "team">("standard");
  
  // Standard task fields
  const [duration, setDuration] = useState("none");
  
  // Alarm task fields
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri default
  const [frequencyType, setFrequencyType] = useState("60");
  const [customTimes, setCustomTimes] = useState<string[]>([]);
  const [newCustomTime, setNewCustomTime] = useState("");
  const [alarmStartTime, setAlarmStartTime] = useState("09:00");
  const [alarmEndTime, setAlarmEndTime] = useState("21:00");
  const [notifyOnlyWorking, setNotifyOnlyWorking] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [showOnPunchClock, setShowOnPunchClock] = useState(false);
  const [showOnDashboard, setShowOnDashboard] = useState(true);
  
  // QR task fields
  const [qrIssueOptions, setQrIssueOptions] = useState<string[]>([]);
  const [newQrIssue, setNewQrIssue] = useState("");
  const [qrAllowNotes, setQrAllowNotes] = useState(true);
  const [qrNotifyPunchClock, setQrNotifyPunchClock] = useState(true);
  
  // QR code dialog state
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [createdQrCode, setCreatedQrCode] = useState<string | null>(null);
  // Assignment — roles auto-include their users; extras are added individually
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

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setAccentColor("#8B5CF6");
    setTaskStyle("standard");
    setDuration("none");
    setDaysOfWeek([1, 2, 3, 4, 5]);
    setFrequencyType("60");
    setCustomTimes([]);
    setNewCustomTime("");
    setNotifyOnlyWorking(true);
    setPushEnabled(true);
    setShowOnPunchClock(false);
    setShowOnDashboard(true);
    setQrIssueOptions([]);
    setNewQrIssue("");
    setQrAllowNotes(true);
    setQrNotifyPunchClock(true);
    setShowQrDialog(false);
    setCreatedQrCode(null);
    // (unified assignment picker — no separate mode)
    setSelectedEmployees([]);
    setSelectedRoles([]);
    setSubtasks([]);
    setNewSubtask("");
    setNewSubtaskType("checkbox");
    setShareable(false);
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  // Apply template when provided
  useEffect(() => {
    if (open && initialTemplate) {
      setTitle(initialTemplate.name ? `${initialTemplate.name}` : "");
      setDescription(initialTemplate.description || "");
      setAccentColor(initialTemplate.accent_color || "#8B5CF6");
      
      // Determine task style
      if (initialTemplate.is_qr_triggered) {
        setTaskStyle("qr");
      } else if (initialTemplate.task_style === "alarm") {
        setTaskStyle("alarm");
      } else if (initialTemplate.task_style === "team") {
        setTaskStyle("team");
      } else {
        setTaskStyle("standard");
      }
      
      // Standard task
      setDuration(initialTemplate.default_duration || "none");
      
      // Alarm task
      if (initialTemplate.days_of_week) setDaysOfWeek(initialTemplate.days_of_week);
      if (initialTemplate.frequency_type === "custom") {
        setFrequencyType("custom");
      } else if (initialTemplate.frequency_minutes) {
        setFrequencyType(initialTemplate.frequency_minutes.toString());
      }
      if (initialTemplate.custom_times) setCustomTimes(initialTemplate.custom_times);
      if (initialTemplate.alarm_start_time) setAlarmStartTime(initialTemplate.alarm_start_time.slice(0, 5));
      if (initialTemplate.alarm_end_time) setAlarmEndTime(initialTemplate.alarm_end_time.slice(0, 5));
      setNotifyOnlyWorking(initialTemplate.notify_only_working ?? true);
      setPushEnabled(initialTemplate.push_enabled ?? true);
      setShowOnPunchClock(initialTemplate.show_on_punch_clock ?? false);
      setShowOnDashboard(initialTemplate.show_on_dashboard ?? true);
      
      // QR task
      if (initialTemplate.qr_issue_options) setQrIssueOptions(initialTemplate.qr_issue_options);
      setQrAllowNotes(initialTemplate.qr_allow_notes ?? true);
      setQrNotifyPunchClock(initialTemplate.qr_notify_punch_clock ?? true);
      
      // Assignment (roles default from template)
      if (initialTemplate.default_roles?.length > 0) {
        setSelectedRoles(initialTemplate.default_roles);
      }
      
      // Subtasks
      if (initialTemplate.subtasks && Array.isArray(initialTemplate.subtasks)) {
        setSubtasks(initialTemplate.subtasks.map((s: any) => ({
          title: s.title,
          item_type: s.item_type || "checkbox",
        })));
      }
    }
  }, [open, initialTemplate]);

  const handleAddSubtask = () => {
    if (newSubtask.trim()) {
      setSubtasks([...subtasks, { 
        title: newSubtask.trim(), 
        item_type: newSubtaskType,
        
      }]);
      setNewSubtask("");
    }
  };

  const handleRemoveSubtask = (index: number) => {
    setSubtasks(subtasks.filter((_, i) => i !== index));
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

  const handleAddQrIssue = () => {
    if (newQrIssue.trim() && !qrIssueOptions.includes(newQrIssue.trim())) {
      setQrIssueOptions([...qrIssueOptions, newQrIssue.trim()]);
      setNewQrIssue("");
    }
  };

  const handleRemoveQrIssue = (issue: string) => {
    setQrIssueOptions(qrIssueOptions.filter(i => i !== issue));
  };

  // Generate a unique QR code
  const generateQrCode = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Please enter a task title");
      return;
    }
    
    // QR and Team tasks don't need employee/role assignments
    if (taskStyle !== "qr" && taskStyle !== "team") {
      if (selectedEmployees.length === 0 && selectedRoles.length === 0) {
        toast.error("Please assign at least one role or employee");
        return;
      }
    }

    if (taskStyle === "team") {
      if (daysOfWeek.length === 0) {
        toast.error("Please select at least one day of the week");
        return;
      }
      if (subtasks.length === 0) {
        toast.error("Team tasks require at least one subtask");
        return;
      }
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

    if (taskStyle === "qr") {
      if (qrIssueOptions.length === 0) {
        toast.error("Please add at least one issue option");
        return;
      }
    }

    setIsSubmitting(true);
    
    try {
      // Calculate expiry time (only for standard tasks)
      let expiresAt = null;
      if (taskStyle === "standard") {
        const durationOption = DURATION_OPTIONS.find(d => d.value === duration);
        if (durationOption?.hours) {
          expiresAt = new Date(Date.now() + durationOption.hours * 60 * 60 * 1000).toISOString();
        }
      }

      // Prepare task data
      const taskData: any = {
        location_id: currentLocation!.id,
        title: title.trim(),
        description: description.trim() || null,
        accent_color: accentColor,
        created_by: user!.id,
        task_style: taskStyle === "qr" ? "standard" : taskStyle, // QR uses standard style in DB
        is_recurring: taskStyle === "alarm" || taskStyle === "team",
        show_on_dashboard: taskStyle === "qr" ? false : taskStyle === "team" ? false : showOnDashboard,
        show_on_punch_clock: taskStyle === "team" ? true : (taskStyle === "alarm" ? showOnPunchClock : false),
        shareable: taskStyle !== "qr" && taskStyle !== "team" && subtasks.length > 0 ? shareable : false,
      };

      if (taskStyle === "standard") {
        taskData.expires_at = expiresAt;
      } else if (taskStyle === "alarm") {
        // Alarm task fields
        taskData.days_of_week = daysOfWeek;
        taskData.frequency_type = frequencyType === "custom" ? "custom" : "interval";
        taskData.frequency_minutes = frequencyType !== "custom" ? parseInt(frequencyType) : null;
        taskData.custom_times = frequencyType === "custom" ? customTimes : null;
        taskData.alarm_start_time = alarmStartTime;
        taskData.alarm_end_time = alarmEndTime;
        taskData.notify_only_working = notifyOnlyWorking;
        taskData.push_enabled = pushEnabled;
      } else if (taskStyle === "team") {
        // Team task fields
        taskData.days_of_week = daysOfWeek;
        taskData.is_active = true;
      } else if (taskStyle === "qr") {
        // QR task fields
        taskData.is_qr_triggered = true;
        taskData.qr_code = generateQrCode();
        taskData.qr_issue_options = qrIssueOptions;
        taskData.qr_allow_notes = qrAllowNotes;
        taskData.qr_notify_punch_clock = qrNotifyPunchClock;
      }

      // Create the task
      const { data: task, error: taskError } = await supabase
        .from('temporary_tasks')
        .insert(taskData)
        .select()
        .single();

      if (taskError) throw taskError;

      // Create assignments (skip for QR and Team tasks). Roles + individual employees can both be set.
      if (taskStyle !== "qr" && taskStyle !== "team") {
        const assignments: any[] = [
          ...selectedRoles.map(role => ({ task_id: task.id, user_id: null, role })),
          ...selectedEmployees.map(userId => ({ task_id: task.id, user_id: userId, role: null })),
        ];

        if (assignments.length > 0) {
          const { error: assignmentError } = await supabase
            .from('temporary_task_assignments')
            .insert(assignments);
          if (assignmentError) throw assignmentError;
        }
      }

      // Create subtasks (skip for QR tasks)
      if (taskStyle !== "qr" && subtasks.length > 0) {
        const subtaskRecords = subtasks.map((subtask, index) => ({
          task_id: task.id,
          title: subtask.title,
          item_type: subtask.item_type,
          order_index: index,
          
          ...(subtask.quantity ? { quantity: subtask.quantity } : {}),
        }));

        const { error: subtaskError } = await supabase
          .from('temporary_task_subtasks')
          .insert(subtaskRecords);

        if (subtaskError) throw subtaskError;
      }

      // Send push notification to assigned users for standard/team tasks
      if (taskStyle !== "qr" && taskStyle !== "alarm") {
        try {
          const pushBody: any = {
            title: '📋 New Task Assigned',
            body: title.trim(),
            notification_type: 'task_assigned',
            data: { type: 'task_assigned', task_id: task.id },
          };

          if (selectedEmployees.length > 0) {
            pushBody.user_ids = selectedEmployees;
          }
          if (selectedRoles.length > 0) {
            pushBody.roles = selectedRoles;
            pushBody.location_id = currentLocation!.id;
          }

          if (pushBody.user_ids || pushBody.roles) {
            await supabase.functions.invoke('send-push-notification', { body: pushBody });
          }
        } catch (pushErr) {
          console.error('Push notification failed (non-blocking):', pushErr);
        }
      }

      // For QR tasks, show the QR code dialog
      if (taskStyle === "qr") {
        setCreatedQrCode(task.qr_code);
        setShowQrDialog(true);
        toast.success("QR Task created! Print or share the QR code.");
        onSuccess();
      } else {
        toast.success(taskStyle === "alarm" ? "Alarm task created" : "Quick task created");
        onSuccess();
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast.error("Failed to create task");
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
          <DialogTitle>Create Quick Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Task Style Toggle */}
          <div className="space-y-2">
            <Label>Task Style</Label>
            <div className="grid grid-cols-4 gap-1.5">
              <Button
                type="button"
                variant={taskStyle === "standard" ? "default" : "outline"}
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setTaskStyle("standard")}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Standard
              </Button>
              <Button
                type="button"
                variant={taskStyle === "alarm" ? "default" : "outline"}
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setTaskStyle("alarm")}
              >
                <AlarmClock className="h-3.5 w-3.5" />
                Alarm
              </Button>
              <Button
                type="button"
                variant={taskStyle === "team" ? "default" : "outline"}
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setTaskStyle("team")}
              >
                <Users className="h-3.5 w-3.5" />
                Team
              </Button>
              <Button
                type="button"
                variant={taskStyle === "qr" ? "default" : "outline"}
                size="sm"
                className="gap-1 text-xs"
                onClick={() => setTaskStyle("qr")}
              >
                <QrCode className="h-3.5 w-3.5" />
                QR
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {taskStyle === "standard" 
                ? "One-time task that stays until completed or expired"
                : taskStyle === "alarm"
                ? "Recurring task with scheduled reminders for clocked-in staff"
                : taskStyle === "team"
                ? "All-day task list available on Punch Clock for any team member"
                : "Guest-scannable QR code that triggers alerts when issues are reported"
              }
            </p>
          </div>

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

          {/* Standard Task: Duration */}
          {taskStyle === "standard" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Visibility Duration</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Accent Color</Label>
                  <AccentColorPicker value={accentColor} onChange={setAccentColor} />
                </div>
              </div>

              {/* Show on Dashboard Toggle for Standard Tasks */}
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

          {/* Alarm Task: Days of Week */}
          {taskStyle === "alarm" && (
            <>
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

              {/* Accent Color for Alarm */}
              <div className="space-y-2">
                <Label>Accent Color</Label>
                <AccentColorPicker value={accentColor} onChange={setAccentColor} />
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

          {/* Team Task Settings */}
          {taskStyle === "team" && (
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
                <p className="text-xs text-muted-foreground">
                  Which days this task list is available
                </p>
              </div>

              {/* Accent Color */}
              <div className="space-y-2">
                <Label>Accent Color</Label>
                <AccentColorPicker value={accentColor} onChange={setAccentColor} />
              </div>
            </>
          )}

          {/* QR Task Settings */}
          {taskStyle === "qr" && (
            <>
              <div className="space-y-2">
                <Label>Issue Options *</Label>
                <p className="text-xs text-muted-foreground">Add options guests can select when reporting</p>
                <div className="flex gap-2">
                  <Input
                    value={newQrIssue}
                    onChange={(e) => setNewQrIssue(e.target.value)}
                    placeholder="e.g. Needs Cleaning"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddQrIssue())}
                  />
                  <Button type="button" size="icon" variant="outline" onClick={handleAddQrIssue}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {qrIssueOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {qrIssueOptions.map(issue => (
                      <Badge key={issue} variant="secondary" className="gap-1">
                        {issue}
                        <X className="h-3 w-3 cursor-pointer" onClick={() => handleRemoveQrIssue(issue)} />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Accent Color</Label>
                <AccentColorPicker value={accentColor} onChange={setAccentColor} />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Allow guest notes</Label>
                  <p className="text-xs text-muted-foreground">Let guests add optional details</p>
                </div>
                <Switch checked={qrAllowNotes} onCheckedChange={setQrAllowNotes} />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Show on Punch Clock</Label>
                  <p className="text-xs text-muted-foreground">Display alert overlay when reported</p>
                </div>
                <Switch checked={qrNotifyPunchClock} onCheckedChange={setQrNotifyPunchClock} />
              </div>
            </>
          )}
          {/* Assignment Section - Hidden for QR and Team tasks */}
          {taskStyle !== "qr" && taskStyle !== "team" && (
            <AssigneePicker
              locationId={currentLocation?.id}
              selectedRoles={selectedRoles}
              onRolesChange={setSelectedRoles}
              selectedUserIds={selectedEmployees}
              onUserIdsChange={setSelectedEmployees}
              label="Assign To"
              helperText="Pick a role to include everyone in it, then add specific people if needed."
              roleOptions={ROLE_OPTIONS}
            />
          )}

          {/* Subtasks - Hidden for QR tasks */}
          {taskStyle !== "qr" && (
            <div className="space-y-2">
              <Label>Subtasks {taskStyle === "team" ? "*" : "(Optional)"}</Label>
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
              {subtasks.length > 0 && (
                <div className="border rounded-lg p-3 space-y-2">
                  {subtasks.map((subtask, index) => (
                    <div key={index} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
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
                      
                    </div>
                  ))}
            </div>
          )}

          {/* Shareable Toggle - only when subtasks exist and not QR */}
          {subtasks.length > 0 && (
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
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : taskStyle === "alarm" ? "Create Alarm" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* QR Code Dialog - shown after creating a QR task */}
      {createdQrCode && (
        <QRTaskCodeDialog
          open={showQrDialog}
          onOpenChange={(open) => {
            setShowQrDialog(open);
            if (!open) {
              onOpenChange(false);
            }
          }}
          taskTitle={title}
          qrCode={createdQrCode}
          accentColor={accentColor}
        />
      )}
    </Dialog>
  );
}
