import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { getTodayInTimezone, getDayOfWeekInTimezone } from '@/utils/dateUtils';
import { getTimezoneOffset } from '@/utils/timezoneUtils';
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

interface ClockedInEmployee {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
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

  // Fetch CLOCKED-IN employees only (same logic as AlarmTaskOverlay)
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

  const totalSubtasks = teamTasks.reduce((sum, t) => sum + t.subtasks.length, 0);
  const totalCompleted = completions.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[90] flex items-end justify-center"
      style={{
        background: 'radial-gradient(ellipse at center bottom, rgba(139, 92, 246, 0.15) 0%, rgba(0,0,0,0.97) 70%)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* 3/4 height card matching alarm overlay style */}
      <motion.div
        initial={{ y: 100, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 100, scale: 0.95 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative w-full h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative overflow-hidden rounded-t-[2rem] backdrop-blur-2xl border border-b-0 flex-1 flex flex-col"
          style={{
            background: 'linear-gradient(145deg, rgba(139, 92, 246, 0.12), rgba(139, 92, 246, 0.04), rgba(0,0,0,0.9))',
            borderColor: 'rgba(139, 92, 246, 0.3)',
            boxShadow: '0 -25px 50px -12px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.15) inset',
          }}
        >
          {/* Top accent bar */}
          <div
            className="h-2 flex-shrink-0"
            style={{ background: 'linear-gradient(90deg, #8B5CF6, #7C3AED)' }}
          />

          {/* Header */}
          <div className="flex items-center gap-4 p-6 pb-4 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="text-white/70 hover:text-white hover:bg-white/10 h-12 w-12"
              onClick={onBack}
            >
              <ArrowLeft className="h-7 w-7" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <Users className="h-6 w-6 text-purple-400" />
                <h2 className="text-2xl font-black text-white tracking-tight">Team Tasks</h2>
              </div>
              {teamTasks.length > 0 && (
                <p className="text-white/50 text-sm mt-1 ml-9">
                  {totalCompleted}/{totalSubtasks} completed
                </p>
              )}
            </div>
          </div>

          {/* Tasks List */}
          <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-10 h-10 border-3 border-white border-t-transparent rounded-full"
                />
              </div>
            ) : teamTasks.length === 0 ? (
              <div className="text-center py-16">
                <Users className="h-16 w-16 text-white/20 mx-auto mb-4" />
                <p className="text-white/50 text-xl">No team tasks for today</p>
              </div>
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
                  <div
                    key={task.id}
                    className="rounded-2xl overflow-hidden"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {/* Task Header */}
                    <button
                      className="w-full flex items-center gap-3 p-4 text-left"
                      onClick={() => toggleExpand(task.id)}
                    >
                      <div
                        className="w-1.5 h-10 rounded-full shrink-0"
                        style={{ backgroundColor: task.accent_color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-white text-base">{task.title}</p>
                        <p className="text-sm text-white/40">
                          {taskCompletedCount}/{task.subtasks.length} completed
                        </p>
                      </div>
                      {allDone && <CheckCircle2 className="h-6 w-6 text-green-400 shrink-0" />}
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-white/40 shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-white/40 shrink-0" />
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
                          <div className="px-4 pb-3 space-y-1.5">
                            {sortedSubtasks.map(subtask => {
                              const completion = getCompletion(subtask.id);
                              const completed = !!completion;
                              const showPicker = showEmployeePicker === subtask.id;

                              return (
                                <div key={subtask.id}>
                                  <div
                                    className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                                      completed
                                        ? 'bg-white/5'
                                        : 'bg-white/8 cursor-pointer hover:bg-white/12 active:bg-white/15'
                                    }`}
                                    onClick={() => {
                                      if (!completed) {
                                        setShowEmployeePicker(showPicker ? null : subtask.id);
                                      }
                                    }}
                                  >
                                    {completed ? (
                                      <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                                    ) : (
                                      <div className="h-5 w-5 rounded-full border-2 border-white/30 shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-sm ${completed ? 'line-through text-white/30' : 'font-medium text-white'}`}>
                                        {subtask.title}
                                        {subtask.quantity && (
                                          <span className="ml-2 text-xs text-white/40">
                                            QTY {subtask.quantity}
                                          </span>
                                        )}
                                      </p>
                                    </div>
                                    {completed && completion?.profile && (
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <Avatar className="h-6 w-6 border border-white/20">
                                          <AvatarImage src={completion.profile.profile_photo_url || undefined} />
                                          <AvatarFallback className="text-[9px] bg-white/20 text-white">
                                            {completion.profile.full_name?.charAt(0)}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="text-[11px] text-white/40">
                                          {completion.profile.full_name?.split(' ')[0]}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Employee Picker - alarm overlay style */}
                                  <AnimatePresence>
                                    {showPicker && !completed && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="py-3 px-2">
                                          <p className="text-xs text-white/50 mb-3 ml-1">Who completed this?</p>
                                          {clockedInEmployees.length === 0 ? (
                                            <p className="text-white/40 text-sm text-center py-4">No employees currently clocked in</p>
                                          ) : (
                                            <div className="flex flex-wrap gap-4 justify-start">
                                              {clockedInEmployees.map((emp) => (
                                                <motion.button
                                                  key={emp.id}
                                                  whileHover={{ scale: 1.05 }}
                                                  whileTap={{ scale: 0.95 }}
                                                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl transition-colors hover:bg-white/10"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleComplete(subtask.id, task.id, emp.id);
                                                  }}
                                                  disabled={completing}
                                                >
                                                  <Avatar className="h-14 w-14 border-2 border-white/20">
                                                    <AvatarImage src={emp.profile_photo_url || undefined} />
                                                    <AvatarFallback className="text-lg bg-white/20 text-white">
                                                      {emp.full_name?.charAt(0)}
                                                    </AvatarFallback>
                                                  </Avatar>
                                                  <span className="text-[11px] text-white/70 max-w-[64px] truncate font-medium">
                                                    {emp.full_name?.split(' ')[0]}
                                                  </span>
                                                </motion.button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}