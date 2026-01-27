import { useState } from 'react';
import { format, subDays, addDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { 
  ClipboardCheck, 
  ClipboardList, 
  ChevronRight,
  ChevronLeft,
  UtensilsCrossed,
  CalendarCheck,
  CheckCircle2,
  CalendarIcon,
  Clock,
  Bell,
  History as HistoryIcon
} from 'lucide-react';

interface Contributor {
  name: string;
  photoUrl?: string | null;
  completedAt: string;
  itemsCompleted: number;
}

export interface HistoryTimelineItem {
  id: string;
  type: 'checklist' | 'task' | 'catering' | 'event' | 'alarm';
  title: string;
  frequency?: string;
  accentColor?: string;
  customerName?: string;
  eventName?: string;
  contributors: Contributor[];
  finalCompletedAt: string;
  completionLevel: number;
  totalItems?: number;
  completedItems?: number;
  subtasks?: number;
  completedSubtasks?: number;
  itemCount?: number;
  notes?: string | null;
  onView?: () => void;
}

interface HistoryTimelineViewProps {
  items: HistoryTimelineItem[];
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  isLoading?: boolean;
}

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'checklist': return <ClipboardCheck className="h-4 w-4" />;
    case 'task': return <ClipboardList className="h-4 w-4" />;
    case 'catering': return <UtensilsCrossed className="h-4 w-4" />;
    case 'event': return <CalendarCheck className="h-4 w-4" />;
    case 'alarm': return <Bell className="h-3 w-3" />;
    default: return <CheckCircle2 className="h-4 w-4" />;
  }
};

const getCompletionColor = (level: number) => {
  if (level === 100) return 'text-emerald-500';
  if (level >= 80) return 'text-amber-500';
  return 'text-destructive';
};

const getTimelineDotColor = (level: number) => {
  if (level === 100) return 'bg-emerald-500';
  if (level >= 80) return 'bg-amber-500';
  return 'bg-destructive';
};

// Date Selector Component
const DateSelector = ({ selectedDate, onDateChange }: { selectedDate: Date; onDateChange: (date: Date) => void }) => {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  
  return (
    <div className="flex items-center justify-between gap-2 p-3 bg-card rounded-xl border border-border shadow-sm">
      <Button 
        variant="ghost" 
        size="icon"
        onClick={() => onDateChange(subDays(selectedDate, 1))}
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>
      
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="gap-2 font-semibold">
            <CalendarIcon className="h-4 w-4" />
            {format(selectedDate, 'EEEE, MMM d, yyyy')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <CalendarComponent
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date) {
                onDateChange(date);
                setCalendarOpen(false);
              }
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
      
      <Button 
        variant="ghost" 
        size="icon"
        onClick={() => onDateChange(addDays(selectedDate, 1))}
        disabled={isToday}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
};

export function HistoryTimelineView({ items, selectedDate, onDateChange, isLoading }: HistoryTimelineViewProps) {
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const dayLabel = isToday ? 'Today' : format(selectedDate, 'EEEE');
  const dateLabel = format(selectedDate, 'MMMM d, yyyy');

  // Sort items by completion time - earliest first (top of screen)
  const sortedItems = [...items].sort((a, b) => {
    const parseTime = (time: string) => {
      const [timePart, period] = time.split(' ');
      let [hours, minutes] = timePart.split(':').map(Number);
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };
    return parseTime(a.finalCompletedAt) - parseTime(b.finalCompletedAt);
  });

  const alarmCount = items.filter(i => i.type === 'alarm').length;
  const regularCount = items.filter(i => i.type !== 'alarm').length;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <DateSelector selectedDate={selectedDate} onDateChange={onDateChange} />
        <div className="text-center text-muted-foreground py-12">Loading history...</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <DateSelector selectedDate={selectedDate} onDateChange={onDateChange} />
        <Card className="text-center py-12">
          <CardContent>
            <HistoryIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No completions this day</h3>
            <p className="text-muted-foreground">Complete a checklist or task to see it here</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DateSelector selectedDate={selectedDate} onDateChange={onDateChange} />
      
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
          
          {sortedItems.map((item) => {
            // Mini inline row for alarm tasks
            if (item.type === 'alarm') {
              return (
                <div key={item.id} className="relative flex items-center mb-1 pl-4 sm:pl-8">
                  {/* Timeline dot - smaller for alarms */}
                  <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-amber-400 ring-2 ring-background" />
                  </div>
                  
                  {/* Compact inline content - amber accent */}
                  <div className="flex items-center gap-1 sm:gap-2 py-0.5 px-2 bg-amber-500/15 border border-amber-500/30 rounded-full text-[10px] sm:text-xs">
                    <Bell className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-amber-600 shrink-0" />
                    <span className="text-amber-700 dark:text-amber-400 font-medium shrink-0">{item.finalCompletedAt}</span>
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
                  onClick={item.onView}
                >
                  <CardContent className="py-1.5 px-2 sm:py-2 sm:px-3">
                    {/* Single row: icon + title + time + completion */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <div 
                        className="p-1 rounded shrink-0"
                        style={{ 
                          backgroundColor: item.type === 'task' && item.accentColor
                            ? `${item.accentColor}20` 
                            : 'hsl(var(--muted))'
                        }}
                      >
                        {getTypeIcon(item.type)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm truncate block">{item.title}</span>
                      </div>
                      
                      <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground shrink-0">
                        <Clock className="h-3 w-3 hidden sm:block" />
                        <span>{item.finalCompletedAt}</span>
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
                        {item.contributors.map((contributor, idx) => (
                          <Avatar key={idx} className="h-5 w-5 -ml-1 first:ml-0 ring-1 ring-background">
                            {contributor.photoUrl && (
                              <AvatarImage src={contributor.photoUrl} />
                            )}
                            <AvatarFallback className="text-[9px] font-medium bg-primary/20 text-primary">
                              {contributor.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                        ))}
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
    </div>
  );
}
