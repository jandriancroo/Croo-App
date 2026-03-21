import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Undo2, Users } from 'lucide-react';
import { getTodayInTimezone, getDayOfWeekInTimezone } from '@/utils/dateUtils';
import { getTimezoneOffset } from '@/utils/timezoneUtils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { getDisplayName } from '@/utils/displayName';

interface TeamTasksViewProps {
  locationId: string;
  timezone: string;
  onBack: () => void;
  isDayMode?: boolean;
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

interface ClockedInEmployee {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
}

export function TeamTasksView({ locationId, timezone, onBack, isDayMode = true }: TeamTasksViewProps) {
  const queryClient = useQueryClient();
  const today = getTodayInTimezone(timezone);
  const todayDayOfWeek = getDayOfWeekInTimezone(timezone) + 1;
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [showEmployeePicker, setShowEmployeePicker] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  // Track which task the picker subtask belongs to
  const [pickerTaskId, setPickerTaskId] = useState<string | null>(null);

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

      const { data: subtasks, error: subError } = await supabase
        .from('temporary_task_subtasks')
        .select('id, title, order_index, days_of_week, quantity, task_id')
        .in('task_id', tasks.map(t => t.id))
        .order('order_index');

      if (subError) throw subError;

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

  // Fetch CLOCKED-IN employees only
  const { data: clockedInEmployees = [] } = useQuery({
    queryKey: ['team-tasks-clocked-in', locationId, today],
    queryFn: async (): Promise<ClockedInEmployee[]> => {
      const todayStr = getTodayInTimezone(timezone);
      const offset = getTimezoneOffset(timezone);
      const startOfDay = new Date(`${todayStr}T00:00:00${offset}`);
      const startMinus = new Date(startOfDay);
      startMinus.setHours(startMinus.getHours() - 12);
      const endOfDayPlus = new Date(`${todayStr}T23:59:59${offset}`);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);

      const { data: punches, error } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, punch_type')
        .eq('location_id', locationId)
        .gte('punch_time', startMinus.toISOString())
        .lte('punch_time', endOfDayPlus.toISOString())
        .order('punch_time', { ascending: true });
      if (error) throw error;

      const userPunches: Record<string, typeof punches> = {};
      (punches || []).forEach(p => {
        if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
        userPunches[p.user_id].push(p);
      });

      const clockedInUserIds: string[] = [];
      Object.entries(userPunches).forEach(([userId, userPunchList]) => {
        const sorted = [...userPunchList].sort((a, b) =>
          new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
        );
        let isClockedIn = false;
        sorted.forEach(p => {
          if (p.punch_type === 'clock_in') isClockedIn = true;
          else if (p.punch_type === 'clock_out') isClockedIn = false;
        });
        if (isClockedIn) clockedInUserIds.push(userId);
      });

      if (clockedInUserIds.length === 0) return [];

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', clockedInUserIds)
        .order('full_name');
      if (profileError) throw profileError;
      return (profiles || []) as ClockedInEmployee[];
    },
    staleTime: 30000,
    refetchInterval: 60000,
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
      setPickerTaskId(null);
      queryClient.invalidateQueries({ queryKey: ['team-task-completions'] });
    } catch (error) {
      console.error('Error completing subtask:', error);
      toast.error('Failed to complete task');
    } finally {
      setCompleting(false);
    }
  };

