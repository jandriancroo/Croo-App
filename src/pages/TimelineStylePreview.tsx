import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  ClipboardCheck, ClipboardList, Bell, Calendar, BookOpen, 
  CheckCircle2, Clock, ChevronRight, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Mock data
const mockItems = [
  { id: '1', type: 'checklist' as const, title: 'Opening Checklist', dueTime: '9:00 AM', completedAt: '8:47 AM', completionLevel: 100, completedItems: 12, totalItems: 12, contributors: [{ name: 'Mike R', photo: null }, { name: 'Sarah L', photo: null }] },
  { id: '2', type: 'alarm' as const, title: 'Check Lobby', dueTime: '10:00 AM', completedAt: '10:02 AM', completionLevel: 100, contributors: [{ name: 'Jake T', photo: null }] },
  { id: '3', type: 'checklist' as const, title: 'Shift Change Line Check', dueTime: '10:15 AM', completedAt: '10:08 AM', completionLevel: 100, completedItems: 22, totalItems: 22, contributors: [{ name: 'Mike R', photo: null }, { name: 'Lisa K', photo: null }, { name: 'Tom B', photo: null }] },
  { id: '4', type: 'alarm-missed' as const, title: 'Check Lobby', dueTime: '11:00 AM', completedAt: undefined, completionLevel: 0, contributors: [] },
  { id: '5', type: 'task' as const, title: 'PFG 20 Item Morning Order', dueTime: undefined, completedAt: '11:37 AM', completionLevel: 100, contributors: [{ name: 'Mike R', photo: null }] },
  { id: '6', type: 'alarm' as const, title: 'Check Lobby', dueTime: '12:00 PM', completedAt: '11:58 AM', completionLevel: 100, contributors: [{ name: 'Sarah L', photo: null }] },
  { id: '7', type: 'alarm-missed' as const, title: 'Check Lobby', dueTime: '1:00 PM', completedAt: undefined, completionLevel: 0, contributors: [] },
  { id: '8', type: 'checklist' as const, title: 'Daily Deep Cleaning', dueTime: '5:00 PM', completedAt: '4:28 PM', completionLevel: 67, completedItems: 8, totalItems: 12, contributors: [{ name: 'Jake T', photo: null }, { name: 'Lisa K', photo: null }] },
  { id: '9', type: 'event' as const, title: 'Team Meeting', dueTime: undefined, completedAt: '2:00 PM', completionLevel: 100, contributors: [{ name: 'Mike R', photo: null }] },
  { id: '10', type: 'logbook' as const, title: 'Drawer Count', dueTime: undefined, completedAt: '5:15 PM', completionLevel: 100, contributors: [{ name: 'Sarah L', photo: null }] },
  { id: '11', type: 'checklist' as const, title: 'Closing Checklist', dueTime: '9:00 PM', completedAt: undefined, completionLevel: 0, completedItems: 0, totalItems: 15, contributors: [] },
];

const typeConfig = {
  checklist: { icon: ClipboardCheck, label: 'Checklist', color: 'emerald' },
  task: { icon: ClipboardList, label: 'Task', color: 'primary' },
  alarm: { icon: Bell, label: 'Alarm', color: 'amber' },
  'alarm-missed': { icon: Bell, label: 'Alarm', color: 'red' },
  event: { icon: Calendar, label: 'Event', color: 'blue' },
  logbook: { icon: BookOpen, label: 'Logbook', color: 'green' },
};

