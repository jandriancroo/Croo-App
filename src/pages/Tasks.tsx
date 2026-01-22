import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, FileCheck, Plus, Pencil, MoreVertical, Trash2, EyeOff, AlertCircle, GripVertical } from "lucide-react";
import { DateNavigator } from "@/components/ui/date-navigator";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TemplateTypeDialog } from "@/components/TemplateTypeDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format, addDays, subDays, eachDayOfInterval } from "date-fns";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableChecklistItem } from '@/components/tasks/SortableChecklistItem';
import { CopyChecklistDialog } from '@/components/tasks/CopyChecklistDialog';
import { TemporaryTasksSection } from '@/components/tasks/TemporaryTasksSection';
import { CompletedTaskDetailsDialog } from '@/components/tasks/CompletedTaskDetailsDialog';
import { getTodayInTimezone, getDateInTimezone, getStartOfDateInTimezone, getDayOfWeekInTimezone, getDateDayOfWeekInTimezone } from '@/utils/dateUtils';

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const { timezone, getBusinessDayRangeInTimezone, closeTime, loading: timezoneLoading } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [historyDate, setHistoryDate] = useState(new Date());
  const [isReordering, setIsReordering] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyChecklistIds, setCopyChecklistIds] = useState<string[]>([]);
  const [copyChecklistTitles, setCopyChecklistTitles] = useState<string[]>([]);
  const [selectedCompletedTask, setSelectedCompletedTask] = useState<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = checklists.findIndex((c: any) => c.id === active.id);
    const newIndex = checklists.findIndex((c: any) => c.id === over.id);
    
    const reorderedChecklists = arrayMove(checklists, oldIndex, newIndex);
    
    // Update display_order for all affected checklists
    const updates = reorderedChecklists.map((checklist: any, index: number) => ({
      id: checklist.id,
      display_order: index,
    }));

    try {
      // Batch update - all updates in parallel instead of sequential
      await Promise.all(
        updates.map(update => 
          supabase
            .from('checklists')
            .update({ display_order: update.display_order })
            .eq('id', update.id)
        )
      );
      
      toast.success("Checklist order updated");
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      queryClient.invalidateQueries({ queryKey: ['checklists'] });
    } catch (error) {
      toast.error("Failed to update order");
    }
  };

  const handleDeactivate = async (checklistId: string) => {
    const { error } = await supabase
      .from('checklists')
      .update({ is_active: false })
      .eq('id', checklistId);

    if (error) {
      toast.error("Failed to deactivate checklist");
      return;
    }

    toast.success("Checklist deactivated");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  const handleDelete = async (checklistId: string) => {
    const { error } = await supabase
      .from('checklists')
      .delete()
      .eq('id', checklistId);

    if (error) {
      toast.error("Failed to delete checklist");
      return;
    }

    toast.success("Checklist deleted");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  const handleCopyTo = (checklistId: string, checklistTitle: string) => {
    setCopyChecklistIds([checklistId]);
    setCopyChecklistTitles([checklistTitle]);
    setCopyDialogOpen(true);
  };

  // Fetch checklists for user's role (location-filtered)
  const { data: checklists = [], isLoading: checklistsLoading } = useQuery({
    queryKey: ['user-checklists', user?.id, isAdmin, currentLocation?.id],
    staleTime: 2 * 60 * 1000, // 2 min - show cached instantly, refresh in background
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

      // BATCH QUERY 1: Get all submissions for all checklists in one query
      // Use business day range to capture late-night submissions correctly
      const checklistIds = checklistInfo.map(c => c.id);
      const { data: allSubmissions } = await supabase
        .from('checklist_submissions')
        .select('id, checklist_id, submitted_by')
        .in('checklist_id', checklistIds)
        .gte('submitted_at', periodStartBusiness.toISOString())
        .lte('submitted_at', periodEndBusiness.toISOString());

      const submissionIds = allSubmissions?.map(s => s.id) || [];
      
      // BATCH QUERY 2: Get all responses for all submissions in one query
      let allResponses: any[] = [];
      if (submissionIds.length > 0) {
        const { data: responses } = await supabase
          .from('checklist_responses')
          .select('id, submission_id, completed_by')
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
        
        submissionIdsForChecklist.forEach(subId => {
          const responses = responsesBySubmission[subId] || [];
          completedCount += responses.length;
          responses.forEach((r: any) => {
            if (r.completed_by) contributorIds.add(r.completed_by);
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
          contributors
        };
      });
    },
    enabled: !!user && !!currentLocation?.id && !timezoneLoading,
  });

  // Fetch completed quick tasks for selected date
  // Historical data is immutable - cache for 1 hour, today's data refreshes more often
  const { data: completedTempTasks = [] } = useQuery({
    queryKey: ['completed-temp-tasks', historyDateStr, currentLocation?.id, closeTime],
    staleTime: isHistoryToday ? 2 * 60 * 1000 : 60 * 60 * 1000,
    gcTime: isHistoryToday ? 10 * 60 * 1000 : 60 * 60 * 1000,
    queryFn: async () => {
      if (!currentLocation?.id) return [];

      // Use business day range for consistency with checklists
      const { start: periodStart, end: periodEnd } = getBusinessDayRangeInTimezone(historyDateStr);

      const { data: tasks, error } = await supabase
        .from('temporary_tasks')
        .select('id, title, description, completed_at, completed_by, accent_color')
        .eq('location_id', currentLocation.id)
        .not('completed_at', 'is', null)
        .gte('completed_at', periodStart.toISOString())
        .lte('completed_at', periodEnd.toISOString())
        .order('completed_at', { ascending: false });

      if (error) throw error;
      if (!tasks || tasks.length === 0) return [];

      const taskIds = tasks.map(t => t.id);
      const completerIds = [...new Set(tasks.map(t => t.completed_by).filter(Boolean))] as string[];

      const [{ data: subtasks }, { data: completers }] = await Promise.all([
        supabase
          .from('temporary_task_subtasks')
          .select('task_id, completed_at')
          .in('task_id', taskIds),
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

      return tasks.map(t => {
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

  if (checklistsLoading || statsLoading) {
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

          <TabsContent value="history" className="space-y-6">

            {/* Completion History */}
            <Card>
              <CardHeader className="py-3">
              <DateNavigator
                  onPrev={() => setHistoryDate(subDays(historyDate, 1))}
                  onNext={() => setHistoryDate(addDays(historyDate, 1))}
                  label={`${format(historyDate, 'EEEE')}, ${format(historyDate, 'MMM d')}`}
                  canGoNext={format(historyDate, 'yyyy-MM-dd') < format(new Date(), 'yyyy-MM-dd')}
                />
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Checklists */}
                  <section className="space-y-4">
                    {historyStats && historyStats.length > 0 ? (
                      <div className="space-y-4">
                        {historyStats.map((stat: any) => {
                          const completionPercent = stat.completionRate * 100;
                          const isComplete = stat.completionRate === 1;
                          const isPartial = stat.completionRate > 0 && stat.completionRate < 1;
                          const barColor = isComplete ? 'bg-green-500' : isPartial ? 'bg-yellow-500' : 'bg-red-500';

                          return (
                            <div 
                              key={stat.id} 
                              className="p-4 rounded-lg border space-y-3 cursor-pointer hover:bg-muted/50 transition-colors"
                              onClick={() => navigate(`/complete-checklist/${stat.id}?date=${format(historyDate, 'yyyy-MM-dd')}`)}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{stat.title}</span>
                                <div className="text-xl">
                                  {isComplete ? '🎉' : isPartial ? '😕' : '😞'}
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>{stat.completedCount} of {stat.itemCount} items</span>
                                  <span>{completionPercent.toFixed(0)}%</span>
                                </div>
                                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full ${barColor} transition-all`}
                                    style={{ width: `${completionPercent}%` }}
                                  />
                                </div>
                              </div>

                              {/* Contributors */}
                              {stat.contributors.length > 0 && (
                                <div className="flex items-center gap-2 pt-2 border-t">
                                  <span className="text-xs text-muted-foreground">Completed by:</span>
                                  <div className="flex -space-x-2">
                                    {stat.contributors.slice(0, 5).map((contributor: any, idx: number) => (
                                      <div
                                        key={idx}
                                        className="h-8 w-8 rounded-full border-2 border-background overflow-hidden bg-muted"
                                        title={contributor.name}
                                      >
                                        {contributor.photo ? (
                                          <img 
                                            src={contributor.photo} 
                                            alt={contributor.name}
                                            className="h-full w-full object-cover"
                                          />
                                        ) : (
                                          <div className="h-full w-full flex items-center justify-center text-xs font-medium">
                                            {contributor.name?.charAt(0)}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    {stat.contributors.length > 5 && (
                                      <div className="h-8 w-8 rounded-full border-2 border-background bg-muted flex items-center justify-center text-xs">
                                        +{stat.contributors.length - 5}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          No checklists available for this date.
                        </AlertDescription>
                      </Alert>
                    )}
                  </section>

                  {/* Quick Tasks */}
                  <section className="space-y-3">
                    <div className="text-sm font-semibold">Quick Tasks</div>
                    {completedTempTasks.length > 0 ? (
                      <div className="space-y-3">
                        {completedTempTasks.map((t: any) => {
                          const total = t.subtaskTotal || 0;
                          const done = t.subtaskCompleted || 0;
                          const pct = total > 0 ? Math.round((done / total) * 100) : 100;

                          return (
                            <div 
                              key={t.id} 
                              className="p-4 rounded-lg border space-y-3 cursor-pointer hover:bg-muted/50 transition-colors"
                              onClick={() => setSelectedCompletedTask(t)}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    className="w-3 h-3 rounded-full shrink-0"
                                    style={{ backgroundColor: t.accent_color || '#8B5CF6' }}
                                  />
                                  <span className="font-medium truncate">{t.title}</span>
                                </div>
                                <div className="text-xl">🎉</div>
                              </div>

                              <div className="space-y-1">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span>{done} of {total} subtasks</span>
                                  <span>{pct}%</span>
                                </div>
                                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>

                              {(t.completerName || t.completerPhoto) && (
                                <div className="flex items-center gap-2 pt-2 border-t">
                                  <span className="text-xs text-muted-foreground">Completed by:</span>
                                  <div className="flex -space-x-2">
                                    <div
                                      className="h-8 w-8 rounded-full border-2 border-background overflow-hidden bg-muted"
                                      title={t.completerName || 'User'}
                                    >
                                      {t.completerPhoto ? (
                                        <img
                                          src={t.completerPhoto}
                                          alt={t.completerName || 'Completed by'}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center text-xs font-medium">
                                          {t.completerName?.charAt(0) || '?'}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {t.description && (
                                <p className="text-sm text-muted-foreground">{t.description}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No quick tasks completed on this date.</p>
                    )}
                  </section>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="edit" className="space-y-6">
            {/* Quick Tasks Section */}
            <TemporaryTasksSection />

            {/* Checklist Templates */}
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">Checklist Templates</CardTitle>
                  <div className="flex gap-2">
                    {isAdmin && checklists.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsReordering(!isReordering)}
                      >
                        {isReordering ? "Done" : "Reorder"}
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        size="icon"
                        onClick={() => setShowTemplateDialog(true)}
                        title="New Checklist"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {checklists.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No checklist templates available</p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={checklists.map((c: any) => c.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {checklists.map((checklist: any) => {
                          const isDynamic = checklist.template_type === 'dynamic';
                          return (
                            <SortableChecklistItem
                              key={checklist.id}
                              checklist={checklist}
                              isDynamic={isDynamic}
                              isReordering={isReordering}
                              isAdmin={isAdmin}
                              currentDay={currentDayIndex}
                              dayNames={dayNames}
                              onNavigate={navigate}
                              onDeactivate={handleDeactivate}
                              onDelete={handleDelete}
                              onCopyTo={handleCopyTo}
                              editMode={true}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <TemplateTypeDialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog} />
      <CopyChecklistDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        checklistIds={copyChecklistIds}
        checklistTitles={copyChecklistTitles}
      />
      <CompletedTaskDetailsDialog
        open={!!selectedCompletedTask}
        onOpenChange={(open) => !open && setSelectedCompletedTask(null)}
        task={selectedCompletedTask}
      />
    </Layout>
  );
}