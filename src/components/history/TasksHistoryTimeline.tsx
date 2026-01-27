import { useMemo } from 'react';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { 
  ClipboardCheck, 
  ClipboardList, 
  CheckCircle2,
  
  Bell,
  History as HistoryIcon
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
}

interface CompletedTask {
  id: string;
  title: string;
  description: string | null;
  completed_at: string;
  accent_color: string | null;
  task_style?: string | null;
  subtaskTotal: number;
  subtaskCompleted: number;
  completerName: string | null;
  completerPhoto: string | null;
}

interface TasksHistoryTimelineProps {
  historyStats: ChecklistStat[] | undefined;
  completedTempTasks: CompletedTask[];
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
  selectedDate,
  onTaskClick 
}: TasksHistoryTimelineProps) {
  const navigate = useNavigate();
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const dayLabel = isToday ? 'Today' : format(selectedDate, 'EEEE');
  const dateLabel = format(selectedDate, 'MMMM d, yyyy');

  // Combine checklists and tasks into timeline items
  const timelineItems = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'checklist' | 'task' | 'alarm';
      title: string;
      completionLevel: number;
      contributors: Contributor[];
      totalItems?: number;
      completedItems?: number;
      accentColor?: string;
      onClick?: () => void;
    }> = [];

    // Add checklists
    historyStats?.forEach(stat => {
      items.push({
        id: `checklist-${stat.id}`,
        type: 'checklist',
        title: stat.title,
        completionLevel: Math.round(stat.completionRate * 100),
        contributors: stat.contributors,
        totalItems: stat.itemCount,
        completedItems: stat.completedCount,
        onClick: () => navigate(`/complete-checklist/${stat.id}?date=${format(selectedDate, 'yyyy-MM-dd')}`),
      });
    });

    // Add completed tasks
    completedTempTasks.forEach(task => {
      const isAlarm = task.task_style === 'alarm';
      items.push({
        id: `task-${task.id}`,
        type: isAlarm ? 'alarm' : 'task',
        title: task.title,
        completionLevel: 100,
        contributors: task.completerName ? [{ name: task.completerName, photo: task.completerPhoto }] : [],
        accentColor: task.accent_color || undefined,
        onClick: () => onTaskClick(task),
      });
    });

    return items;
  }, [historyStats, completedTempTasks, navigate, selectedDate, onTaskClick]);

  const alarmCount = timelineItems.filter(i => i.type === 'alarm').length;
  const regularCount = timelineItems.filter(i => i.type !== 'alarm').length;

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
          {alarmCount > 0 && (
            <Badge variant="outline" className="text-[10px] sm:text-xs gap-0.5 px-1.5">
              <Bell className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              {alarmCount}
            </Badge>
          )}
        </div>
      </div>
      
      <div className="relative ml-2 sm:ml-4">
        {/* Vertical line */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border" />
        
        {timelineItems.map((item) => {
          // Mini inline row for alarm tasks
          if (item.type === 'alarm') {
            return (
              <div 
                key={item.id} 
                className="relative flex items-center mb-1 pl-4 sm:pl-8 cursor-pointer"
                onClick={item.onClick}
              >
                {/* Timeline dot - smaller for alarms */}
                <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-400 ring-2 ring-background" />
                </div>
                
                {/* Compact inline content - amber accent */}
                <div className="flex items-center gap-1 sm:gap-2 py-0.5 px-2 bg-amber-500/15 border border-amber-500/30 rounded-full text-[10px] sm:text-xs">
                  <Bell className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-amber-600 shrink-0" />
                  <span className="text-foreground font-medium">{item.title}</span>
                  <CheckCircle2 className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-500 shrink-0" />
                </div>
              </div>
            );
          }

          // Regular card for other items - mobile optimized
          return (
            <div key={item.id} className="relative flex items-start mb-2 pl-4 sm:pl-8">
              {/* Timeline dot */}
              <div className="absolute left-0 top-2 -translate-x-1/2">
                <div 
                  className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ring-2 ring-background ${getTimelineDotColor(item.completionLevel)}`}
                />
              </div>
              
              <Card 
                className="flex-1 hover:shadow-md transition-shadow cursor-pointer"
                onClick={item.onClick}
              >
                <CardContent className="py-1.5 px-2 sm:py-2 sm:px-3">
                  {/* Single row: icon + title + completion */}
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <div 
                      className="p-1 rounded shrink-0"
                      style={{ 
                        backgroundColor: item.type === 'task' && item.accentColor
                          ? `${item.accentColor}20` 
                          : 'hsl(var(--muted))'
                      }}
                    >
                      {item.type === 'checklist' ? (
                        <ClipboardCheck className="h-4 w-4" />
                      ) : (
                        <ClipboardList className="h-4 w-4" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm truncate block">{item.title}</span>
                    </div>
                    
                    <div className="shrink-0">
                      {item.completionLevel === 100 ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <span className={`text-[10px] sm:text-xs font-medium ${getCompletionColor(item.completionLevel)}`}>
                          {item.completionLevel}%
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Contributors row - compact avatars only on mobile */}
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <div className="flex items-center gap-0.5">
                      {item.contributors.slice(0, 5).map((contributor, idx) => (
                        <Avatar key={idx} className="h-5 w-5 -ml-1 first:ml-0 ring-1 ring-background">
                          {contributor.photo && (
                            <AvatarImage src={contributor.photo} />
                          )}
                          <AvatarFallback className="text-[9px] font-medium bg-primary/20 text-primary">
                            {contributor.name?.charAt(0) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {item.contributors.length > 5 && (
                        <Avatar className="h-5 w-5 -ml-1 ring-1 ring-background">
                          <AvatarFallback className="text-[9px] font-medium bg-muted">
                            +{item.contributors.length - 5}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-1 hidden sm:inline">
                        {item.contributors.map(c => c.name).join(', ')}
                      </span>
                    </div>
                    
                    {item.type === 'checklist' && item.totalItems && (
                      <span className="text-[10px] text-muted-foreground">
                        {item.completedItems}/{item.totalItems} items
                      </span>
                    )}
                  </div>
                  
                  {item.completionLevel < 100 && (
                    <Progress value={item.completionLevel} className="h-1 mt-1.5" />
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
