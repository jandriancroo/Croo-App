import { useMemo, memo } from 'react';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Card, CardContent } from '@/components/ui/card';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import { 
  ClipboardCheck, 
  ClipboardList, 
  CheckCircle2,
  Bell,
  Calendar,
  BookOpen,
  History as HistoryIcon,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

interface Contributor {
  name: string;
  photo: string | null;
}

interface ChecklistStat {
  id: string;
  title: string;
  completed: boolean;
  completionRate: number;
  itemCount: number;
  completedCount: number;
  contributors: Contributor[];
  lastCompletedAt?: string | null;
  dueByTime?: string | null;
}

interface CompletedTask {
  id: string;
  title: string;
  description?: string | null;
  completed_at: string;
  accent_color?: string | null;
  task_style?: string | null;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  completerName: string | null;
  completerPhoto: string | null;
}

interface EventCompletion {
  id: string;
  title: string;
  completed_at: string;
  accent_color: string | null;
  task_style: 'event';
  completerName: string | null;
  completerPhoto: string | null;
}

interface LogbookEntry {
  id: string;
  title: string;
  completed_at: string;
  task_style: 'logbook';
  completerName: string | null;
  completerPhoto: string | null;
}

interface TasksHistoryTimelineProps {
  historyStats: ChecklistStat[] | undefined;
  completedTempTasks: CompletedTask[];
  eventCompletions: EventCompletion[];
  logbookEntries: LogbookEntry[];
  selectedDate: Date;
  viewMode: 'grouped' | 'timeline';
  onTaskClick: (task: CompletedTask) => void;
}

interface TimelineItem {
  id: string;
  type: 'checklist' | 'task' | 'alarm' | 'alarm-missed' | 'event' | 'logbook';
  title: string;
  description?: string | null;
  completionLevel: number;
  contributors: Contributor[];
  totalItems?: number;
  completedItems?: number;
  accentColor?: string;
  completedAt?: string;
  displayTime?: string;
  onClick?: () => void;
}

// ── Shared helper ──
function ContributorAvatars({ contributors, size = 'md' }: { contributors: Contributor[]; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const textSize = size === 'md' ? 'text-[8px]' : 'text-[7px]';
  return (
    <div className="flex items-center -space-x-1.5">
      {contributors.slice(0, 4).map((c, i) => (
        <Avatar key={i} className={cn(sizeClass, 'ring-1 ring-background shrink-0')}>
          {c.photo && <AvatarImage src={c.photo} />}
          <AvatarFallback className={cn(textSize, 'font-medium bg-primary/20 text-primary')}>{c.name?.charAt(0) || '?'}</AvatarFallback>
        </Avatar>
      ))}
      {contributors.length > 4 && (
        <Avatar className={cn(sizeClass, 'ring-1 ring-background shrink-0')}>
          <AvatarFallback className={cn(textSize, 'font-medium bg-muted')}>+{contributors.length - 4}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

// ── Type config ──
const typeConfig = {
  checklist: { icon: ClipboardCheck, label: 'Checklist' },
  task: { icon: ClipboardList, label: 'Task' },
  alarm: { icon: Bell, label: 'Alarm' },
  'alarm-missed': { icon: Bell, label: 'Alarm' },
  event: { icon: Calendar, label: 'Event' },
  logbook: { icon: BookOpen, label: 'Logbook' },
};

// ══════════════════════════════════════════
// GROUPED VIEW (Option E from preview)
// ══════════════════════════════════════════
const GroupedView = memo(function GroupedView({ items }: { items: TimelineItem[] }) {
  const groups = useMemo(() => [
    { label: 'Events & Logbook', icon: Calendar, color: 'text-blue-600 dark:text-blue-400', items: items.filter(i => i.type === 'event' || i.type === 'logbook') },
    { label: 'Tasks', icon: ClipboardList, color: 'text-primary', items: items.filter(i => i.type === 'task') },
    { label: 'Checklists', icon: ClipboardCheck, color: 'text-emerald-600 dark:text-emerald-400', items: items.filter(i => i.type === 'checklist') },
    { label: 'Alarm Checks', icon: Bell, color: 'text-amber-600 dark:text-amber-400', items: items.filter(i => i.type === 'alarm' || i.type === 'alarm-missed') },
  ].filter(g => g.items.length > 0), [items]);

  return (
    <div className="space-y-4">
      {groups.map(group => {
        const GroupIcon = group.icon;
        const isAlarmGroup = group.label === 'Alarm Checks';
        const completedCount = isAlarmGroup
          ? group.items.filter(i => i.type === 'alarm').length
          : group.items.filter(i => i.completionLevel === 100).length;

        return (
          <div key={group.label}>
            <div className="flex items-center gap-2 mb-1">
              <GroupIcon className={cn('h-3.5 w-3.5', group.color)} />
              <span className="text-xs font-semibold text-foreground">{group.label}</span>
              <span className="text-[10px] text-muted-foreground">{completedCount}/{group.items.length}</span>
            </div>
            <div className="space-y-0.5 ml-5">
              {group.items.map(item => {
                const isMissed = item.type === 'alarm-missed';
                const isComplete = item.completionLevel === 100;
                const isChecklist = item.type === 'checklist';
                const anchorTime = isChecklist ? item.displayTime : (item.displayTime);

                return (
                  <div
                    key={item.id}
                    onClick={item.onClick}
                    className={cn('flex items-center gap-2 py-1 px-2 rounded-md cursor-pointer hover:bg-muted/40 transition-colors', isMissed && 'opacity-50')}
                  >
                    <span className="text-[10px] font-mono text-muted-foreground w-14 shrink-0">{anchorTime}</span>
                    <span className={cn('text-xs font-medium flex-1 truncate', isMissed && 'line-through text-muted-foreground')}>{item.title}</span>
                    {isMissed ? (
                      <span className="text-[9px] font-bold text-destructive uppercase">Missed</span>
                    ) : isChecklist && !isComplete ? (
                      <span className="text-[10px] font-bold text-amber-600">{item.completedItems}/{item.totalItems}</span>
                    ) : isComplete ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/20 shrink-0" />
                    )}
                    {item.contributors.length > 0 && <ContributorAvatars contributors={item.contributors} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});

// ══════════════════════════════════════════
// TIMELINE VIEW (Option D from preview)
// ══════════════════════════════════════════
const TimelineView = memo(function TimelineView({ items }: { items: TimelineItem[] }) {
  return (
    <div className="divide-y divide-border/40">
      {items.map(item => {
        const isMissed = item.type === 'alarm-missed';
        const isComplete = item.completionLevel === 100;
        const isChecklist = item.type === 'checklist';
        const anchorTime = isChecklist ? item.displayTime : (item.displayTime);
        const Icon = typeConfig[item.type].icon;

        const dotColorMap: Record<string, string> = {
          checklist: isComplete ? 'bg-emerald-500' : item.completionLevel > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30',
          task: 'bg-primary',
          alarm: 'bg-amber-400',
          'alarm-missed': 'bg-destructive',
          event: 'bg-blue-400',
          logbook: 'bg-green-400',
        };

        return (
          <div
            key={item.id}
            onClick={item.onClick}
            className={cn('flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-muted/20 transition-colors', isMissed && 'opacity-50')}
          >
            <span className="text-[10px] font-mono text-muted-foreground w-14 text-right shrink-0">{anchorTime || ''}</span>
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColorMap[item.type])} />
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <Icon className={cn('h-3 w-3 shrink-0', isMissed ? 'text-destructive' : 'text-muted-foreground')} />
              <span className={cn('text-xs font-medium truncate', isMissed && 'line-through')}>{item.title}</span>
            </div>
            {isMissed ? (
              <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
            ) : isChecklist && !isComplete ? (
              <span className="text-[10px] font-semibold text-amber-600 shrink-0">{item.completedItems}/{item.totalItems}</span>
            ) : isComplete ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/20 shrink-0" />
            )}
            {item.contributors.length > 0 && <ContributorAvatars contributors={item.contributors} size="sm" />}
            <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
          </div>
        );
      })}
    </div>
  );
});

// ══════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════
export function TasksHistoryTimeline({ 
  historyStats, 
  completedTempTasks, 
  eventCompletions,
  logbookEntries,
  selectedDate,
  viewMode,
  onTaskClick 
}: TasksHistoryTimelineProps) {
  const navigate = useNavigate();
  const { timezone } = useLocationTimezone();

  // Combine all items into timeline, sorted chronologically
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];

    // Add checklists with their last completion time
    historyStats?.forEach(stat => {
      const isMonthlyChecklist = stat.title?.toLowerCase().includes('monthly');
      
      // Use due_by_time as the anchor time for checklists
      let displayTime: string | undefined;
      let sortTime: string | undefined;
      
      if (stat.dueByTime && !isMonthlyChecklist) {
        // Parse HH:MM due_by_time and format for display
        const [hours, minutes] = stat.dueByTime.split(':').map(Number);
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        displayTime = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
        // Create a sortable timestamp from the due time
        const sortDate = new Date(selectedDate);
        sortDate.setHours(hours, minutes, 0, 0);
        sortTime = sortDate.toISOString();
      } else if (!isMonthlyChecklist && stat.lastCompletedAt) {
        displayTime = formatInTimeZone(new Date(stat.lastCompletedAt), timezone, 'h:mm a');
        sortTime = stat.lastCompletedAt;
      }
      
      items.push({
        id: `checklist-${stat.id}`,
        type: 'checklist',
        title: stat.title,
        completionLevel: Math.round(stat.completionRate * 100),
        contributors: stat.contributors,
        totalItems: stat.itemCount,
        completedItems: stat.completedCount,
        completedAt: sortTime,
        displayTime,
        onClick: () => navigate(`/complete-checklist/${stat.id}?date=${format(selectedDate, 'yyyy-MM-dd')}`),
      });
    });

    // Add completed tasks
    completedTempTasks.forEach(task => {
      const isAlarm = task.task_style === 'alarm';
      const isMissedAlarm = task.task_style === 'alarm-missed';
      const displayTime = task.completed_at 
        ? formatInTimeZone(new Date(task.completed_at), timezone, 'h:mm a')
        : undefined;
      
      items.push({
        id: `task-${task.id}`,
        type: isMissedAlarm ? 'alarm-missed' : isAlarm ? 'alarm' : 'task',
        title: task.title,
        description: task.description,
        completionLevel: 100,
        contributors: task.completerName ? [{ name: task.completerName, photo: task.completerPhoto }] : [],
        accentColor: task.accent_color || undefined,
        completedAt: task.completed_at,
        displayTime,
        onClick: () => onTaskClick(task),
      });
    });

    // Add event completions
    eventCompletions.forEach(event => {
      const displayTime = formatInTimeZone(new Date(event.completed_at), timezone, 'h:mm a');
      items.push({
        id: `event-${event.id}`,
        type: 'event',
        title: event.title,
        completionLevel: 100,
        contributors: event.completerName ? [{ name: event.completerName, photo: event.completerPhoto }] : [],
        accentColor: event.accent_color || undefined,
        completedAt: event.completed_at,
        displayTime,
        onClick: () => onTaskClick(event as any),
      });
    });

    // Add logbook entries
    logbookEntries.forEach(entry => {
      const displayTime = formatInTimeZone(new Date(entry.completed_at), timezone, 'h:mm a');
      items.push({
        id: `logbook-${entry.id}`,
        type: 'logbook',
        title: entry.title,
        completionLevel: 100,
        contributors: entry.completerName ? [{ name: entry.completerName, photo: entry.completerPhoto }] : [],
        completedAt: entry.completed_at,
        displayTime,
        onClick: () => onTaskClick(entry as any),
      });
    });

    // Sort chronologically; items without times go to bottom
    return items.sort((a, b) => {
      if (!a.completedAt && !b.completedAt) return 0;
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    });
  }, [historyStats, completedTempTasks, eventCompletions, logbookEntries, navigate, selectedDate, onTaskClick, timezone]);


  if (timelineItems.length === 0) {
    return (
      <Card className="text-center py-12">
        <CardContent>
          <HistoryIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No completions this day</h3>
          <p className="text-muted-foreground">Complete a checklist or task to see it here</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-3 px-3">
        {viewMode === 'grouped' ? (
          <GroupedView items={timelineItems} />
        ) : (
          <TimelineView items={timelineItems} />
        )}
      </CardContent>
    </Card>
  );
}
