import { useState } from 'react';
import { format, subDays, addDays } from 'date-fns';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  AlertCircle,
  CalendarIcon,
  Clock,
  Bell
} from 'lucide-react';

interface Contributor {
  name: string;
  completedAt: string;
  itemsCompleted: number;
}

interface HistoryItem {
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
}

// Sample data for a single day with completion levels and contributors
const getSampleItemsForDate = (date: Date): HistoryItem[] => {
  const dayOfWeek = date.getDay();
  
  const alarmTasks: HistoryItem[] = [
    {
      id: 'alarm-1',
      type: 'alarm',
      title: 'Bathroom Check',
      contributors: [{ name: 'Alex K.', completedAt: '10:00 AM', itemsCompleted: 1 }],
      finalCompletedAt: '10:02 AM',
      completionLevel: 100,
    },
    {
      id: 'alarm-2',
      type: 'alarm',
      title: 'Bathroom Check',
      contributors: [{ name: 'Jordan A.', completedAt: '10:30 AM', itemsCompleted: 1 }],
      finalCompletedAt: '10:31 AM',
      completionLevel: 100,
    },
    {
      id: 'alarm-3',
      type: 'alarm',
      title: 'Bathroom Check',
      contributors: [{ name: 'Marcus T.', completedAt: '11:00 AM', itemsCompleted: 1 }],
      finalCompletedAt: '11:03 AM',
      completionLevel: 100,
    },
    {
      id: 'alarm-4',
      type: 'alarm',
      title: 'Lobby Sweep',
      contributors: [{ name: 'Sarah M.', completedAt: '12:00 PM', itemsCompleted: 1 }],
      finalCompletedAt: '12:05 PM',
      completionLevel: 100,
    },
    {
      id: 'alarm-5',
      type: 'alarm',
      title: 'Bathroom Check',
      contributors: [{ name: 'Alex K.', completedAt: '1:00 PM', itemsCompleted: 1 }],
      finalCompletedAt: '1:02 PM',
      completionLevel: 100,
    },
  ];
  
  const baseItems: HistoryItem[] = [
    {
      id: '1',
      type: 'checklist',
      title: 'Opening Checklist',
      frequency: 'daily',
      contributors: [
        { name: 'Jordan A.', completedAt: '9:00 AM', itemsCompleted: 8 },
        { name: 'Marcus T.', completedAt: '9:15 AM', itemsCompleted: 4 },
      ],
      finalCompletedAt: '9:15 AM',
      completionLevel: 100,
      totalItems: 12,
      completedItems: 12,
    },
    {
      id: '2',
      type: 'task',
      title: 'Restock napkins in lobby',
      accentColor: '#8B5CF6',
      contributors: [
        { name: 'Marcus T.', completedAt: '10:30 AM', itemsCompleted: 3 },
      ],
      finalCompletedAt: '10:30 AM',
      completionLevel: 100,
      subtasks: 3,
      completedSubtasks: 3,
    },
    {
      id: '3',
      type: 'catering',
      title: 'Smith Wedding Order',
      customerName: 'John Smith',
      contributors: [
        { name: 'Sarah M.', completedAt: '11:45 AM', itemsCompleted: 1 },
      ],
      finalCompletedAt: '11:45 AM',
      completionLevel: 100,
      itemCount: 45,
    },
    {
      id: '4',
      type: 'checklist',
      title: 'Food Safety Temps',
      frequency: 'daily',
      contributors: [
        { name: 'Alex K.', completedAt: '2:00 PM', itemsCompleted: 5 },
        { name: 'Jordan A.', completedAt: '2:15 PM', itemsCompleted: 2 },
      ],
      finalCompletedAt: '2:15 PM',
      completionLevel: 85,
      totalItems: 8,
      completedItems: 7,
    },
    {
      id: '5',
      type: 'event',
      title: 'Birthday Party Setup',
      eventName: 'Table 5 Party',
      contributors: [
        { name: 'Marcus T.', completedAt: '4:30 PM', itemsCompleted: 1 },
      ],
      finalCompletedAt: '4:30 PM',
      completionLevel: 100,
    },
    {
      id: '6',
      type: 'checklist',
      title: 'Closing Checklist',
      frequency: 'daily',
      contributors: [
        { name: 'Sarah M.', completedAt: '9:30 PM', itemsCompleted: 6 },
        { name: 'Alex K.', completedAt: '9:45 PM', itemsCompleted: 5 },
        { name: 'Jordan A.', completedAt: '10:00 PM', itemsCompleted: 4 },
      ],
      finalCompletedAt: '10:00 PM',
      completionLevel: 100,
      totalItems: 15,
      completedItems: 15,
    },
  ];

  // Vary items based on day
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return [
      ...baseItems,
      ...alarmTasks,
      {
        id: '7',
        type: 'catering',
        title: 'Corporate Lunch - TechCorp',
        customerName: 'TechCorp Inc.',
        contributors: [
          { name: 'Jordan A.', completedAt: '11:00 AM', itemsCompleted: 1 },
        ],
        finalCompletedAt: '11:00 AM',
        completionLevel: 100,
        itemCount: 60,
      },
    ];
  }
  
  return [...baseItems, ...alarmTasks];
};

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

