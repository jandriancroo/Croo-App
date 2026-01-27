import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { 
  ClipboardCheck, 
  ClipboardList, 
  Calendar, 
  ChevronRight,
  UtensilsCrossed,
  CalendarCheck,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

// Sample data for preview - multiple days with completion levels
const sampleDays = [
  {
    label: 'Today',
    date: 'Mon, Jan 27',
    items: [
      {
        id: '1',
        type: 'checklist',
        title: 'Opening Checklist',
        frequency: 'daily',
        completedBy: 'Jordan A.',
        completedAt: '9:15 AM',
        completionLevel: 100,
        totalItems: 12,
        completedItems: 12,
      },
      {
        id: '2',
        type: 'task',
        title: 'Restock napkins in lobby',
        accentColor: '#8B5CF6',
        completedBy: 'Marcus T.',
        completedAt: '10:30 AM',
        completionLevel: 100,
        subtasks: 3,
        completedSubtasks: 3,
      },
      {
        id: '3',
        type: 'catering',
        title: 'Smith Wedding Order',
        customerName: 'John Smith',
        completedBy: 'Sarah M.',
        completedAt: '11:45 AM',
        completionLevel: 100,
        itemCount: 45,
      },
      {
        id: '4',
        type: 'checklist',
        title: 'Food Safety Temps',
        frequency: 'daily',
        completedBy: 'Alex K.',
        completedAt: '2:00 PM',
        completionLevel: 85,
        totalItems: 8,
        completedItems: 7,
      },
    ],
  },
  {
    label: 'Yesterday',
    date: 'Sun, Jan 26',
    items: [
      {
        id: '5',
        type: 'checklist',
        title: 'Closing Checklist',
        frequency: 'daily',
        completedBy: 'Jordan A.',
        completedAt: '10:15 PM',
        completionLevel: 100,
        totalItems: 15,
        completedItems: 15,
      },
      {
        id: '6',
        type: 'event',
        title: 'Birthday Party Setup',
        eventName: 'Table 5 Party',
        completedBy: 'Marcus T.',
        completedAt: '4:30 PM',
        completionLevel: 100,
      },
      {
        id: '7',
        type: 'task',
        title: 'Deep clean walk-in cooler',
        accentColor: '#EC4899',
        completedBy: 'Sarah M.',
        completedAt: '3:00 PM',
        completionLevel: 100,
        subtasks: 5,
        completedSubtasks: 5,
      },
      {
        id: '8',
        type: 'checklist',
        title: 'Opening Checklist',
        frequency: 'daily',
        completedBy: 'Alex K.',
        completedAt: '9:00 AM',
        completionLevel: 92,
        totalItems: 12,
        completedItems: 11,
      },
    ],
  },
  {
    label: 'Saturday',
    date: 'Sat, Jan 25',
    items: [
      {
        id: '9',
        type: 'catering',
        title: 'Corporate Lunch - TechCorp',
        customerName: 'TechCorp Inc.',
        completedBy: 'Jordan A.',
        completedAt: '11:00 AM',
        completionLevel: 100,
        itemCount: 60,
      },
      {
        id: '10',
        type: 'checklist',
        title: 'Weekly Deep Clean',
        frequency: 'weekly',
        completedBy: 'Team',
        completedAt: '6:00 PM',
        completionLevel: 78,
        totalItems: 18,
        completedItems: 14,
      },
      {
        id: '11',
        type: 'task',
        title: 'Replace CO2 tanks',
        accentColor: '#F59E0B',
        completedBy: 'Marcus T.',
        completedAt: '2:30 PM',
        completionLevel: 100,
        subtasks: 2,
        completedSubtasks: 2,
      },
    ],
  },
];

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'checklist': return <ClipboardCheck className="h-4 w-4" />;
    case 'task': return <ClipboardList className="h-4 w-4" />;
    case 'catering': return <UtensilsCrossed className="h-4 w-4" />;
    case 'event': return <CalendarCheck className="h-4 w-4" />;
    default: return <CheckCircle2 className="h-4 w-4" />;
  }
};

const getCompletionColor = (level: number) => {
  if (level === 100) return 'text-emerald-500';
  if (level >= 80) return 'text-amber-500';
  return 'text-red-500';
};

