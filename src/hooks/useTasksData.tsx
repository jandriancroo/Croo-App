import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";

import { getDayOfWeekInTimezone } from "@/utils/dateUtils";
import { isItemLive } from "@/utils/checklistArchivePeriod";
import {
  loadChecklistHistory,
  loadCompletedQuickTasks,
  loadEventCompletions,
  loadLogbookEntries,
} from "@/lib/taskHistory/core";

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
          // Crew-facing visibility: archived items are gone immediately.
          const todayItems = checklist.checklist_items?.filter((item: any) =>
            isItemLive(item) && item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }

        // Training is assigned per person; Standard follows the shared schedule rule.
        if (checklist.template_type === 'training') return true;
        return checklistShowsOn(checklist as any, getTodayInTimezone(timezone));
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
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(historyDateStr);
      return loadChecklistHistory(supabase, { locationId: currentLocation.id, dateStr: historyDateStr, timezone, closeTime, periodStart, periodEnd, now: new Date() });
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
      return loadCompletedQuickTasks(supabase, { locationId: currentLocation.id, dateStr: historyDateStr, timezone, closeTime, periodStart, periodEnd, now: new Date() });
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
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(historyDateStr);
      return loadEventCompletions(supabase, { locationId: currentLocation.id, dateStr: historyDateStr, timezone, closeTime, periodStart, periodEnd, now: new Date() });
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
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(historyDateStr);
      return loadLogbookEntries(supabase, { locationId: currentLocation.id, dateStr: historyDateStr, timezone, closeTime, periodStart, periodEnd, now: new Date() });
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

