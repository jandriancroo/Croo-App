import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, User, Users, Trash2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateTemporaryTaskDialog } from "./CreateTemporaryTaskDialog";
import { TemporaryTaskDetailsDialog } from "./TemporaryTaskDetailsDialog";
import { formatDistanceToNow, isPast } from "date-fns";
import { toast } from "sonner";
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

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  general_manager: "General Manager",
  shift_manager: "Shift Manager",
  team_member: "Team Member",
};

export function TemporaryTasksSection() {
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

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
          subtasks:temporary_task_subtasks(id, completed_at)
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
            <Button
              size="icon"
              onClick={() => setShowCreateDialog(true)}
              title="New Quick Task"
            >
              <Plus className="h-4 w-4" />
            </Button>
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

                        {/* Expiry */}
                        {task.expires_at && (
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
                          onClick={() => setSelectedTask(task)}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTaskId(task.id)}
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

      {selectedTask && (
        <TemporaryTaskDetailsDialog
          open={!!selectedTask}
          onOpenChange={(open) => !open && setSelectedTask(null)}
          task={selectedTask}
          onComplete={handleRefresh}
        />
      )}

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
