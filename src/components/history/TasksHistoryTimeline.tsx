import { useMemo } from 'react';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { 
  ClipboardCheck, 
  ClipboardList, 
  CheckCircle2,
  Bell,
  Calendar,
  BookOpen,
  History as HistoryIcon
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
  onTaskClick: (task: CompletedTask) => void;
}

const getTimelineDotColor = (level: number) => {
  if (level === 100) return 'bg-emerald-500';
  if (level >= 80) return 'bg-amber-500';
  return 'bg-destructive';
};

const getCompletionColor = (level: number) => {
  if (level === 100) return 'text-emerald-500';
  if (level >= 80) return 'text-amber-500';
  return 'text-destructive';
};

export function TasksHistoryTimeline({ 
  historyStats, 
  completedTempTasks, 
  eventCompletions,
  logbookEntries,
  selectedDate,
  onTaskClick 
}: TasksHistoryTimelineProps) {
  const navigate = useNavigate();
  const { timezone } = useLocationTimezone();
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const dayLabel = isToday ? 'Today' : format(selectedDate, 'EEEE');
  const dateLabel = format(selectedDate, 'MMMM d, yyyy');

  // Combine all items into timeline, sorted chronologically
  const timelineItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'checklist' | 'task' | 'alarm' | 'alarm-missed' | 'event' | 'logbook';
      title: string;
      description?: string | null;
      completionLevel: number;
      contributors: Contributor[];
      totalItems?: number;
      completedItems?: number;
      accentColor?: string;
      completedAt?: string; // ISO timestamp for sorting and display
      displayTime?: string; // Formatted time for display
      onClick?: () => void;
    }> = [];

    // Add checklists with their last completion time
    // For monthly checklists, don't show a time since they accumulate across days
    historyStats?.forEach(stat => {
      const isMonthlyChecklist = stat.title?.toLowerCase().includes('monthly');
      
      // Only show time for non-monthly checklists (daily/weekly)
      const displayTime = (!isMonthlyChecklist && stat.lastCompletedAt)
        ? formatInTimeZone(new Date(stat.lastCompletedAt), timezone, 'h:mm a')
        : undefined;
      
      // Monthly checklists should sort by title at the bottom (no time = end of list)
      // Daily checklists sort by their last completion time
      const completedAt = isMonthlyChecklist ? undefined : (stat.lastCompletedAt || undefined);
      
      items.push({
        id: `checklist-${stat.id}`,
        type: 'checklist',
        title: stat.title,
        completionLevel: Math.round(stat.completionRate * 100),
        contributors: stat.contributors,
        totalItems: stat.itemCount,
        completedItems: stat.completedCount,
        completedAt,
        displayTime,
        onClick: () => navigate(`/complete-checklist/${stat.id}?date=${format(selectedDate, 'yyyy-MM-dd')}`),
      });
    });

    // Add completed tasks with their completion times
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

    // Add logbook entries (safe counts, drawer counts)
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

    // Sort all items chronologically by completion time (earliest first)
    // Items without times (monthly checklists) go to the BOTTOM
    return items.sort((a, b) => {
      if (!a.completedAt && !b.completedAt) return 0;
      if (!a.completedAt) return 1;  // No time = bottom of list
      if (!b.completedAt) return -1; // Has time = above items without time
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    });
  }, [historyStats, completedTempTasks, eventCompletions, logbookEntries, navigate, selectedDate, onTaskClick, timezone]);

  const alarmCount = timelineItems.filter(i => i.type === 'alarm').length;
  const missedAlarmCount = timelineItems.filter(i => i.type === 'alarm-missed').length;
  const regularCount = timelineItems.filter(i => i.type !== 'alarm' && i.type !== 'alarm-missed').length;

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
    <div className="space-y-3">
      {/* Day header - compact on mobile */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full text-xs sm:text-sm font-semibold">
          {dayLabel}
        </div>
        <span className="text-xs sm:text-sm text-muted-foreground">{dateLabel}</span>
        <div className="flex-1 h-px bg-border hidden sm:block" />
        <div className="flex items-center gap-1.5 ml-auto">
          <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 sm:px-2">
            {regularCount}
          </Badge>
          {(alarmCount > 0 || missedAlarmCount > 0) && (
            <Badge variant="outline" className="text-[10px] sm:text-xs gap-0.5 px-1.5">
              <Bell className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              {alarmCount}/{alarmCount + missedAlarmCount}
            </Badge>
          )}
        </div>
      </div>
      
      <div className="relative ml-2 sm:ml-4">
        {/* Vertical line */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border" />
        
        {timelineItems.map((item) => {
          // --- Alarm pills (small, compact) ---
          if (item.type === 'alarm') {
            const contributor = item.contributors[0];
            return (
              <div key={item.id} className="relative flex items-center mb-1 pl-4 sm:pl-8 cursor-pointer" onClick={item.onClick}>
                <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-400 ring-2 ring-background" />
                </div>
                <div className="flex items-center gap-1 sm:gap-2 py-0.5 px-2 bg-amber-500/15 border border-amber-500/30 rounded-full text-[10px] sm:text-xs">
                  <Bell className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-amber-600 shrink-0" />
                  {item.displayTime && <span className="text-amber-700 dark:text-amber-400 font-medium shrink-0">{item.displayTime}</span>}
                  <span className="text-foreground font-medium">{item.title}</span>
                  <CheckCircle2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-500 shrink-0" />
                  {contributor && (
                    <>
                      <span className="text-muted-foreground mx-0.5">·</span>
                      <Avatar className="h-4 w-4 shrink-0">
                        {contributor.photo && <AvatarImage src={contributor.photo} />}
                        <AvatarFallback className="text-[8px] font-medium bg-primary/20 text-primary">{contributor.name?.charAt(0) || '?'}</AvatarFallback>
                      </Avatar>
                    </>
                  )}
                </div>
              </div>
            );
          }

          // --- Missed alarm pills (small, red) ---
          if (item.type === 'alarm-missed') {
            return (
              <div key={item.id} className="relative flex items-center mb-1 pl-4 sm:pl-8">
                <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-destructive ring-2 ring-background" />
                </div>
                <div className="flex items-center gap-1 sm:gap-2 py-0.5 px-2 bg-destructive/10 border border-destructive/30 rounded-full text-[10px] sm:text-xs">
                  <Bell className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-destructive shrink-0" />
                  {item.displayTime && <span className="text-destructive font-medium shrink-0">{item.displayTime}</span>}
                  <span className="text-muted-foreground font-medium">{item.title}</span>
                  <span className="text-destructive font-semibold text-[9px] sm:text-[10px] uppercase tracking-wider">Missed</span>
                </div>
              </div>
            );
          }

          // --- Determine pill styling by type ---
          let pillBg: string;
          let pillTextColor: string;
          let dotColor: string;
          let PillIcon: typeof ClipboardCheck;

          if (item.type === 'checklist') {
            const isComplete = item.completionLevel === 100;
            pillBg = isComplete 
              ? 'bg-emerald-500/10 border-emerald-500/30' 
              : item.completionLevel >= 50 
                ? 'bg-amber-500/10 border-amber-500/30' 
                : 'bg-muted/50 border-border';
            pillTextColor = isComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground';
            dotColor = getTimelineDotColor(item.completionLevel);
            PillIcon = ClipboardCheck;
          } else if (item.type === 'event') {
            pillBg = 'bg-blue-500/15 border-blue-500/30';
            pillTextColor = 'text-blue-600 dark:text-blue-400';
            dotColor = 'bg-blue-400';
            PillIcon = Calendar;
          } else if (item.type === 'logbook') {
            pillBg = 'bg-green-500/15 border-green-500/30';
            pillTextColor = 'text-green-600 dark:text-green-400';
            dotColor = 'bg-green-400';
            PillIcon = BookOpen;
          } else {
            // Quick tasks - teal/primary
            pillBg = 'bg-primary/10 border-primary/30';
            pillTextColor = 'text-primary';
            dotColor = 'bg-primary';
            PillIcon = ClipboardList;
          }

          const isLarger = item.type === 'checklist' || item.type === 'task';

          return (
            <div 
              key={item.id} 
              className="relative flex items-center mb-1.5 pl-4 sm:pl-8 cursor-pointer"
              onClick={item.onClick}
            >
              {/* Timeline dot */}
              <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ring-2 ring-background ${dotColor}`} />
              </div>
              
              {/* Pill */}
              <div className={`flex items-center gap-1.5 sm:gap-2 ${isLarger ? 'py-1 px-3 text-xs sm:text-sm' : 'py-0.5 px-2 text-[10px] sm:text-xs'} border rounded-full ${pillBg}`}>
                <PillIcon className={`${isLarger ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5 sm:h-3 sm:w-3'} shrink-0 ${pillTextColor}`} />
                
                {item.displayTime && (
                  <span className={`font-medium shrink-0 ${pillTextColor}`}>{item.displayTime}</span>
                )}
                
                <span className="text-foreground font-medium truncate max-w-[140px] sm:max-w-[220px]">{item.title}</span>
                
                {/* Completion indicator */}
                {item.type === 'checklist' && item.completionLevel < 100 ? (
                  <span className={`font-semibold shrink-0 ${getCompletionColor(item.completionLevel)}`}>
                    {item.completedItems}/{item.totalItems}
                  </span>
                ) : (
                  <CheckCircle2 className={`${isLarger ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5 sm:h-3 sm:w-3'} text-emerald-500 shrink-0`} />
                )}
                
                {/* Contributors */}
                {item.contributors.length > 0 && (
                  <>
                    <span className="text-muted-foreground mx-0.5">·</span>
                    <div className="flex items-center -space-x-1.5">
                      {item.contributors.slice(0, 4).map((contributor, idx) => (
                        <Avatar key={idx} className={`${isLarger ? 'h-5 w-5' : 'h-4 w-4'} ring-1 ring-background shrink-0`}>
                          {contributor.photo && <AvatarImage src={contributor.photo} />}
                          <AvatarFallback className={`${isLarger ? 'text-[8px]' : 'text-[7px]'} font-medium bg-primary/20 text-primary`}>
                            {contributor.name?.charAt(0) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {item.contributors.length > 4 && (
                        <Avatar className={`${isLarger ? 'h-5 w-5' : 'h-4 w-4'} ring-1 ring-background shrink-0`}>
                          <AvatarFallback className={`${isLarger ? 'text-[8px]' : 'text-[7px]'} font-medium bg-muted`}>
                            +{item.contributors.length - 4}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
