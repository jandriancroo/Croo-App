import { useState, Suspense, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { DateNavigator } from "@/components/ui/date-navigator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek } from "date-fns";
import { CompletedTaskDetailsDialog } from '@/components/tasks/CompletedTaskDetailsDialog';
import { TasksHistoryTimeline } from '@/components/history/TasksHistoryTimeline';
import { useTasksData } from '@/hooks/useTasksData';
import { Layers, Grid3x3, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import { PageTitle } from '@/components/PageTitle';

// Lazy-load Edit tab components to defer DnD bundle
const EditTabContent = lazyWithRetry(() => import('@/components/tasks/EditTabContent'));
// Heatmap only mounts when the user selects it
const ChecklistHeatmap = lazyWithRetry(() =>
  import('@/components/history/ChecklistHeatmap').then(m => ({ default: m.ChecklistHeatmap }))
);

export default function Tasks() {
  const [activeTab, setActiveTab] = useState('history');

  const {
    isAdmin,
    isManager,
    checklists,
    checklistsLoading,
    historyStats,
    completedTempTasks,
    eventCompletions,
    logbookEntries,
    historyDate,
    setHistoryDate,
  } = useTasksData({ editTabActive: activeTab === 'edit' });

  const [selectedCompletedTask, setSelectedCompletedTask] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'heatmap'>('grouped');
  const [heatmapRange, setHeatmapRange] = useState<'week' | 'month'>('week');

  // Calculate completion percentage
  const completionPercent = useMemo(() => {
    if (!historyStats || historyStats.length === 0) return 0;
    const total = historyStats.reduce((sum, s) => sum + Math.round(s.completionRate * 100), 0);
    return Math.round(total / historyStats.length);
  }, [historyStats]);

  // Track if we're in initial load (no cached data yet)
  const isInitialLoading = checklistsLoading && checklists.length === 0 && !historyStats;


  const isHistoryToday = format(historyDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const { doneCount, totalCount } = useMemo(() => {
    const stats = historyStats || [];
    return {
      doneCount: stats.reduce((sum: number, s: any) => sum + (s.completedCount || 0), 0),
      totalCount: stats.reduce((sum: number, s: any) => sum + (s.itemCount || 0), 0),
    };
  }, [historyStats]);
  const tasksStatusText = totalCount === 0
    ? (isHistoryToday ? 'NO TASKS TODAY' : `NO TASKS · ${format(historyDate, 'MMM d').toUpperCase()}`)
    : isHistoryToday
      ? `${doneCount} OF ${totalCount} DONE TODAY`
      : `${doneCount} OF ${totalCount} DONE · ${format(historyDate, 'MMM d').toUpperCase()}`;

  return (
    <Layout>
      <div className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <PageTitle color="blue" status={{ text: tasksStatusText }} action={
              <div
                className="relative size-10 md:size-11 shrink-0"
                aria-label={`${completionPercent}% done`}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 40 40"
                  className="absolute inset-0 size-full -rotate-90"
                  fill="none"
                >
                  <circle cx="20" cy="20" r="18" strokeWidth="4" className="stroke-[hsl(var(--muted))]" />
                  {completionPercent > 0 && (
                    <circle
                      cx="20" cy="20" r="18" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={`${(completionPercent / 100) * 2 * Math.PI * 18} ${2 * Math.PI * 18}`}
                      className={completionPercent >= 100 ? 'stroke-[hsl(var(--status-on-track))]' : 'stroke-[hsl(var(--primary))]'}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  {completionPercent >= 100 ? (
                    <Check aria-hidden className="h-4 w-4 text-[hsl(var(--status-on-track))]" strokeWidth={3} />
                  ) : (
                    <span aria-hidden className="text-xs font-bold tabular-nums leading-none text-foreground">
                      {completionPercent}%
                    </span>
                  )}
                </div>
              </div>
          }>Tasks</PageTitle>
          <div>
                <TabsList>
                  <TabsTrigger value="history">History</TabsTrigger>
                  {(isAdmin || isManager) && (
                    <TabsTrigger value="edit">Edit</TabsTrigger>
                  )}
                </TabsList>
          </div>

          <TabsContent value="history" className="space-y-4">
            {isInitialLoading ? (
              <PageSkeleton variant="grid" />
            ) : (
              <>
                {/* View toggle ABOVE date navigator */}
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedControl
                    variant="neutral"
                    fullWidth
                    className="min-w-[250px] flex-1"
                    value={viewMode}
                    onValueChange={(v) => setViewMode(v)}
                    options={[
                      { value: 'grouped', label: 'By Category', icon: <Layers />, ariaLabel: 'Grouped view' },
                      { value: 'heatmap', label: 'Heatmap', icon: <Grid3x3 />, ariaLabel: 'Heatmap view' },
                    ]}
                  />

                  {/* When in heatmap mode, show week/month sub-toggle */}
                  {viewMode === 'heatmap' && (
                    <SegmentedControl
                      variant="neutral"
                      className="shrink-0"
                      value={heatmapRange}
                      onValueChange={(v) => setHeatmapRange(v)}
                      options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
                    />
                  )}
                </div>

                {/* Date navigator — steps by day / week / month based on view */}
                <DateNavigator
                  onPrev={() => {
                    if (viewMode === 'grouped') setHistoryDate(subDays(historyDate, 1));
                    else if (heatmapRange === 'week') setHistoryDate(subWeeks(historyDate, 1));
                    else setHistoryDate(subMonths(historyDate, 1));
                  }}
                  onNext={() => {
                    if (viewMode === 'grouped') setHistoryDate(addDays(historyDate, 1));
                    else if (heatmapRange === 'week') setHistoryDate(addWeeks(historyDate, 1));
                    else setHistoryDate(addMonths(historyDate, 1));
                  }}
                  label={
                    viewMode === 'grouped'
                      ? (format(historyDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                          ? `Today, ${format(historyDate, 'MMM d')}`
                          : `${format(historyDate, 'EEEE')}, ${format(historyDate, 'MMM d')}`)
                      : heatmapRange === 'week'
                        ? `Week of ${format(startOfWeek(historyDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
                        : format(historyDate, 'MMMM yyyy')
                  }
                  canGoNext={
                    viewMode === 'grouped'
                      ? format(historyDate, 'yyyy-MM-dd') < format(new Date(), 'yyyy-MM-dd')
                      : historyDate < new Date()
                  }
                  className="w-full"
                />

                {viewMode === 'grouped' ? (
                  <TasksHistoryTimeline
                    historyStats={historyStats}
                    completedTempTasks={completedTempTasks}
                    eventCompletions={eventCompletions}
                    logbookEntries={logbookEntries}
                    selectedDate={historyDate}
                    viewMode="grouped"
                    onTaskClick={setSelectedCompletedTask}
                  />
                ) : (
                  <Suspense fallback={<PageSkeleton variant="grid" />}>
                    <ChecklistHeatmap anchorDate={historyDate} range={heatmapRange} />
                  </Suspense>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="edit" className="space-y-6">
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
