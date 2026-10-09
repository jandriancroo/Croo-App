// The ONE place a shift is reassigned and a published week's "Update" is sent.
// Used by the Schedule page (drag reassign, Update button) and by Theo's Confirm change.
// Runs in the browser as the signed-in manager, so database access rules decide who may do it.
import { supabase } from '@/integrations/supabase/client';
import { endOfWeek } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/** Add one shift (the Schedule page's desktop drag-add, and Theo's Add shift). No breaks. Returns the row with its template. */
/** station_id: set only when the shift's station differs from its template's (null = inherit via effectiveStationId). */
export async function addShift(row: { schedule_id: string; template_id: string | null; user_id: string; day_of_week: number; shift_date: string; start_time: string; end_time: string; station_id?: string | null }) {
  const { data, error } = await supabase
    .from("scheduled_shifts")
    .insert({ schedule_id: row.schedule_id, template_id: row.template_id, user_id: row.user_id, day_of_week: row.day_of_week, shift_date: row.shift_date, start_time: row.start_time, end_time: row.end_time, is_time_off: false, ...(row.station_id ? { station_id: row.station_id } : {}) })
    .select(`*, template:shift_templates(*)`)
    .single();
  if (error) throw error;
  return data;
}

/** Delete one shift (the Edit Shift window's delete, and Theo's Delete shift / Undo of an add). */
export async function deleteShift(shiftId: string) {
  const { error } = await supabase.from("scheduled_shifts").delete().eq("id", shiftId);
  if (error) throw error;
}

/** Undo of Theo's delete: put the same shift back, same id and every column it had. */
export async function restoreShift(row: Record<string, any>) {
  const { template: _t, schedule: _s, ...cols } = row;
  const { error } = await supabase.from("scheduled_shifts").insert(cols as any);
  if (error) throw error;
}

/** Read a shift's full row (taken just before Theo deletes it, so Undo can restore every column). */
export async function readShiftRow(shiftId: string) {
  const { data, error } = await supabase.from("scheduled_shifts").select("*").eq("id", shiftId).single();
  if (error) throw error;
  return data as Record<string, any>;
}

/** The week's schedule row: find it, or create it as a draft (the phone Add sheet's find-or-create). */
export async function ensureDraftSchedule(locationId: string, weekStart: string, weekEnd: string) {
  const { data: existing } = await supabase.from('schedules').select('id, is_published').eq('week_start_date', weekStart).eq('location_id', locationId).maybeSingle();
  if (existing?.id) return existing as { id: string; is_published: boolean };
  const { data: created, error } = await supabase.from('schedules')
    .insert({ week_start_date: weekStart, week_end_date: weekEnd, location_id: locationId, is_published: false })
    .select('id, is_published').single();
  if (error) throw error;
  return created as { id: string; is_published: boolean };
}

/** Move a shift to a person/day (the Schedule page's drag reassign). */
export async function reassignShift(shiftId: string, userId: string, dayOfWeek: number, shiftDate: string) {
  const { error } = await supabase.from('scheduled_shifts').update({ user_id: userId, day_of_week: dayOfWeek, shift_date: shiftDate }).eq('id', shiftId);
  if (error) throw error;
}

/**
 * Change a shift's start and end (the Edit Shift window's save, and Theo's Change hours / its Undo).
 * ONE write. `extra` carries the Edit Shift window's other fields (person, position, breaks, a date move)
 * in that same write; Theo passes nothing extra, so person, day, position and breaks stay as they are.
 */
export async function updateShiftTimes(shiftId: string, startTime: string, endTime: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase.from("scheduled_shifts").update({ ...extra, start_time: startTime, end_time: endTime } as any).eq("id", shiftId);
  if (error) throw error;
}

/**
 * Theo's Swap shifts (and its Undo): two reassignShift moves — the same as two drag-moves by hand — then ONE
 * Update per published week. If the second move fails, the first is put back and nothing is sent.
 */