const getProgressColor = (level: number) => {
  if (level === 100) return 'bg-emerald-500';
  if (level >= 80) return 'bg-amber-500';
  return 'bg-red-500';
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

// ==================== STYLE 1: TIMELINE ====================
const TimelineView = () => (
  <div className="space-y-6">
    <h3 className="text-lg font-semibold text-center mb-4">Option 1: Timeline View</h3>
    
    {sampleDays.map((day) => (
      <div key={day.label} className="relative">
        {/* Day header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-semibold">
            {day.label}
          </div>
          <span className="text-sm text-muted-foreground">{day.date}</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        
        <div className="relative ml-6">
          {/* Vertical line */}
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border" />
          
          {day.items.map((item) => (
            <div key={item.id} className="relative flex items-start mb-4 pl-6">
              {/* Timeline dot */}
              <div 
                className="absolute left-0 top-2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-background"
                style={{ 
                  backgroundColor: item.completionLevel === 100 
                    ? '#10B981' 
                    : item.completionLevel >= 80 
                      ? '#F59E0B' 
                      : '#EF4444'
                }}
              />
              
              <Card className="flex-1">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <div className="p-1.5 rounded-md bg-muted shrink-0">
                        {getTypeIcon(item.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{item.title}</span>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {item.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Avatar className="h-4 w-4">
                            <AvatarFallback className="text-[8px]">{item.completedBy.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <span>{item.completedBy}</span>
                          <span>•</span>
                          <span>{item.completedAt}</span>
                        </div>
                      </div>
                    </div>
                    <CompletionIndicator 
                      level={item.completionLevel} 
                      label={item.type === 'checklist' ? `(${(item as any).completedItems}/${(item as any).totalItems})` : undefined}
                    />
                  </div>
                  {item.completionLevel < 100 && (
                    <div className="mt-2">
                      <Progress value={item.completionLevel} className="h-1.5" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

// ==================== STYLE 2: COMPACT ACTIVITY FEED ====================
const CompactFeedView = () => (
  <div className="space-y-6">
    <h3 className="text-lg font-semibold text-center mb-4">Option 2: Compact Activity Feed</h3>
    
    {sampleDays.map((day) => (
      <div key={day.label}>
        {/* Day header */}
        <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/95 backdrop-blur-sm py-2 z-10">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{day.label}</span>
          <span className="text-xs text-muted-foreground">{day.date}</span>
          <div className="flex-1 h-px bg-border" />
          <Badge variant="outline" className="text-xs">
            {day.items.length} items
          </Badge>
        </div>
        
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {day.items.map((item) => (
              <div 
                key={item.id} 
                className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors cursor-pointer group"
              >
                {/* Completion dot */}
                <div 
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ 
                    backgroundColor: item.completionLevel === 100 
                      ? '#10B981' 
                      : item.completionLevel >= 80 
                        ? '#F59E0B' 
                        : '#EF4444'
                  }}
                />
                
                {/* Icon */}
                <div 
                  className="p-1.5 rounded-md shrink-0"
                  style={{ 
                    backgroundColor: item.type === 'task' 
                      ? `${(item as any).accentColor || '#8B5CF6'}20` 
                      : 'hsl(var(--muted))'
                  }}
                >
                  {getTypeIcon(item.type)}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{item.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {item.completedBy} • {item.completedAt}
                  </div>
                </div>
                
                {/* Completion indicator */}
                <div className="flex items-center gap-2 shrink-0">
                  {item.type === 'checklist' && (
                    <span className="text-xs text-muted-foreground">
                      {(item as any).completedItems}/{(item as any).totalItems}
                    </span>
                  )}
                  <span className={`text-xs font-semibold ${getCompletionColor(item.completionLevel)}`}>
                    {item.completionLevel}%
                  </span>
                </div>
                
                {/* Arrow */}
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    ))}
  </div>
);

// ==================== STYLE 3: GROUPED CARD GRID ====================
const GroupedGridView = () => (
  <div className="space-y-6">
    <h3 className="text-lg font-semibold text-center mb-4">Option 3: Grouped Card Grid</h3>
    
    {sampleDays.map((day) => (
      <div key={day.label}>
        {/* Day header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="bg-muted px-3 py-1 rounded-lg">
            <span className="text-sm font-semibold">{day.label}</span>
            <span className="text-xs text-muted-foreground ml-2">{day.date}</span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">{day.items.length} completed</span>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          {day.items.map((item) => (
            <Card 
              key={item.id} 
              className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
            >
              {/* Progress bar as top accent */}
              <div className="h-1 bg-muted relative overflow-hidden">
                <div 
                  className={`h-full ${getProgressColor(item.completionLevel)}`}
                  style={{ width: `${item.completionLevel}%` }}
                />
              </div>
              
              <CardContent className="p-3">
                <div className="flex items-start gap-2 mb-2">
                  <div 
                    className="p-1 rounded shrink-0"
                    style={{ 
                      backgroundColor: item.type === 'task' 
                        ? `${(item as any).accentColor || '#8B5CF6'}20` 
                        : 'hsl(var(--muted))'
                    }}
                  >
                    {getTypeIcon(item.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm line-clamp-1">{item.title}</span>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {item.type}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[10px]">{item.completedBy.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-muted-foreground truncate max-w-[60px]">{item.completedBy}</span>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    {item.completionLevel === 100 ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <>
                        <span className={`text-xs font-semibold ${getCompletionColor(item.completionLevel)}`}>
                          {item.completionLevel}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="text-[10px] text-muted-foreground mt-1 text-right">
                  {item.completedAt}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default function HistoryStylePreview() {
  return (
    <Layout>
      <div className="space-y-8 pb-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold">History Page Style Preview</h2>
          <p className="text-muted-foreground text-sm mt-1">
            3 days of sample data with completion levels
          </p>
        </div>
        
        {/* Option 1: Timeline */}
        <div className="border-2 border-dashed border-primary/30 rounded-xl p-4 bg-primary/5">
          <TimelineView />
        </div>
        
        {/* Option 2: Compact Feed */}
        <div className="border-2 border-dashed border-secondary/30 rounded-xl p-4 bg-secondary/5">
          <CompactFeedView />
        </div>
        
        {/* Option 3: Grouped Grid */}
        <div className="border-2 border-dashed border-accent/30 rounded-xl p-4 bg-accent/5">
          <GroupedGridView />
        </div>
      </div>
    </Layout>
  );
}
