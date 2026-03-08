import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Users, Clock, DollarSign, TrendingUp, ChevronLeft, ChevronRight, 
  UserPlus, CalendarPlus, Circle, Coffee, BarChart3, Zap,
  ArrowUp, ArrowDown, MoreHorizontal, Plus, Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Mock Data ───────────────────────────────────────────────
// ─── Mock Data ───────────────────────────────────────────────
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_DATES = [2, 3, 4, 5, 6, 7, 8];

const MOCK_SHIFTS = [
  { id: '1', name: 'Sarah M.', avatar: null, position: 'Opening Manager', color: '#3b82f6', start: '7:00 AM', end: '3:00 PM', isActive: true, clockIn: '6:55 AM', hours: 4.2 },
  { id: '2', name: 'Jake R.', avatar: null, position: 'Line Cook', color: '#ef4444', start: '8:00 AM', end: '4:00 PM', isActive: true, clockIn: '7:58 AM', hours: 3.4, isOnBreak: true, breakStart: '11:30 AM' },
  { id: '3', name: 'Emily T.', avatar: null, position: 'Cashier', color: '#22c55e', start: '10:00 AM', end: '6:00 PM', isActive: false, hours: 0 },
  { id: '4', name: 'Marcus W.', avatar: null, position: 'Closing Manager', color: '#3b82f6', start: '2:00 PM', end: '10:00 PM', isActive: false, hours: 0 },
  { id: '5', name: 'Ava L.', avatar: null, position: 'Line Cook', color: '#ef4444', start: '11:00 AM', end: '7:00 PM', isActive: false, hours: 0 },
];

const MOCK_EVENTS = [
  { id: 'e1', name: 'Team Meeting', time: '9:00 AM', color: '#8b5cf6' },
  { id: 'e2', name: 'Food Delivery', time: '11:00 AM', color: '#f59e0b' },
];

const MOCK_TOOLS = { scheduledHours: 42.5, laborCost: 637, projectedSales: 2850, laborPercent: 22.4, salesPerLH: 67.06, activeNow: 2, onBreak: 1, scheduled: 5 };

// ─── Shared Components ──────────────────────────────────────
function DatePillSelector({ selectedIdx, onSelect }: { selectedIdx: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center justify-around bg-muted rounded-xl p-1 border border-border/40">
      {WEEK_DAYS.map((day, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={cn(
            "flex flex-col items-center flex-1 py-1.5 rounded-lg transition-all",
            i === selectedIdx
              ? "bg-primary text-primary-foreground shadow-md"
              : i === 6 ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground"
          )}
        >
          <span className="text-[10px] font-semibold uppercase">{day}</span>
          <span className="text-sm font-bold">{WEEK_DATES[i]}</span>
        </button>
      ))}
    </div>
  );
}

function ScheduleToolsBar({ variant = 'full' }: { variant?: 'full' | 'compact' | 'mini' }) {
  if (variant === 'mini') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg border border-border/30 text-xs">
        <span className="font-semibold">{MOCK_TOOLS.scheduledHours}h</span>
        <span className="text-muted-foreground">|</span>
        <span className="font-semibold">${MOCK_TOOLS.laborCost}</span>
        <span className="text-muted-foreground">|</span>
        <span className={cn("font-bold", MOCK_TOOLS.laborPercent <= 25 ? "text-green-600" : "text-yellow-600")}>{MOCK_TOOLS.laborPercent}%</span>
        <span className="text-muted-foreground">|</span>
        <span className="font-medium">${MOCK_TOOLS.salesPerLH}/LH</span>
      </div>
    );
  }
  if (variant === 'compact') {
    return (
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Hours', value: `${MOCK_TOOLS.scheduledHours}h`, icon: Clock },
          { label: 'Labor', value: `$${MOCK_TOOLS.laborCost}`, icon: DollarSign },
          { label: 'Labor %', value: `${MOCK_TOOLS.laborPercent}%`, icon: TrendingUp, color: MOCK_TOOLS.laborPercent <= 25 ? 'text-green-600' : 'text-yellow-600' },
          { label: '$/LH', value: `$${MOCK_TOOLS.salesPerLH}`, icon: BarChart3 },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center p-2 bg-muted/50 rounded-lg border border-border/30">
            <item.icon className="h-3.5 w-3.5 text-muted-foreground mb-0.5" />
            <span className={cn("text-sm font-bold", item.color)}>{item.value}</span>
            <span className="text-[10px] text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 bg-muted/50 rounded-lg border border-border/30">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Scheduled</span>
          </div>
          <span className="text-lg font-bold">{MOCK_TOOLS.scheduledHours}h</span>
          <span className="text-xs text-muted-foreground ml-1">(${MOCK_TOOLS.laborCost})</span>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg border border-border/30">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Proj. Sales</span>
          </div>
          <span className="text-lg font-bold">${MOCK_TOOLS.projectedSales.toLocaleString()}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 bg-muted/50 rounded-lg border border-border/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Labor %</span>
          <span className={cn("text-sm font-bold", MOCK_TOOLS.laborPercent <= 25 ? "text-green-600" : "text-yellow-600")}>{MOCK_TOOLS.laborPercent}%</span>
        </div>
        <div className="p-2.5 bg-muted/50 rounded-lg border border-border/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">$/LH</span>
          <span className="text-sm font-bold">${MOCK_TOOLS.salesPerLH}</span>
        </div>
      </div>
    </div>
  );
}

