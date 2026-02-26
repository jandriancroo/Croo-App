import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TemporaryTaskCard } from "@/components/dashboard/TemporaryTaskCard";
import { CalendarCheck } from "lucide-react";
import { getTodayInTimezone, getDayOfWeekInTimezone } from "@/utils/dateUtils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/useUserRole";
import { filterEventsByRole } from "@/utils/eventRoleFilter";

interface EventTask {
  id: string;
  event_name: string;
  event_time: string;
  category_id: string | null;
  category?: {
    name: string;
    color: string;
  } | null;
}

interface EventDailyTasksProps {
  locationId: string;
  timezone?: string;
}

const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export function EventDailyTasks({ locationId, timezone = DEFAULT_TIMEZONE }: EventDailyTasksProps) {
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState<string | null>(null);
  const { role } = useUserRole();

  // Use timezone-aware date functions
  const today = getTodayInTimezone(timezone);
  const todayDayOfWeek = getDayOfWeekInTimezone(timezone);

  // Fetch event tasks with React Query
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["event-daily-tasks", locationId, todayDayOfWeek, role],
    queryFn: async () => {
      const { data: eventsData, error: eventsError } = await supabase
        .from("schedule_events")
        .select(`
          id,
          event_name,
          event_time,
          day_of_week,
          days_of_week,
          category_id,
          tagged_roles,
          event_categories(name, color)
        `)
        .eq("location_id", locationId)
        .eq("is_daily_task", true)
        .eq("is_recurring", true);

      if (eventsError) throw eventsError;

      // Filter events that occur today
      const todaysTasks = (eventsData || []).filter((event: any) => {
        if (event.days_of_week && event.days_of_week.length > 0) {
          return event.days_of_week.includes(todayDayOfWeek);
        }
        return event.day_of_week === todayDayOfWeek;
      }).map((event: any) => ({
        id: event.id,
        event_name: event.event_name,
        event_time: event.event_time,
        category_id: event.category_id,
        category: event.event_categories,
        tagged_roles: event.tagged_roles as string[] | null,
      }));

      // Filter by user role visibility
      const roleFiltered = filterEventsByRole(todaysTasks, role);

      return roleFiltered as EventTask[];
    },
    enabled: !!locationId && !!role,
    staleTime: 60 * 1000, // 1 min cache - event definitions rarely change mid-day
  });

  // Fetch completions with React Query
  const { data: completions = [] } = useQuery({
    queryKey: ["event-task-completions", today, tasks.map(t => t.id)],
    queryFn: async () => {
      if (tasks.length === 0) return [];
      
      const { data, error } = await supabase
        .from("event_task_completions")
        .select("event_id, completed_date")
        .in("event_id", tasks.map(t => t.id))
        .eq("completed_date", today);
        
      if (error) throw error;
      return data || [];
    },
    enabled: tasks.length > 0,
    staleTime: 10 * 1000, // 10s cache for completions
  });

  const handleComplete = async (taskId: string) => {
    setCompleting(taskId);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please sign in");
        return;
      }

      const { error } = await supabase
        .from("event_task_completions")
        .insert({
          event_id: taskId,
          completed_date: today,
          completed_by: user.id,
        });

      if (error) {
        if (error.code === "23505") {
          toast.error("Task already completed today");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Task completed!");
      queryClient.invalidateQueries({ queryKey: ["event-task-completions"] });
    } catch (error) {
      console.error("Error completing task:", error);
      toast.error("Failed to complete task");
    } finally {
      setCompleting(null);
    }
  };

  const isCompleted = (taskId: string) => {
    return completions.some((c) => c.event_id === taskId);
  };

  // Filter out completed tasks
  const incompleteTasks = tasks.filter((t) => !isCompleted(t.id));

  if (isLoading || incompleteTasks.length === 0) {
    return null;
  }

  return (
    <>
      {incompleteTasks.map((task) => (
        <EventCard
          key={task.id}
          id={task.id}
          name={task.event_name}
          time={task.event_time}
          categoryName={task.category?.name}
          categoryColor={task.category?.color}
          showCompleteButton={true}
          isLoading={completing === task.id}
          onComplete={() => handleComplete(task.id)}
        />
      ))}
    </>
  );
}
