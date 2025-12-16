import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { TemporaryTaskCard } from "./TemporaryTaskCard";
import { TemporaryTaskDetailsDialog } from "@/components/tasks/TemporaryTaskDetailsDialog";
import { ClipboardList } from "lucide-react";
import * as Icons from "lucide-react";

export function AssignedTemporaryTasks() {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<any>(null);

  // Fetch user's role
  const { data: userRole } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.role;
    },
    enabled: !!user?.id,
  });

  // Fetch assigned temporary tasks
  const { data: tasks = [], refetch } = useQuery({
    queryKey: ["assigned-temp-tasks", currentLocation?.id, user?.id, userRole],
    queryFn: async () => {
      if (!currentLocation?.id || !user?.id) return [];

      // Get tasks assigned to this user or their role
      const { data: assignments, error: assignError } = await supabase
        .from("temporary_task_assignments")
        .select("task_id")
        .or(`user_id.eq.${user.id}${userRole ? `,role.eq.${userRole}` : ""}`);

      if (assignError) throw assignError;
      if (!assignments || assignments.length === 0) return [];

      const taskIds = [...new Set(assignments.map((a) => a.task_id))];

      // Fetch the actual tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from("temporary_tasks")
        .select("*")
        .in("id", taskIds)
        .eq("location_id", currentLocation.id)
        .eq("is_active", true)
        .is("completed_at", null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

      if (tasksError) throw tasksError;
      return tasksData || [];
    },
    enabled: !!currentLocation?.id && !!user?.id,
    refetchInterval: 30000,
  });

  const handleTaskComplete = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["assigned-temp-tasks"] });
  };

  const getIconComponent = (iconName: string) => {
    const IconComponent = (Icons as any)[iconName];
    return IconComponent || ClipboardList;
  };

  if (tasks.length === 0) return null;

  return (
    <>
      {tasks.map((task) => (
        <TemporaryTaskCard
          key={task.id}
          id={task.id}
          title={task.title}
          subtitle={task.description || undefined}
          icon={getIconComponent(task.icon_name || "ClipboardList")}
          accentColor={task.accent_color || "#8B5CF6"}
          buttonLabel="View"
          buttonVariant="view"
          onAction={() => setSelectedTask(task)}
        />
      ))}

      {selectedTask && (
        <TemporaryTaskDetailsDialog
          open={!!selectedTask}
          onOpenChange={(open) => !open && setSelectedTask(null)}
          task={selectedTask}
          onComplete={handleTaskComplete}
        />
      )}
    </>
  );
}
