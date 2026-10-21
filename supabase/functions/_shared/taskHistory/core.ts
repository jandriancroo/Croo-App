/**
 * Tasks > History query logic — pure and client-agnostic.
 *
 * Shared by the browser (src/hooks/useTasksData.tsx) and edge functions
 * (supabase/functions/_shared/taskHistory/core.ts, byte-identical copy enforced
 * by core.parity.test.ts). The db client is passed in; never import React, hooks,
 * or a specific client here.
 *
 * Known quirks intentionally preserved (do not fix here without a separate ship):
 *  - monthly checklist window uses the runtime's local month (new Date(y, m, 1)).
 *  - missed alarm slots stamp a hard-coded '-08:00' offset.
 */
import {
  getDateDayOfWeekInTimezone,
  getScorePeriodStart,
  isItemExpectedInPeriod,
  versionsLiveOnDay,
} from './helpers.ts';
import { checklistScorePeriod, checklistShowsOn, isPeriodScored } from './schedule.ts';

/** Browser-local window for a yyyy-MM-dd range (same convention as the old month window). */
const localWindow = (start: string, end: string) => {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  return { start: new Date(sy, sm - 1, sd, 0, 0, 0, 0), end: new Date(ey, em - 1, ed, 23, 59, 59, 999) };
};

// deno-lint-ignore no-explicit-any
export type TaskHistoryDb = any;

export interface TaskHistoryCtx {
  locationId: string;
  /** Business date being viewed, yyyy-MM-dd. */
  dateStr: string;
  timezone: string;
  closeTime: string | null;
  /** Business-day range for dateStr (caller computes with getBusinessDayRangeInTimezone). */
  periodStart: Date;
  periodEnd: Date;
  /** Current instant (used to hide future alarm slots when viewing today). */
  now: Date;
}

export interface ChecklistHistoryRow {
  id: string;
  title: string;
  completed: boolean;
  completionRate: number;
  itemCount: number;
  completedCount: number;
  contributorIds: string[];
  lastCompletedAt: string | null;
  dueByTime: string | null;
}

export interface HistoryTaskItem {
  id: string;
  title: string;
  description?: string | null;
  completed_at: string;
  completed_by: string | null;
  accent_color: string | null;
  task_style: string | null;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  completerName?: string | null;
  completerPhoto?: string | null;
}

