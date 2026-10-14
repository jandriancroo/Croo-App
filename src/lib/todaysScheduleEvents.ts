import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';

/** Schedule rows win over matching recurring templates, exactly as in the schedule. */
export function mergeScheduleEvents<T extends { event_name: string; day_of_week: number | null; event_time: string }>(
  scheduleEvents: T[], recurringEvents: T[],
): T[] {
  return [...scheduleEvents, ...recurringEvents.filter(template => !scheduleEvents.some(event =>
    event.event_name === template.event_name && event.day_of_week === template.day_of_week && event.event_time === template.event_time
  ))];
}

export function scheduleDayContext(timezone: string, today = DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd')) {
  const localDay = DateTime.fromFormat(today, 'yyyy-MM-dd', { zone: timezone });
  return { today, weekStart: localDay.startOf('week').toFormat('yyyy-MM-dd'), dayOfWeek: localDay.weekday - 1 };
}

export interface TodayEventRow {
  id: string;
  event_name: string;
  event_time: string;
  day_of_week: number | null;
  days_of_week: number[] | null;
  event_date: string | null;
  schedule_id: string | null;
  location_id: string | null;
  is_recurring: boolean | null;
  is_daily_task: boolean | null;
}

export function selectTodaysScheduleEvents<T extends TodayEventRow>(
  scheduleEvents: T[], recurringEvents: T[],
  options: { today: string; dayOfWeek: number; locationId: string; scheduleId: string | null; canSeeOneOffs: boolean },
): T[] {
  const oneOffs = options.canSeeOneOffs && options.scheduleId
    ? scheduleEvents.filter(event => event.schedule_id === options.scheduleId && event.event_date === options.today)
    : [];
  const templates = recurringEvents.filter(event => event.location_id === options.locationId &&
    event.schedule_id === null && event.is_recurring === true &&
    (event.days_of_week?.length ? event.days_of_week.includes(options.dayOfWeek) : event.day_of_week === options.dayOfWeek));
  const seen = new Set<string>();
  return mergeScheduleEvents(oneOffs, templates)
    .filter(event => {
      if (!event.is_daily_task || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => a.event_time.localeCompare(b.event_time));
}

/** Read-only: never creates a missing schedule or alters events/completions. */
export async function loadTodaysScheduleEvents(locationId: string, timezone: string, canSeeDrafts: boolean, today?: string) {
  const context = scheduleDayContext(timezone, today);
  const columns = 'id, event_name, event_time, event_end_time, event_date, schedule_id, location_id, is_recurring, is_daily_task, day_of_week, days_of_week, category_id, tagged_roles, event_categories(name, color)' as const;
  const [scheduleResult, recurringResult] = await Promise.all([
    supabase.from('schedules').select('id, is_published').eq('location_id', locationId).eq('week_start_date', context.weekStart).maybeSingle(),
    supabase.from('schedule_events').select(columns).eq('location_id', locationId).eq('is_recurring', true).is('schedule_id', null),
  ]);
  if (scheduleResult.error) throw scheduleResult.error;
  if (recurringResult.error) throw recurringResult.error;
  const schedule = scheduleResult.data;
  const canSeeOneOffs = !!schedule && (schedule.is_published === true || canSeeDrafts);
  const oneOffResult = schedule && canSeeOneOffs
    ? await supabase.from('schedule_events').select(columns).eq('schedule_id', schedule.id).eq('event_date', context.today)
    : { data: [], error: null };
  if (oneOffResult.error) throw oneOffResult.error;
  return selectTodaysScheduleEvents(oneOffResult.data || [], recurringResult.data || [], {
    ...context, locationId, scheduleId: schedule?.id ?? null, canSeeOneOffs,
  }).map(event => ({ ...event, tagged_roles: event.tagged_roles as string[] | null, category: event.event_categories }));
}