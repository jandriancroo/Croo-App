import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, User, Users, Trash2, Eye, Camera, Pencil, AlarmClock, QrCode, Copy, Save, FileText, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lightenHexTowardWhite } from "@/components/dashboard/TemporaryTaskCard";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateTemporaryTaskDialog } from "./CreateTemporaryTaskDialog";
import { EditTemporaryTaskDialog } from "./EditTemporaryTaskDialog";
import { QRTaskCodeDialog } from "./QRTaskCodeDialog";
import { QuickTaskTemplateLibrary } from "./QuickTaskTemplateLibrary";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog";
import { QuickTaskEmptyState } from "./QuickTaskEmptyState";
import { formatDistanceToNow, isPast, format } from "date-fns";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useRolePermissions } from "@/hooks/useRolePermissions";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  brand_admin: "Brand Admin",
  org_admin: "Org Admin",
  admin: "Admin",
  manager: "Manager",
  shift_manager: "Shift Manager",
  shift_manager_in_training: "Shift Manager in Training",
  team_member: "Team Member",
};

export function TemporaryTasksSection() {
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { canCreateTasks, role, isShiftManager } = useUserRole();
  const { hasPermission } = useRolePermissions();
  // Admins/managers always can; shift managers need the toggle enabled
  const effectiveCanCreateTasks = canCreateTasks || (role === 'shift_manager' && hasPermission('create_tasks'));
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [editTask, setEditTask] = useState<any>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [qrDialogTask, setQrDialogTask] = useState<any>(null);
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [saveAsTemplateTask, setSaveAsTemplateTask] = useState<any>(null);
  const [templateToApply, setTemplateToApply] = useState<any>(null);

  // Fetch temporary tasks
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['temporary-tasks', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { data, error } = await supabase
        .from('temporary_tasks')
        .select(`
          *,
          created_by_profile:profiles!temporary_tasks_created_by_fkey(full_name),
          assignments:temporary_task_assignments(
            id,
            user_id,
            role,
            user:profiles(full_name)
          ),
          subtasks:temporary_task_subtasks(id, title, item_type, response_image_url, completed_at, completed_by_profile:profiles(full_name))
        `)
        .eq('location_id', currentLocation.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Filter out expired tasks and system-generated tasks (audit fixes, catering, etc.)
      return (data || []).filter(task => {
        if (task.expires_at && isPast(new Date(task.expires_at))) return false;
        // Hide system-generated tasks (linked to audits or write-ups)
        if (task.audit_id || task.write_up_id) return false;
        return true;
      });
    },
    enabled: !!currentLocation?.id,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['temporary-tasks'] });
  };

  const handleDelete = async () => {
    if (!deleteTaskId) return;
    
    try {
      const { error } = await supabase
        .from('temporary_tasks')
        .delete()
        .eq('id', deleteTaskId);

      if (error) throw error;
      
      toast.success("Task deleted");
      handleRefresh();
    } catch (error) {
      console.error("Error deleting task:", error);
      toast.error("Failed to delete task");
    } finally {
      setDeleteTaskId(null);
    }
  };

  const handleDuplicate = async (task: any) => {
    if (!currentLocation?.id || !user?.id) return;

    try {
      // Create duplicate task
      const taskData: any = {
        location_id: currentLocation.id,
        title: `${task.title} (Copy)`,
        description: task.description,
        accent_color: task.accent_color,
        created_by: user.id,
        task_style: task.task_style || 'standard',
        is_recurring: task.is_recurring,
        show_on_dashboard: task.show_on_dashboard ?? true,
        days_of_week: task.days_of_week,
        frequency_type: task.frequency_type,
        frequency_minutes: task.frequency_minutes,
        custom_times: task.custom_times,
        alarm_start_time: task.alarm_start_time,
        alarm_end_time: task.alarm_end_time,
        notify_only_working: task.notify_only_working,
        push_enabled: task.push_enabled,
        show_on_punch_clock: task.show_on_punch_clock,
        is_qr_triggered: task.is_qr_triggered,
        qr_issue_options: task.qr_issue_options,
        qr_allow_notes: task.qr_allow_notes,
        qr_notify_punch_clock: task.qr_notify_punch_clock,
      };

      // Generate new QR code if QR task
      if (task.is_qr_triggered) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let newQrCode = '';
        for (let i = 0; i < 8; i++) {
          newQrCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        taskData.qr_code = newQrCode;
      }

      const { data: newTask, error: taskError } = await supabase
        .from('temporary_tasks')
        .insert(taskData)
        .select()
        .single();

      if (taskError) throw taskError;

      // Duplicate assignments
      if (task.assignments?.length > 0) {
        const assignments = task.assignments.map((a: any) => ({
          task_id: newTask.id,
          user_id: a.user_id,
          role: a.role,
        }));

        await supabase
          .from('temporary_task_assignments')
          .insert(assignments);
      }

      // Duplicate subtasks (without completion status)
      if (task.subtasks?.length > 0) {
        const subtasks = task.subtasks.map((s: any, index: number) => ({
          task_id: newTask.id,
          title: s.title,
          item_type: s.item_type,
          order_index: index,
        }));

        await supabase
          .from('temporary_task_subtasks')
          .insert(subtasks);
      }

      toast.success("Task duplicated");
      handleRefresh();
    } catch (error) {
      console.error("Error duplicating task:", error);
      toast.error("Failed to duplicate task");
    }
  };

  const handleSelectTemplate = (template: any) => {
    setTemplateToApply(template);
    setShowCreateDialog(true);
  };

  return (
    <>
      <div className="space-y-4">
        {/* Header with actions */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Quick Tasks</h3>
          {effectiveCanCreateTasks && (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setShowTemplateLibrary(true)}
                title="Template Library"
              >
                <FileText className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                onClick={() => setShowCreateDialog(true)}
                title="New Quick Task"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        
        {/* Content */}
          {isLoading ? (
            <p className="text-center text-muted-foreground py-4">Loading...</p>
          ) : tasks.length === 0 ? (
            <QuickTaskEmptyState onCreate={effectiveCanCreateTasks ? () => setShowCreateDialog(true) : undefined} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tasks.map((task: any) => {
                const completedSubtasks = task.subtasks?.filter((s: any) => s.completed_at).length || 0;
                const totalSubtasks = task.subtasks?.length || 0;
                const hasSubtasks = totalSubtasks > 0;
                const accent = task.accent_color || '#8B5CF6';
                const countColor = lightenHexTowardWhite(accent, 0.8);

                return (
                  <div
                    key={task.id}
                    className="group flex items-center gap-2 cursor-pointer transition-all hover:brightness-[1.06] active:brightness-95 active:scale-[0.995]"
                    style={{
                      backgroundColor: accent,
                      borderRadius: 12,
                      padding: "8px 10px",
                      boxShadow: `0 1px 2px ${accent}55, inset 0 1px 0 rgba(255,255,255,0.12)`,
                    }}
                    onClick={() => setSelectedTask(task)}
                  >
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        backgroundColor: "rgba(255,255,255,0.22)",
                      }}
                    >
                      {task.task_style === 'alarm' ? (
                        <AlarmClock style={{ width: 14, height: 14, color: '#fff' }} strokeWidth={2.25} />
                      ) : task.is_qr_triggered ? (
                        <QrCode style={{ width: 14, height: 14, color: '#fff' }} strokeWidth={2.25} />
                      ) : (
                        <ClipboardList style={{ width: 14, height: 14, color: '#fff' }} strokeWidth={2.25} />
                      )}
                    </div>
                    <span className="flex-1 min-w-0 truncate" style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>
                      {task.title}
                    </span>
                    {hasSubtasks && (
                      <span className="shrink-0 tabular-nums text-right" style={{ color: countColor, fontSize: 12, fontWeight: 500 }}>
                        {completedSubtasks}/{totalSubtasks}
                      </span>
                    )}
                    {effectiveCanCreateTasks && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="h-6 w-6 flex items-center justify-center rounded-md shrink-0 hover:bg-white/20 transition-colors"
                            style={{ color: '#fff' }}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Edit task"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditTask(task); }}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(task); }}>
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSaveAsTemplateTask(task); }}>
                            <Save className="h-4 w-4 mr-2" />
                            Save as Template
                          </DropdownMenuItem>
                          {task.is_qr_triggered && (
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setQrDialogTask(task); }}>
                              <QrCode className="h-4 w-4 mr-2" />
                              View QR Code
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); setDeleteTaskId(task.id); }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      <CreateTemporaryTaskDialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) setTemplateToApply(null);
        }}
        onSuccess={handleRefresh}
        initialTemplate={templateToApply}
      />

      <EditTemporaryTaskDialog
        open={!!editTask}
        onOpenChange={(open) => !open && setEditTask(null)}
        onSuccess={handleRefresh}
        task={editTask}
      />

      {/* View-only Task Details Dialog (no completion) */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: selectedTask?.accent_color || "#8B5CF6" }}
              />
              {selectedTask?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Description */}
            {selectedTask?.description && (
              <p className="text-sm text-muted-foreground">{selectedTask.description}</p>
            )}

            {/* Assignment Info */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Assigned to:</p>
              <div className="flex flex-wrap gap-2">
                {selectedTask?.assignments?.map((assignment: any) => (
                  <Badge key={assignment.id} variant="secondary" className="gap-1">
                    {assignment.user_id ? (
                      <>
                        <User className="h-3 w-3" />
                        {assignment.user?.full_name || "Unknown"}
                      </>
                    ) : (
                      <>
                        <Users className="h-3 w-3" />
                        {ROLE_LABELS[assignment.role] || assignment.role}
                      </>
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Expiry Info */}
            {selectedTask?.expires_at && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>
                  Expires {formatDistanceToNow(new Date(selectedTask.expires_at), { addSuffix: true })}
                </span>
              </div>
            )}

            {/* Subtasks (view only) */}
            {selectedTask?.subtasks && selectedTask.subtasks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Subtasks ({selectedTask.subtasks.filter((s: any) => s.completed_at).length}/{selectedTask.subtasks.length})
                </p>
                <div className="border rounded-lg p-3 space-y-3">
                  {selectedTask.subtasks.map((subtask: any) => (
                    <div key={subtask.id} className="space-y-2">
                      <div className="flex items-start gap-2">
                        {subtask.item_type === 'photo' ? (
                          <Camera className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        ) : (
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 ${subtask.completed_at ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                            {subtask.completed_at && <span className="text-primary-foreground text-xs">✓</span>}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm ${subtask.completed_at ? "line-through text-muted-foreground" : ""}`}>
                              {subtask.title}
                            </p>
                            <Badge variant="outline" className="text-[10px] px-1.5">
                              {subtask.item_type === 'photo' ? 'Photo' : 'Check'}
                            </Badge>
                          </div>
                          {subtask.completed_at && subtask.completed_by_profile && (
                            <p className="text-xs text-muted-foreground">
                              by {subtask.completed_by_profile.full_name} · {format(new Date(subtask.completed_at), "h:mm a")}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* Show photo if uploaded */}
                      {subtask.item_type === 'photo' && subtask.response_image_url && (
                        <img 
                          src={subtask.response_image_url} 
                          alt="Completion photo"
                          className="w-full h-24 object-cover rounded-lg border ml-6"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* QR Code section for QR tasks */}
            {selectedTask?.is_qr_triggered && selectedTask?.qr_code && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground">QR Code</p>
                <Button 
                  variant="outline" 
                  className="w-full gap-2"
                  onClick={() => {
                    setSelectedTask(null);
                    setQrDialogTask(selectedTask);
                  }}
                >
                  <QrCode className="h-4 w-4" />
                  View QR Code & Link
                </Button>
              </div>
            )}

            {!selectedTask?.is_qr_triggered && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Employees complete this task from their Dashboard
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <QRTaskCodeDialog
        open={!!qrDialogTask}
        onOpenChange={(open) => !open && setQrDialogTask(null)}
        taskTitle={qrDialogTask?.title || ''}
        qrCode={qrDialogTask?.qr_code || ''}
        accentColor={qrDialogTask?.accent_color || '#8B5CF6'}
      />

      <AlertDialog open={!!deleteTaskId} onOpenChange={(open) => !open && setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuickTaskTemplateLibrary
        open={showTemplateLibrary}
        onOpenChange={setShowTemplateLibrary}
        onSelectTemplate={handleSelectTemplate}
      />

      <SaveAsTemplateDialog
        open={!!saveAsTemplateTask}
        onOpenChange={(open) => !open && setSaveAsTemplateTask(null)}
        task={saveAsTemplateTask}
      />
    </>
  );
}
