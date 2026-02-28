import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { getTodayInTimezone, getDayOfWeekInTimezone } from '@/utils/dateUtils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

interface TeamTasksViewProps {
  locationId: string;
  timezone: string;
  onBack: () => void;
}

interface TeamSubtask {
  id: string;
  title: string;
  order_index: number;
  quantity: number | null;
}

interface TeamTask {
  id: string;
  title: string;
  accent_color: string;
  subtasks: TeamSubtask[];
}

interface SubtaskCompletion {
  subtask_id: string;
  completed_by: string;
  completed_at: string;
  profile?: { full_name: string; profile_photo_url: string | null };
}

export function TeamTasksView({ locationId, timezone, onBack }: TeamTasksViewProps) {
  const queryClient = useQueryClient();
  const today = getTodayInTimezone(timezone);
  // days_of_week in DB uses 1-indexed (Mon=1..Sun=7), but getDayOfWeekInTimezone returns 0-indexed (Mon=0..Sun=6)
  const todayDayOfWeek = getDayOfWeekInTimezone(timezone) + 1;
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [showEmployeePicker, setShowEmployeePicker] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  // Fetch team tasks for today
  const { data: teamTasks = [], isLoading } = useQuery({
    queryKey: ['team-tasks', locationId, todayDayOfWeek],
    queryFn: async () => {
      const { data: tasks, error } = await supabase
        .from('temporary_tasks')
        .select('id, title, accent_color')
        .eq('location_id', locationId)
        .eq('task_style', 'team')
        .eq('is_active', true)
        .eq('is_recurring', true)
        .contains('days_of_week', [todayDayOfWeek]);

      if (error) throw error;
      if (!tasks?.length) return [];

      // Fetch subtasks
      const { data: subtasks, error: subError } = await supabase
        .from('temporary_task_subtasks')
        .select('id, title, order_index, days_of_week, quantity, task_id')
        .in('task_id', tasks.map(t => t.id))
        .order('order_index');

      if (subError) throw subError;

      // Group subtasks by task
      return tasks.map(task => ({
        ...task,
        subtasks: (subtasks || [])
          .filter(s => s.task_id === task.id)
          .map(s => ({ id: s.id, title: s.title, order_index: s.order_index, quantity: s.quantity }))
      })) as TeamTask[];
    },
    staleTime: 60000,
  });

  // Fetch completions for today
  const { data: completions = [] } = useQuery({
    queryKey: ['team-task-completions', locationId, today],
    queryFn: async () => {
      const allSubtaskIds = teamTasks.flatMap(t => t.subtasks.map(s => s.id));
      if (allSubtaskIds.length === 0) return [] as SubtaskCompletion[];

      const { data, error } = await supabase
        .from('task_subtask_completions')
        .select('subtask_id, completed_by, completed_at')
        .in('subtask_id', allSubtaskIds)
        .eq('completed_date', today);

      if (error) throw error;

      const userIds = [...new Set((data || []).map(c => c.completed_by))];
      if (userIds.length === 0) return (data || []).map(c => ({ ...c, profile: { full_name: 'Unknown', profile_photo_url: null } })) as SubtaskCompletion[];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      return (data || []).map(c => ({
        ...c,
        profile: profileMap.get(c.completed_by) || { full_name: 'Unknown', profile_photo_url: null }
      })) as SubtaskCompletion[];
    },
    enabled: teamTasks.length > 0,
    staleTime: 10000,
  });

  // Fetch employees at location for the picker
  const { data: employees = [] } = useQuery({
    queryKey: ['team-tasks-employees', locationId],
    queryFn: async () => {
      const { data: userLocations } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', locationId);

      if (!userLocations?.length) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', userLocations.map(ul => ul.user_id))
        .eq('is_active', true)
        .order('full_name');

      return profiles || [];
    },
  });

  const getCompletion = (subtaskId: string) => completions.find(c => c.subtask_id === subtaskId);
  const isCompleted = (subtaskId: string) => !!getCompletion(subtaskId);

  const handleComplete = async (subtaskId: string, taskId: string, employeeId: string) => {
    setCompleting(true);
    try {
      const { error } = await supabase
        .from('task_subtask_completions')
        .insert({
          subtask_id: subtaskId,
          task_id: taskId,
          completed_by: employeeId,
          completed_date: today,
        });

      if (error) {
        if (error.code === '23505') {
          toast.error('Already completed today');
        } else {
          throw error;
        }
        return;
      }

      toast.success('Task completed!');
      setShowEmployeePicker(null);
      queryClient.invalidateQueries({ queryKey: ['team-task-completions'] });
    } catch (error) {
      console.error('Error completing subtask:', error);
      toast.error('Failed to complete task');
    } finally {
      setCompleting(false);
    }
  };

  const toggleExpand = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  // Auto-expand all tasks on mount
  if (teamTasks.length > 0 && expandedTasks.size === 0) {
    const allIds = new Set(teamTasks.map(t => t.id));
    if (allIds.size > 0) setExpandedTasks(allIds);
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold">Team Tasks</h2>
        </div>
        {teamTasks.length > 0 && (
          <Badge variant="secondary" className="ml-auto">
            {completions.length}/{teamTasks.reduce((sum, t) => sum + t.subtasks.length, 0)} done
          </Badge>
        )}
      </div>

      {/* Tasks List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">Loading tasks...</p>
        ) : teamTasks.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No team tasks for today</p>
        ) : (
          teamTasks.map(task => {
            const taskCompletedCount = task.subtasks.filter(s => isCompleted(s.id)).length;
            const isExpanded = expandedTasks.has(task.id);
            const allDone = taskCompletedCount === task.subtasks.length && task.subtasks.length > 0;

            // Sort: incomplete first, completed at bottom
            const sortedSubtasks = [...task.subtasks].sort((a, b) => {
              const aComplete = isCompleted(a.id) ? 1 : 0;
              const bComplete = isCompleted(b.id) ? 1 : 0;
              return aComplete - bComplete || a.order_index - b.order_index;
            });

            return (
              <Card key={task.id} className="overflow-hidden">
                {/* Task Header */}
                <button
                  className="w-full flex items-center gap-3 p-3 text-left"
                  onClick={() => toggleExpand(task.id)}
                >
                  <div
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: task.accent_color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {taskCompletedCount}/{task.subtasks.length} completed
                    </p>
                  </div>
                  {allDone && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />}
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {/* Subtasks */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <CardContent className="p-0 pb-2 px-3 space-y-1">
                        {sortedSubtasks.map(subtask => {
                          const completion = getCompletion(subtask.id);
                          const completed = !!completion;
                          const showPicker = showEmployeePicker === subtask.id;

                          return (
                            <div key={subtask.id}>
                              <div
                                className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                                  completed
                                    ? 'bg-muted/50'
                                    : 'bg-secondary/50 cursor-pointer hover:bg-secondary'
                                }`}
                                onClick={() => {
                                  if (!completed) {
                                    setShowEmployeePicker(showPicker ? null : subtask.id);
                                  }
                                }}
                              >
                                {completed ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                ) : (
                                  <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm ${completed ? 'line-through text-muted-foreground' : 'font-medium'}`}>
                                    {subtask.title}
                                    {subtask.quantity && (
                                      <span className="ml-1 text-xs text-muted-foreground">
                                        QTY {subtask.quantity}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                {completed && completion?.profile && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={completion.profile.profile_photo_url || undefined} />
                                      <AvatarFallback className="text-[8px] bg-primary/20 text-primary">
                                        {completion.profile.full_name?.charAt(0)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="text-[10px] text-muted-foreground">
                                      {completion.profile.full_name?.split(' ')[0]}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Employee Picker */}
                              <AnimatePresence>
                                {showPicker && !completed && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="p-2 ml-6">
                                      <p className="text-xs text-muted-foreground mb-2">Who completed this?</p>
                                      <div className="flex flex-wrap gap-2">
                                        {employees.map((emp: any) => (
                                          <button
                                            key={emp.id}
                                            className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-accent transition-colors"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleComplete(subtask.id, task.id, emp.id);
                                            }}
                                            disabled={completing}
                                          >
                                            <Avatar className="h-10 w-10">
                                              <AvatarImage src={emp.profile_photo_url || undefined} />
                                              <AvatarFallback className="bg-primary/20 text-primary text-sm">
                                                {emp.full_name?.charAt(0)}
                                              </AvatarFallback>
                                            </Avatar>
                                            <span className="text-[10px] text-muted-foreground max-w-[60px] truncate">
                                              {emp.full_name?.split(' ')[0]}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </CardContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
