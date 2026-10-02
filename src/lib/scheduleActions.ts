// The ONE place a shift is reassigned and a published week's "Update" is sent.
// Used by the Schedule page (drag reassign, Update button) and by Theo's Confirm change.
// Runs in the browser as the signed-in manager, so database access rules decide who may do it.
import { supabase } from '@/integrations/supabase/client';
import { endOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/** Move a shift to a person/day (the Schedule page's drag reassign). */
export async function reassignShift(shiftId: string, userId: string, dayOfWeek: number, shiftDate: string) {
  const { error } = await supabase.from('scheduled_shifts').update({ user_id: userId, day_of_week: dayOfWeek, shift_date: shiftDate }).eq('id', shiftId);
  if (error) throw error;
}

/** Differences between the published snapshot and the current shifts (who is affected and how). */
export function detectScheduleChanges(oldShifts: any[], newShifts: any[]) {
  const changes: any[] = [];
  const oldShiftsMap = new Map(oldShifts.map(s => [s.id, s]));
  const newShiftsMap = new Map(newShifts.map(s => [s.id, s]));

  oldShifts.forEach(oldShift => {
    if (!newShiftsMap.has(oldShift.id) && oldShift.user_id) {
      changes.push({ user_id: oldShift.user_id, type: 'removed', oldShift, newShift: null });
    }
  });
  newShifts.forEach(newShift => {
    const oldShift = oldShiftsMap.get(newShift.id);
    if (!oldShift && newShift.user_id) {
      changes.push({ user_id: newShift.user_id, type: 'added', oldShift: null, newShift });
    } else if (oldShift && newShift.user_id) {
      if (oldShift.start_time !== newShift.start_time || oldShift.end_time !== newShift.end_time) {
        changes.push({ user_id: newShift.user_id, type: 'time_changed', oldShift, newShift });
      } else if (oldShift.shift_date !== newShift.shift_date || oldShift.day_of_week !== newShift.day_of_week) {
        changes.push({ user_id: newShift.user_id, type: 'date_changed', oldShift, newShift });
      } else if (oldShift.user_id !== newShift.user_id) {
        if (oldShift.user_id) changes.push({ user_id: oldShift.user_id, type: 'removed', oldShift, newShift: null });
        if (newShift.user_id) changes.push({ user_id: newShift.user_id, type: 'added', oldShift: null, newShift });
      }
    }
  });
  return changes;
}

/**
 * The Schedule page's "Update" step for a published week: change log for every waiting change,
 * ONE "Schedule Updated" push to everyone affected, then the published snapshot refresh.
 * `onNotified` runs at the same moment the page has always shown its success message.
 */
export async function sendScheduleUpdate(opts: {
  scheduleId: string;
  weekStart: Date;
  timezone: string;
  publishedSnapshot: any[];
  changedBy: string | undefined;
  onNotified?: (affectedCount: number, changeCount: number) => void;
}) {
  const { scheduleId, weekStart, timezone, publishedSnapshot, changedBy } = opts;
  const { data: currentShifts, error: shiftsError } = await supabase.from('scheduled_shifts').select('*').eq('schedule_id', scheduleId);
  if (shiftsError) throw shiftsError;

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const dateRange = `${formatInTimeZone(weekStart, timezone, "MMM d")} - ${formatInTimeZone(weekEnd, timezone, "MMM d, yyyy")}`;
  const changes = detectScheduleChanges(publishedSnapshot, currentShifts || []);
  let affectedUserIds: string[] = [];

  if (changes.length > 0) {
    affectedUserIds = [...new Set(changes.map(c => c.user_id).filter(Boolean))] as string[];
    for (const change of changes) {
      await supabase.from('schedule_change_log').insert({
        schedule_id: scheduleId, user_id: change.user_id, change_type: change.type,
        old_shift_data: change.oldShift, new_shift_data: change.newShift, changed_by: changedBy
      });
    }
    if (affectedUserIds.length > 0) {
      await supabase.functions.invoke('send-push-notification', {
        body: { user_ids: affectedUserIds, title: 'Schedule Updated', body: `Your schedule for ${dateRange} has been updated`, notification_type: 'schedule_updates', data: { type: 'schedule_update', schedule_id: scheduleId } }
      });
    }
  }
  opts.onNotified?.(affectedUserIds.length, changes.length);

  await supabase.from('schedule_change_log').update({ is_draft: false }).eq('schedule_id', scheduleId).eq('is_draft', true);

  const { error } = await supabase.from('schedules').update({
    published_shifts_snapshot: currentShifts, last_status_changed_at: new Date().toISOString(),
    last_status_changed_by: changedBy, last_status_action: 'updated'
  }).eq('id', scheduleId);
  if (error) throw error;
  return { affectedUserIds, changeCount: changes.length };
}

/**
 * Theo's Confirm change and Undo: the two Schedule page steps, one after the other.
 * Draft week: the move only, nothing sent. Published week: the move, then the same Update
 * (which also sends any other changes already waiting on that week).
 */
export async function reassignAndNotify(opts: {
  shift: { id: string; schedule_id: string; day_of_week: number; shift_date: string };
  toUserId: string;
  changedBy: string;
  timezone: string;
}) {
  await reassignShift(opts.shift.id, opts.toUserId, opts.shift.day_of_week, opts.shift.shift_date);
  const { data: sch, error } = await supabase.from('schedules')
    .select('id, is_published, published_shifts_snapshot, week_start_date').eq('id', opts.shift.schedule_id).single();
  if (error) throw error;
  if (!sch?.is_published) return { notified: false, affectedUserIds: [] as string[] };
  const res = await sendScheduleUpdate({
    scheduleId: sch.id,
    weekStart: new Date(`${sch.week_start_date}T12:00:00`),
    timezone: opts.timezone,
    publishedSnapshot: Array.isArray(sch.published_shifts_snapshot) ? (sch.published_shifts_snapshot as any[]) : [],
    changedBy: opts.changedBy,
  });
  return { notified: res.affectedUserIds.length > 0, affectedUserIds: res.affectedUserIds };
}