// ─── Completion History ───────────────────────────────────────
export async function loadChecklistHistory(
  db: TaskHistoryDb,
  ctx: TaskHistoryCtx
): Promise<ChecklistHistoryRow[]> {
  const { locationId, dateStr: historyDateStr } = ctx;
  if (!locationId) return [];

  const periodStartBusiness = ctx.periodStart;
  const periodEndBusiness = ctx.periodEnd;

  const { data: allChecklistVersions } = await db
    .from('checklists')
    .select(`
          id,
          title,
          template_type,
          frequency,
          scheduled_date,
          visible_days_before_month_end,
          schedule_repeats,
          schedule_period,
          schedule_mode,
          schedule_weekdays,
          schedule_day,
          schedule_quarter_month,
          schedule_last_n,
          due_by_time,
          is_active,
          family_id,
          replaces_checklist_id,
          superseded_at,
          checklist_items(id, days_of_week, item_type, deleted_at)
        `)
    .neq('template_type', 'training')
    .eq('location_id', locationId)
    .order('display_order', { ascending: true });

  const checklistInfo = planChecklistDay(allChecklistVersions, ctx);

  if (checklistInfo.length === 0) return [];

  // deno-lint-ignore no-explicit-any
  const dailyChecklistIds = checklistInfo.filter((c: any) => !isPeriodScored(c)).map((c: any) => c.id);
  // deno-lint-ignore no-explicit-any
  const periodLists = checklistInfo.filter((c: any) => isPeriodScored(c));
  // deno-lint-ignore no-explicit-any
  const monthlyChecklistIds = periodLists.map((c: any) => c.id);
  // One fetch covering every week/month/quarter window; each list is trimmed to its own below.
  // deno-lint-ignore no-explicit-any
  const monthStart = new Date(Math.min(...periodLists.map((c: any) => c.periodStart.getTime()), Date.now()));
  // deno-lint-ignore no-explicit-any
  const monthEnd = new Date(Math.max(...periodLists.map((c: any) => c.periodEnd.getTime()), 0));

  const responseSelect = `
                item_id,
                submission_id,
                completed_by,
                created_at,
                checklist_submissions!inner(id, checklist_id)
              `;
  const [dailyResponsesResult, monthlyResponsesResult] = await Promise.all([
    dailyChecklistIds.length > 0
      ? db
          .from('checklist_responses')
          .select(responseSelect)
          .in('checklist_submissions.checklist_id', dailyChecklistIds)
          .eq('checklist_submissions.location_id', locationId)
          .gte('created_at', periodStartBusiness.toISOString())
          .lte('created_at', periodEndBusiness.toISOString())
          .not('completed_by', 'is', null)
      : Promise.resolve({ data: [] }),
    monthlyChecklistIds.length > 0
      ? db
          .from('checklist_responses')
          .select(responseSelect)
          .in('checklist_submissions.checklist_id', monthlyChecklistIds)
          .eq('checklist_submissions.location_id', locationId)
          .gte('created_at', monthStart.toISOString())
          .lte('created_at', monthEnd.toISOString())
          .not('completed_by', 'is', null)
      : Promise.resolve({ data: [] }),
  ]);

  // deno-lint-ignore no-explicit-any
  const allResponses: any[] = [
    ...(dailyResponsesResult.data || []),
    ...(monthlyResponsesResult.data || []),
  ];

  const allSubmissions: Array<{ id: string; checklist_id: string }> = [];
  for (const response of allResponses) {
    const submission = response.checklist_submissions;
    if (submission?.id && submission?.checklist_id && !allSubmissions.some((s) => s.id === submission.id)) {
      allSubmissions.push({ id: submission.id, checklist_id: submission.checklist_id });
    }
  }

  const submissionsByChecklist: Record<string, Array<{ id: string; checklist_id: string }>> = {};
  for (const s of allSubmissions) {
    if (!submissionsByChecklist[s.checklist_id]) submissionsByChecklist[s.checklist_id] = [];
    submissionsByChecklist[s.checklist_id].push(s);
  }
  // deno-lint-ignore no-explicit-any
  const responsesBySubmission: Record<string, any[]> = {};
  for (const r of allResponses) {
    if (!responsesBySubmission[r.submission_id]) responsesBySubmission[r.submission_id] = [];
    responsesBySubmission[r.submission_id].push(r);
  }

  // deno-lint-ignore no-explicit-any
  return checklistInfo.map((checklist: any) => {
    const submissions = submissionsByChecklist[checklist.id] || [];
    const todayItemIds: Set<string> = checklist.expectedItemIds;
    const uniqueItemIds = new Set<string>();
    const contributorIds = new Set<string>();
    let lastCompletedAt: string | null = null;

    for (const sub of submissions) {
      for (const r of responsesBySubmission[sub.id] || []) {
        if (r.created_at) {
          const t = new Date(r.created_at).getTime();
          if (t < checklist.periodStart.getTime() || t > checklist.periodEnd.getTime()) continue;
        }
        if (r.item_id && todayItemIds.has(r.item_id)) uniqueItemIds.add(r.item_id);
        if (r.completed_by) contributorIds.add(r.completed_by);
        if (r.created_at && (!lastCompletedAt || r.created_at > lastCompletedAt)) {
          lastCompletedAt = r.created_at;
        }
      }
    }

    const completedCount = Math.min(uniqueItemIds.size, checklist.itemCount);
    const completionRate = checklist.itemCount > 0 ? Math.min(completedCount / checklist.itemCount, 1) : 0;
    return {
      id: checklist.id,
      title: checklist.title,
      completed: completionRate === 1,
      completionRate,
      itemCount: checklist.itemCount,
      completedCount,
      contributorIds: Array.from(contributorIds),
      lastCompletedAt,
      dueByTime: checklist.due_by_time || null,
    };
  });
}

