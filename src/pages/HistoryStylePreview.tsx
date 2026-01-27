import { useState } from 'react';
import { format, subDays, addDays } from 'date-fns';
import { Layout } from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { 
  ClipboardCheck, 
  ClipboardList, 
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  UtensilsCrossed,
  CalendarCheck,
  CheckCircle2,
  CalendarIcon,
  Bell,
  AlertTriangle
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
  notes?: string;
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
      notes: 'All stations checked and ready for service.',
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
      notes: 'Walk-in cooler temp slightly elevated, maintenance notified.',
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
    case 'checklist': return ClipboardCheck;
    case 'task': return ClipboardList;
    case 'catering': return UtensilsCrossed;
    case 'event': return CalendarCheck;
    case 'alarm': return Bell;
    default: return CheckCircle2;
  }
};

// ==================== TIMELINE ROW COMPONENT ====================
const TimelineRow = ({ item }: { item: HistoryItem }) => {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = getTypeIcon(item.type);
  const isComplete = item.completionLevel === 100;
  const isPartial = item.completionLevel > 0 && item.completionLevel < 100;
  const isAlarm = item.type === 'alarm';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button 
          className={cn(
            "w-full flex items-center gap-2 py-2.5 px-1 rounded-lg transition-colors",
            "active:bg-muted/50 hover:bg-muted/30",
            isAlarm && "py-1.5"
          )}
        >
          {/* LEFT: Time */}
          <div className={cn(
            "w-16 shrink-0 text-right pr-2",
            isAlarm ? "text-[11px]" : "text-xs",
            "font-medium text-muted-foreground"
          )}>
            {item.finalCompletedAt}
          </div>

          {/* CENTER: Timeline dot/indicator */}
          <div className="flex flex-col items-center shrink-0">
            {isComplete ? (
              <div className={cn(
                "rounded-full flex items-center justify-center",
                isAlarm 
                  ? "w-3 h-3 bg-amber-500" 
                  : "w-4 h-4 bg-emerald-500"
              )}>
                {!isAlarm && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
            ) : isPartial ? (
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                <span className="text-[8px] font-bold text-white">{item.completionLevel}</span>
              </div>
            ) : (
              <div className="w-4 h-4 rounded-full bg-destructive flex items-center justify-center">
                <AlertTriangle className="w-2.5 h-2.5 text-white" />
              </div>
            )}
          </div>

          {/* RIGHT: Task details */}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {/* Icon + Title */}
            <div className={cn(
              "p-1 rounded shrink-0",
              isAlarm 
                ? "bg-amber-500/20" 
                : item.type === 'task' && item.accentColor 
                  ? "" 
                  : "bg-muted"
            )}
              style={item.type === 'task' && item.accentColor ? { backgroundColor: `${item.accentColor}20` } : undefined}
            >
              <Icon className={cn(
                isAlarm ? "h-3 w-3 text-amber-600" : "h-3.5 w-3.5"
              )} />
            </div>
            
            <span className={cn(
              "font-medium truncate",
              isAlarm ? "text-xs" : "text-sm"
            )}>
              {item.title}
            </span>

            {/* Assignees (avatars) */}
            <div className="flex items-center -space-x-1.5 shrink-0 ml-auto">
              {item.contributors.slice(0, 3).map((contributor, idx) => (
                <Avatar key={idx} className={cn(
                  "ring-2 ring-background",
                  isAlarm ? "h-5 w-5" : "h-6 w-6"
                )}>
                  <AvatarFallback className={cn(
                    "font-medium bg-primary/20 text-primary",
                    isAlarm ? "text-[8px]" : "text-[10px]"
                  )}>
                    {contributor.name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
              ))}
              {item.contributors.length > 3 && (
                <Avatar className={cn("ring-2 ring-background", isAlarm ? "h-5 w-5" : "h-6 w-6")}>
                  <AvatarFallback className="text-[8px] bg-muted">
                    +{item.contributors.length - 3}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>

            {/* Status indicator */}
            {!isAlarm && (
              <div className="shrink-0 flex items-center gap-1">
                {isComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : isPartial ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-amber-600 border-amber-300">
                    {item.completionLevel}%
                  </Badge>
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
              </div>
            )}

            {/* Expand chevron */}
            {!isAlarm && (
              <ChevronDown className={cn(
                "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                isOpen && "rotate-180"
              )} />
            )}
          </div>
        </button>
      </CollapsibleTrigger>

      {/* Expanded details */}
      {!isAlarm && (
        <CollapsibleContent>
          <div className="ml-[72px] mr-2 mb-3 p-3 rounded-lg bg-muted/50 space-y-2">
            {/* Item counts */}
            {item.totalItems && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Items completed</span>
                <span className="font-medium">{item.completedItems}/{item.totalItems}</span>
              </div>
            )}
            {item.subtasks && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Subtasks</span>
                <span className="font-medium">{item.completedSubtasks}/{item.subtasks}</span>
              </div>
            )}
            {item.itemCount && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Items</span>
                <span className="font-medium">{item.itemCount}</span>
              </div>
            )}

            {/* Progress bar for partial */}
            {isPartial && (
              <Progress value={item.completionLevel} className="h-1.5" />
            )}

            {/* Contributors breakdown */}
            <div className="pt-1 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Contributors</span>
              {item.contributors.map((c, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">{c.itemsCompleted} items • {c.completedAt}</span>
                </div>
              ))}
            </div>

            {/* Notes */}
            {item.notes && (
              <div className="pt-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Notes</span>
                <p className="text-xs mt-0.5">{item.notes}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

// ==================== TIMELINE VIEW ====================
const TimelineView = ({ items, selectedDate }: { items: HistoryItem[]; selectedDate: Date }) => {
  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  const dayLabel = isToday ? 'Today' : format(selectedDate, 'EEEE');
  const dateLabel = format(selectedDate, 'MMMM d, yyyy');

  // Sort items by completion time - earliest first
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
  const completeCount = items.filter(i => i.completionLevel === 100).length;

  return (
    <div className="space-y-3">
      {/* Day header */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full text-xs font-semibold">
          {dayLabel}
        </div>
        <span className="text-xs text-muted-foreground">{dateLabel}</span>
        <div className="flex-1 h-px bg-border hidden sm:block" />
        <div className="flex items-center gap-1.5 ml-auto">
          <Badge variant="secondary" className="text-[10px] px-1.5 gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {completeCount}/{items.length}
          </Badge>
          {alarmCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 gap-0.5 border-amber-300 text-amber-600">
              <Bell className="h-2.5 w-2.5" />
              {alarmCount}
            </Badge>
          )}
        </div>
      </div>
      
      {/* Timeline with vertical line */}
      <div className="relative">
        {/* Vertical timeline line - positioned at center of dots (72px from left = 16px time + 8px gap + 8px half of dot area) */}
        <div className="absolute left-[72px] top-0 bottom-0 w-0.5 bg-border -translate-x-1/2" />
        
        {/* Timeline rows */}
        <div className="relative">
          {sortedItems.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </div>
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
          <Button variant="outline" className="gap-2 font-semibold text-sm">
            <CalendarIcon className="h-4 w-4" />
            {format(selectedDate, 'EEE, MMM d')}
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
      <div className="space-y-4 pb-20">
        <div className="text-center">
          <h2 className="text-xl font-bold">History</h2>
          <p className="text-muted-foreground text-xs mt-0.5">
            Completed tasks and checklists
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
