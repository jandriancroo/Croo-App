import { useState, Suspense, useMemo } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { DateNavigator } from "@/components/ui/date-navigator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, addDays, subDays } from "date-fns";
import { CompletedTaskDetailsDialog } from '@/components/tasks/CompletedTaskDetailsDialog';
import { TasksHistoryTimeline } from '@/components/history/TasksHistoryTimeline';
import { useTasksData } from '@/hooks/useTasksData';
import { Layers, LayoutList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

// Lazy-load Edit tab components to defer DnD bundle
const EditTabContent = lazyWithRetry(() => import('@/components/tasks/EditTabContent'));

export default function Tasks() {
  const {
    isAdmin,
    isManager,
    checklists,
    checklistsLoading,
    submissionStats,
    statsLoading,
    historyStats,
    completedTempTasks,
    eventCompletions,
    logbookEntries,
    historyDate,
    setHistoryDate,
  } = useTasksData();

  const [selectedCompletedTask, setSelectedCompletedTask] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'timeline'>('grouped');

  // Calculate completion percentage
  const completionPercent = useMemo(() => {
    if (!historyStats || historyStats.length === 0) return 0;
    const total = historyStats.reduce((sum, s) => sum + Math.round(s.completionRate * 100), 0);
    return Math.round(total / historyStats.length);
  }, [historyStats]);

  // Track if we're in initial load (no cached data yet)
  const hasNoData = checklists.length === 0 && !submissionStats;
  const isInitialLoading = (checklistsLoading || statsLoading) && hasNoData;

  // SVG circle params
  const circleSize = 62;
  const strokeWidth = 4.5;
  const radius = (circleSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (completionPercent / 100) * circumference;

  return (
    <Layout>
      <div className="space-y-4">
        <Tabs defaultValue="history" className="w-full">
          <div className="mb-4">
            <div className="flex justify-between items-start gap-4">
              <div className="space-y-3">
                <h1 className="text-3xl font-bold">Tasks</h1>
                <TabsList>
                  <TabsTrigger value="history">History</TabsTrigger>
                  {(isAdmin || isManager) && (
                    <TabsTrigger value="edit">Edit</TabsTrigger>
                  )}
                </TabsList>
              </div>
              {/* Completion circle - right aligned */}
              <div className="relative mt-1">
                <svg width={circleSize} height={circleSize} className="-rotate-90">
                  <circle cx={circleSize / 2} cy={circleSize / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={strokeWidth} />
                  <circle
                    cx={circleSize / 2} cy={circleSize / 2} r={radius} fill="none"
                    stroke={completionPercent === 100 ? 'hsl(142, 71%, 45%)' : 'hsl(var(--primary))'}
                    strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round" className="transition-all duration-500"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">
                  {completionPercent}%
                </span>
              </div>
            </div>
            <PageHeaderDivider />
          </div>

          <TabsContent value="history" className="space-y-4">
            {isInitialLoading ? (
              <PageSkeleton variant="grid" />
            ) : (
              <>
                {/* View toggle + Date navigator row */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-muted rounded-lg p-0.5">
                    <button
                      onClick={() => setViewMode('grouped')}
                      className={cn(
                        'p-1.5 rounded-md transition-colors',
                        viewMode === 'grouped' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                      )}
                      aria-label="Grouped view"
                    >
                      <Layers className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('timeline')}
                      className={cn(
                        'p-1.5 rounded-md transition-colors',
                        viewMode === 'timeline' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                      )}
                      aria-label="Timeline view"
                    >
                      <LayoutList className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1">
                    <DateNavigator
                      onPrev={() => setHistoryDate(subDays(historyDate, 1))}
                      onNext={() => setHistoryDate(addDays(historyDate, 1))}
                      label={format(historyDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') 
                        ? `Today, ${format(historyDate, 'MMM d')}` 
                        : `${format(historyDate, 'EEEE')}, ${format(historyDate, 'MMM d')}`}
                      canGoNext={format(historyDate, 'yyyy-MM-dd') < format(new Date(), 'yyyy-MM-dd')}
                      className="w-full"
                    />
                  </div>
                </div>

                <TasksHistoryTimeline
                  historyStats={historyStats}
                  completedTempTasks={completedTempTasks}
                  eventCompletions={eventCompletions}
                  logbookEntries={logbookEntries}
                  selectedDate={historyDate}
                  viewMode={viewMode}
                  onTaskClick={setSelectedCompletedTask}
                />
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