  const handleUndo = async (subtaskId: string) => {
    try {
      const { error } = await supabase
        .from('task_subtask_completions')
        .delete()
        .eq('subtask_id', subtaskId)
        .eq('completed_date', today);

      if (error) throw error;
      toast.success('Completion undone');
      queryClient.invalidateQueries({ queryKey: ['team-task-completions'] });
    } catch (error) {
      console.error('Error undoing completion:', error);
      toast.error('Failed to undo');
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

  const [initialized, setInitialized] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);

  // Auto-expand all tasks on first load only
  if (teamTasks.length > 0 && !initialized) {
    setExpandedTasks(new Set(teamTasks.map(t => t.id)));
    setInitialized(true);
  }

  // Get the subtask title for the picker overlay
  const pickerSubtask = showEmployeePicker
    ? teamTasks.flatMap(t => t.subtasks).find(s => s.id === showEmployeePicker)
    : null;
  const pickerTask = pickerTaskId
    ? teamTasks.find(t => t.id === pickerTaskId)
    : null;

  return (
    <div className={`h-full flex flex-col ${isDayMode ? 'bg-background' : 'bg-neutral-900'}`}>
      {/* Header */}
      <div className={`flex items-center gap-3 p-4 border-b ${isDayMode ? 'border-border' : 'border-neutral-700'}`}>
        <Button variant="ghost" size="icon" onClick={onBack} className={isDayMode ? '' : 'text-white hover:bg-neutral-800'}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Users className={`h-5 w-5 ${isDayMode ? 'text-primary' : 'text-primary'}`} />
          <h2 className={`text-lg font-bold ${isDayMode ? '' : 'text-white'}`}>Team Tasks</h2>
        </div>
        {teamTasks.length > 0 && (
          <Badge variant="secondary" className={`ml-auto ${isDayMode ? '' : 'bg-neutral-700 text-neutral-200 border-neutral-600'}`}>
            {completions.length}/{teamTasks.reduce((sum, t) => sum + t.subtasks.length, 0)} done
          </Badge>
        )}
      </div>

      {/* Tasks List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <p className={`text-center py-8 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>Loading tasks...</p>
        ) : teamTasks.length === 0 ? (
          <p className={`text-center py-8 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>No team tasks for today</p>
        ) : (
          teamTasks.map(task => {
            const taskCompletedCount = task.subtasks.filter(s => isCompleted(s.id)).length;
            const isExpanded = expandedTasks.has(task.id);
            const allDone = taskCompletedCount === task.subtasks.length && task.subtasks.length > 0;

            const sortedSubtasks = [...task.subtasks].sort((a, b) => {
              const aComplete = isCompleted(a.id) ? 1 : 0;
              const bComplete = isCompleted(b.id) ? 1 : 0;
              return aComplete - bComplete || a.order_index - b.order_index;
            });

            return (
              <Card key={task.id} className={`overflow-hidden ${isDayMode ? '' : 'bg-neutral-800/80 border-neutral-700'}`}>
                <button
                  className={`w-full flex items-center gap-3 p-3 text-left ${isDayMode ? '' : 'hover:bg-neutral-700/50'}`}
                  onClick={() => toggleExpand(task.id)}
                >
                  <div
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: task.accent_color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm ${isDayMode ? '' : 'text-white'}`}>{task.title}</p>
                    <p className={`text-xs ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>
                      {taskCompletedCount}/{task.subtasks.length} completed
                    </p>
                  </div>
                  {allDone && <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />}
                  {isExpanded ? (
                    <ChevronDown className={`h-4 w-4 shrink-0 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`} />
                  ) : (
                    <ChevronRight className={`h-4 w-4 shrink-0 ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`} />
                  )}
                </button>

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

                          return (
                            <div key={subtask.id}>
                              <motion.div
                                layout
                                className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                                  completed
                                    ? isDayMode ? 'bg-muted/50 cursor-pointer' : 'bg-neutral-700/30 cursor-pointer'
                                    : isDayMode ? 'bg-secondary/50 cursor-pointer hover:bg-secondary' : 'bg-neutral-700/50 cursor-pointer hover:bg-neutral-700'
                                }`}
                                onClick={() => {
                                  if (!completed) {
                                    setShowEmployeePicker(subtask.id);
                                    setPickerTaskId(task.id);
                                  } else {
                                    setConfirmUndo(confirmUndo === subtask.id ? null : subtask.id);
                                  }
                                }}
                              >
                                {completed ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                ) : (
                                  <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm ${completed ? `line-through ${isDayMode ? 'text-muted-foreground' : 'text-neutral-500'}` : `font-medium ${isDayMode ? '' : 'text-white'}`}`}>
                                    {subtask.title}
                                    {subtask.quantity && (
                                      <span className={`ml-1 text-xs ${isDayMode ? 'text-muted-foreground' : 'text-neutral-500'}`}>
                                        {' '}QTY {subtask.quantity}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                {completed && completion?.profile && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <Avatar className="h-5 w-5">
                                      <AvatarImage src={completion.profile.profile_photo_url || undefined} />
                                      <AvatarFallback className="text-[8px] bg-primary/20 text-primary">
                                        {getDisplayName(completion.profile.full_name, completion.profile.nickname)?.charAt(0)}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className={`text-[10px] ${isDayMode ? 'text-muted-foreground' : 'text-neutral-400'}`}>
                                      {getDisplayName(completion.profile.full_name, completion.profile.nickname)?.split(' ')[0]}
                                    </span>
                                  </div>
                                )}
                              </motion.div>
                              {/* Undo slide-down */}
                              <AnimatePresence>
                                {confirmUndo === subtask.id && completed && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="w-full mt-1 text-destructive hover:text-destructive hover:bg-destructive/10 gap-2"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUndo(subtask.id);
                                        setConfirmUndo(null);
                                      }}
                                    >
                                      <Undo2 className="h-3.5 w-3.5" />
                                      Undo Completion
                                    </Button>
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

      {/* Full-screen Employee Picker Overlay (alarm-style) */}
      <AnimatePresence>
        {showEmployeePicker && pickerSubtask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[100] flex items-end justify-center"
            style={{
              background: `radial-gradient(ellipse at center bottom, ${pickerTask?.accent_color || '#8B5CF6'}30 0%, rgba(0,0,0,0.97) 70%)`,
              backdropFilter: 'blur(20px)',
            }}
          >
            <motion.div
              initial={{ y: 100, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 100, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full h-[75vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="relative overflow-hidden rounded-t-[2rem] backdrop-blur-2xl border border-b-0 flex-1 flex flex-col"
                style={{
                  background: `linear-gradient(145deg, ${pickerTask?.accent_color || '#8B5CF6'}18, ${pickerTask?.accent_color || '#8B5CF6'}06, rgba(0,0,0,0.9))`,
                  borderColor: `${pickerTask?.accent_color || '#8B5CF6'}40`,
                  boxShadow: `0 -25px 50px -12px ${pickerTask?.accent_color || '#8B5CF6'}40, 0 0 0 1px ${pickerTask?.accent_color || '#8B5CF6'}20 inset`,
                }}
              >
                {/* Top accent bar */}
                <div
                  className="h-2 flex-shrink-0"
                  style={{ background: `linear-gradient(90deg, ${pickerTask?.accent_color || '#8B5CF6'}, ${pickerTask?.accent_color || '#8B5CF6'}80)` }}
                />

                <div className="flex-1 flex flex-col p-8 overflow-hidden">
                  <div className="flex items-center gap-4 mb-8">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white/70 hover:text-white hover:bg-white/10 h-12 w-12"
                      onClick={() => {
                        setShowEmployeePicker(null);
                        setPickerTaskId(null);
                      }}
                    >
                      <ArrowLeft className="h-7 w-7" />
                    </Button>
                    <div>
                      <h2 className="text-3xl font-black text-white tracking-tight">
                        Who Completed the Task?
                      </h2>
                      <p className="text-white/60 mt-1 text-lg">
                        {pickerSubtask.title}
                        {pickerSubtask.quantity && ` - QTY ${pickerSubtask.quantity}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto py-4">
                    {clockedInEmployees.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-white/60 text-xl">No employees currently clocked in</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-center gap-8">
                        {clockedInEmployees.map((employee) => (
                          <motion.button
                            key={employee.id}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleComplete(showEmployeePicker!, pickerTaskId!, employee.id)}
                            disabled={completing}
                            className="flex flex-col items-center gap-3 p-4 rounded-2xl transition-colors hover:bg-white/10 disabled:opacity-50"
                          >
                            <div className="relative">
                              <Avatar className="h-24 w-24 border-3 border-white/30">
                                <AvatarImage src={employee.profile_photo_url || undefined} />
                                <AvatarFallback className="text-3xl bg-white/20 text-white">
                                  {getDisplayName(employee.full_name, employee.nickname)?.charAt(0)?.toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            </div>
                            <span className="text-white font-semibold text-base max-w-[100px] truncate">
                              {getDisplayName(employee.full_name, employee.nickname)?.split(' ')[0]}
                            </span>
                          </motion.button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}