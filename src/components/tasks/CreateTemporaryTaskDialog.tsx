import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

interface CreateTemporaryTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
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

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "general_manager", label: "General Manager" },
  { value: "shift_manager", label: "Shift Manager" },
  { value: "team_member", label: "Team Member" },
];

export function CreateTemporaryTaskDialog({ open, onOpenChange, onSuccess }: CreateTemporaryTaskDialogProps) {
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("none");
  const [accentColor, setAccentColor] = useState("#8B5CF6");
  const [assignmentType, setAssignmentType] = useState<"employees" | "roles">("employees");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
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
    setDuration("none");
    setAccentColor("#8B5CF6");
    setAssignmentType("employees");
    setSelectedEmployees([]);
    setSelectedRoles([]);
    setSubtasks([]);
    setNewSubtask("");
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  const handleAddSubtask = () => {
    if (newSubtask.trim()) {
      setSubtasks([...subtasks, newSubtask.trim()]);
      setNewSubtask("");
    }
  };

  const handleRemoveSubtask = (index: number) => {
    setSubtasks(subtasks.filter((_, i) => i !== index));
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

    setIsSubmitting(true);
    
    try {
      // Calculate expiry time
      const durationOption = DURATION_OPTIONS.find(d => d.value === duration);
      let expiresAt = null;
      if (durationOption?.hours) {
        expiresAt = new Date(Date.now() + durationOption.hours * 60 * 60 * 1000).toISOString();
      }

      // Create the task
      const { data: task, error: taskError } = await supabase
        .from('temporary_tasks')
        .insert({
          location_id: currentLocation!.id,
          title: title.trim(),
          description: description.trim() || null,
          accent_color: accentColor,
          created_by: user!.id,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (taskError) throw taskError;

      // Create assignments
      const assignments = assignmentType === "employees"
        ? selectedEmployees.map(userId => ({ task_id: task.id, user_id: userId, role: null }))
        : selectedRoles.map(role => ({ task_id: task.id, user_id: null, role }));

      const { error: assignmentError } = await supabase
        .from('temporary_task_assignments')
        .insert(assignments);

      if (assignmentError) throw assignmentError;

      // Create subtasks
      if (subtasks.length > 0) {
        const subtaskRecords = subtasks.map((title, index) => ({
          task_id: task.id,
          title,
          order_index: index,
        }));

        const { error: subtaskError } = await supabase
          .from('temporary_task_subtasks')
          .insert(subtaskRecords);

        if (subtaskError) throw subtaskError;
      }

      toast.success("Temporary task created");
      onSuccess();
      onOpenChange(false);
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
          <DialogTitle>Create Temporary Task</DialogTitle>
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

          {/* Duration & Color Row */}
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
          </div>

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
                  employees.map((emp: any) => (
                    <div key={emp.id} className="flex items-center gap-2">
                      <Checkbox
                        id={emp.id}
                        checked={selectedEmployees.includes(emp.id)}
                        onCheckedChange={() => toggleEmployee(emp.id)}
                      />
                      <label htmlFor={emp.id} className="text-sm cursor-pointer">
                        {emp.full_name || emp.email}
                      </label>
                    </div>
                  ))
                )}
              </div>
              {selectedEmployees.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedEmployees.map(id => {
                    const emp = employees.find((e: any) => e.id === id);
                    return emp ? (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {emp.full_name?.split(' ')[0] || emp.email}
                        <X 
                          className="h-3 w-3 cursor-pointer" 
                          onClick={() => toggleEmployee(id)}
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
                      id={role.value}
                      checked={selectedRoles.includes(role.value)}
                      onCheckedChange={() => toggleRole(role.value)}
                    />
                    <label htmlFor={role.value} className="text-sm cursor-pointer">
                      {role.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subtasks */}
          <div className="space-y-2">
            <Label>Subtasks (Optional)</Label>
            <div className="flex gap-2">
              <Input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="Add a subtask"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSubtask())}
              />
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
                  <div key={index} className="flex items-center justify-between gap-2">
                    <span className="text-sm">{index + 1}. {subtask}</span>
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
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
