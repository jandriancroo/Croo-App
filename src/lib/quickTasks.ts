// The ONE place quick tasks are written from the app (manual dialog and Theo's
// Create task button). Runs in the browser as the signed-in manager, so the
// database's own access rules decide who may create or delete a task.
import { supabase } from '@/integrations/supabase/client';

export const QUICK_TASK_DURATIONS = [
  { value: '1h', label: '1 Hour', hours: 1 },
  { value: '3h', label: '3 Hours', hours: 3 },
  { value: '1d', label: '1 Day', hours: 24 },
  { value: '3d', label: '3 Days', hours: 72 },
  { value: '1w', label: '1 Week', hours: 168 },
  { value: '1m', label: '1 Month', hours: 720 },
  { value: 'none', label: 'Until Complete', hours: null as number | null },
];
export const DEFAULT_ACCENT_COLOR = '#8B5CF6';

export const durationLabel = (v: string) => QUICK_TASK_DURATIONS.find((d) => d.value === v)?.label ?? 'Until Complete';

export interface QuickSubtask { title: string; item_type: string; quantity?: number | null }

/** The single existing "New Task Assigned" push. */
export async function notifyTaskAssigned(opts: { taskId: string; title: string; employeeIds: string[]; roles: string[]; locationId: string }) {
  try {
    const pushBody: any = {
      title: '📋 New Task Assigned',
      body: opts.title,
      notification_type: 'task_assigned',
      data: { type: 'task_assigned', task_id: opts.taskId },
    };
    if (opts.employeeIds.length > 0) pushBody.user_ids = opts.employeeIds;
    if (opts.roles.length > 0) {
      pushBody.roles = opts.roles;
      pushBody.location_id = opts.locationId;
    }
    if (pushBody.user_ids || pushBody.roles) {
      await supabase.functions.invoke('send-push-notification', { body: pushBody });
    }
  } catch (pushErr) {
    console.error('Push notification failed (non-blocking):', pushErr);
  }
}

/** Single write path: task row, assignments, subtasks, then the optional push. */
export async function saveQuickTask(opts: {
  taskData: Record<string, any>;
  employeeIds?: string[];
  roles?: string[];
  assign: boolean;
  subtasks?: QuickSubtask[];
  notify: boolean;
}) {
  const employeeIds = opts.employeeIds ?? [];
  const roles = opts.roles ?? [];
  const { data: task, error: taskError } = await supabase
    .from('temporary_tasks')
    .insert(opts.taskData as any)
    .select()
    .single();
  if (taskError) throw taskError;

  if (opts.assign) {
    const assignments: any[] = [
      ...roles.map((role) => ({ task_id: task.id, user_id: null, role })),
      ...employeeIds.map((userId) => ({ task_id: task.id, user_id: userId, role: null })),
    ];
    if (assignments.length > 0) {
      const { error } = await supabase.from('temporary_task_assignments').insert(assignments);
      if (error) throw error;
    }
  }

  const subtasks = opts.subtasks ?? [];
  if (subtasks.length > 0) {
    const records = subtasks.map((s, index) => ({
      task_id: task.id,
      title: s.title,
      item_type: s.item_type,
      order_index: index,
      ...(s.quantity ? { quantity: s.quantity } : {}),
    }));
    const { error } = await supabase.from('temporary_task_subtasks').insert(records as any);
    if (error) throw error;
  }

  if (opts.notify) {
    await notifyTaskAssigned({ taskId: task.id, title: opts.taskData.title, employeeIds, roles, locationId: opts.taskData.location_id });
  }
  return task;
}

/** A STANDARD quick task (dialog defaults unless given). */
export async function createStandardQuickTask(opts: {
  locationId: string;
  createdBy: string;
  title: string;
  employeeIds: string[];
  roles: string[];
  duration: string;
  description?: string | null;
  accentColor?: string;
  showOnDashboard?: boolean;
  shareable?: boolean;
  subtasks?: QuickSubtask[];
}) {
  const title = opts.title.trim();
  if (!title) throw new Error('Task needs a title');
  if (opts.employeeIds.length === 0 && opts.roles.length === 0) throw new Error('Assign at least one role or employee');
  const hours = QUICK_TASK_DURATIONS.find((d) => d.value === opts.duration)?.hours;
  const subtasks = opts.subtasks ?? [];
  const taskData = {
    location_id: opts.locationId,
    title,
    description: opts.description?.trim() || null,
    accent_color: opts.accentColor ?? DEFAULT_ACCENT_COLOR,
    created_by: opts.createdBy,
    task_style: 'standard',
    is_recurring: false,
    show_on_dashboard: opts.showOnDashboard ?? true,
    show_on_punch_clock: false,
    shareable: subtasks.length > 0 ? !!opts.shareable : false,
    expires_at: hours ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null,
  };
  return saveQuickTask({ taskData, employeeIds: opts.employeeIds, roles: opts.roles, assign: true, subtasks, notify: true });
}

/** The existing quick-task delete (Tasks page delete and Theo's Undo). */
export async function deleteQuickTask(taskId: string) {
  const { error } = await supabase.from('temporary_tasks').delete().eq('id', taskId);
  if (error) throw error;
}