const CompletionIndicator = ({ level, label }: { level: number; label?: string }) => (
  <div className="flex items-center gap-1.5">
    {level === 100 ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : (
      <AlertCircle className={`h-4 w-4 ${getCompletionColor(level)}`} />
    )}
    <span className={`text-xs font-medium ${getCompletionColor(level)}`}>
      {level}%{label ? ` ${label}` : ''}
    </span>
  </div>
);

// ==================== CONTRIBUTORS DISPLAY ====================
const ContributorsDisplay = ({ contributors }: { contributors: Contributor[] }) => {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {contributors.map((contributor, idx) => (
        <div 
          key={idx}
          className="flex items-center gap-2 bg-muted/60 rounded-full px-3 py-1.5"
        >
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-xs font-medium bg-primary/20 text-primary">
              {contributor.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{contributor.name}</span>
          <span className="text-xs text-muted-foreground">({contributor.itemsCompleted})</span>
        </div>
      ))}
    </div>
  );
};

// ==================== TIMELINE VIEW ====================
const TimelineView = ({ items, selectedDate }: { items: HistoryItem[]; selectedDate: Date }) => {
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

  return (
    <div className="space-y-4">
      {/* Day header */}
      <div className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-semibold">
          {dayLabel}
        </div>
        <span className="text-sm text-muted-foreground">{dateLabel}</span>
        <div className="flex-1 h-px bg-border" />
        <Badge variant="secondary" className="text-xs">
          {regularCount} completed
        </Badge>
        {alarmCount > 0 && (
          <Badge variant="outline" className="text-xs gap-1">
            <Bell className="h-3 w-3" />
            {alarmCount}
          </Badge>
        )}
      </div>
      
      <div className="relative ml-4">
        {/* Vertical line */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border" />
        
        {sortedItems.map((item) => {
          // Mini inline row for alarm tasks
          if (item.type === 'alarm') {
            return (
              <div key={item.id} className="relative flex items-center mb-2 pl-8">
                {/* Timeline dot - smaller for alarms */}
                <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 ring-2 ring-background" />
                </div>
                
                {/* Compact inline content */}
                <div className="flex items-center gap-2 ml-16 py-1 px-2.5 bg-muted/40 rounded-full text-xs">
                  <Bell className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground font-medium">{item.finalCompletedAt}</span>
                  <span className="text-foreground">{item.title}</span>
                  <span className="text-muted-foreground">• {item.contributors[0]?.name}</span>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                </div>
              </div>
            );
          }

          // Regular card for other items
          return (
            <div key={item.id} className="relative flex items-start mb-4 pl-8">
              {/* Timeline dot with time */}
              <div className="absolute left-0 top-0 -translate-x-1/2 flex flex-col items-center">
                <div 
                  className={`w-3 h-3 rounded-full ring-2 ring-background ${getTimelineDotColor(item.completionLevel)}`}
                />
              </div>
              
              {/* Time label */}
              <div className="absolute left-6 top-0 flex items-center gap-1 text-xs text-muted-foreground font-medium min-w-[70px]">
                <Clock className="h-3 w-3" />
                {item.finalCompletedAt}
              </div>
              
              <Card className="flex-1 ml-16 hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <div 
                        className="p-1.5 rounded-md shrink-0"
                        style={{ 
                          backgroundColor: item.type === 'task' && item.accentColor
                            ? `${item.accentColor}20` 
                            : 'hsl(var(--muted))'
                        }}
                      >
                        {getTypeIcon(item.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{item.title}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                            {item.type}
                          </Badge>
                        </div>
                        
                        {/* Contributors section */}
                        <div className="mt-2">
                          <ContributorsDisplay contributors={item.contributors} />
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <CompletionIndicator 
                        level={item.completionLevel} 
                        label={item.type === 'checklist' && item.totalItems 
                          ? `(${item.completedItems}/${item.totalItems})` 
                          : undefined
                        }
                      />
                    </div>
                  </div>
                  
                  {item.completionLevel < 100 && (
                    <div className="mt-3">
                      <Progress value={item.completionLevel} className="h-1.5" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==================== DATE SELECTOR COMPONENT ====================
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

export default function HistoryStylePreview() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  const items = getSampleItemsForDate(selectedDate);
  
  return (
    <Layout>
      <div className="space-y-6 pb-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold">History</h2>
          <p className="text-muted-foreground text-sm mt-1">
            View completed tasks and checklists
          </p>
        </div>
        
        {/* Date Selector */}
        <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
        
        {/* Timeline View */}
        <TimelineView items={items} selectedDate={selectedDate} />
      </div>
    </Layout>
  );
}
