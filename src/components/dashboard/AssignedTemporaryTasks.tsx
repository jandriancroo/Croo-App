import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { TemporaryTaskCard } from "./TemporaryTaskCard";
import { TemporaryTaskDetailsDialog } from "@/components/tasks/TemporaryTaskDetailsDialog";
import { ClipboardList, Check, CircleCheck, ChefHat, CalendarCheck, CalendarDays } from "lucide-react";
import * as Icons from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";
import { getTodayInTimezone, getDayOfWeekInTimezone } from "@/utils/dateUtils";
import { filterEventsByRole } from "@/utils/eventRoleFilter";
import { getAlarmIntervalKey } from "@/utils/timezoneUtils";

interface AssignedTemporaryTasksProps {
  showCompleted?: boolean;
  includeCateringOrders?: boolean;
  includeEventTasks?: boolean;
  /** Compact badge-style rendering for mobile Today tab */
  compact?: boolean;
  /** Content to render between events and tasks in compact mode */
  afterEventsContent?: React.ReactNode;
}

interface CateringOrder {
  id: string;
  order_number: string | null;
  customer_name: string;
  pickup_date: string;
  pickup_time: string;
  headcount: number | null;
  items: { quantity: number; item: string; notes?: string }[];
  notes: string | null;
  source_url: string | null;
  status: string;
}

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

const ORANGE_COLOR = "#f97316";

