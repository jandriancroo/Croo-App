// The ONE place a schedule event or an event category is created or deleted (single-row saves).
// Used by the phone Add Event sheet, the desktop event row, and Theo's Add event tap (and its Undo).
// Runs in the browser as the signed-in user, so database access rules decide who may do it.
// (Copying categories from another store and the new-store setup keep their own bulk copies.)
import { supabase } from '@/integrations/supabase/client';

type EventCommon = {
  locationId: string;
  name: string;
  startTime: string;
  endTime?: string | null;
  notes?: string | null;
  taggedRoles?: string[];
  categoryId?: string | null;
  isDailyTask: boolean;
  isMeeting: boolean;
};
/** One-time: a date (Monday = 0 day number) on that week's schedule. Recurring: weekdays (Monday = 0), every week. */
export type NewScheduleEvent = EventCommon & (
  | { mode: 'one-time'; scheduleId: string; eventDate: string; dayOfWeek: number }
  | { mode: 'recurring'; days: number[] }
);

/** Insert one event exactly as the manual screens always have. Returns the new event's id. */
export async function createScheduleEvent(e: NewScheduleEvent): Promise<string> {
  const roles = e.taggedRoles && e.taggedRoles.length > 0 ? e.taggedRoles : null;
  const row = e.mode === 'one-time'
    ? {
        schedule_id: e.scheduleId, event_name: e.name, event_time: e.startTime, event_end_time: e.endTime || null,
        event_date: e.eventDate, day_of_week: e.dayOfWeek, days_of_week: null, notes: e.notes || null, tagged_roles: roles,
        is_recurring: false, category_id: e.categoryId || null, is_daily_task: e.isDailyTask, is_meeting: e.isMeeting, location_id: e.locationId,
      }
    : {
        schedule_id: null, event_name: e.name, event_time: e.startTime, event_end_time: e.endTime || null,
        day_of_week: e.days[0], days_of_week: e.days.length > 1 ? e.days : null, notes: e.notes || null, tagged_roles: roles,
        is_recurring: true, category_id: e.categoryId || null, is_daily_task: e.isDailyTask, is_meeting: e.isMeeting, location_id: e.locationId,
      };
  const { data, error } = await supabase.from('schedule_events').insert(row as any).select('id').single();
  if (error) throw error;
  return data.id as string;
}

/** Delete one event (the desktop row's delete, and Theo's Undo). */
export async function deleteScheduleEvent(eventId: string) {
  const { error } = await supabase.from('schedule_events').delete().eq('id', eventId);
  if (error) throw error;
}

/** Create one category at a store (name + color). Returns the new row. */
export async function createEventCategory(opts: { locationId: string; name: string; color: string }) {
  const { data, error } = await supabase.from('event_categories')
    .insert({ name: opts.name.trim(), color: opts.color, location_id: opts.locationId })
    .select().single();
  if (error) throw error;
  return data;
}

/** Remove a category (only Theo's Undo / failed save of a category that same tap created). */
export async function deleteEventCategory(categoryId: string) {
  const { error } = await supabase.from('event_categories').delete().eq('id', categoryId);
  if (error) throw error;
}
