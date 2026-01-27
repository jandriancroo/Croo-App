import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { 
  ClipboardCheck, 
  ClipboardList, 
  Calendar, 
  Eye, 
  ChevronRight,
  UtensilsCrossed,
  CalendarCheck,
  CheckCircle2
} from 'lucide-react';

// Sample data for preview
const sampleItems = [
  {
    id: '1',
    type: 'checklist',
    title: 'Opening Checklist',
    frequency: 'daily',
    completedBy: 'Jordan A.',
    completedAt: new Date().toISOString(),
    avatar: null,
  },
  {
    id: '2',
    type: 'task',
    title: 'Restock napkins in lobby',
    accentColor: '#8B5CF6',
    completedBy: 'Marcus T.',
    completedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    avatar: null,
  },
  {
    id: '3',
    type: 'catering',
    title: 'Smith Wedding Order',
    customerName: 'John Smith',
    completedBy: 'Sarah M.',
    completedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    avatar: null,
  },
  {
    id: '4',
    type: 'event',
    title: 'Prep for Birthday Party (Table 5)',
    eventName: 'Birthday Party',
    completedBy: 'Alex K.',
    completedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    avatar: null,
  },
  {
    id: '5',
    type: 'checklist',
    title: 'Food Safety Temps',
    frequency: 'daily',
    completedBy: 'Jordan A.',
    completedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    avatar: null,
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

const getTypeBadge = (type: string, accentColor?: string) => {
  switch (type) {
    case 'checklist': return <Badge variant="secondary">Checklist</Badge>;
    case 'task': return (
      <Badge 
        variant="outline" 
        className="border-0"
        style={{ backgroundColor: `${accentColor || '#8B5CF6'}20`, color: accentColor || '#8B5CF6' }}
      >
        Quick Task
      </Badge>
    );
    case 'catering': return <Badge className="bg-amber-500/20 text-amber-600 border-0">Catering</Badge>;
    case 'event': return <Badge className="bg-emerald-500/20 text-emerald-600 border-0">Event</Badge>;
    default: return <Badge variant="outline">Task</Badge>;
  }
};

const formatTime = (date: string) => {
  return new Date(date).toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
};

// ==================== STYLE 1: TIMELINE ====================
const TimelineView = () => (
  <div className="space-y-4">
    <h3 className="text-lg font-semibold text-center mb-4">Option 1: Timeline View</h3>
    <div className="relative">
      {/* Center line */}
      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border -translate-x-1/2" />
      
      {sampleItems.map((item, index) => (
        <div 
          key={item.id} 
          className={`relative flex items-center mb-6 ${
            index % 2 === 0 ? 'justify-start' : 'justify-end'
          }`}
        >
          {/* Timeline dot */}
          <div className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary ring-4 ring-background z-10" />
          
          {/* Card */}
          <Card className={`w-[45%] ${index % 2 === 0 ? 'mr-auto' : 'ml-auto'}`}>
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <div className="p-1.5 rounded-md bg-muted">
                  {getTypeIcon(item.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{item.title}</span>
                    {getTypeBadge(item.type, (item as any).accentColor)}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <Avatar className="h-4 w-4">
                      <AvatarFallback className="text-[8px]">{item.completedBy.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span>{item.completedBy}</span>
                    <span>•</span>
                    <span>{formatTime(item.completedAt)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  </div>
);

// ==================== STYLE 2: COMPACT ACTIVITY FEED ====================
const CompactFeedView = () => (
  <div className="space-y-4">
    <h3 className="text-lg font-semibold text-center mb-4">Option 2: Compact Activity Feed</h3>
    <Card>
      <CardContent className="p-0 divide-y divide-border">
        {sampleItems.map((item) => (
          <div 
            key={item.id} 
            className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors cursor-pointer group"
          >
            {/* Icon with accent */}
            <div 
              className="p-2 rounded-lg shrink-0"
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
                {getTypeBadge(item.type, (item as any).accentColor)}
              </div>
              <div className="text-xs text-muted-foreground">
                {item.completedBy} • {formatTime(item.completedAt)}
              </div>
            </div>
            
            {/* Avatar */}
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback>{item.completedBy.charAt(0)}</AvatarFallback>
            </Avatar>
            
            {/* Arrow */}
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

// ==================== STYLE 3: GROUPED CARD GRID ====================
const GroupedGridView = () => (
  <div className="space-y-4">
    <h3 className="text-lg font-semibold text-center mb-4">Option 3: Grouped Card Grid</h3>
    
    {/* Today section */}
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Today</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {sampleItems.slice(0, 3).map((item) => (
          <Card 
            key={item.id} 
            className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
          >
            {/* Accent bar */}
            <div 
              className="h-1"
              style={{ 
                backgroundColor: item.type === 'task' 
                  ? (item as any).accentColor || '#8B5CF6'
                  : item.type === 'catering' 
                    ? '#F59E0B'
                    : item.type === 'event'
                      ? '#10B981'
                      : 'hsl(var(--primary))'
              }}
            />
            <CardContent className="p-3">
              <div className="flex items-start gap-2 mb-2">
                {getTypeIcon(item.type)}
                <span className="font-medium text-sm line-clamp-2">{item.title}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[10px]">{item.completedBy.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground">{item.completedBy}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatTime(item.completedAt)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
    
    {/* Earlier section */}
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Earlier</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {sampleItems.slice(3).map((item) => (
          <Card 
            key={item.id} 
            className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
          >
            <div 
              className="h-1"
              style={{ 
                backgroundColor: item.type === 'task' 
                  ? (item as any).accentColor || '#8B5CF6'
                  : item.type === 'catering' 
                    ? '#F59E0B'
                    : item.type === 'event'
                      ? '#10B981'
                      : 'hsl(var(--primary))'
              }}
            />
            <CardContent className="p-3">
              <div className="flex items-start gap-2 mb-2">
                {getTypeIcon(item.type)}
                <span className="font-medium text-sm line-clamp-2">{item.title}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[10px]">{item.completedBy.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground">{item.completedBy}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatTime(item.completedAt)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  </div>
);

export default function HistoryStylePreview() {
  return (
    <Layout>
      <div className="space-y-8 pb-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold">History Page Style Preview</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Compare the 3 layout options below (same sample data)
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
