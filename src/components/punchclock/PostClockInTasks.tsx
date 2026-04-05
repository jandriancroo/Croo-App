import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Utensils, Vault, Banknote, CheckCircle, Clock, ArrowRight } from 'lucide-react';
import { getBusinessDateInTimezone, getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { Progress } from '@/components/ui/progress';
import { filterEventsByRole } from '@/utils/eventRoleFilter';
import type { AppRole } from '@/hooks/useUserRole';

interface PostClockInTasksProps {
  userId: string;
  locationId: string;
  timezone: string;
  closeTime?: string | null;
  userRole?: AppRole | null;
  onDismiss: () => void;
}

interface Task {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  accentColor: string;
  type: 'catering' | 'safe' | 'deposit' | 'event';
}

export function PostClockInTasks({ userId, locationId, timezone, closeTime, userRole, onDismiss }: PostClockInTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(8);
  const [dismissed, setDismissed] = useState(false);

  // Auto-dismiss after 15 seconds
  useEffect(() => {
    if (dismissed) return;
    
    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onDismiss, dismissed]);

  // Fetch outstanding tasks
  useEffect(() => {
    const fetchTasks = async () => {
      const allTasks: Task[] = [];
      const today = getBusinessDateInTimezone(timezone, closeTime);
      const todayDayOfWeek = getDayOfWeekInTimezone(timezone);

      try {
        // Fetch pending catering orders for today
        const { data: cateringOrders } = await supabase
          .from('catering_orders')
          .select('id, customer_name, pickup_time')
          .eq('location_id', locationId)
          .eq('pickup_date', today)
          .eq('status', 'pending')
          .order('pickup_time', { ascending: true });

        if (cateringOrders && cateringOrders.length > 0) {
          cateringOrders.forEach(order => {
            allTasks.push({
              id: `catering-${order.id}`,
              title: `Catering: ${order.customer_name}`,
              subtitle: `Pickup at ${order.pickup_time}`,
              icon: Utensils,
              accentColor: '#f97316', // orange
              type: 'catering'
            });
          });
        }

        // Fetch incomplete daily event tasks
        const { data: events } = await supabase
          .from('schedule_events')
          .select('id, event_name, event_time, day_of_week, days_of_week, tagged_roles, event_categories(name, color)')
          .eq('location_id', locationId)
          .eq('is_daily_task', true)
          .eq('is_recurring', true);

        if (events && events.length > 0) {
          // Filter events for today
          const todaysEvents = events.filter((event: any) => {
            if (event.days_of_week && event.days_of_week.length > 0) {
              return event.days_of_week.includes(todayDayOfWeek);
            }
            return event.day_of_week === todayDayOfWeek;
          }).map((event: any) => ({
            ...event,
            tagged_roles: event.tagged_roles as string[] | null,
          }));

          // Filter by user role visibility
          const roleFilteredEvents = filterEventsByRole(todaysEvents, userRole ?? null);

          // Check which are already completed
          if (roleFilteredEvents.length > 0) {
            const { data: completions } = await supabase
              .from('event_task_completions')
              .select('event_id')
              .in('event_id', roleFilteredEvents.map(e => e.id))
              .eq('completed_date', today);

            const completedIds = new Set(completions?.map(c => c.event_id) || []);
            
            roleFilteredEvents.forEach((event: any) => {
              if (!completedIds.has(event.id)) {
                allTasks.push({
                  id: `event-${event.id}`,
                  title: event.event_name,
                  subtitle: `Due by ${event.event_time}`,
                  icon: CheckCircle,
                  accentColor: event.event_categories?.color || '#3b82f6',
                  type: 'event'
                });
              }
            });
          }
        }

        // Fetch logbook categories for safe/drawer counts
        const { data: categories } = await supabase
          .from('logbook_categories')
          .select('id, name')
          .eq('location_id', locationId)
          .eq('is_active', true)
          .in('name', ['Safe Count', 'Drawer Count']);

        const safeCountCategory = categories?.find(c => c.name === 'Safe Count');
        const drawerCountCategory = categories?.find(c => c.name === 'Drawer Count');

        if (safeCountCategory || drawerCountCategory) {
          // Fetch today's logbook entries
          const { data: todaysEntries } = await supabase
            .from('logbook_entries')
            .select('id, category_id, logbook_entry_values(value_text)')
            .eq('location_id', locationId)
            .eq('entry_date', today);

          const safeCountEntries = todaysEntries?.filter(e => e.category_id === safeCountCategory?.id) || [];
          const drawerCountEntries = todaysEntries?.filter(e => e.category_id === drawerCountCategory?.id) || [];

          // Check AM/PM safe counts
          const amSafeCountSubmitted = safeCountEntries.some(entry =>
            entry.logbook_entry_values?.some((v: any) =>
              v.value_text?.toLowerCase().includes('"shift":"am"') ||
              v.value_text?.includes('"shift":"AM"')
            )
          );
          const pmSafeCountSubmitted = safeCountEntries.some(entry =>
            entry.logbook_entry_values?.some((v: any) =>
              v.value_text?.toLowerCase().includes('"shift":"pm"') ||
              v.value_text?.includes('"shift":"PM"')
            )
          );
          const depositSubmitted = drawerCountEntries.length > 0;

          // Fetch location hours to determine which tasks to show
          const { data: locationSettings } = await supabase
            .from('location_settings')
            .select('hours_open, hours_close, am_safe_count_window_minutes, pm_safe_count_window_minutes')
            .eq('location_id', locationId)
            .single();

          const { data: locationHours } = await supabase
            .from('location_hours')
            .select('open_time, close_time')
            .eq('location_id', locationId)
            .eq('day_of_week', todayDayOfWeek)
            .single();

          const openTime = locationHours?.open_time || locationSettings?.hours_open;
          const closeTime = locationHours?.close_time || locationSettings?.hours_close;
          
          // Use location-specific timing settings or defaults
          const amWindowMinutes = locationSettings?.am_safe_count_window_minutes ?? 120;
          const pmWindowMinutes = locationSettings?.pm_safe_count_window_minutes ?? 120;

          const parseTime = (timeStr: string | null): number | null => {
            if (!timeStr) return null;
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
          };

          const openMinutes = parseTime(openTime);
          const closeMinutes = parseTime(closeTime);
          const now = new Date();
          const currentMinutes = now.getHours() * 60 + now.getMinutes();

          // AM Safe Count window: configurable minutes before/after open
          if (!amSafeCountSubmitted && openMinutes !== null) {
            const amWindowStart = openMinutes - amWindowMinutes;
            const amWindowEnd = openMinutes + amWindowMinutes;
            if (currentMinutes >= amWindowStart && currentMinutes <= amWindowEnd) {
              allTasks.push({
                id: 'safe-am',
                title: 'AM Safe Count',
                subtitle: 'Opening count needed',
                icon: Vault,
                accentColor: '#22c55e', // green
                type: 'safe'
              });
            }
          }

          // PM Safe Count & Deposit window: at close to configurable minutes after close
          if (closeMinutes !== null) {
            const pmWindowStart = closeMinutes;
            const pmWindowEnd = closeMinutes + pmWindowMinutes;
            if (currentMinutes >= pmWindowStart && currentMinutes <= pmWindowEnd) {
              if (!pmSafeCountSubmitted) {
                allTasks.push({
                  id: 'safe-pm',
                  title: 'PM Safe Count',
                  subtitle: 'Closing count needed',
                  icon: Vault,
                  accentColor: '#8b5cf6', // purple
                  type: 'safe'
                });
              }
              if (!depositSubmitted) {
                allTasks.push({
                  id: 'deposit',
                  title: 'Drawer Deposit',
                  subtitle: 'Cash deposit needed',
                  icon: Banknote,
                  accentColor: '#eab308', // yellow
                  type: 'deposit'
                });
              }
            }
          }
        }

        setTasks(allTasks);
      } catch (error) {
        console.error('Error fetching post-clock-in tasks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [locationId, timezone]);

  const handleTaskClick = (task: Task) => {
    setDismissed(true);
    // Just dismiss - user can navigate to tasks from dashboard
    onDismiss();
  };

  const handleDismissClick = () => {
    setDismissed(true);
    onDismiss();
  };

  // If no tasks, auto-dismiss immediately
  useEffect(() => {
    if (!loading && tasks.length === 0) {
      onDismiss();
    }
  }, [loading, tasks.length, onDismiss]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Clock className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Outstanding Tasks
        </h3>
        <span className="text-sm text-muted-foreground">
          Auto-dismiss in {timeRemaining}s
        </span>
      </div>
      
      <Progress value={(timeRemaining / 8) * 100} className="h-1" />
      
      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {tasks.map(task => (
          <Card 
            key={task.id}
            className="overflow-hidden cursor-pointer hover:bg-accent/50 transition-colors"
            style={{ borderLeft: `4px solid ${task.accentColor}` }}
            onClick={() => handleTaskClick(task)}
          >
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="p-2 rounded-lg shrink-0"
                  style={{ backgroundColor: `${task.accentColor}20` }}
                >
                  <task.icon className="h-4 w-4" style={{ color: task.accentColor }} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{task.title}</p>
                  {task.subtitle && (
                    <p className="text-xs text-muted-foreground">{task.subtitle}</p>
                  )}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Button 
        variant="outline" 
        className="w-full" 
        onClick={handleDismissClick}
      >
        Dismiss
      </Button>
    </div>
  );
}
