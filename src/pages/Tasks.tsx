import { useState, lazy, Suspense } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { DateNavigator } from "@/components/ui/date-navigator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, addDays, subDays } from "date-fns";
import { CompletedTaskDetailsDialog } from '@/components/tasks/CompletedTaskDetailsDialog';
import { TasksHistoryTimeline } from '@/components/history/TasksHistoryTimeline';
import { useTasksData } from '@/hooks/useTasksData';

// Lazy-load Edit tab components to defer DnD bundle
const EditTabContent = lazy(() => import('@/components/tasks/EditTabContent'));

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
    historyDateStr,
  } = useTasksData();

  const [selectedCompletedTask, setSelectedCompletedTask] = useState<any>(null);

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
            <DateNavigator
              onPrev={() => setHistoryDate(subDays(historyDate, 1))}
              onNext={() => setHistoryDate(addDays(historyDate, 1))}
              label={`${format(historyDate, 'EEEE')}, ${format(historyDate, 'MMM d')}`}
              canGoNext={format(historyDate, 'yyyy-MM-dd') < format(new Date(), 'yyyy-MM-dd')}
            />

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
