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
import { Plus, X, Trash2, Camera, CheckSquare, AlarmClock, ClipboardList, QrCode, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AccentColorPicker } from "./AccentColorPicker";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface EditTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: any;
}

interface Subtask {
  title: string;
  item_type: "checkbox" | "photo";
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

export function EditTemplateDialog({ open, onOpenChange, template }: EditTemplateDialogProps) {
  const queryClient = useQueryClient();
  
  // Basic fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState("#8B5CF6");
  
  // Task style
  const [taskStyle, setTaskStyle] = useState<"standard" | "alarm" | "qr">("standard");
  
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
  
  // QR task fields
  const [qrIssueOptions, setQrIssueOptions] = useState<string[]>([]);
  const [newQrIssue, setNewQrIssue] = useState("");
  const [qrAllowNotes, setQrAllowNotes] = useState(true);
  const [qrNotifyPunchClock, setQrNotifyPunchClock] = useState(true);
  
  // Assignment
  const [assignmentType, setAssignmentType] = useState<"employees" | "roles">("roles");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  
  // Subtasks
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [newSubtaskType, setNewSubtaskType] = useState<"checkbox" | "photo">("checkbox");
  
  const [isSaving, setIsSaving] = useState(false);

  // Load template data
  useEffect(() => {
    if (template) {
      setName(template.name || "");
      setDescription(template.description || "");
      setAccentColor(template.accent_color || "#8B5CF6");
      
      // Task style
      if (template.is_qr_triggered) {
        setTaskStyle("qr");
      } else if (template.task_style === "alarm") {
        setTaskStyle("alarm");
      } else {
        setTaskStyle("standard");
      }
      
      // Alarm settings
      if (template.days_of_week) setDaysOfWeek(template.days_of_week);
      if (template.frequency_type === "custom") {
        setFrequencyType("custom");
      } else if (template.frequency_minutes) {
        setFrequencyType(template.frequency_minutes.toString());
      }
      if (template.custom_times) setCustomTimes(template.custom_times);
      if (template.alarm_start_time) setAlarmStartTime(template.alarm_start_time.slice(0, 5));
      if (template.alarm_end_time) setAlarmEndTime(template.alarm_end_time.slice(0, 5));
      setNotifyOnlyWorking(template.notify_only_working ?? true);
      setPushEnabled(template.push_enabled ?? true);
      setShowOnPunchClock(template.show_on_punch_clock ?? false);
      setShowOnDashboard(template.show_on_dashboard ?? true);
      
      // QR settings
      if (template.qr_issue_options) setQrIssueOptions(template.qr_issue_options);
      setQrAllowNotes(template.qr_allow_notes ?? true);
      setQrNotifyPunchClock(template.qr_notify_punch_clock ?? true);
      
      // Assignment
      if (template.default_roles?.length > 0) {
        setAssignmentType("roles");
        setSelectedRoles(template.default_roles);
      } else {
        setAssignmentType("employees");
        setSelectedRoles([]);
      }
      
      // Subtasks
      if (template.subtasks && Array.isArray(template.subtasks)) {
        setSubtasks(template.subtasks.map((s: any) => ({
          title: s.title,
          item_type: s.item_type || "checkbox",
        })));
      } else {
        setSubtasks([]);
      }
    }
  }, [template]);

  const handleAddSubtask = () => {
    if (newSubtask.trim()) {
      setSubtasks([...subtasks, { title: newSubtask.trim(), item_type: newSubtaskType }]);
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

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const handleSave = async () => {
    if (!template?.id || !name.trim()) {
      toast.error("Please enter a template name");
      return;
    }

    setIsSaving(true);
    try {
      const updateData: any = {
        name: name.trim(),
        description: description.trim() || null,
        accent_color: accentColor,
        task_style: taskStyle === "qr" ? "standard" : taskStyle,
        is_qr_triggered: taskStyle === "qr",
        show_on_dashboard: taskStyle === "qr" ? false : showOnDashboard,
        
        // Alarm settings
        days_of_week: taskStyle === "alarm" ? daysOfWeek : null,
        frequency_type: taskStyle === "alarm" ? (frequencyType === "custom" ? "custom" : "interval") : null,
        frequency_minutes: taskStyle === "alarm" && frequencyType !== "custom" ? parseInt(frequencyType) : null,
        custom_times: taskStyle === "alarm" && frequencyType === "custom" ? customTimes : null,
        alarm_start_time: taskStyle === "alarm" ? alarmStartTime : null,
        alarm_end_time: taskStyle === "alarm" ? alarmEndTime : null,
        notify_only_working: taskStyle === "alarm" ? notifyOnlyWorking : true,
        push_enabled: taskStyle === "alarm" ? pushEnabled : true,
        show_on_punch_clock: taskStyle === "alarm" ? showOnPunchClock : false,
        
        // QR settings
        qr_issue_options: taskStyle === "qr" ? qrIssueOptions : null,
        qr_allow_notes: taskStyle === "qr" ? qrAllowNotes : true,
        qr_notify_punch_clock: taskStyle === "qr" ? qrNotifyPunchClock : true,
        
        // Assignment
        assignment_type: assignmentType,
        default_roles: assignmentType === "roles" && selectedRoles.length > 0 ? selectedRoles : null,
        
        // Subtasks
        subtasks: taskStyle !== "qr" && subtasks.length > 0 ? subtasks : [],
      };

      const { error } = await supabase
        .from('quick_task_templates')
        .update(updateData)
        .eq('id', template.id);

      if (error) throw error;

      toast.success("Template updated");
      queryClient.invalidateQueries({ queryKey: ['quick-task-templates'] });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating template:", error);
      toast.error("Failed to update template");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Edit Template
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0 w-full">
          {/* Name & Description */}
          <div className="space-y-2">
            <Label htmlFor="name">Template Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter template name"
            />
          </div>

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

          {/* Task Style */}
          <div className="space-y-2">
            <Label>Task Style</Label>
            <div className="flex gap-2 w-full">
              <Button
                type="button"
                variant={taskStyle === "standard" ? "default" : "outline"}
                size="sm"
                className="gap-2 flex-1"
                onClick={() => setTaskStyle("standard")}
              >
                <ClipboardList className="h-4 w-4" />
                Standard
              </Button>
              <Button
                type="button"
                variant={taskStyle === "alarm" ? "default" : "outline"}
                size="sm"
                className="gap-2 flex-1"
                onClick={() => setTaskStyle("alarm")}
              >
                <AlarmClock className="h-4 w-4" />
                Alarm
              </Button>
              <Button
                type="button"
                variant={taskStyle === "qr" ? "default" : "outline"}
                size="sm"
                className="gap-2 flex-1"
                onClick={() => setTaskStyle("qr")}
              >
                <QrCode className="h-4 w-4" />
                QR
              </Button>
            </div>
          </div>

          {/* Accent Color */}
          <div className="space-y-2">
            <Label>Color</Label>
            <AccentColorPicker value={accentColor} onChange={setAccentColor} />
          </div>

          {/* Alarm Task Settings */}
          {taskStyle === "alarm" && (
            <>
              <div className="space-y-2">
                <Label>Active Days</Label>
                <div className="flex gap-1 flex-wrap">
                  {DAYS_OF_WEEK.map(day => (
                    <Button
                      key={day.value}
                      type="button"
                      variant={daysOfWeek.includes(day.value) ? "default" : "outline"}
                      size="sm"
                      className="w-10 h-8"
                      onClick={() => toggleDayOfWeek(day.value)}
                    >
                      {day.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input
                    type="time"
                    value={alarmStartTime}
                    onChange={(e) => setAlarmStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Input
                    type="time"
                    value={alarmEndTime}
                    onChange={(e) => setAlarmEndTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={frequencyType} onValueChange={setFrequencyType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {frequencyType === "custom" && (
                <div className="space-y-2">
                  <Label>Custom Times</Label>
                  <div className="flex gap-2">
                    <Input
                      type="time"
                      value={newCustomTime}
                      onChange={(e) => setNewCustomTime(e.target.value)}
                    />
                    <Button type="button" size="icon" onClick={handleAddCustomTime}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {customTimes.map(time => {
                      // Convert 24h to 12h format for display
                      const [h, m] = time.split(':').map(Number);
                      const period = h >= 12 ? 'PM' : 'AM';
                      const h12 = h % 12 || 12;
                      const display = `${h12}:${m.toString().padStart(2, '0')} ${period}`;
                      return (
                      <Badge key={time} variant="secondary" className="gap-1">
                        {display}
                        <button onClick={() => handleRemoveCustomTime(time)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify-working" className="text-sm">Only notify clocked-in staff</Label>
                  <Switch id="notify-working" checked={notifyOnlyWorking} onCheckedChange={setNotifyOnlyWorking} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="push-enabled" className="text-sm">Send push notifications</Label>
                  <Switch id="push-enabled" checked={pushEnabled} onCheckedChange={setPushEnabled} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="show-punch" className="text-sm">Show on Punch Clock</Label>
                  <Switch id="show-punch" checked={showOnPunchClock} onCheckedChange={setShowOnPunchClock} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="show-dashboard" className="text-sm">Show on Dashboard</Label>
                  <Switch id="show-dashboard" checked={showOnDashboard} onCheckedChange={setShowOnDashboard} />
                </div>
              </div>
            </>
          )}

          {/* QR Task Settings */}
          {taskStyle === "qr" && (
            <>
              <div className="space-y-2">
                <Label>Issue Options *</Label>
                <div className="flex gap-2">
                  <Input
                    value={newQrIssue}
                    onChange={(e) => setNewQrIssue(e.target.value)}
                    placeholder="Add issue option..."
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddQrIssue())}
                  />
                  <Button type="button" size="icon" onClick={handleAddQrIssue}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {qrIssueOptions.map(issue => (
                    <Badge key={issue} variant="secondary" className="gap-1">
                      {issue}
                      <button onClick={() => handleRemoveQrIssue(issue)}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="qr-notes" className="text-sm">Allow notes</Label>
                  <Switch id="qr-notes" checked={qrAllowNotes} onCheckedChange={setQrAllowNotes} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="qr-notify" className="text-sm">Notify on Punch Clock</Label>
                  <Switch id="qr-notify" checked={qrNotifyPunchClock} onCheckedChange={setQrNotifyPunchClock} />
                </div>
              </div>
            </>
          )}

          {/* Role Assignment (for non-QR tasks) */}
          {taskStyle !== "qr" && (
            <div className="space-y-2">
              <Label>Default Roles</Label>
              <p className="text-xs text-muted-foreground">Roles to assign when creating tasks from this template</p>
              <div className="flex gap-x-3 gap-y-1.5 flex-wrap">
                {ROLE_OPTIONS.map(role => (
                  <div key={role.value} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`role-${role.value}`}
                      checked={selectedRoles.includes(role.value)}
                      onCheckedChange={() => toggleRole(role.value)}
                    />
                    <Label htmlFor={`role-${role.value}`} className="text-xs font-normal cursor-pointer">
                      {role.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subtasks (for non-QR tasks) */}
          {taskStyle !== "qr" && (
            <div className="space-y-2">
              <Label>Subtasks</Label>
              <div className="flex gap-1.5">
                <Input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  placeholder="Add subtask..."
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSubtask())}
                  className="flex-1 min-w-0"
                />
                <Select value={newSubtaskType} onValueChange={(v: "checkbox" | "photo") => setNewSubtaskType(v)}>
                  <SelectTrigger className="w-20 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checkbox">
                      <div className="flex items-center gap-1">
                        <CheckSquare className="h-3.5 w-3.5" />
                        Check
                      </div>
                    </SelectItem>
                    <SelectItem value="photo">
                      <div className="flex items-center gap-1">
                        <Camera className="h-3.5 w-3.5" />
                        Photo
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" size="icon" className="shrink-0" onClick={handleAddSubtask}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {subtasks.length > 0 && (
                <div className="border rounded-lg divide-y">
                  {subtasks.map((subtask, index) => (
                    <div key={index} className="flex items-center justify-between p-2 gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {subtask.item_type === "photo" ? (
                          <Camera className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <CheckSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm truncate">{subtask.title}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleRemoveSubtask(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Saving..." : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