export function AssignedTemporaryTasks({ 
  showCompleted = false,
  includeCateringOrders = false,
  includeEventTasks = false,
  compact = false,
  afterEventsContent,
}: AssignedTemporaryTasksProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const { getTodayInTimezone, timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [selectedOrder, setSelectedOrder] = useState<CateringOrder | null>(null);
  const { isAdmin, isManager, isShiftManager, isGeneralManager, role } = useUserRole();
  const canComplete = isShiftManager || isGeneralManager || isManager || isAdmin;

  // Get user role from useUserRole hook (already fetched above via isAdmin, etc)
  // Use supabase rpc call for role filtering in query - avoids duplicate fetch
  const userRoleForFilter = isAdmin ? 'admin' : isGeneralManager ? 'general_manager' : isManager ? 'manager' : isShiftManager ? 'shift_manager' : 'team_member';

  // Fetch assigned temporary tasks (both completed and incomplete for today)
  const { data: tasks = [], refetch } = useQuery({
    queryKey: ["assigned-temp-tasks", currentLocation?.id, user?.id, userRoleForFilter, showCompleted],
    queryFn: async () => {
      if (!currentLocation?.id || !user?.id) return [];

      // Get tasks assigned to this user or their role
      const { data: assignments, error: assignError } = await supabase
        .from("temporary_task_assignments")
        .select("task_id")
        .or(`user_id.eq.${user.id}${userRoleForFilter ? `,role.eq.${userRoleForFilter}` : ""}`);

      if (assignError) throw assignError;
      if (!assignments || assignments.length === 0) return [];

      const taskIds = [...new Set(assignments.map((a) => a.task_id))];

      // Fetch tasks - include both completed and incomplete
      // Filter by show_on_dashboard = true
      let query = supabase
        .from("temporary_tasks")
        .select("*")
        .in("id", taskIds)
        .eq("location_id", currentLocation.id)
        .eq("is_active", true)
        .eq("show_on_dashboard", true);

      // If not showing completed, filter them out
      if (!showCompleted) {
        query = query.is("completed_at", null);
      }

      const { data: tasksData, error: tasksError } = await query
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

      if (tasksError) throw tasksError;

      // For alarm tasks, filter out those that have been completed for the current interval
      const now = new Date();

      // Get alarm task IDs
      const alarmTaskIds = tasksData?.filter(t => t.task_style === 'alarm').map(t => t.id) || [];
      
      if (alarmTaskIds.length > 0) {
        // Check for recent completions (within the last hour to cover most intervals)
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const { data: recentCompletions } = await supabase
          .from('alarm_task_completions')
          .select('task_id, interval_key')
          .in('task_id', alarmTaskIds)
          .gte('completed_at', oneHourAgo);

        // Create a set of completed task intervals
        const completedIntervals = new Set(
          recentCompletions?.map(c => `${c.task_id}_${c.interval_key}`) || []
        );

        // Filter out alarm tasks that have been completed for their current interval
        return tasksData?.filter(task => {
          if (task.task_style !== 'alarm') return true;
          
          // For alarm tasks, check if the current interval is completed
          if (task.last_triggered_at) {
            const triggeredAt = new Date(task.last_triggered_at);
            // Use timezone-aware interval key generation
            const taskIntervalKey = getAlarmIntervalKey(triggeredAt, timezone);
            return !completedIntervals.has(`${task.id}_${taskIntervalKey}`);
          }
          return true;
        }) || [];
      }

      return tasksData || [];
    },
    enabled: !!currentLocation?.id && !!user?.id,
    staleTime: 10 * 1000, // 10s cache - prevent refetch on re-mount
    refetchInterval: 30000,
  });

  // Fetch subtask counts for all tasks
  const taskIds = tasks.map(t => t.id);
  const { data: subtaskCounts = {} } = useQuery({
    queryKey: ["task-subtask-counts", taskIds],
    queryFn: async () => {
      if (taskIds.length === 0) return {};
      
      const { data, error } = await supabase
        .from("temporary_task_subtasks")
        .select("task_id, completed_at")
        .in("task_id", taskIds);

      if (error) throw error;

      // Group by task_id and count completed/total
      const counts: Record<string, { completed: number; total: number }> = {};
      (data || []).forEach(subtask => {
        if (!counts[subtask.task_id]) {
          counts[subtask.task_id] = { completed: 0, total: 0 };
        }
        counts[subtask.task_id].total++;
        if (subtask.completed_at) {
          counts[subtask.task_id].completed++;
        }
      });
      return counts;
    },
    enabled: taskIds.length > 0,
    staleTime: 10 * 1000,
  });

  // Fetch catering orders for today
  const { data: cateringOrders = [], refetch: refetchCatering } = useQuery({
    queryKey: ["assigned-catering-orders", currentLocation?.id, includeCateringOrders],
    queryFn: async () => {
      if (!currentLocation?.id || !includeCateringOrders) return [];
      const today = getTodayInTimezone();
      
      const { data, error } = await supabase
        .from("catering_orders")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("pickup_date", today)
        .order("pickup_time", { ascending: true });

      if (error) throw error;
      return (data || []).map(order => ({
        ...order,
        items: order.items as unknown as { quantity: number; item: string; notes?: string }[]
      })) as CateringOrder[];
    },
    enabled: !!currentLocation?.id && includeCateringOrders,
    staleTime: 10 * 1000,
    refetchInterval: 30000,
  });

  // Fetch event daily tasks for today - use timezone-aware functions
  const today = getTodayInTimezone();
  const todayDayOfWeek = getDayOfWeekInTimezone();

  const { data: eventTasks = [], refetch: refetchEvents } = useQuery({
    queryKey: ["today-event-tasks", currentLocation?.id, includeEventTasks, role],
    queryFn: async () => {
      if (!currentLocation?.id || !includeEventTasks) return [];

      const { data: eventsData, error: eventsError } = await supabase
        .from("schedule_events")
        .select(`id, event_name, event_time, day_of_week, days_of_week, category_id, tagged_roles, event_categories(name, color)`)
        .eq("location_id", currentLocation.id)
        .eq("is_daily_task", true)
        .eq("is_recurring", true);

      if (eventsError) throw eventsError;

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
    enabled: !!currentLocation?.id && includeEventTasks && !!role,
    refetchInterval: 30000,
  });

  // Fetch event task completions
  const { data: eventCompletions = [] } = useQuery({
    queryKey: ["today-event-completions", eventTasks.map(t => t.id), today],
    queryFn: async () => {
      if (eventTasks.length === 0) return [];
      const { data, error } = await supabase
        .from("event_task_completions")
        .select("event_id, completed_date")
        .in("event_id", eventTasks.map(t => t.id))
        .eq("completed_date", today);
      if (error) throw error;
      return data || [];
    },
    enabled: eventTasks.length > 0,
  });

  const [completingEventTask, setCompletingEventTask] = useState<string | null>(null);

  // Separate completed and incomplete tasks
  const incompleteTasks = tasks.filter(t => !t.completed_at);
  const completedTasks = tasks.filter(t => t.completed_at);

  // Separate catering orders
  const pendingOrders = cateringOrders.filter(o => o.status === 'pending');
  const completedOrders = cateringOrders.filter(o => o.status === 'completed');

  // Separate event tasks
  const isEventCompleted = (taskId: string) => eventCompletions.some(c => c.event_id === taskId);
  const incompleteEventTasks = eventTasks.filter(t => !isEventCompleted(t.id));
  const completedEventTasks = eventTasks.filter(t => isEventCompleted(t.id));

  const handleTaskComplete = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["assigned-temp-tasks"] });
  };

  const handleCateringComplete = async (order: CateringOrder) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("catering_orders")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        })
        .eq("id", order.id);

      if (error) throw error;
      toast.success("Catering order completed!");
      setSelectedOrder(null);
      refetchCatering();
    } catch (error) {
      console.error("Error completing order:", error);
      toast.error("Failed to complete order");
    }
  };

  const handleEventTaskComplete = async (taskId: string) => {
    setCompletingEventTask(taskId);
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
      refetchEvents();
      queryClient.invalidateQueries({ queryKey: ["today-event-completions"] });
    } catch (error) {
      console.error("Error completing task:", error);
      toast.error("Failed to complete task");
    } finally {
      setCompletingEventTask(null);
    }
  };

  const getIconComponent = (iconName: string) => {
    const IconComponent = (Icons as any)[iconName];
    return IconComponent || ClipboardList;
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const hasNoTasks = tasks.length === 0 && pendingOrders.length === 0 && completedOrders.length === 0 && eventTasks.length === 0;

  if (hasNoTasks) {
    return null;
  }
  // Compact badge-style rendering for mobile Today tab
  if (compact) {
    // Collect all items into a unified badge list
    const badgeItems: { id: string; label: string; color: string; progress?: string; onClick: () => void; isEvent?: boolean }[] = [];

    // Events first
    incompleteEventTasks.forEach(task => {
      badgeItems.push({
        id: `event-${task.id}`,
        label: task.event_name,
        color: task.category?.color || '#8B5CF6',
        progress: formatTime(task.event_time),
        onClick: () => handleEventTaskComplete(task.id),
        isEvent: true,
      });
    });

    incompleteTasks.forEach(task => {
      const counts = subtaskCounts[task.id];
      const progress = counts && counts.total > 0 ? `${counts.completed}/${counts.total}` : undefined;
      badgeItems.push({
        id: task.id,
        label: task.title,
        color: task.accent_color || '#8B5CF6',
        progress,
        onClick: () => setSelectedTask(task),
      });
    });

    pendingOrders.forEach(order => {
      badgeItems.push({
        id: `catering-${order.id}`,
        label: order.customer_name,
        color: ORANGE_COLOR,
        progress: formatTime(order.pickup_time),
        onClick: () => setSelectedOrder(order),
      });
    });

    if (badgeItems.length === 0 && !showCompleted) return null;

    const eventItems = badgeItems.filter(i => i.isEvent);
    const otherItems = badgeItems.filter(i => !i.isEvent);

    const renderRow = (item: typeof badgeItems[0]) => (
      <div
        key={item.id}
        onClick={item.onClick}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg overflow-hidden cursor-pointer active:opacity-80 transition-opacity"
        style={{ backgroundColor: `${item.color}10` }}
      >
        {/* Inset rounded accent stripe */}
        <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
        
        <span className="text-xs font-medium truncate flex-1">{item.label}</span>
        {item.progress && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{item.progress}</span>
        )}
        <CircleCheck className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      </div>
    );

    const allItems = [...eventItems, ...otherItems];
    // Split: items before afterEventsContent (events) and after (tasks)
    const beforeContent = eventItems;
    const afterContent = otherItems;

    const renderPill = (item: typeof badgeItems[0]) => (
      <div
        key={item.id}
        onClick={item.onClick}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg overflow-hidden cursor-pointer active:opacity-80 transition-opacity min-w-[calc(50%-4px)] max-w-full flex-grow"
        style={{ backgroundColor: `${item.color}10` }}
      >
        <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
        <span className="text-xs font-medium truncate flex-1">{item.label}</span>
        {item.progress && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{item.progress}</span>
        )}
        {item.isEvent ? <CalendarDays className="h-4 w-4 text-muted-foreground/40 shrink-0" /> : <CircleCheck className="h-4 w-4 text-muted-foreground/40 shrink-0" />}
      </div>
    );

    return (
      <>
        {beforeContent.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {beforeContent.map(renderPill)}
          </div>
        )}
        {afterEventsContent}
        {afterContent.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {afterContent.map(renderPill)}
          </div>
        )}

        {selectedTask && (
          <TemporaryTaskDetailsDialog
            open={!!selectedTask}
            onOpenChange={(open) => !open && setSelectedTask(null)}
            task={selectedTask}
            onComplete={handleTaskComplete}
          />
        )}

        {/* Catering Order Details Dialog */}
        <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ChefHat className="h-5 w-5" />
                Catering Order
              </DialogTitle>
            </DialogHeader>
            {selectedOrder && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Customer</span>
                    <span className="font-medium">{selectedOrder.customer_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Pickup</span>
                    <span className="text-primary font-medium">Today at {formatTime(selectedOrder.pickup_time)}</span>
                  </div>
                </div>
                {canComplete && (
                  <Button className="w-full" size="lg" onClick={() => handleCateringComplete(selectedOrder)}>
                    <Check className="h-5 w-5 mr-2" />
                    Mark Completed
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      {/* Event tasks — prioritized to top */}
      {incompleteEventTasks.map((task) => (
        <TemporaryTaskCard
          key={`event-${task.id}`}
          id={task.id}
          title={task.event_name}
          subtitle={task.event_time}
          icon={CalendarCheck}
          accentColor={task.category?.color || "#6366f1"}
          onAction={() => handleEventTaskComplete(task.id)}
          isLoading={completingEventTask === task.id}
          iconStyle="minimal"
          badge={{ label: "EVENT", color: task.category?.color || "#6366f1" }}
        />
      ))}


      {/* Incomplete temporary tasks */}
      {incompleteTasks.map((task) => {
        const counts = subtaskCounts[task.id];
        return (
          <TemporaryTaskCard
            key={task.id}
            id={task.id}
            title={task.title}
            subtitle={task.description || undefined}
            icon={getIconComponent(task.icon_name || "ClipboardList")}
            accentColor={task.accent_color || "#8B5CF6"}
            buttonLabel={task.write_up_id ? "Sign" : undefined}
            onAction={() => setSelectedTask(task)}
            taskStyle={(task.task_style as "standard" | "alarm") || "standard"}
            showShare={!!task.shareable}
            subtasksCompleted={counts?.completed}
            subtasksTotal={counts?.total}
          />
        );
      })}

      {/* Pending catering orders */}
      {pendingOrders.map((order) => (
        <TemporaryTaskCard
          key={`catering-${order.id}`}
          id={order.id}
          title={order.customer_name}
          subtitle={`Pickup: ${formatTime(order.pickup_time)}`}
          icon={ChefHat}
          accentColor={ORANGE_COLOR}
          buttonLabel="Done"
          onAction={() => setSelectedOrder(order)}
          badge={{ label: `${order.items.length} items` }}
        />
      ))}

      {/* Completed tasks with strikethrough */}
      {showCompleted && completedTasks.map((task) => (
        <div key={task.id} className="relative opacity-60">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="h-[2px] w-[90%] bg-muted-foreground/50" />
          </div>
          <TemporaryTaskCard
            id={task.id}
            title={task.title}
            subtitle={task.description || undefined}
            icon={Check}
            accentColor="#22c55e"
            buttonLabel="Done"
            onAction={() => {}}
            taskStyle="standard"
          />
        </div>
      ))}

      {/* Completed catering orders with strikethrough */}
      {showCompleted && completedOrders.map((order) => (
        <div key={`catering-done-${order.id}`} className="relative opacity-60">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="h-[2px] w-[90%] bg-muted-foreground/50" />
          </div>
          <TemporaryTaskCard
            id={order.id}
            title={order.customer_name}
            subtitle={`Pickup: ${formatTime(order.pickup_time)}`}
            icon={Check}
            accentColor="#22c55e"
            buttonLabel="Done"
            onAction={() => {}}
          />
        </div>
      ))}

      {/* Completed event tasks with strikethrough */}
      {showCompleted && completedEventTasks.map((task) => (
        <div key={`event-done-${task.id}`} className="relative opacity-60">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="h-[2px] w-[90%] bg-muted-foreground/50" />
          </div>
          <TemporaryTaskCard
            id={task.id}
            title={task.event_name}
            subtitle={task.event_time}
            icon={CalendarCheck}
            accentColor={task.category?.color || "#6366f1"}
            onAction={() => {}}
            iconStyle="minimal"
          />
        </div>
      ))}

      {selectedTask && (
        <TemporaryTaskDetailsDialog
          open={!!selectedTask}
          onOpenChange={(open) => !open && setSelectedTask(null)}
          task={selectedTask}
          onComplete={handleTaskComplete}
        />
      )}

      {/* Catering Order Details Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              Catering Order
            </DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="font-medium">{selectedOrder.customer_name}</span>
                </div>
                {selectedOrder.order_number && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Order #</span>
                    <span>{selectedOrder.order_number}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Pickup</span>
                  <span className="text-primary font-medium">
                    Today at {formatTime(selectedOrder.pickup_time)}
                  </span>
                </div>
                {selectedOrder.headcount && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Headcount</span>
                    <span>{selectedOrder.headcount}</span>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Items</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <span className="font-medium min-w-[24px]">{item.quantity}x</span>
                      <div>
                        <span>{item.item}</span>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground">{item.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedOrder.notes && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-1">Notes</h4>
                  <p className="text-sm text-muted-foreground">{selectedOrder.notes}</p>
                </div>
              )}

              {canComplete && (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => handleCateringComplete(selectedOrder)}
                >
                  <Check className="h-5 w-5 mr-2" />
                  Mark Completed
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}