/**
 * Which checklists count on ctx.dateStr and which items they expect — exactly the set
 * Tasks > History scores (live version that day, no section headers, archive rule,
 * dynamic days_of_week, single_day, monthly window). Pure; used by loadChecklistHistory
 * and Theo's item-level lookup. Each row keeps its checklist fields plus itemCount,
 * expectedItemIds, expectedItems, periodStart, periodEnd.
 */
// deno-lint-ignore no-explicit-any
export function planChecklistDay(allChecklistVersions: any[] | null | undefined, ctx: TaskHistoryCtx): any[] {
  const { dateStr: historyDateStr, timezone, closeTime } = ctx;
  const periodStartBusiness = ctx.periodStart;
  const periodEndBusiness = ctx.periodEnd;
  const [yr, mo, dy] = historyDateStr.split('-').map(Number);
  const histDateLocal = new Date(yr, mo - 1, dy, 12, 0, 0); // noon to avoid DST edge
  const currentDay = getDateDayOfWeekInTimezone(histDateLocal, timezone);
  // Closed period ignores is_active; one live version per family per day.
  // deno-lint-ignore no-explicit-any
  const checklistsData = versionsLiveOnDay((allChecklistVersions ?? []) as any[], periodStartBusiness);
  if (!checklistsData || checklistsData.length === 0) return [];

  // deno-lint-ignore no-explicit-any
  const checklistInfo = checklistsData.map((checklist: any) => {
    // Standard lists: shared schedule rule (one date, weekdays, month/quarter days, last-N windows).
    if (checklist.template_type !== 'dynamic' && !checklistShowsOn(checklist, historyDateStr)) return null;
    const scoreStart = getScorePeriodStart({
      templateType: checklist.template_type,
      frequency: checklist.frequency,
      businessDateStr: historyDateStr,
      dayOfWeekMon0: currentDay,
      timezone,
      closeTime,
      schedule: checklist,
    });
    const answerableItems = (checklist.checklist_items || []).filter(
      // deno-lint-ignore no-explicit-any
      (item: any) => item.item_type !== 'section_header' && isItemExpectedInPeriod(item, scoreStart)
    );
    const expectedItems = checklist.template_type === 'dynamic'
      // deno-lint-ignore no-explicit-any
      ? answerableItems.filter((item: any) => item.days_of_week && item.days_of_week.includes(currentDay))
      : answerableItems;
    const itemCount = expectedItems.length;
    // deno-lint-ignore no-explicit-any
    const expectedItemIds = new Set<string>(expectedItems.map((item: any) => item.id));

    // Week/month/quarter lists ("Last N days") score once for the whole period:
    // browser-local window (known quirk — preserved from the old month window).
    const sp = checklistScorePeriod(checklist, historyDateStr);
    const win = sp.kind === 'day' ? null : localWindow(sp.start, sp.end);
    const periodStart = win ? win.start : periodStartBusiness;
    const periodEnd = win ? win.end : periodEndBusiness;
    return { ...checklist, itemCount, expectedItemIds, expectedItems, periodStart, periodEnd };
    // deno-lint-ignore no-explicit-any
  }).filter((c: any) => c !== null && c.itemCount > 0);

  return checklistInfo;
}

