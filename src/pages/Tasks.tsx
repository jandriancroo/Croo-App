import { useState, Suspense, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { DateNavigator } from "@/components/ui/date-navigator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek } from "date-fns";
import { CompletedTaskDetailsDialog } from '@/components/tasks/CompletedTaskDetailsDialog';
import { TasksHistoryTimeline } from '@/components/history/TasksHistoryTimeline';
import { useTasksData } from '@/hooks/useTasksData';
import { Layers, Grid3x3 } from 'lucide-react';
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


  // SVG circle params
  const circleSize = 44;
  const strokeWidth = 4.5;
  const radius = (circleSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionPercent / 100) * circumference;

  return (
    <Layout>
      <div className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <PageTitle color="blue" action={
              <div className="relative size-11">
                <svg width={circleSize} height={circleSize} className="size-11 -rotate-90">
                  <circle cx={circleSize / 2} cy={circleSize / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
                  <circle
                    cx={circleSize / 2} cy={circleSize / 2} r={radius} fill="none"
                    stroke={completionPercent === 100 ? 'hsl(142, 71%, 45%)' : 'hsl(var(--primary))'}
                    strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round" className="transition-all duration-500"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-foreground">
                  {completionPercent}%
                </span>
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