export async function swapShiftsAndNotify(opts: {
  a: { id: string; schedule_id: string; day_of_week: number; shift_date: string; fromUserId: string; toUserId: string };
  b: { id: string; schedule_id: string; day_of_week: number; shift_date: string; fromUserId: string; toUserId: string };
  changedBy: string;
  timezone: string;
}) {
  const { a, b } = opts;
  await reassignShift(a.id, a.toUserId, a.day_of_week, a.shift_date);
  try {
    await reassignShift(b.id, b.toUserId, b.day_of_week, b.shift_date);
  } catch (e) {
    try { await reassignShift(a.id, a.fromUserId, a.day_of_week, a.shift_date); } catch { /* reported below */ }
    throw new Error('Not saved');
  }
  const affected = new Set<string>();
  for (const sid of [...new Set([a.schedule_id, b.schedule_id])]) {
    const r = await updateIfPublished({ scheduleId: sid, changedBy: opts.changedBy, timezone: opts.timezone });
    r.forEach((u) => affected.add(u));
  }
  return { notified: affected.size > 0, affectedUserIds: [...affected] };
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
 * The Schedule page's "Update" step for a published week (history rows are written by DB triggers),
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
    if (affectedUserIds.length > 0) {
      await supabase.functions.invoke('send-push-notification', {
        body: { user_ids: affectedUserIds, title: 'Schedule Updated', body: `Your schedule for ${dateRange} has been updated`, notification_type: 'schedule_updates', data: { type: 'schedule_update', schedule_id: scheduleId } }
      });
    }
  }
  opts.onNotified?.(affectedUserIds.length, changes.length);

  // The schedules trigger turns this snapshot refresh into one 'update_sent' history row and marks rows Sent.
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
  const { notified, affectedUserIds } = await applyThenUpdate({ scheduleId: opts.shift.schedule_id, changedBy: opts.changedBy, timezone: opts.timezone },
    () => reassignShift(opts.shift.id, opts.toUserId, opts.shift.day_of_week, opts.shift.shift_date));
  return { notified, affectedUserIds };
}

/**
 * Theo's Confirm and Undo for every schedule action: apply the change, then — only on a published
 * week — the same Update the Schedule page sends. Draft week: the change only, nothing sent.
 */
export async function applyThenUpdate<T>(opts: { scheduleId: string; changedBy: string; timezone: string }, change: () => Promise<T>) {
  const result = await change();
  const affectedUserIds = await updateIfPublished(opts);
  return { result, notified: affectedUserIds.length > 0, affectedUserIds };
}

/** The Update step only, and only on a published week (draft: nothing sent). Returns who was notified. */
export async function updateIfPublished(opts: { scheduleId: string; changedBy: string; timezone: string }): Promise<string[]> {
  const { data: sch, error } = await supabase.from('schedules')
    .select('id, is_published, published_shifts_snapshot, week_start_date').eq('id', opts.scheduleId).single();
  if (error) throw error;
  if (!sch?.is_published) return [];
  const res = await sendScheduleUpdate({
    scheduleId: sch.id,
    weekStart: new Date(`${sch.week_start_date}T12:00:00`),
    timezone: opts.timezone,
    publishedSnapshot: Array.isArray(sch.published_shifts_snapshot) ? (sch.published_shifts_snapshot as any[]) : [],
    changedBy: opts.changedBy,
  });
  return res.affectedUserIds;
}

/** The locked weekly schedule email, called exactly as the Schedule page always has (fire and forget). */
export function sendWeeklyScheduleEmail(scheduleId: string, locationId: string) {
  supabase.functions.invoke('send-weekly-schedule-email', {
    body: { schedule_id: scheduleId, location_id: locationId }
  }).then(response => {
    if (response.error) console.error('Failed to send schedule emails:', response.error);
    else console.log('Schedule emails sent:', response.data);
  });
}

/** Post a week: the server publishes (and queues the team push), then the weekly email goes out. */
export async function publishSchedule(scheduleId: string, locationId: string) {
  const { data, error } = await supabase.rpc('publish_schedule' as any, { _schedule_id: scheduleId });
  if (error) throw error;
  sendWeeklyScheduleEmail(scheduleId, locationId);
  return data as unknown as number;
}