function ShiftCard({ shift, showPunchInfo = false }: { shift: typeof MOCK_SHIFTS[0]; showPunchInfo?: boolean; compact?: boolean }) {
  const statusColor = shift.isOnBreak ? '#f59e0b' : shift.isActive ? '#22c55e' : shift.color;
  const isPunched = showPunchInfo && shift.isActive;

  return (
    <div className={cn(
      "flex rounded-lg bg-card border border-border/30 shadow-neumorphic overflow-hidden",
      !shift.isActive && !shift.isOnBreak && "opacity-70"
    )}>
      <div className="w-1 shrink-0" style={{ backgroundColor: statusColor }} />
      <div className="flex-1 flex items-center gap-2.5 px-2.5 py-1.5">
        <div className="relative shrink-0">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{shift.name.charAt(0)}</AvatarFallback>
          </Avatar>
          {shift.isActive && !shift.isOnBreak && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 border-2 border-background animate-pulse" />
          )}
          {shift.isOnBreak && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500 border-2 border-background" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm truncate">{shift.name}</span>
            {isPunched && (
              <span className={cn("font-bold text-xs shrink-0", shift.isOnBreak ? "text-amber-600" : "text-green-600")}>
                {shift.hours.toFixed(1)}h
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">{shift.start} - {shift.end}</div>
          {isPunched && (
            <div className="text-xs text-green-600 whitespace-nowrap">In: {shift.clockIn}</div>
          )}
          {shift.isOnBreak && (
            <div className="text-xs text-amber-600 font-medium whitespace-nowrap">Break: {shift.breakStart}</div>
          )}
          <div className="flex justify-end">
            <Badge variant="secondary" className="text-[10px]" style={{ backgroundColor: `${shift.color}20`, color: shift.color }}>
              {shift.position}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function LivePulseRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-green-500/10 rounded-lg border border-green-500/20">
      <div className="flex items-center gap-1.5">
        <Circle className="h-2.5 w-2.5 fill-green-500 text-green-500 animate-pulse" />
        <span className="text-xs font-semibold text-green-700 dark:text-green-400">{MOCK_TOOLS.activeNow} Active</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5">
        <Coffee className="h-3 w-3 text-amber-500" />
        <span className="text-xs font-medium text-amber-600">{MOCK_TOOLS.onBreak} Break</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1.5">
        <Users className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{MOCK_TOOLS.scheduled} Total</span>
      </div>
    </div>
  );
}

function ManagerActionRow() {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"><UserPlus className="h-3.5 w-3.5" /> Punch</Button>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"><CalendarPlus className="h-3.5 w-3.5" /> Shift</Button>
      <div className="flex-1" />
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-destructive/10 border border-destructive rounded-md">
        <span className="relative flex items-end gap-[1px] h-3">
          <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-1" style={{ height: '25%' }} />
          <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-2" style={{ height: '50%' }} />
          <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-3" style={{ height: '75%' }} />
          <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-4" style={{ height: '100%' }} />
        </span>
        <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Live</span>
      </div>
    </div>
  );
}

function EventPills() {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {MOCK_EVENTS.map(e => (
        <div key={e.id} className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 py-1" style={{ borderLeftColor: e.color, borderLeftWidth: 3 }}>
          <span className="text-xs font-medium truncate">{e.name}</span>
          <span className="text-[10px] text-muted-foreground">{e.time}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Option 1: 7shifts "Dashboard Feed" ─────────────────────
// Borrowed: Hero stats row at top (7shifts daily overview), 
// unified shift list with live/scheduled interleaved, 
// date pill selector, collapsible schedule tools
function Option1() {
  const [dayIdx, setDayIdx] = useState(6);
  return (
    <div className="space-y-3 p-3">
      {/* Date Navigation */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Sunday, Mar 8</h2>
          <span className="text-xs text-muted-foreground">Current Week</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      
      <DatePillSelector selectedIdx={dayIdx} onSelect={setDayIdx} />
      
      {/* 7shifts-style hero stats — borrowed from their daily dashboard card */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
          <Circle className="h-3 w-3 fill-green-500 text-green-500 mx-auto mb-1 animate-pulse" />
          <span className="text-xl font-bold text-green-700 dark:text-green-400">{MOCK_TOOLS.activeNow}</span>
          <p className="text-[10px] text-muted-foreground">Clocked In</p>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
          <Coffee className="h-3 w-3 text-amber-500 mx-auto mb-1" />
          <span className="text-xl font-bold text-amber-700 dark:text-amber-400">{MOCK_TOOLS.onBreak}</span>
          <p className="text-[10px] text-muted-foreground">On Break</p>
        </div>
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
          <Users className="h-3 w-3 text-primary mx-auto mb-1" />
          <span className="text-xl font-bold">{MOCK_TOOLS.scheduled}</span>
          <p className="text-[10px] text-muted-foreground">Scheduled</p>
        </div>
      </div>

      {/* Schedule Tools — compact grid */}
      <ScheduleToolsBar variant="compact" />

      <ManagerActionRow />
      <EventPills />

      {/* Unified shift list — interleaved active + upcoming */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">All Shifts</h4>
        {MOCK_SHIFTS.map(s => (
          <ShiftCard key={s.id} shift={s} showPunchInfo={true} />
        ))}
      </div>
    </div>
  );
}

// ─── Option 2: Connecteam "Card Stack" ──────────────────────
// Borrowed: Connecteam's stacked card layout with prominent
// live status banner, schedule tools as a sticky summary bar,
// grouped sections (Active → Upcoming), floating action button
function Option2() {
  const [dayIdx, setDayIdx] = useState(6);
  const activeShifts = MOCK_SHIFTS.filter(s => s.isActive);
  const upcomingShifts = MOCK_SHIFTS.filter(s => !s.isActive);
  
  return (
    <div className="space-y-3 p-3">
      <DatePillSelector selectedIdx={dayIdx} onSelect={setDayIdx} />
      
      {/* Connecteam-style live status banner */}
      <div className="bg-gradient-to-r from-green-500/15 to-primary/10 rounded-xl p-4 border border-green-500/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-green-500" />
            <span className="text-sm font-bold">Live Status</span>
          </div>
          <Badge variant="outline" className="text-[10px]">Sunday, Mar 8</Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <span className="text-2xl font-bold text-green-600">{MOCK_TOOLS.activeNow}</span>
            <p className="text-[10px] text-muted-foreground">Active</p>
          </div>
          <div className="text-center">
            <span className="text-2xl font-bold text-amber-600">{MOCK_TOOLS.onBreak}</span>
            <p className="text-[10px] text-muted-foreground">Break</p>
          </div>
          <div className="text-center">
            <span className="text-2xl font-bold">{MOCK_TOOLS.scheduled}</span>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
          <div className="ml-auto text-right">
            <span className="text-lg font-bold">{MOCK_TOOLS.scheduledHours}h</span>
            <p className="text-[10px] text-muted-foreground">Sched. Hours</p>
          </div>
        </div>
      </div>
      
      {/* Sticky schedule tools bar — Connecteam bottom summary */}
      <ScheduleToolsBar variant="mini" />
      
      <ManagerActionRow />
      <EventPills />

      {/* Grouped: Active first */}
      {activeShifts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-green-600 uppercase tracking-wide flex items-center gap-1">
            <Circle className="h-2 w-2 fill-green-500 text-green-500" /> Currently Working
          </h4>
          {activeShifts.map(s => <ShiftCard key={s.id} shift={s} showPunchInfo={true} />)}
        </div>
      )}
      
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upcoming</h4>
        {upcomingShifts.map(s => <ShiftCard key={s.id} shift={s} />)}
      </div>
    </div>
  );
}

// ─── Option 3: "Minimal Timeline" ───────────────────────────
// Borrowed: 7shifts timeline view + Connecteam's clean whitespace.
// Single column with time markers on left, shifts positioned by time,
// schedule tools as expandable drawer from bottom
function Option3() {
  const [dayIdx, setDayIdx] = useState(6);
  const [toolsOpen, setToolsOpen] = useState(false);
  
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Mar 8</h2>
          <span className="text-xs text-muted-foreground">Sunday</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
      </div>
      
      <DatePillSelector selectedIdx={dayIdx} onSelect={setDayIdx} />
      <LivePulseRow />
      <ManagerActionRow />
      
      {/* Timeline — 7shifts gantt-style on mobile */}
      <div className="relative">
        {/* Time markers */}
        {hours.map(h => (
          <div key={h} className="flex items-start" style={{ minHeight: 48 }}>
            <span className="text-[10px] text-muted-foreground w-10 shrink-0 text-right pr-2 pt-0.5">
              {h > 12 ? `${h - 12}pm` : h === 12 ? '12pm' : `${h}am`}
            </span>
            <div className="flex-1 border-t border-border/30 relative" />
          </div>
        ))}
        
        {/* Shift bars overlaid — simplified visual representation */}
        <div className="absolute left-12 right-2 top-0" style={{ height: hours.length * 48 }}>
          {MOCK_SHIFTS.map((s, i) => {
            const startHour = parseInt(s.start.split(':')[0]) + (s.start.includes('PM') && !s.start.startsWith('12') ? 12 : 0);
            const endHour = parseInt(s.end.split(':')[0]) + (s.end.includes('PM') && !s.end.startsWith('12') ? 12 : 0);
            const top = (startHour - 7) * 48;
            const height = (endHour - startHour) * 48;
            const width = `calc(${100 / 3}% - 4px)`;
            const left = `calc(${(i % 3) * (100 / 3)}% + 2px)`;
            
            return (
              <div
                key={s.id}
                className="absolute rounded-md border text-[10px] px-1.5 py-0.5 overflow-hidden"
                style={{ 
                  top, height: Math.max(height, 24), 
                  width, left,
                  backgroundColor: `${s.color}20`, 
                  borderColor: s.color,
                  color: s.color 
                }}
              >
                <span className="font-semibold block truncate">{s.name}</span>
                {height > 30 && <span className="block truncate opacity-75">{s.position}</span>}
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Expandable schedule tools */}
      <button 
        onClick={() => setToolsOpen(!toolsOpen)}
        className="w-full flex items-center justify-center gap-2 py-2 bg-muted rounded-lg border border-border/40 text-xs font-medium text-muted-foreground"
      >
        <BarChart3 className="h-3.5 w-3.5" />
        Schedule Tools
        {toolsOpen ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
      </button>
      {toolsOpen && <ScheduleToolsBar variant="full" />}
    </div>
  );
}

// ─── Option 4: "Split Commander" ─────────────────────────────
// Borrowed: Connecteam's split-panel approach. Top = live pulse 
// with compact punch cards. Bottom = full shift list. Schedule 
// tools pinned between as a divider summary bar.
function Option4() {
  const [dayIdx, setDayIdx] = useState(6);
  const activeShifts = MOCK_SHIFTS.filter(s => s.isActive);
  
  return (
    <div className="space-y-0 p-3">
      <DatePillSelector selectedIdx={dayIdx} onSelect={setDayIdx} />
      
      <div className="mt-3 space-y-3">
        {/* Top zone: Live pulse */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-green-500" /> Right Now
            </h3>
            <Button size="sm" variant="outline" className="h-6 gap-1 text-[10px]"><UserPlus className="h-3 w-3" /> Punch</Button>
          </div>
          
          {/* Compact active punch cards */}
          <div className="grid grid-cols-2 gap-2">
            {activeShifts.map(s => (
              <div key={s.id} className="flex items-center gap-2 p-2 bg-card rounded-lg border border-border/30 shadow-sm">
                <div className="relative shrink-0">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px]">{s.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-background",
                    s.isOnBreak ? "bg-amber-500" : "bg-green-500 animate-pulse"
                  )} />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-semibold block truncate">{s.name}</span>
                  <span className={cn("text-[10px]", s.isOnBreak ? "text-amber-600" : "text-green-600")}>
                    {s.isOnBreak ? `Break ${s.breakStart}` : `${s.hours.toFixed(1)}h`}
                  </span>
                </div>
              </div>
            ))}
            {activeShifts.length === 0 && (
              <div className="col-span-2 text-center py-4 text-xs text-muted-foreground">No one clocked in yet</div>
            )}
          </div>
        </div>
        
        {/* Divider: Schedule Tools summary */}
        <div className="relative">
          <div className="absolute inset-x-0 top-1/2 border-t border-border/50" />
          <div className="relative flex justify-center">
            <ScheduleToolsBar variant="mini" />
          </div>
        </div>
        
        {/* Bottom zone: Full schedule */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Day Schedule ({MOCK_TOOLS.scheduled})
            </h3>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0"><CalendarPlus className="h-3.5 w-3.5" /></Button>
              <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-destructive/10 border border-destructive rounded">
                <span className="text-[9px] font-semibold text-destructive uppercase">Live</span>
              </div>
            </div>
          </div>
          
          <EventPills />
          
          {MOCK_SHIFTS.map(s => (
            <ShiftCard key={s.id} shift={s} showPunchInfo={s.isActive} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Option 5: "Agenda Board" ────────────────────────────────
// Borrowed: 7shifts agenda + Connecteam's task board approach.
// Top = collapsible schedule tools card. Middle = events as 
// highlighted rows. Shifts sorted by time with status badges inline.
// Clean, list-first, data-dense.
function Option5() {
  const [dayIdx, setDayIdx] = useState(6);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-center">
            <h2 className="text-base font-bold">Sunday, March 8</h2>
            <span className="text-[10px] text-muted-foreground">Week of Mar 2 - Mar 8, 2026</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      
      <DatePillSelector selectedIdx={dayIdx} onSelect={setDayIdx} />
      
      {/* Schedule Tools card — 7shifts style collapsible */}
      <Card className={cn("overflow-hidden transition-all", toolsExpanded ? "p-0" : "p-0")}>
        <button 
          onClick={() => setToolsExpanded(!toolsExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 text-xs font-medium"
        >
          <span className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Day Insights</span>
          <span className="text-muted-foreground">{toolsExpanded ? '▲' : '▼'}</span>
        </button>
        {toolsExpanded && (
          <div className="p-3 space-y-3 border-t border-border/30">
            {/* Key metrics as horizontal row */}
            <div className="flex items-center justify-between text-center">
              <div>
                <span className="text-lg font-bold">{MOCK_TOOLS.scheduledHours}h</span>
                <p className="text-[10px] text-muted-foreground">Hours</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <span className="text-lg font-bold">${MOCK_TOOLS.laborCost}</span>
                <p className="text-[10px] text-muted-foreground">Labor</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <span className={cn("text-lg font-bold", MOCK_TOOLS.laborPercent <= 25 ? "text-green-600" : "text-yellow-600")}>{MOCK_TOOLS.laborPercent}%</span>
                <p className="text-[10px] text-muted-foreground">Labor %</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <span className="text-lg font-bold">${MOCK_TOOLS.projectedSales.toLocaleString()}</span>
                <p className="text-[10px] text-muted-foreground">Sales</p>
              </div>
            </div>
            
            {/* SPLH bar */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-primary/5 rounded-lg">
              <span className="text-xs text-muted-foreground">Sales Per Labor Hour</span>
              <span className="text-sm font-bold">${MOCK_TOOLS.salesPerLH}</span>
            </div>
          </div>
        )}
      </Card>
      
      <LivePulseRow />
      <ManagerActionRow />
      
      {/* Events as highlighted agenda rows */}
      {MOCK_EVENTS.length > 0 && (
        <div className="space-y-1">
          {MOCK_EVENTS.map(e => (
            <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ backgroundColor: `${e.color}10` }}>
              <div className="w-1 h-8 rounded-full" style={{ backgroundColor: e.color }} />
              <div className="flex-1">
                <span className="text-sm font-medium">{e.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{e.time}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Shift list — clean agenda style */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{MOCK_TOOLS.scheduled} Shifts</h4>
          <Button size="sm" variant="ghost" className="h-6 gap-1 text-[10px]"><Plus className="h-3 w-3" /> Add</Button>
        </div>
        {MOCK_SHIFTS.map(s => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 bg-card rounded-lg border border-border/30">
            <div className="relative shrink-0">
              <Avatar className="h-9 w-9">
                <AvatarFallback>{s.name.charAt(0)}</AvatarFallback>
              </Avatar>
              {s.isActive && <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background", s.isOnBreak ? "bg-amber-500" : "bg-green-500 animate-pulse")} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold truncate">{s.name}</span>
                {s.isActive && (
                  <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", s.isOnBreak ? "border-amber-500 text-amber-600" : "border-green-500 text-green-600")}>
                    {s.isOnBreak ? 'Break' : `${s.hours.toFixed(1)}h`}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{s.start} - {s.end}</span>
                <span style={{ color: s.color }}>• {s.position}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Option 6: "Frankenstein" ─────────────────────────────────
// Combines: Option 2's grouped sections (Currently Working / Upcoming),
// Option 5's green status bar + collapsible Day Insights card,
// pill-sized quick tasks, compact shift cards with punch info
function Option6() {
  const [dayIdx, setDayIdx] = useState(6);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const activeShifts = MOCK_SHIFTS.filter(s => s.isActive);
  const upcomingShifts = MOCK_SHIFTS.filter(s => !s.isActive);

  const MOCK_TASKS = [
    { title: 'Prep line check', color: '#8b5cf6' },
    { title: 'Restock napkins', color: '#ef4444' },
    { title: 'Opening checklist', color: '#3b82f6', subtasksCompleted: 3, subtasksTotal: 5 },
    { title: 'Temp log cooler #2', color: '#f59e0b' },
  ];

  return (
    <div className="space-y-3 p-3">
      {/* Date header + nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-center">
            <h2 className="text-base font-bold">Sunday, March 8</h2>
            <span className="text-[10px] text-muted-foreground">Week of Mar 2 - Mar 8, 2026</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <DatePillSelector selectedIdx={dayIdx} onSelect={setDayIdx} />


      {/* Events & Tasks — 2-column grid */}
      <div className="space-y-1">
        {/* Events — flex-wrap, single-line height */}
        <div className="flex flex-wrap gap-1">
          {MOCK_EVENTS.map(e => (
            <div key={e.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg min-w-[calc(50%-2px)] max-w-full flex-grow" style={{ backgroundColor: `${e.color}10` }}>
              <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
              <span className="text-xs font-medium truncate">{e.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{e.time}</span>
              <div className="h-5 w-5 rounded-full border border-border/60 flex items-center justify-center shrink-0 text-muted-foreground/50 ml-auto">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </div>
            </div>
          ))}
        </div>
        <div className="mx-6 border-t border-border/30" />
        {/* Tasks — flex-wrap, short ones pair up, long ones get full row */}
        <div className="flex flex-wrap gap-1">
          {MOCK_TASKS.map((t, i) => {
            const isLong = t.title.length > 14 || !!t.subtasksTotal;
            return (
              <div key={`t-${i}`} className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 rounded-lg",
                isLong ? "w-full" : "min-w-[calc(50%-2px)] max-w-full flex-grow"
              )} style={{ backgroundColor: `${t.color}10` }}>
                <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                <span className="text-xs font-medium truncate">{t.title}</span>
                {t.subtasksTotal && (
                  <span
                    className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
                    style={{
                      backgroundColor: t.subtasksCompleted === t.subtasksTotal ? '#22c55e20' : `${t.color}20`,
                      color: t.subtasksCompleted === t.subtasksTotal ? '#22c55e' : t.color,
                    }}
                  >
                    {t.subtasksCompleted}/{t.subtasksTotal}
                  </span>
                )}
                <button className="h-5 w-5 rounded-full border border-border/60 flex items-center justify-center shrink-0 hover:border-primary hover:text-primary transition-colors text-muted-foreground/50 ml-auto">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Option 2: Grouped sections — Currently Working */}
      {activeShifts.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
            <Circle className="h-2 w-2 fill-green-500 text-green-500" />
            <span className="text-green-600">Now</span>
            <span className="text-muted-foreground mx-0.5">·</span>
            <span className="text-green-600">{MOCK_TOOLS.activeNow} Active</span>
            <span className="text-muted-foreground mx-0.5">·</span>
            <span className="text-amber-600">{MOCK_TOOLS.onBreak} Break</span>
            <span className="text-muted-foreground mx-0.5">·</span>
            <span className="text-muted-foreground">{MOCK_TOOLS.scheduled} Total</span>
            <div className="ml-auto">
              <Button size="icon" variant="ghost" className="h-6 w-6"><UserPlus className="h-3.5 w-3.5" /></Button>
            </div>
          </h4>
          {activeShifts.map(s => (
            <ShiftCard key={s.id} shift={s} showPunchInfo compact />
          ))}
        </div>
      )}

      {/* Option 2: Upcoming section */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          Later
          <div className="flex items-center gap-1 ml-auto">
            <Button size="icon" variant="ghost" className="h-6 w-6"><CalendarPlus className="h-3.5 w-3.5" /></Button>
            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-destructive/10 border border-destructive rounded-md">
              <span className="relative flex items-end gap-[1px] h-3">
                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-1" style={{ height: '25%' }} />
                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-2" style={{ height: '50%' }} />
                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-3" style={{ height: '75%' }} />
                <span className="w-0.5 bg-destructive rounded-sm animate-wifi-bar-4" style={{ height: '100%' }} />
              </span>
              <span className="text-[10px] font-semibold text-destructive uppercase tracking-wide">Live</span>
            </div>
          </div>
        </h4>
        {upcomingShifts.map(s => (
          <ShiftCard key={s.id} shift={s} compact />
        ))}
      </div>

      {/* Day Insights — bottom of page */}
      <Card className="overflow-hidden p-0">
        <button
          onClick={() => setToolsExpanded(!toolsExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 text-xs font-medium"
        >
          <span className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Day Insights</span>
          <span className="text-muted-foreground">{toolsExpanded ? '▲' : '▼'}</span>
        </button>
        {toolsExpanded && (
          <div className="px-3 py-2.5 border-t border-border/30">
            <div className="flex items-center justify-between text-center">
              <div>
                <span className="text-base font-bold">{MOCK_TOOLS.scheduledHours}h</span>
                <p className="text-[10px] text-muted-foreground">Hours</p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div>
                <span className="text-base font-bold">${MOCK_TOOLS.laborCost}</span>
                <p className="text-[10px] text-muted-foreground">Labor</p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div>
                <span className={cn("text-base font-bold", MOCK_TOOLS.laborPercent <= 25 ? "text-green-600" : "text-yellow-600")}>{MOCK_TOOLS.laborPercent}%</span>
                <p className="text-[10px] text-muted-foreground">Labor %</p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div>
                <span className="text-base font-bold">${MOCK_TOOLS.salesPerLH}</span>
                <p className="text-[10px] text-muted-foreground">$/LH</p>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Preview Page ────────────────────────────────────────────
const OPTIONS = [
  { 
    id: 1, 
    title: '7shifts "Dashboard Feed"', 
    Component: Option1,
    inspiration: [
      '7shifts: Hero stats row with live clocked-in/break/scheduled counts',
      '7shifts: Unified shift list mixing active punches + scheduled shifts',
      'Compact 4-tile schedule tools grid (hours, labor $, labor %, $/LH)',
      '7shifts: Day pill selector for quick date switching',
    ]
  },
  { 
    id: 2, 
    title: 'Connecteam "Card Stack"', 
    Component: Option2,
    inspiration: [
      'Connecteam: Gradient live-status banner with prominent active/break counts',
      'Connecteam: Grouped sections — "Currently Working" vs "Upcoming"',
      'Inline one-line schedule tools summary bar (sticky-ready)',
      'Connecteam: Card-stack layout with clear visual hierarchy',
    ]
  },
  { 
    id: 3, 
    title: 'Minimal Timeline', 
    Component: Option3,
    inspiration: [
      '7shifts: Gantt-style timeline with time markers on left edge',
      'Connecteam: Clean whitespace and minimal chrome',
      'Expandable schedule tools drawer at bottom',
      'Color-coded shift bars positioned by actual time',
    ]
  },
  { 
    id: 4, 
    title: 'Split Commander', 
    Component: Option4,
    inspiration: [
      'Connecteam: Split-panel layout — live status top, schedule bottom',
      'Compact 2-col punch cards for at-a-glance active status',
      'Schedule tools as a visual divider between zones',
      '7shifts: Dense shift cards with inline position badges',
    ]
  },
  { 
    id: 5, 
    title: 'Agenda Board', 
    Component: Option5,
    inspiration: [
      '7shifts: Collapsible "Day Insights" card with key metrics',
      'Connecteam: Agenda-style events as highlighted colored rows',
      'Clean list layout with inline status badges per shift',
      'Horizontal metrics row (hours | labor | % | sales) for fast scanning',
    ]
  },
  { 
    id: 6, 
    title: '★ Frankenstein', 
    Component: Option6,
    inspiration: [
      'Option 2: "Currently Working" / "Upcoming" grouped shift sections',
      'Option 5: Green live-status bar (Active • Break • Total)',
      'Option 5: Collapsible "Day Insights" with horizontal metrics',
      'Pill-sized quick tasks matching current TemporaryTaskCard compactness',
      'Compact shift cards with punch info + position badges',
      'Schedule tools visible on every view via Day Insights card',
    ]
  },
];

export default function SchedulePreview() {
  const [activeOption, setActiveOption] = useState(5); // Default to Option 6
  const current = OPTIONS[activeOption];
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-primary text-primary-foreground px-4 py-3 shadow-lg">
        <h1 className="text-lg font-bold">Mobile Schedule — Design Preview</h1>
        <p className="text-xs text-primary-foreground/70">6 combined Today+Schedule options</p>
      </div>
      
      {/* Option selector */}
      <div className="flex overflow-x-auto gap-2 px-3 py-3 border-b border-border/40 bg-muted/30">
        {OPTIONS.map((opt, i) => (
          <button
            key={opt.id}
            onClick={() => setActiveOption(i)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
              i === activeOption
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/50"
            )}
          >
            Option {opt.id}
          </button>
        ))}
      </div>
      
      {/* Inspiration notes */}
      <div className="px-4 py-3 bg-muted/20 border-b border-border/30">
        <h3 className="text-sm font-bold mb-1.5">{current.title}</h3>
        <ul className="space-y-1">
          {current.inspiration.map((note, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <span className="shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/50" />
              {note}
            </li>
          ))}
        </ul>
      </div>
      
      {/* Phone frame mockup */}
      <div className="flex justify-center py-6 px-4">
        <div className="w-full max-w-[390px] bg-background border-2 border-border rounded-3xl shadow-2xl overflow-hidden">
          {/* Notch */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-28 h-5 bg-foreground/10 rounded-full" />
          </div>
          
          {/* Content */}
          <div className="max-h-[700px] overflow-y-auto">
            <current.Component />
          </div>
          
          {/* Bottom bar */}
          <div className="h-1 bg-foreground/10 mx-auto w-32 rounded-full mb-2 mt-1" />
        </div>
      </div>
    </div>
  );
}
