import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { EventCard } from "@/components/schedule/EventCard";

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

interface EventTaskCompletion {
  event_id: string;
  completed_date: string;
}

interface EventDailyTasksProps {
  locationId: string;
}

export function EventDailyTasks({ locationId }: EventDailyTasksProps) {
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [completions, setCompletions] = useState<EventTaskCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);

  const today = format(new Date(), "yyyy-MM-dd");
  // Convert JS day (Sun=0) to schedule day (Mon=0)
  const jsDay = new Date().getDay();
  const todayDayOfWeek = jsDay === 0 ? 6 : jsDay - 1;

  useEffect(() => {
    if (locationId) {
      fetchTasks();
    }
  }, [locationId]);

  const fetchTasks = async () => {
    try {
      // Fetch events that are daily tasks and occur today
      const { data: eventsData, error: eventsError } = await supabase
        .from("schedule_events")
        .select(`
          id,
          event_name,
          event_time,
          day_of_week,
          days_of_week,
          category_id,
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
      }));

      setTasks(todaysTasks);

      // Fetch today's completions
      if (todaysTasks.length > 0) {
        const { data: completionsData, error: completionsError } = await supabase
          .from("event_task_completions")
          .select("event_id, completed_date")
          .in("event_id", todaysTasks.map((t: EventTask) => t.id))
          .eq("completed_date", today);

        if (completionsError) throw completionsError;
        setCompletions(completionsData || []);
      }
    } catch (error) {
      console.error("Error fetching event tasks:", error);
    } finally {
      setLoading(false);
    }
  };

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

      setCompletions([...completions, { event_id: taskId, completed_date: today }]);
      toast.success("Task completed!");
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

  if (loading || incompleteTasks.length === 0) {
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
