import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface SaveAsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: any;
}

export function SaveAsTemplateDialog({ open, onOpenChange, task }: SaveAsTemplateDialogProps) {
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter a template name");
      return;
    }

    if (!task || !currentLocation?.id || !user?.id) {
      toast.error("Missing required data");
      return;
    }

    setIsSubmitting(true);

    try {
      // Build subtasks array from task subtasks
      const subtasks = (task.subtasks || [])
        .filter((s: any) => !s.completed_at)
        .map((s: any) => ({
          title: s.title,
          item_type: s.item_type || 'checkbox',
        }));

      // Extract roles from assignments
      const defaultRoles = (task.assignments || [])
        .filter((a: any) => a.role)
        .map((a: any) => a.role);

      const templateData = {
        location_id: currentLocation.id,
        created_by: user.id,
        name: name.trim(),
        description: description.trim() || task.description || null,
        
        // Core settings
        task_style: task.task_style || 'standard',
        accent_color: task.accent_color || '#8B5CF6',
        
        // Standard task
        default_duration: 'none',
        
        // Alarm task
        days_of_week: task.days_of_week || null,
        frequency_type: task.frequency_type || null,
        frequency_minutes: task.frequency_minutes || null,
        custom_times: task.custom_times || null,
        alarm_start_time: task.alarm_start_time || null,
        alarm_end_time: task.alarm_end_time || null,
        notify_only_working: task.notify_only_working ?? true,
        push_enabled: task.push_enabled ?? true,
        show_on_punch_clock: task.show_on_punch_clock ?? false,
        show_on_dashboard: task.show_on_dashboard ?? true,
        
        // QR task
        is_qr_triggered: task.is_qr_triggered || false,
        qr_issue_options: task.qr_issue_options || null,
        qr_allow_notes: task.qr_allow_notes ?? true,
        qr_notify_punch_clock: task.qr_notify_punch_clock ?? true,
        
        // Assignment
        assignment_type: defaultRoles.length > 0 ? 'roles' : 'employees',
        default_roles: defaultRoles.length > 0 ? defaultRoles : null,
        
        // Subtasks
        subtasks: subtasks.length > 0 ? subtasks : [],
      };

      const { error } = await supabase
        .from('quick_task_templates')
        .insert(templateData);

      if (error) throw error;

      toast.success("Template saved");
      queryClient.invalidateQueries({ queryKey: ['quick-task-templates'] });
      onOpenChange(false);
      setName("");
      setDescription("");
    } catch (error: any) {
      console.error("Error saving template:", error);
      toast.error("Failed to save template");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Save as Template
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Template Name *</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={task?.title ? `${task.title} Template` : "Enter template name"}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Description</Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this template"
              rows={2}
            />
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">What will be saved:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Task style ({task?.task_style === 'alarm' ? 'Alarm' : task?.is_qr_triggered ? 'QR' : 'Standard'})</li>
              <li>Color and display settings</li>
              {task?.subtasks?.length > 0 && (
                <li>{task.subtasks.filter((s: any) => !s.completed_at).length} subtasks</li>
              )}
              {task?.task_style === 'alarm' && <li>Schedule and frequency settings</li>}
              {task?.is_qr_triggered && <li>QR issue options</li>}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {isSubmitting ? "Saving..." : "Save Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
