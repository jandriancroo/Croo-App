import { useState, Suspense, useMemo, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { DateNavigator } from "@/components/ui/date-navigator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek } from "date-fns";
import { CompletedTaskDetailsDialog, CompletedTaskContent } from '@/components/tasks/CompletedTaskDetailsDialog';
import { useDuo } from '@/hooks/useDuo';
import { ChevronLeft } from 'lucide-react';
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
  const duo = useDuo();
  const [activeTab, setActiveTab] = useState('history');
  // Duo orb actions (New Quick Task / New Checklist) land on the Edit tab, then the Edit tab opens the right dialog.
  const [duoAction, setDuoAction] = useState<string | null>(null);
  useEffect(() => {
    if (!duo.isDuo) return;
    const go = (name: string) => () => { setActiveTab('edit'); setDuoAction(name); };
    const names = ['open-new-quick-task', 'open-quick-task-templates', 'open-new-checklist', 'open-copy-all-checklists'];
    const fns = names.map(go);
    names.forEach((n, i) => window.addEventListener(n, fns[i]));
    return () => names.forEach((n, i) => window.removeEventListener(n, fns[i]));
  }, [duo.isDuo]);

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
  const duoSpan: 'day' | 'week' | 'month' = viewMode === 'grouped' ? 'day' : heatmapRange;

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

  // Duo: the shared page line in the top band shows this status.
  useEffect(() => {
    if (!duo.isDuo) return;
    document.documentElement.dataset.duoStatus = tasksStatusText;
    return () => { delete document.documentElement.dataset.duoStatus; };
  }, [duo.isDuo, tasksStatusText]);

  const summary = (
    <div className="duo-tasks-summary">
      <div className="duo-tasks-big">{completionPercent}<small>%</small></div>
      <div className="duo-tasks-sub">{tasksStatusText.toLowerCase()}</div>
      <div className="duo-tasks-rows">
        {(historyStats || []).map((st: any) => (
          <div key={st.id} className="duo-tasks-row"><span>{st.title}</span><b>{st.completedCount}/{st.itemCount}</b></div>
        ))}
        {(completedTempTasks || []).length > 0 && <div className="duo-tasks-row"><span>Quick tasks done</span><b>{completedTempTasks.length}</b></div>}
      </div>
    </div>
  );

  return (
    <Layout>
      <div className={duo.isDuo ? (duo.isOpen ? 'duo-tasks-page duo-tasks-left space-y-4' : 'duo-tasks-page space-y-4') : 'space-y-4'}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {!duo.isDuo && <PageTitle color="blue" status={{ text: tasksStatusText }} action={
              <div
                className="relative size-10 md:size-11 shrink-0"
                role="img"
                aria-label={`${completionPercent}% done`}
              >
                {/* Same glyph as the dash checklist cards: thin ring, 3px gap,
                    pie wedge from the centre (r=4.5 + 9px stroke = r=9). */}
                <svg
                  aria-hidden
                  viewBox="0 0 28 28"
                  className="absolute inset-0 size-full"
                  fill="none"
                >
                  <circle cx="14" cy="14" r="13" strokeWidth="2" className="stroke-[hsl(var(--muted))]" />
                  {completionPercent > 0 && (
                    <circle
                      cx="14" cy="14" r="4.5"
                      strokeWidth="9"
                      strokeDasharray={`${(Math.min(100, Math.max(0, completionPercent)) / 100) * 2 * Math.PI * 4.5} ${2 * Math.PI * 4.5}`}
                      transform="rotate(-90 14 14)"
                      className="stroke-[hsl(var(--primary))]"
                    />
                  )}
                </svg>
              </div>
          }>Tasks</PageTitle>}
          <div className={duo.isDuo ? 'duo-tasks-ctl' : undefined}>
                <TabsList>
                  <TabsTrigger value="history">History</TabsTrigger>
                  {(isAdmin || isManager) && (
                    <TabsTrigger value="edit">Edit</TabsTrigger>
                  )}
                </TabsList>
                {duo.isDuo && activeTab === 'edit' && <span id="duo-tasks-subtabs" className="contents" />}
                {duo.isDuo && activeTab === 'history' && (
                  <SegmentedControl
                    variant="neutral"
                    value={duoSpan}
                    onValueChange={(v: 'day' | 'week' | 'month') => {
                      if (v === 'day') setViewMode('grouped');
                      else { setViewMode('heatmap'); setHeatmapRange(v); }
                    }}
                    options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
                  />
                )}
          </div>

          <TabsContent value="history" className="space-y-4">
            {isInitialLoading ? (
              <PageSkeleton variant="grid" />
            ) : (
              <>
                {/* View toggle ABOVE date navigator */}
                <div className={cn("flex flex-wrap items-center gap-2", duo.isDuo && "hidden")}>
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
                  className="w-full duo-ctl"
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
                duoAction={duoAction}
                onDuoActionDone={() => setDuoAction(null)}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      {duo.isOpen && (
        <aside className="duo-tasks-dock">
          <div id="duo-tasks-detail" />
          {selectedCompletedTask ? (
            <>
              <button type="button" className="duo-tasks-back" onClick={() => setSelectedCompletedTask(null)}><ChevronLeft size={16} /> Day summary</button>
              <CompletedTaskContent task={selectedCompletedTask} dock />
            </>
          ) : summary}
        </aside>
      )}
      <CompletedTaskDetailsDialog
        open={!duo.isOpen && !!selectedCompletedTask}
        onOpenChange={(open) => !open && setSelectedCompletedTask(null)}
        task={selectedCompletedTask}
      />
    </Layout>
  );
}