// ─── Completed Quick Tasks ────────────────────────────────────
export async function loadCompletedQuickTasks(
  db: TaskHistoryDb,
  ctx: TaskHistoryCtx
): Promise<HistoryTaskItem[]> {
  const { locationId, dateStr: historyDateStr, timezone, periodStart, periodEnd, now } = ctx;
  if (!locationId) return [];

  const [{ data: oneTimeTasks, error: oneTimeError }, { data: alarmTasks }] = await Promise.all([
    db
      .from('temporary_tasks')
      .select('id, title, description, completed_at, completed_by, accent_color, task_style')
      .eq('location_id', locationId)
      .not('completed_at', 'is', null)
      .gte('completed_at', periodStart.toISOString())
      .lte('completed_at', periodEnd.toISOString())
      .order('completed_at', { ascending: false }),
    db
      .from('temporary_tasks')
      .select('id, title, description, accent_color, task_style, alarm_start_time, alarm_end_time, frequency_minutes, custom_times')
      .eq('location_id', locationId)
      .eq('task_style', 'alarm')
      .eq('is_active', true),
  ]);

  if (oneTimeError) throw oneTimeError;

  // deno-lint-ignore no-explicit-any
  const alarmTaskIds = (alarmTasks || []).map((t: any) => t.id);
  // deno-lint-ignore no-explicit-any
  let alarmCompletions: any[] = [];
  if (alarmTaskIds.length > 0) {
    const { data: completions } = await db
      .from('alarm_task_completions')
      .select('id, task_id, completed_at, completed_by, interval_key')
      .in('task_id', alarmTaskIds)
      .gte('completed_at', periodStart.toISOString())
      .lte('completed_at', periodEnd.toISOString())
      .order('completed_at', { ascending: false });
    alarmCompletions = completions || [];
  }

  const alarmTaskItems: HistoryTaskItem[] = [];

  // deno-lint-ignore no-explicit-any
  (alarmTasks || []).forEach((task: any) => {
    const startTime = task.alarm_start_time?.slice(0, 5) || '09:00';
    const endTime = task.alarm_end_time?.slice(0, 5) || '21:00';
    const freqMin = task.frequency_minutes || 60;
    const customTimes: string[] = task.custom_times || [];

    const expectedTimes: string[] = [];
    if (customTimes.length > 0) {
      expectedTimes.push(...customTimes);
    } else {
      const [startH, startM] = startTime.split(':').map(Number);
      const [endH, endM] = endTime.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      for (let m = startMinutes; m <= endMinutes; m += freqMin) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        expectedTimes.push(`${hh}:${mm}`);
      }
    }

    const taskCompletions = alarmCompletions.filter((c) => c.task_id === task.id);
    // deno-lint-ignore no-explicit-any
    const completionMinutesList: { minutes: number; completion: any }[] = [];
    taskCompletions.forEach((c) => {
      const keyParts = c.interval_key?.split('_');
      if (keyParts && keyParts[1]) {
        const hhmm = keyParts[1];
        const h = parseInt(hhmm.slice(0, 2), 10);
        const m = parseInt(hhmm.slice(2, 4), 10);
        completionMinutesList.push({ minutes: h * 60 + m, completion: c });
      }
    });

    const TOLERANCE = 5;
    const findCompletionForSlot = (slotTime: string) => {
      const [sh, sm] = slotTime.split(':').map(Number);
      const slotMin = sh * 60 + sm;
      // deno-lint-ignore no-explicit-any
      let best: any = null;
      let bestDist = Infinity;
      for (const entry of completionMinutesList) {
        const dist = Math.abs(entry.minutes - slotMin);
        if (dist <= TOLERANCE && dist < bestDist) {
          bestDist = dist;
          best = entry.completion;
        }
      }
      return best;
    };

    const localStr = now.toLocaleString('en-US', { timeZone: timezone || 'America/Los_Angeles' });
    const localNow = new Date(localStr);
    const currentDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
    const isViewingToday = historyDateStr === currentDate;
    const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();

    expectedTimes.forEach((timeSlot) => {
      const [h, m] = timeSlot.split(':').map(Number);
      const slotMinutes = h * 60 + m;
      if (isViewingToday && slotMinutes > currentMinutes) return;

      // Hard-coded offset (known quirk — preserved).
      const slotUtcIso = `${historyDateStr}T${timeSlot}:00-08:00`;
      const matchingCompletion = findCompletionForSlot(timeSlot);
      const wasCompleted = !!matchingCompletion;

      alarmTaskItems.push({
        id: matchingCompletion?.id || `missed-${task.id}-${timeSlot}`,
        title: task.title || 'Unknown Alarm',
        description: task.description || null,
        completed_at: matchingCompletion?.completed_at || slotUtcIso,
        completed_by: matchingCompletion?.completed_by || null,
        accent_color: task.accent_color || null,
        task_style: wasCompleted ? 'alarm' : 'alarm-missed',
        subtaskTotal: 0,
        subtaskCompleted: 0,
        completerName: null,
        completerPhoto: null,
      });
    });
  });

  // deno-lint-ignore no-explicit-any
  const oneTimeItems: HistoryTaskItem[] = (oneTimeTasks || []).map((t: any) => ({
    ...t,
    task_style: t.task_style || null,
    subtaskTotal: 0,
    subtaskCompleted: 0,
    completerName: null,
    completerPhoto: null,
  }));

  const allItems = [...oneTimeItems, ...alarmTaskItems];
  if (allItems.length === 0) return [];

  // deno-lint-ignore no-explicit-any
  const oneTimeTaskIds = (oneTimeTasks || []).map((t: any) => t.id);
  const { data: subtasks } = oneTimeTaskIds.length > 0
    ? await db
        .from('temporary_task_subtasks')
        .select('task_id, completed_at')
        .in('task_id', oneTimeTaskIds)
    : { data: [] };

  const subtaskAgg: Record<string, { total: number; completed: number }> = {};
  // deno-lint-ignore no-explicit-any
  for (const s of (subtasks || []) as any[]) {
    const entry = subtaskAgg[s.task_id] || { total: 0, completed: 0 };
    entry.total += 1;
    if (s.completed_at) entry.completed += 1;
    subtaskAgg[s.task_id] = entry;
  }

  return allItems.map((t) => {
    const agg = subtaskAgg[t.id] || { total: 0, completed: 0 };
    return { ...t, subtaskTotal: agg.total, subtaskCompleted: agg.completed };
  });
}

