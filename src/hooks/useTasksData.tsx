import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import {
  getDayOfWeekInTimezone,
  getDateDayOfWeekInTimezone,
} from "@/utils/dateUtils";
import {
  getScorePeriodStart,
  isItemExpectedInPeriod,
  isItemLive,
} from "@/utils/checklistArchivePeriod";

interface UseTasksDataOptions {
  /** When true, the Edit tab is mounted and needs the full checklist edit payload. */
  editTabActive?: boolean;
}

export function useTasksData(options: UseTasksDataOptions = {}) {
  const { editTabActive = false } = options;
  const { user } = useAuth();
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { timezone, getBusinessDayRangeInTimezone, closeTime, loading: timezoneLoading } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [historyDate, setHistoryDate] = useState(new Date());

  const historyDateStr = format(historyDate, 'yyyy-MM-dd');
  const isHistoryToday = historyDateStr === format(new Date(), 'yyyy-MM-dd');


  // ─── Checklists ───────────────────────────────────────────────
  const { data: checklists = [], isLoading: checklistsLoading } = useQuery({
    queryKey: ['user-checklists', user?.id, isAdmin, currentLocation?.id],
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { data: userRoles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user!.id);

      const userRole = userRoles?.[0]?.role;

      const { data, error } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_role_tags(role),
          checklist_user_tags(user_id),
          checklist_items(id, days_of_week, deleted_at)
        `)
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: true });

      if (error) throw error;

      const currentDay = getDayOfWeekInTimezone(timezone);
      const today = new Date();

      return data.filter(checklist => {
        // Admins see everything (including inactive for edit tab)
        if (isAdmin) return true;

        // Non-admins never see inactive checklists
        if (!checklist.is_active) return false;

        const roleTags = checklist.checklist_role_tags;
        const userTags = (checklist as any).checklist_user_tags ?? [];
        const hasNoAudience = roleTags.length === 0 && userTags.length === 0;
        const roleMatch = roleTags.some((tag: any) => tag.role === userRole);
        const userMatch = userTags.some((t: any) => t.user_id === user!.id);
        if (!(hasNoAudience || roleMatch || userMatch)) return false;

        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) =>
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }

        if (checklist.frequency === 'monthly' && checklist.visible_days_before_month_end) {
          const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          const daysUntilMonthEnd = lastDayOfMonth.getDate() - today.getDate();
          return daysUntilMonthEnd < checklist.visible_days_before_month_end;
        }

        return true;
      });
    },
    // Only the Edit tab (or managers/admins who can act on templates) need this
    // heavy payload — the History tab never reads it.
    enabled: !!user && !!currentLocation?.id && (editTabActive || isAdmin || isManager),
  });


  // ─── Completion History ───────────────────────────────────────
  const { data: rawHistoryStats } = useQuery({
    queryKey: ['completion-history', historyDateStr, user?.id, currentLocation?.id, closeTime],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    gcTime: isHistoryToday ? 10 * 60 * 1000 : 60 * 60 * 1000,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { start: periodStartBusiness, end: periodEndBusiness } = getBusinessDayRangeInTimezone(historyDateStr);
      // Derive day-of-week from the date string (not the Date object) to avoid
      // timezone mismatches between format() (local) and getDateDayOfWeekInTimezone (location tz).
      const [yr, mo, dy] = historyDateStr.split('-').map(Number);
      const histDateLocal = new Date(yr, mo - 1, dy, 12, 0, 0); // noon to avoid DST edge
      const currentDay = getDateDayOfWeekInTimezone(histDateLocal, timezone);

      const { data: checklistsData } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          template_type,
          frequency,
          scheduled_date,
          visible_days_before_month_end,
          due_by_time,
          checklist_items(id, days_of_week, item_type)
        `)
        .eq('is_active', true)
        .neq('template_type', 'training')
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: true });

      if (!checklistsData || checklistsData.length === 0) return [];

      const checklistInfo = checklistsData.map(checklist => {
        // Single-day checklists only exist on their scheduled date
        if (checklist.frequency === 'single_day') {
          const sd = (checklist as any).scheduled_date;
          if (sd && sd !== historyDateStr) return null;
        }
        // Exclude section_header rows from the expected count — they're
        // visual dividers, not answerable items. Counting them makes a fully
        // completed checklist show as e.g. "21/24" (3 headers unanswered).
        const answerableItems = (checklist.checklist_items || []).filter(
          (item: any) => item.item_type !== 'section_header'
        );
        let itemCount = answerableItems.length;
        if (checklist.template_type === 'dynamic') {
          itemCount = answerableItems.filter((item: any) =>
            item.days_of_week && item.days_of_week.includes(currentDay)
          ).length;
        }

        const isMonthly = checklist.frequency === 'monthly';
        
        // Filter out monthly checklists outside their visibility window
        if (isMonthly && checklist.visible_days_before_month_end) {
          const viewDate = new Date(historyDateStr + 'T12:00:00');
          const lastDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
          const daysUntilMonthEnd = lastDayOfMonth.getDate() - viewDate.getDate();
          if (daysUntilMonthEnd >= checklist.visible_days_before_month_end) {
            return null; // Not visible on this date
          }
        }

        let periodStart: Date;
        let periodEnd: Date;

        if (isMonthly) {
          periodStart = new Date(historyDate.getFullYear(), historyDate.getMonth(), 1, 0, 0, 0, 0);
          periodEnd = new Date(historyDate.getFullYear(), historyDate.getMonth() + 1, 0, 23, 59, 59, 999);
        } else {
          periodStart = periodStartBusiness;
          periodEnd = periodEndBusiness;
        }

        return { ...checklist, itemCount, periodStart, periodEnd };
      }).filter((c): c is NonNullable<typeof c> => c !== null && c.itemCount > 0);

      if (checklistInfo.length === 0) return [];

      const dailyChecklists = checklistInfo.filter(c => c.frequency !== 'monthly');
      const monthlyChecklists = checklistInfo.filter(c => c.frequency === 'monthly');

      const monthStart = new Date(historyDate.getFullYear(), historyDate.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(historyDate.getFullYear(), historyDate.getMonth() + 1, 0, 23, 59, 59, 999);

      const dailyChecklistIds = dailyChecklists.map(c => c.id);
      const monthlyChecklistIds = monthlyChecklists.map(c => c.id);

      const [dailyResponsesResult, monthlyResponsesResult] = await Promise.all([
        dailyChecklistIds.length > 0
          ? supabase
              .from('checklist_responses')
              .select(`
                item_id,
                submission_id,
                completed_by,
                created_at,
                checklist_submissions!inner(id, checklist_id)
              `)
              .in('checklist_submissions.checklist_id', dailyChecklistIds)
              .eq('checklist_submissions.location_id', currentLocation.id)
              .gte('created_at', periodStartBusiness.toISOString())
              .lte('created_at', periodEndBusiness.toISOString())
              .not('completed_by', 'is', null)
          : Promise.resolve({ data: [] as any[] }),
        monthlyChecklistIds.length > 0
          ? supabase
              .from('checklist_responses')
              .select(`
                item_id,
                submission_id,
                completed_by,
                created_at,
                checklist_submissions!inner(id, checklist_id)
              `)
              .in('checklist_submissions.checklist_id', monthlyChecklistIds)
              .eq('checklist_submissions.location_id', currentLocation.id)
              .gte('created_at', monthStart.toISOString())
              .lte('created_at', monthEnd.toISOString())
              .not('completed_by', 'is', null)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const allResponses = [
        ...(dailyResponsesResult.data || []),
        ...(monthlyResponsesResult.data || []),
      ];


      const allSubmissions = allResponses.reduce((acc: Array<{ id: string; checklist_id: string }>, response: any) => {
        const submission = response.checklist_submissions;
        if (submission?.id && submission?.checklist_id && !acc.some(s => s.id === submission.id)) {
          acc.push({ id: submission.id, checklist_id: submission.checklist_id });
        }
        return acc;
      }, []);

      // Profiles are resolved once per history date by a shared lookup below.


      const submissionsByChecklist = (allSubmissions || []).reduce((acc: Record<string, any[]>, s) => {
        if (!acc[s.checklist_id]) acc[s.checklist_id] = [];
        acc[s.checklist_id].push(s);
        return acc;
      }, {});

      const responsesBySubmission = allResponses.reduce((acc: Record<string, any[]>, r) => {
        if (!acc[r.submission_id]) acc[r.submission_id] = [];
        acc[r.submission_id].push(r);
        return acc;
      }, {});

      return checklistInfo.map(checklist => {
        const submissions = submissionsByChecklist[checklist.id] || [];
        const submissionIdsForChecklist = submissions.map(s => s.id);

        // Build set of today's valid item IDs for dynamic checklists
        const todayItemIds = checklist.template_type === 'dynamic'
          ? new Set(checklist.checklist_items
              ?.filter((item: any) => item.days_of_week && item.days_of_week.includes(currentDay))
              .map((item: any) => item.id))
          : null;

        const uniqueItemIds = new Set<string>();
        const contributorIds = new Set<string>();
        let lastCompletedAt: string | null = null;

        submissionIdsForChecklist.forEach(subId => {
          const responses = responsesBySubmission[subId] || [];
          responses.forEach((r: any) => {
            // For dynamic checklists, only count responses for today's items
            if (r.item_id && (todayItemIds === null || todayItemIds.has(r.item_id))) {
              uniqueItemIds.add(r.item_id);
            }
            if (r.completed_by) contributorIds.add(r.completed_by);
            if (r.created_at && (!lastCompletedAt || r.created_at > lastCompletedAt)) {
              lastCompletedAt = r.created_at;
            }
          });
        });

        const completedCount = Math.min(uniqueItemIds.size, checklist.itemCount);
        const completionRate = checklist.itemCount > 0 ? Math.min(completedCount / checklist.itemCount, 1) : 0;

        return {
          id: checklist.id,
          title: checklist.title,
          completed: completionRate === 1,
          completionRate,
          itemCount: checklist.itemCount,
          completedCount,
          contributorIds: Array.from(contributorIds) as string[],
          lastCompletedAt,
          dueByTime: checklist.due_by_time || null,
        };
      });

    },
    enabled: !!user && !!currentLocation?.id && !timezoneLoading,
  });

  // ─── Completed Quick Tasks ────────────────────────────────────
  const { data: rawTempTasks = [] } = useQuery({
    queryKey: ['completed-temp-tasks', historyDateStr, currentLocation?.id, closeTime],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    gcTime: isHistoryToday ? 10 * 60 * 1000 : 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(historyDateStr);

      const [{ data: oneTimeTasks, error: oneTimeError }, { data: alarmTasks }] = await Promise.all([
        supabase
          .from('temporary_tasks')
          .select('id, title, description, completed_at, completed_by, accent_color, task_style')
          .eq('location_id', currentLocation.id)
          .not('completed_at', 'is', null)
          .gte('completed_at', periodStart.toISOString())
          .lte('completed_at', periodEnd.toISOString())
          .order('completed_at', { ascending: false }),
        supabase
          .from('temporary_tasks')
          .select('id, title, description, accent_color, task_style, alarm_start_time, alarm_end_time, frequency_minutes, custom_times')
          .eq('location_id', currentLocation.id)
          .eq('task_style', 'alarm')
          .eq('is_active', true),
      ]);

      if (oneTimeError) throw oneTimeError;

      const alarmTaskIds = alarmTasks?.map(t => t.id) || [];
      let alarmCompletions: any[] = [];
      if (alarmTaskIds.length > 0) {
        const { data: completions } = await supabase
          .from('alarm_task_completions')
          .select('id, task_id, completed_at, completed_by, interval_key')
          .in('task_id', alarmTaskIds)
          .gte('completed_at', periodStart.toISOString())
          .lte('completed_at', periodEnd.toISOString())
          .order('completed_at', { ascending: false });
        alarmCompletions = completions || [];
      }

      const alarmTaskItems: any[] = [];

      (alarmTasks || []).forEach(task => {
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

        const taskCompletions = alarmCompletions.filter(c => c.task_id === task.id);

        const completionMinutesList: { minutes: number; completion: any }[] = [];
        taskCompletions.forEach(c => {
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

        const completedSlots = new Set<string>();
        expectedTimes.forEach(timeSlot => {
          if (findCompletionForSlot(timeSlot)) {
            completedSlots.add(timeSlot);
          }
        });

        const now = new Date();
        const localStr = now.toLocaleString('en-US', { timeZone: timezone || 'America/Los_Angeles' });
        const localNow = new Date(localStr);
        const currentDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
        const isViewingToday = historyDateStr === currentDate;
        const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();

        expectedTimes.forEach(timeSlot => {
          const [h, m] = timeSlot.split(':').map(Number);
          const slotMinutes = h * 60 + m;

          if (isViewingToday && slotMinutes > currentMinutes) return;

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
            task_style: wasCompleted ? 'alarm' as const : 'alarm-missed' as const,
            subtaskTotal: 0,
            subtaskCompleted: 0,
            completerName: null as string | null,
            completerPhoto: null as string | null,
          });
        });
      });

      const oneTimeItems = (oneTimeTasks || []).map(t => ({
        ...t,
        task_style: t.task_style || null,
        subtaskTotal: 0,
        subtaskCompleted: 0,
        completerName: null as string | null,
        completerPhoto: null as string | null,
      }));

      const allItems = [...oneTimeItems, ...alarmTaskItems];
      if (allItems.length === 0) return [];

      const oneTimeTaskIds = (oneTimeTasks || []).map(t => t.id);

      const { data: subtasks } = oneTimeTaskIds.length > 0
        ? await supabase
            .from('temporary_task_subtasks')
            .select('task_id, completed_at')
            .in('task_id', oneTimeTaskIds)
        : { data: [] as any[] };


      const subtaskAgg = (subtasks || []).reduce(
        (acc: Record<string, { total: number; completed: number }>, s: any) => {
          const entry = acc[s.task_id] || { total: 0, completed: 0 };
          entry.total += 1;
          if (s.completed_at) entry.completed += 1;
          acc[s.task_id] = entry;
          return acc;
        },
        {}
      );

      return allItems.map(t => {
        const agg = subtaskAgg[t.id] || { total: 0, completed: 0 };
        return {
          ...t,
          subtaskTotal: agg.total,
          subtaskCompleted: agg.completed,
        };
      });
    },
    enabled: !!currentLocation?.id,
  });

  // ─── Event Completions ────────────────────────────────────────
  const { data: rawEventCompletions = [] } = useQuery({
    queryKey: ['event-completions', historyDateStr, currentLocation?.id],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { data: completions, error } = await supabase
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
        .eq('completed_date', historyDateStr)
        .eq('event.location_id', currentLocation.id);

      if (error) throw error;
      if (!completions || completions.length === 0) return [];

      return completions.map(c => ({
        id: c.id,
        title: (c.event as any)?.event_name || 'Event',
        completed_at: c.completed_at,
        completed_by: c.completed_by,
        accent_color: null,
        task_style: 'event' as const,
      }));
    },
    enabled: !!currentLocation?.id,
  });

  // ─── Logbook Entries ──────────────────────────────────────────
  const { data: rawLogbookEntries = [] } = useQuery({
    queryKey: ['logbook-completions', historyDateStr, currentLocation?.id],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { data: entries, error } = await supabase
        .from('logbook_entries')
        .select(`
          id,
          created_at,
          created_by,
          category:logbook_categories(name),
          logbook_entry_values(value_text)
        `)
        .eq('location_id', currentLocation.id)
        .eq('entry_date', historyDateStr);

      if (error) throw error;
      if (!entries || entries.length === 0) return [];

      return entries.map(e => {
        let title = (e.category as any)?.name || 'Logbook Entry';
        // For Safe Count entries, append AM/PM shift label
        if (title.toLowerCase() === 'safe count') {
          try {
            const valText = (e as any).logbook_entry_values?.[0]?.value_text;
            if (valText) {
              const parsed = JSON.parse(valText);
              if (parsed?.shift) {
                title = `Safe Count (${parsed.shift})`;
              }
            }
          } catch { /* ignore parse errors */ }
        }
        return {
          id: e.id,
          title,
          completed_at: e.created_at,
          completed_by: e.created_by,
          accent_color: null,
          task_style: 'logbook' as const,
        };
      });
    },
    enabled: !!currentLocation?.id,
  });

  // ─── Shared profile lookup (one query per history date) ───────
  const profileIdsKey = useMemo(() => {
    const ids = new Set<string>();
    (rawHistoryStats || []).forEach((h: any) => (h.contributorIds || []).forEach((id: string) => ids.add(id)));
    (rawTempTasks || []).forEach((t: any) => t.completed_by && ids.add(t.completed_by));
    (rawEventCompletions || []).forEach((c: any) => c.completed_by && ids.add(c.completed_by));
    (rawLogbookEntries || []).forEach((e: any) => e.completed_by && ids.add(e.completed_by));
    return Array.from(ids).sort().join(',');
  }, [rawHistoryStats, rawTempTasks, rawEventCompletions, rawLogbookEntries]);

  const { data: profilesMap = {} } = useQuery({
    queryKey: ['history-profiles', profileIdsKey],
    enabled: profileIdsKey.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const ids = profileIdsKey.split(',').filter(Boolean);
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', ids);
      const map: Record<string, { name: string; photo: string | null }> = {};
      (data || []).forEach((p: any) => {
        map[p.id] = { name: p.full_name, photo: p.profile_photo_url };
      });
      return map;
    },
  });

  const historyStats = useMemo(
    () =>
      (rawHistoryStats || []).map((h: any) => ({
        ...h,
        contributors: (h.contributorIds || []).map((id: string) => profilesMap[id]).filter(Boolean),
      })),
    [rawHistoryStats, profilesMap]
  );

  const decorate = (items: any[]) =>
    items.map((t: any) => {
      const p = t.completed_by ? profilesMap[t.completed_by] : null;
      return { ...t, completerName: p?.name || null, completerPhoto: p?.photo || null };
    });

  const completedTempTasks = useMemo(() => decorate(rawTempTasks || []), [rawTempTasks, profilesMap]);
  const eventCompletions = useMemo(() => decorate(rawEventCompletions || []), [rawEventCompletions, profilesMap]);
  const logbookEntries = useMemo(() => decorate(rawLogbookEntries || []), [rawLogbookEntries, profilesMap]);

  return {
    // Auth / role
    user,
    isAdmin,
    isManager,
    // Timezone
    timezone,
    timezoneLoading,
    // Data
    checklists,
    checklistsLoading,
    historyStats,
    completedTempTasks,
    eventCompletions,
    logbookEntries,
    // History navigation
    historyDate,
    setHistoryDate,
    historyDateStr,
  };
}