function ContributorAvatars({ contributors, size = 'sm' }: { contributors: { name: string; photo: string | null }[]; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const textSize = size === 'md' ? 'text-[8px]' : 'text-[7px]';
  return (
    <div className="flex items-center -space-x-1.5">
      {contributors.slice(0, 4).map((c, i) => (
        <Avatar key={i} className={cn(sizeClass, 'ring-1 ring-background shrink-0')}>
          {c.photo && <AvatarImage src={c.photo} />}
          <AvatarFallback className={cn(textSize, 'font-medium bg-primary/20 text-primary')}>{c.name?.charAt(0)}</AvatarFallback>
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

// ============================================================
// OPTION A: Clean Pill Timeline (current + refinements)
// ============================================================
function OptionA() {
  return (
    <div className="relative ml-3">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border" />
      {mockItems.map(item => {
        const isAlarm = item.type === 'alarm' || item.type === 'alarm-missed';
        const isMissed = item.type === 'alarm-missed';
        const isChecklist = item.type === 'checklist';
        const isComplete = item.completionLevel === 100;
        const isNotStarted = item.completionLevel === 0 && !isMissed;
        const anchorTime = isChecklist ? item.dueTime : (item.completedAt || item.dueTime);

        let pillBg = 'bg-primary/8 border-primary/25';
        let dotColor = 'bg-primary';
        let timeColor = 'text-primary';

        if (isMissed) { pillBg = 'bg-destructive/10 border-destructive/30'; dotColor = 'bg-destructive'; timeColor = 'text-destructive'; }
        else if (isAlarm) { pillBg = 'bg-amber-500/12 border-amber-500/30'; dotColor = 'bg-amber-400'; timeColor = 'text-amber-600 dark:text-amber-400'; }
        else if (isChecklist && isComplete) { pillBg = 'bg-emerald-500/10 border-emerald-500/25'; dotColor = 'bg-emerald-500'; timeColor = 'text-emerald-600 dark:text-emerald-400'; }
        else if (isChecklist && !isNotStarted) { pillBg = 'bg-amber-500/10 border-amber-500/25'; dotColor = 'bg-amber-500'; timeColor = 'text-amber-600 dark:text-amber-400'; }
        else if (isChecklist && isNotStarted) { pillBg = 'bg-muted/60 border-border'; dotColor = 'bg-muted-foreground/40'; timeColor = 'text-muted-foreground'; }
        else if (item.type === 'event') { pillBg = 'bg-blue-500/10 border-blue-500/25'; dotColor = 'bg-blue-400'; timeColor = 'text-blue-600 dark:text-blue-400'; }
        else if (item.type === 'logbook') { pillBg = 'bg-green-500/10 border-green-500/25'; dotColor = 'bg-green-400'; timeColor = 'text-green-600 dark:text-green-400'; }

        const Icon = typeConfig[item.type].icon;
        const isLarge = isChecklist || item.type === 'task';

        return (
          <div key={item.id} className={cn('relative flex items-center pl-6 cursor-pointer', isLarge ? 'mb-2' : 'mb-1')}>
            <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className={cn('rounded-full ring-2 ring-background', dotColor, isLarge ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5')} />
            </div>
            <div className={cn('flex items-center gap-1.5 border rounded-full', pillBg, isLarge ? 'py-1.5 px-3 text-xs' : 'py-0.5 px-2 text-[10px]')}>
              <Icon className={cn('shrink-0', timeColor, isLarge ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5')} />
              {anchorTime && <span className={cn('font-semibold shrink-0', timeColor)}>{anchorTime}</span>}
              <span className="text-foreground font-medium truncate max-w-[160px]">{item.title}</span>
              {isMissed ? (
                <span className="text-destructive font-bold text-[9px] uppercase tracking-wider">Missed</span>
              ) : isChecklist && !isComplete ? (
                <span className={cn('font-bold shrink-0', item.completionLevel >= 50 ? 'text-amber-600' : 'text-muted-foreground')}>{item.completedItems}/{item.totalItems}</span>
              ) : isComplete ? (
                <CheckCircle2 className={cn('text-emerald-500 shrink-0', isLarge ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5')} />
              ) : null}
              {item.contributors.length > 0 && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <ContributorAvatars contributors={item.contributors} size={isLarge ? 'md' : 'sm'} />
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// OPTION B: Time-Anchored Slots (schedule-style)
// ============================================================
function OptionB() {
  const timeSlots = ['9:00 AM', '10:00 AM', '10:15 AM', '11:00 AM', '11:37 AM', '12:00 PM', '1:00 PM', '2:00 PM', '4:28 PM', '5:00 PM', '5:15 PM', '9:00 PM'];
  const itemsByTime = new Map<string, typeof mockItems>();
  mockItems.forEach(item => {
    const t = item.type === 'checklist' ? item.dueTime : (item.completedAt || item.dueTime);
    if (t) {
      if (!itemsByTime.has(t)) itemsByTime.set(t, []);
      itemsByTime.get(t)!.push(item);
    }
  });

  return (
    <div className="space-y-0">
      {timeSlots.filter(t => itemsByTime.has(t)).map(time => {
        const items = itemsByTime.get(time)!;
        return (
          <div key={time} className="flex gap-3 py-1.5 border-b border-border/30 last:border-0">
            <span className="text-[11px] font-mono font-semibold text-muted-foreground w-16 shrink-0 pt-0.5 text-right">{time}</span>
            <div className="flex-1 space-y-1">
              {items.map(item => {
                const isMissed = item.type === 'alarm-missed';
                const isComplete = item.completionLevel === 100;
                const Icon = typeConfig[item.type].icon;
                const colorMap: Record<string, string> = { emerald: 'text-emerald-500', primary: 'text-primary', amber: 'text-amber-500', red: 'text-destructive', blue: 'text-blue-500', green: 'text-green-500' };
                const iconColor = colorMap[typeConfig[item.type].color] || 'text-muted-foreground';

                return (
                  <div key={item.id} className={cn('flex items-center gap-2 py-0.5 px-2 rounded-lg cursor-pointer transition-colors hover:bg-muted/50', isMissed && 'opacity-60')}>
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', iconColor)} />
                    <span className={cn('text-xs font-medium flex-1 truncate', isMissed && 'line-through text-muted-foreground')}>{item.title}</span>
                    {isMissed ? (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">MISSED</Badge>
                    ) : item.type === 'checklist' && !isComplete ? (
                      <span className="text-[10px] font-bold text-amber-600">{item.completedItems}/{item.totalItems}</span>
                    ) : isComplete ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
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
}

// ============================================================
// OPTION C: Left-Border Accent Bars
// ============================================================
function OptionC() {
  return (
    <div className="space-y-1">
      {mockItems.map(item => {
        const isMissed = item.type === 'alarm-missed';
        const isComplete = item.completionLevel === 100;
        const isChecklist = item.type === 'checklist';
        const anchorTime = isChecklist ? item.dueTime : (item.completedAt || item.dueTime);
        const Icon = typeConfig[item.type].icon;

        const borderColorMap: Record<string, string> = {
          checklist: isComplete ? 'border-l-emerald-500' : item.completionLevel > 0 ? 'border-l-amber-500' : 'border-l-muted-foreground/30',
          task: 'border-l-primary',
          alarm: 'border-l-amber-400',
          'alarm-missed': 'border-l-destructive',
          event: 'border-l-blue-400',
          logbook: 'border-l-green-400',
        };

        return (
          <div 
            key={item.id} 
            className={cn(
              'flex items-center gap-2 py-1.5 px-3 border-l-[3px] rounded-r-lg cursor-pointer transition-colors hover:bg-muted/30',
              borderColorMap[item.type],
              isMissed && 'bg-destructive/5'
            )}
          >
            <span className="text-[10px] font-mono text-muted-foreground w-14 shrink-0">{anchorTime || '—'}</span>
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={cn('text-xs font-medium flex-1 truncate', isMissed && 'text-muted-foreground')}>{item.title}</span>
            {isMissed ? (
              <span className="text-[9px] font-bold text-destructive uppercase">Missed</span>
            ) : isChecklist && !isComplete ? (
              <span className="text-[10px] font-bold text-amber-600">{item.completedItems}/{item.totalItems}</span>
            ) : isComplete ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            ) : (
              <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
            )}
            {item.contributors.length > 0 && <ContributorAvatars contributors={item.contributors} />}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// OPTION D: Minimal Rows with Time Column
// ============================================================
function OptionD() {
  return (
    <div className="divide-y divide-border/40">
      {mockItems.map(item => {
        const isMissed = item.type === 'alarm-missed';
        const isComplete = item.completionLevel === 100;
        const isChecklist = item.type === 'checklist';
        const anchorTime = isChecklist ? item.dueTime : (item.completedAt || item.dueTime);
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
          <div key={item.id} className={cn('flex items-center gap-3 py-2 px-1 cursor-pointer hover:bg-muted/20 transition-colors', isMissed && 'opacity-50')}>
            {/* Time */}
            <span className="text-[11px] font-mono text-muted-foreground w-16 text-right shrink-0">{anchorTime || ''}</span>
            
            {/* Status dot */}
            <div className={cn('w-2 h-2 rounded-full shrink-0', dotColorMap[item.type])} />
            
            {/* Content */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className={cn('text-sm font-medium truncate', isMissed && 'line-through')}>{item.title}</span>
              {item.type !== 'alarm' && item.type !== 'alarm-missed' && (
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">{typeConfig[item.type].label}</span>
              )}
            </div>

            {/* Status */}
            {isMissed ? (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            ) : isChecklist && !isComplete ? (
              <span className="text-[11px] font-semibold text-amber-600 shrink-0">{item.completedItems}/{item.totalItems}</span>
            ) : isComplete ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/20 shrink-0" />
            )}

            {/* Avatars */}
            {item.contributors.length > 0 && <ContributorAvatars contributors={item.contributors} size="md" />}
            
            <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// OPTION E: Grouped Cards by Type
// ============================================================
function OptionE() {
  const groups = [
    { label: 'Checklists', icon: ClipboardCheck, color: 'text-emerald-600 dark:text-emerald-400', items: mockItems.filter(i => i.type === 'checklist') },
    { label: 'Tasks', icon: ClipboardList, color: 'text-primary', items: mockItems.filter(i => i.type === 'task') },
    { label: 'Alarm Checks', icon: Bell, color: 'text-amber-600 dark:text-amber-400', items: mockItems.filter(i => i.type === 'alarm' || i.type === 'alarm-missed') },
    { label: 'Events & Logbook', icon: Calendar, color: 'text-blue-600 dark:text-blue-400', items: mockItems.filter(i => i.type === 'event' || i.type === 'logbook') },
  ].filter(g => g.items.length > 0);

  return (
    <div className="space-y-4">
      {groups.map(group => {
        const GroupIcon = group.icon;
        const completedCount = group.items.filter(i => i.completionLevel === 100).length;
        const missedCount = group.items.filter(i => i.type === 'alarm-missed').length;

        return (
          <div key={group.label}>
            <div className="flex items-center gap-2 mb-1.5">
              <GroupIcon className={cn('h-3.5 w-3.5', group.color)} />
              <span className="text-xs font-semibold text-foreground">{group.label}</span>
              <span className="text-[10px] text-muted-foreground">{completedCount}/{group.items.length - missedCount}</span>
            </div>
            <div className="space-y-0.5 ml-5">
              {group.items.map(item => {
                const isMissed = item.type === 'alarm-missed';
                const isComplete = item.completionLevel === 100;
                const isChecklist = item.type === 'checklist';
                const anchorTime = isChecklist ? item.dueTime : (item.completedAt || item.dueTime);

                return (
                  <div key={item.id} className={cn('flex items-center gap-2 py-1 px-2 rounded-md cursor-pointer hover:bg-muted/40 transition-colors', isMissed && 'opacity-50')}>
                    <span className="text-[10px] font-mono text-muted-foreground w-14 shrink-0">{anchorTime}</span>
                    <span className={cn('text-xs font-medium flex-1 truncate', isMissed && 'line-through text-muted-foreground')}>{item.title}</span>
                    {isMissed ? (
                      <span className="text-[9px] font-bold text-destructive uppercase">Missed</span>
                    ) : isChecklist && !isComplete ? (
                      <span className="text-[10px] font-bold text-amber-600">{item.completedItems}/{item.totalItems}</span>
                    ) : isComplete ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/20 shrink-0" />
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
}

// ============================================================
// Main Preview Page
// ============================================================
export default function TimelineStylePreview() {
  const [selected, setSelected] = useState<string>('E');
  const options = [
    { id: 'E', label: 'Grouped', desc: 'Items grouped by type with section headers' },
    { id: 'D', label: 'Timeline', desc: 'Clean divider rows with dot indicators and chevrons' },
  ];

  return (
    <Layout>
      <div className="container mx-auto p-4 max-w-lg space-y-4">
        <h1 className="text-xl font-bold">Timeline Style Preview</h1>
        <p className="text-sm text-muted-foreground">Checklists anchor to <strong>due time</strong>, tasks to <strong>completion time</strong></p>

        {/* Selector */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => setSelected(opt.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-all shrink-0',
                selected === opt.id 
                  ? 'bg-primary text-primary-foreground border-primary' 
                  : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {opt.id}. {opt.label}
            </button>
          ))}
        </div>
        
        <p className="text-[11px] text-muted-foreground">{options.find(o => o.id === selected)?.desc}</p>

        {/* Day header */}
        <div className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full text-xs font-semibold">Tuesday</div>
          <span className="text-xs text-muted-foreground">March 4, 2026</span>
          <div className="flex-1" />
          <Badge variant="secondary" className="text-[10px]">10</Badge>
          <Badge variant="outline" className="text-[10px] gap-0.5">
            <Bell className="h-2.5 w-2.5" /> 3/7
          </Badge>
        </div>

        {/* Content */}
        <Card>
          <CardContent className="py-3 px-3">
            {selected === 'A' && <OptionA />}
            {selected === 'B' && <OptionB />}
            {selected === 'C' && <OptionC />}
            {selected === 'D' && <OptionD />}
            {selected === 'E' && <OptionE />}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