// ─── Event Completions ────────────────────────────────────────
export async function loadEventCompletions(
  db: TaskHistoryDb,
  ctx: TaskHistoryCtx
): Promise<HistoryTaskItem[]> {
  if (!ctx.locationId) return [];
  const { data: completions, error } = await db
    .from('event_task_completions')
    .select(`
          id,
          completed_at,
          completed_by,
          event:schedule_events!inner(
            id,
            event_name,
            location_id
          )
        `)
    .eq('completed_date', ctx.dateStr)
    .eq('event.location_id', ctx.locationId);

  if (error) throw error;
  if (!completions || completions.length === 0) return [];

  // deno-lint-ignore no-explicit-any
  return completions.map((c: any) => ({
    id: c.id,
    title: c.event?.event_name || 'Event',
    completed_at: c.completed_at,
    completed_by: c.completed_by,
    accent_color: null,
    task_style: 'event',
  }));
}

// ─── Logbook Entries ──────────────────────────────────────────
export async function loadLogbookEntries(
  db: TaskHistoryDb,
  ctx: TaskHistoryCtx
): Promise<HistoryTaskItem[]> {
  if (!ctx.locationId) return [];
  const { data: entries, error } = await db
    .from('logbook_entries')
    .select(`
          id,
          created_at,
          created_by,
          category:logbook_categories(name),
          logbook_entry_values(value_text)
        `)
    .eq('location_id', ctx.locationId)
    .eq('entry_date', ctx.dateStr);

  if (error) throw error;
  if (!entries || entries.length === 0) return [];

  // deno-lint-ignore no-explicit-any
  return entries.map((e: any) => {
    let title = e.category?.name || 'Logbook Entry';
    if (title.toLowerCase() === 'safe count') {
      try {
        const valText = e.logbook_entry_values?.[0]?.value_text;
        if (valText) {
          const parsed = JSON.parse(valText);
          if (parsed?.shift) title = `Safe Count (${parsed.shift})`;
        }
      } catch { /* ignore parse errors */ }
    }
    return {
      id: e.id,
      title,
      completed_at: e.created_at,
      completed_by: e.created_by,
      accent_color: null,
      task_style: 'logbook',
    };
  });
}

// ─── All four ─────────────────────────────────────────────────
export async function loadTaskHistory(db: TaskHistoryDb, ctx: TaskHistoryCtx) {
  const [checklists, quickTasks, events, logbook] = await Promise.all([
    loadChecklistHistory(db, ctx),
    loadCompletedQuickTasks(db, ctx),
    loadEventCompletions(db, ctx),
    loadLogbookEntries(db, ctx),
  ]);
  return { checklists, quickTasks, events, logbook };
}
