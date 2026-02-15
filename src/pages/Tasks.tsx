import { useState, useEffect, lazy, Suspense } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus } from "lucide-react";
import { DateNavigator } from "@/components/ui/date-navigator";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TemplateTypeDialog } from "@/components/TemplateTypeDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { format, addDays, subDays, eachDayOfInterval } from "date-fns";
import { CompletedTaskDetailsDialog } from '@/components/tasks/CompletedTaskDetailsDialog';
import { TasksHistoryTimeline } from '@/components/history/TasksHistoryTimeline';
import { getTodayInTimezone, getDateInTimezone, getDayOfWeekInTimezone, getDateDayOfWeekInTimezone } from '@/utils/dateUtils';

// Lazy-load Edit tab components to defer DnD bundle
const EditTabContent = lazy(() => import('@/components/tasks/EditTabContent'));

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { timezone, getBusinessDayRangeInTimezone, closeTime, loading: timezoneLoading } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [historyDate, setHistoryDate] = useState(new Date());
  const [selectedCompletedTask, setSelectedCompletedTask] = useState<any>(null);

  // Fetch checklists for user's role (location-filtered)
  const { data: checklists = [], isLoading: checklistsLoading } = useQuery({
    queryKey: ['user-checklists', user?.id, isAdmin, currentLocation?.id],
    staleTime: 2 * 60 * 1000, // 2 min - show cached instantly, refresh in background
    placeholderData: (prev) => prev, // Keep previous data during refetch
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
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true)
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: true });

      if (error) throw error;

      // Use timezone-aware day of week (Mon=0, Sun=6)
      const currentDay = getDayOfWeekInTimezone(timezone);
      const today = new Date();
      
      return data.filter(checklist => {
        // Admins (including super_admin) see all checklists
        if (isAdmin) return true;
        
        const roleTags = checklist.checklist_role_tags;
        const roleMatch = roleTags.length === 0 || roleTags.some((tag: any) => tag.role === userRole);
        
        if (!roleMatch) return false;
        
        // For dynamic checklists - non-admins only see if there are items for today
        if (checklist.template_type === 'dynamic') {
          const todayItems = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          );
          return todayItems && todayItems.length > 0;
        }
        
        // For monthly checklists with visibility window
        if (checklist.frequency === 'monthly' && checklist.visible_days_before_month_end) {
          const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          const daysUntilMonthEnd = lastDayOfMonth.getDate() - today.getDate();
          // Show if we're within the visibility window
          return daysUntilMonthEnd < checklist.visible_days_before_month_end;
        }
        
        return true;
      });
    },
    enabled: !!user && !!currentLocation?.id,
  });

  // Fetch submission stats (location-filtered)
  const { data: submissionStats, isLoading: statsLoading } = useQuery({
    queryKey: ['submission-stats', user?.id, currentLocation?.id],
    staleTime: 2 * 60 * 1000, // 2 min cache
    placeholderData: (prev) => prev, // Keep previous data during refetch
    queryFn: async () => {
      if (!currentLocation?.id) return { today: 0, thisWeek: 0, thisMonth: 0 };
      
      const todayStr = getTodayInTimezone(timezone);
      const today = new Date();
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - today.getDay());
      
      const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

      const [todayResult, weekResult, monthResult] = await Promise.all([
        supabase
          .from('checklist_submissions')
          .select('id', { count: 'exact' })
          .eq('submitted_by', user!.id)
          .eq('location_id', currentLocation.id)
          .gte('submitted_at', todayStr),
        supabase
          .from('checklist_submissions')
          .select('id', { count: 'exact' })
          .eq('submitted_by', user!.id)
          .eq('location_id', currentLocation.id)
          .gte('submitted_at', getDateInTimezone(thisWeekStart, timezone)),
        supabase
          .from('checklist_submissions')
          .select('id', { count: 'exact' })
          .eq('submitted_by', user!.id)
          .eq('location_id', currentLocation.id)
          .gte('submitted_at', getDateInTimezone(thisMonthStart, timezone)),
      ]);

      return {
        today: todayResult.count || 0,
        thisWeek: weekResult.count || 0,
        thisMonth: monthResult.count || 0,
      };
    },
    enabled: !!user && !!currentLocation?.id,
  });

  // Fetch completion history for selected date (location-filtered)
  // Historical data is immutable - cache for 1 hour, today's data refreshes more often
  const historyDateStr = format(historyDate, 'yyyy-MM-dd');
  const isHistoryToday = historyDateStr === format(new Date(), 'yyyy-MM-dd');
  const { data: historyStats } = useQuery({
    queryKey: ['completion-history', historyDateStr, user?.id, currentLocation?.id, closeTime],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000, // Today: 2 min, Past: 1 hour
    gcTime: isHistoryToday ? 10 * 60 * 1000 : 60 * 60 * 1000, // Keep in cache same duration
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      // Use business day range (accounts for close time + 3 hours buffer)
      // This ensures late-night submissions count for the correct business day
      const { start: periodStartBusiness, end: periodEndBusiness } = getBusinessDayRangeInTimezone(historyDateStr);
      
      // Use timezone-aware day of week for the history date
      const currentDay = getDateDayOfWeekInTimezone(historyDate, timezone);

      // Get all checklists for this location with items
      const { data: checklistsData } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          template_type,
          frequency,
          checklist_items(id, days_of_week)
        `)
        .eq('is_active', true)
        .eq('location_id', currentLocation.id)
        .order('display_order', { ascending: true });

      if (!checklistsData || checklistsData.length === 0) return [];

      // Build checklist info map with item counts
      const checklistInfo = checklistsData.map(checklist => {
        let itemCount = checklist.checklist_items?.length || 0;
        if (checklist.template_type === 'dynamic') {
          itemCount = checklist.checklist_items?.filter((item: any) => 
            item.days_of_week && item.days_of_week.includes(currentDay)
          ).length || 0;
        }
        
        const isMonthly = checklist.frequency === 'monthly';
        let periodStart: Date;
        let periodEnd: Date;
        
        if (isMonthly) {
          periodStart = new Date(historyDate.getFullYear(), historyDate.getMonth(), 1, 0, 0, 0, 0);
          periodEnd = new Date(historyDate.getFullYear(), historyDate.getMonth() + 1, 0, 23, 59, 59, 999);
        } else {
          // Use business day boundaries for daily checklists
          periodStart = periodStartBusiness;
          periodEnd = periodEndBusiness;
        }
        
        return { ...checklist, itemCount, periodStart, periodEnd };
      }).filter(c => c.itemCount > 0);

      if (checklistInfo.length === 0) return [];

      // Split checklists by frequency for proper date range queries
      const dailyChecklists = checklistInfo.filter(c => c.frequency !== 'monthly');
      const monthlyChecklists = checklistInfo.filter(c => c.frequency === 'monthly');
      
      // Calculate month boundaries for monthly checklists
      const monthStart = new Date(historyDate.getFullYear(), historyDate.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(historyDate.getFullYear(), historyDate.getMonth() + 1, 0, 23, 59, 59, 999);

      // BATCH QUERY 1: Get submissions for daily and monthly checklists separately
      const dailyChecklistIds = dailyChecklists.map(c => c.id);
      const monthlyChecklistIds = monthlyChecklists.map(c => c.id);
      
      const [dailySubmissionsResult, monthlySubmissionsResult] = await Promise.all([
        dailyChecklistIds.length > 0
          ? supabase
              .from('checklist_submissions')
              .select('id, checklist_id, submitted_by')
              .in('checklist_id', dailyChecklistIds)
              .gte('submitted_at', periodStartBusiness.toISOString())
              .lte('submitted_at', periodEndBusiness.toISOString())
          : Promise.resolve({ data: [] }),
        monthlyChecklistIds.length > 0
          ? supabase
              .from('checklist_submissions')
              .select('id, checklist_id, submitted_by')
              .in('checklist_id', monthlyChecklistIds)
              .gte('submitted_at', monthStart.toISOString())
              .lte('submitted_at', monthEnd.toISOString())
          : Promise.resolve({ data: [] }),
      ]);
      
      const allSubmissions = [
        ...(dailySubmissionsResult.data || []),
        ...(monthlySubmissionsResult.data || []),
      ];

      const submissionIds = allSubmissions.map(s => s.id);
      
      // BATCH QUERY 2: Get all responses for all submissions in one query
      // Include created_at to track last completion time
      let allResponses: any[] = [];
      if (submissionIds.length > 0) {
        const { data: responses } = await supabase
          .from('checklist_responses')
          .select('id, submission_id, completed_by, created_at')
          .in('submission_id', submissionIds)
          .not('completed_by', 'is', null);
        allResponses = responses || [];
      }

      // BATCH QUERY 3: Get all contributor profiles in one query
      const allContributorIds = [...new Set(allResponses.map(r => r.completed_by).filter(Boolean))];
      let profilesMap: Record<string, { name: string; photo: string | null }> = {};
      if (allContributorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .in('id', allContributorIds);
        
        profiles?.forEach((p: any) => {
          profilesMap[p.id] = { name: p.full_name, photo: p.profile_photo_url };
        });
      }

      // Group submissions by checklist_id
      const submissionsByChecklist = (allSubmissions || []).reduce((acc: Record<string, any[]>, s) => {
        if (!acc[s.checklist_id]) acc[s.checklist_id] = [];
        acc[s.checklist_id].push(s);
        return acc;
      }, {});

      // Group responses by submission_id
      const responsesBySubmission = allResponses.reduce((acc: Record<string, any[]>, r) => {
        if (!acc[r.submission_id]) acc[r.submission_id] = [];
        acc[r.submission_id].push(r);
        return acc;
      }, {});

      // Build results from pre-fetched data (no more N+1 queries!)
      return checklistInfo.map(checklist => {
        const submissions = submissionsByChecklist[checklist.id] || [];
        const submissionIdsForChecklist = submissions.map(s => s.id);
        
        let completedCount = 0;
        const contributorIds = new Set<string>();
        let lastCompletedAt: string | null = null;
        
        submissionIdsForChecklist.forEach(subId => {
          const responses = responsesBySubmission[subId] || [];
          completedCount += responses.length;
          responses.forEach((r: any) => {
            if (r.completed_by) contributorIds.add(r.completed_by);
            // Track the most recent completion time
            if (r.created_at && (!lastCompletedAt || r.created_at > lastCompletedAt)) {
              lastCompletedAt = r.created_at;
            }
          });
        });

        const contributors = Array.from(contributorIds)
          .map(id => profilesMap[id])
          .filter(Boolean);

        const cappedCompletedCount = Math.min(completedCount, checklist.itemCount);
        const completionRate = checklist.itemCount > 0 ? Math.min(cappedCompletedCount / checklist.itemCount, 1) : 0;

        return {
          id: checklist.id,
          title: checklist.title,
          completed: completionRate === 1,
          completionRate,
          itemCount: checklist.itemCount,
          completedCount: cappedCompletedCount,
          contributors,
          lastCompletedAt, // Add last completion time for sorting
        };
      });
    },
    enabled: !!user && !!currentLocation?.id && !timezoneLoading,
  });

  // Fetch completed quick tasks AND alarm completions for selected date
  // Historical data is immutable - cache for 1 hour, today's data refreshes more often
  const { data: completedTempTasks = [] } = useQuery({
    queryKey: ['completed-temp-tasks', historyDateStr, currentLocation?.id, closeTime],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    gcTime: isHistoryToday ? 10 * 60 * 1000 : 60 * 60 * 1000,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      // Use business day range for consistency with checklists
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(historyDateStr);

      // Fetch one-time completed tasks AND alarm tasks in parallel
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

      // Fetch alarm completions for the selected date
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

      // Map alarm tasks by ID for quick lookup
      const alarmTaskMap = (alarmTasks || []).reduce((acc: Record<string, any>, t) => {
        acc[t.id] = t;
        return acc;
      }, {});

      // Generate expected firing times for each alarm task
      // and mark which were completed vs missed
      const alarmTaskItems: any[] = [];
      
      (alarmTasks || []).forEach(task => {
        const startTime = task.alarm_start_time?.slice(0, 5) || '09:00';
        const endTime = task.alarm_end_time?.slice(0, 5) || '21:00';
        const freqMin = task.frequency_minutes || 60;
        const customTimes: string[] = task.custom_times || [];
        
        // Generate expected firing times
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
        
        // Find completions for this task
        const taskCompletions = alarmCompletions.filter(c => c.task_id === task.id);
        
        // Map completions by interval_key hour to match expected times
        const completedIntervalHours = new Set<string>();
        taskCompletions.forEach(c => {
          // interval_key format: YYYY-MM-DD_HHMM
          const keyParts = c.interval_key?.split('_');
          if (keyParts && keyParts[1]) {
            const hhmm = keyParts[1];
            const h = hhmm.slice(0, 2);
            const m = hhmm.slice(2, 4);
            completedIntervalHours.add(`${h}:${m}`);
          }
        });
        
        // For today, only show slots up to the current hour
        const now = new Date();
        const pstStr = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const pstNow = new Date(pstStr);
        const currentDate = `${pstNow.getFullYear()}-${String(pstNow.getMonth() + 1).padStart(2, '0')}-${String(pstNow.getDate()).padStart(2, '0')}`;
        const isViewingToday = historyDateStr === currentDate;
        const currentMinutes = pstNow.getHours() * 60 + pstNow.getMinutes();
        
        expectedTimes.forEach(timeSlot => {
          const [h, m] = timeSlot.split(':').map(Number);
          const slotMinutes = h * 60 + m;
          
          // Don't show future slots for today
          if (isViewingToday && slotMinutes > currentMinutes) return;
          
          // Build a fake UTC timestamp for sorting (using the date being viewed)
          const slotUtcIso = `${historyDateStr}T${timeSlot}:00-08:00`;
          
          // Check if this slot was completed
          const wasCompleted = completedIntervalHours.has(timeSlot);
          
          // Find the matching completion for completed slots
          const matchingCompletion = wasCompleted 
            ? taskCompletions.find(c => {
                const keyParts = c.interval_key?.split('_');
                if (keyParts && keyParts[1]) {
                  const hhmm = keyParts[1];
                  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}` === timeSlot;
                }
                return false;
              })
            : null;
          
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

      // Combine one-time tasks (with task_style) 
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

      // Get all completer IDs
      const completerIds = [...new Set(allItems.map(t => t.completed_by).filter(Boolean))] as string[];
      
      // Get subtask data for one-time tasks only
      const oneTimeTaskIds = (oneTimeTasks || []).map(t => t.id);

      const [{ data: subtasks }, { data: completers }] = await Promise.all([
        oneTimeTaskIds.length > 0
          ? supabase
              .from('temporary_task_subtasks')
              .select('task_id, completed_at')
              .in('task_id', oneTimeTaskIds)
          : Promise.resolve({ data: [] }),
        completerIds.length > 0
          ? supabase
              .from('profiles')
              .select('id, full_name, profile_photo_url')
              .in('id', completerIds)
          : Promise.resolve({ data: [] as any[] } as any),
      ]);

      const completerMap = (completers || []).reduce((acc: Record<string, any>, p: any) => {
        acc[p.id] = p;
        return acc;
      }, {});

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
        const completer = t.completed_by ? completerMap[t.completed_by] : null;
        return {
          ...t,
          subtaskTotal: agg.total,
          subtaskCompleted: agg.completed,
          completerName: completer?.full_name || null,
          completerPhoto: completer?.profile_photo_url || null,
        };
      });
    },
    enabled: !!currentLocation?.id,
  });

  // Fetch event completions for selected date
  const { data: eventCompletions = [] } = useQuery({
    queryKey: ['event-completions', historyDateStr, currentLocation?.id],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
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

      // Get completer profiles
      const completerIds = [...new Set(completions.map(c => c.completed_by).filter(Boolean))];
      let completersMap: Record<string, any> = {};
      if (completerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .in('id', completerIds);
        profiles?.forEach((p: any) => {
          completersMap[p.id] = p;
        });
      }

      return completions.map(c => ({
        id: c.id,
        title: (c.event as any)?.event_name || 'Event',
        completed_at: c.completed_at,
        completed_by: c.completed_by,
        accent_color: null,
        task_style: 'event' as const,
        completerName: completersMap[c.completed_by]?.full_name || null,
        completerPhoto: completersMap[c.completed_by]?.profile_photo_url || null,
      }));
    },
    enabled: !!currentLocation?.id,
  });

  // Fetch logbook entries (safe counts, drawer counts) for selected date
  const { data: logbookEntries = [] } = useQuery({
    queryKey: ['logbook-completions', historyDateStr, currentLocation?.id],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      const { data: entries, error } = await supabase
        .from('logbook_entries')
        .select(`
          id,
          created_at,
          created_by,
          category:logbook_categories(name)
        `)
        .eq('location_id', currentLocation.id)
        .eq('entry_date', historyDateStr);

      if (error) throw error;
      if (!entries || entries.length === 0) return [];

      // Get creator profiles
      const creatorIds = [...new Set(entries.map(e => e.created_by).filter(Boolean))];
      let creatorsMap: Record<string, any> = {};
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .in('id', creatorIds);
        profiles?.forEach((p: any) => {
          creatorsMap[p.id] = p;
        });
      }

      return entries.map(e => ({
        id: e.id,
        title: (e.category as any)?.name || 'Logbook Entry',
        completed_at: e.created_at,
        completed_by: e.created_by,
        accent_color: null,
        task_style: 'logbook' as const,
        completerName: creatorsMap[e.created_by]?.full_name || null,
        completerPhoto: creatorsMap[e.created_by]?.profile_photo_url || null,
      }));
    },
    enabled: !!currentLocation?.id,
  });

  // Prefetch past 14 days of history for instant navigation (same pattern as Schedule)
  useEffect(() => {
    if (!user?.id || !currentLocation?.id || timezoneLoading) return;
    
    const today = new Date();
    const pastDates = eachDayOfInterval({
      start: subDays(today, 14),
      end: subDays(today, 1) // Don't prefetch today - it's fetched by current query
    });

    pastDates.forEach(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // Prefetch completion-history for each past day (include closeTime in key)
      queryClient.prefetchQuery({
        queryKey: ['completion-history', dateStr, user.id, currentLocation.id, closeTime],
        staleTime: 60 * 60 * 1000, // 1 hour for historical data
      });
      
      // Prefetch completed-temp-tasks for each past day (include closeTime in key)
      queryClient.prefetchQuery({
        queryKey: ['completed-temp-tasks', dateStr, currentLocation.id, closeTime],
        staleTime: 60 * 60 * 1000, // 1 hour for historical data
      });
    });
  }, [user?.id, currentLocation?.id, queryClient, closeTime, timezoneLoading]);

  // Use timezone-aware day of week for display
  const currentDayIndex = getDayOfWeekInTimezone(timezone);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // Only show skeleton on true initial load (no cached data yet)
  const hasNoData = checklists.length === 0 && !submissionStats;
  if ((checklistsLoading || statsLoading) && hasNoData) {
    return (
      <Layout>
        <div className="container max-w-6xl mx-auto p-6">
          <PageSkeleton variant="grid" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        <Tabs defaultValue="history" className="w-full">
          <div className="mb-4">
            <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row gap-4">
              <div className="space-y-3">
                <h1 className="text-3xl font-bold">Tasks</h1>
                <TabsList>
                  <TabsTrigger value="history">History</TabsTrigger>
                  {(isAdmin || isManager) && (
                    <TabsTrigger value="edit">Edit</TabsTrigger>
                  )}
                </TabsList>
              </div>
            </div>
            <PageHeaderDivider />
          </div>

          <TabsContent value="history" className="space-y-4">
            {/* Date Navigator */}
            <DateNavigator
              onPrev={() => setHistoryDate(subDays(historyDate, 1))}
              onNext={() => setHistoryDate(addDays(historyDate, 1))}
              label={`${format(historyDate, 'EEEE')}, ${format(historyDate, 'MMM d')}`}
              canGoNext={format(historyDate, 'yyyy-MM-dd') < format(new Date(), 'yyyy-MM-dd')}
            />

            {/* Timeline View */}
            <TasksHistoryTimeline
              historyStats={historyStats}
              completedTempTasks={completedTempTasks}
              eventCompletions={eventCompletions}
              logbookEntries={logbookEntries}
              selectedDate={historyDate}
              onTaskClick={setSelectedCompletedTask}
            />
          </TabsContent>

          <TabsContent value="edit" className="space-y-6">
            {/* Lazy-load Edit tab content with Suspense fallback */}
            <Suspense fallback={<PageSkeleton variant="grid" />}>
              <EditTabContent
                checklists={checklists}
                isAdmin={isAdmin}
                isManager={isManager}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      <CompletedTaskDetailsDialog
        open={!!selectedCompletedTask}
        onOpenChange={(open) => !open && setSelectedCompletedTask(null)}
        task={selectedCompletedTask}
      />
    </Layout>
  );
}
