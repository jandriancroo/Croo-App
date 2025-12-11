import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { formatTime12Hour } from "@/lib/utils";
import { format } from "date-fns";

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
    <div className="space-y-2">
      {incompleteTasks.map((task) => (
        <Card
          key={task.id}
          className="overflow-hidden"
          style={{
            borderLeft: task.category?.color ? `4px solid ${task.category.color}` : undefined,
          }}
        >
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="p-2 rounded-lg"
                style={{
                  backgroundColor: task.category?.color ? `${task.category.color}20` : "hsl(var(--accent))",
                }}
              >
                <CalendarCheck
                  className="h-4 w-4"
                  style={{ color: task.category?.color || "hsl(var(--accent-foreground))" }}
                />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{task.event_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime12Hour(task.event_time)}
                  {task.category?.name && (
                    <span
                      className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
                      style={{
                        backgroundColor: `${task.category.color}20`,
                        color: task.category.color,
                      }}
                    >
                      {task.category.name}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1"
              onClick={() => handleComplete(task.id)}
              disabled={completing === task.id}
            >
              <Check className="h-3.5 w-3.5" />
              Complete
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
