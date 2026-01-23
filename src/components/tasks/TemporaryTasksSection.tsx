import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, User, Users, Trash2, Eye, Camera, CheckSquare, Pencil, AlarmClock, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateTemporaryTaskDialog } from "./CreateTemporaryTaskDialog";
import { EditTemporaryTaskDialog } from "./EditTemporaryTaskDialog";
import { QRTaskCodeDialog } from "./QRTaskCodeDialog";
import { formatDistanceToNow, isPast, format } from "date-fns";
import { toast } from "sonner";
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

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  brand_admin: "Brand Admin",
  org_admin: "Org Admin",
  admin: "Admin",
  manager: "Manager",
  shift_manager: "Shift Manager",
  team_member: "Team Member",
};

export function TemporaryTasksSection() {
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const { canCreateTasks } = useUserRole();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [editTask, setEditTask] = useState<any>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [qrDialogTask, setQrDialogTask] = useState<any>(null);

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
      
      // Filter out expired tasks
      return (data || []).filter(task => {
        if (!task.expires_at) return true;
        return !isPast(new Date(task.expires_at));
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

  return (
    <>
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Quick Tasks</CardTitle>
            {canCreateTasks && (
              <Button
                size="icon"
                onClick={() => setShowCreateDialog(true)}
                title="New Quick Task"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-center text-muted-foreground py-4">Loading...</p>
          ) : tasks.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No active quick tasks. Create one to assign temporary tasks to employees.
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task: any) => {
                const completedSubtasks = task.subtasks?.filter((s: any) => s.completed_at).length || 0;
                const totalSubtasks = task.subtasks?.length || 0;
                const hasSubtasks = totalSubtasks > 0;
                
                return (
                  <div
                    key={task.id}
                    className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
                    style={{ borderLeftWidth: 4, borderLeftColor: task.accent_color }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div 
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setSelectedTask(task)}
                      >
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{task.title}</p>
                          {task.task_style === 'alarm' && (
                            <Badge 
                              variant="outline" 
                              className="text-[10px] px-1.5 gap-0.5"
                              style={{ borderColor: task.accent_color, color: task.accent_color }}
                            >
                              <AlarmClock className="h-2.5 w-2.5" />
                              ALARM
                            </Badge>
                          )}
                          {task.is_qr_triggered && (
                            <Badge 
                              variant="outline" 
                              className="text-[10px] px-1.5 gap-0.5"
                              style={{ borderColor: task.accent_color, color: task.accent_color }}
                            >
                              <QrCode className="h-2.5 w-2.5" />
                              QR
                            </Badge>
                          )}
                          {hasSubtasks && (
                            <Badge variant="outline" className="text-[10px] px-1.5">
                              {completedSubtasks}/{totalSubtasks}
                            </Badge>
                          )}
                        </div>
                        
                        {/* Assignments */}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {task.assignments?.map((assignment: any) => (
                            <Badge 
                              key={assignment.id} 
                              variant="secondary" 
                              className="text-[10px] gap-0.5 px-1.5 py-0"
                            >
                              {assignment.user_id ? (
                                <>
                                  <User className="h-2.5 w-2.5" />
                                  {assignment.user?.full_name?.split(' ')[0] || "Unknown"}
                                </>
                              ) : (
                                <>
                                  <Users className="h-2.5 w-2.5" />
                                  {ROLE_LABELS[assignment.role] || assignment.role}
                                </>
                              )}
                            </Badge>
                          ))}
                        </div>

                        {/* Expiry or Alarm info */}
                        {task.task_style === 'alarm' ? (
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                            <AlarmClock className="h-3 w-3" />
                            {task.frequency_type === 'custom' 
                              ? `${(task.custom_times || []).length} times/day`
                              : task.frequency_minutes === 30 
                                ? 'Every 30 min'
                                : task.frequency_minutes === 60 
                                  ? 'Every hour'
                                  : 'Every 2 hours'
                            }
                          </div>
                        ) : task.expires_at && (
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(task.expires_at), { addSuffix: true })}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditTask(task)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setSelectedTask(task)}
                          title="View"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTaskId(task.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateTemporaryTaskDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleRefresh}
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
    </>
  );
}
