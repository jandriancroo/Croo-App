import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, TrendingDown, ChevronRight, ChevronLeft,
  ClipboardCheck, CircleCheck, DollarSign, Users, Clock,
  BarChart3, ChefHat, Bell, MessageSquare, Flame,
  ArrowUpRight, ArrowDownRight, Eye, Utensils, Star,
  Timer, Zap, Target, Activity, CalendarDays
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Mock Data ───────────────────────────────────────────────────
const METRICS = [
  { label: 'Sales', value: '$4,823', sub: '+12.3% vs LW', trend: 'up' as const, icon: DollarSign },
  { label: 'Pace', value: '$6,210', sub: 'Projected EOD', trend: 'up' as const, icon: Target },
  { label: 'Labor', value: '18.2%', sub: '$876 total', trend: 'down' as const, icon: Users },
  { label: 'Goal', value: '$7,500', sub: '64% achieved', trend: 'up' as const, icon: Flame },
  { label: 'Tickets', value: '142', sub: 'Avg $33.96', trend: 'up' as const, icon: BarChart3 },
  { label: 'Speed', value: '4.2m', sub: 'Avg ticket time', trend: 'down' as const, icon: Timer },
];

const CHECKLISTS = [
  { name: 'AM Opening', progress: 100, items: 12, done: 12, time: '6:30 AM' },
  { name: 'Line Check', progress: 75, items: 8, done: 6, time: '10:00 AM' },
  { name: 'PM Transition', progress: 33, items: 6, done: 2, time: '2:00 PM' },
  { name: 'Closing', progress: 0, items: 10, done: 0, time: '9:00 PM' },
];

const TASKS = [
  { text: 'Count walk-in cooler', assignee: 'Maria S.', color: 'hsl(var(--primary))' },
  { text: 'Restock napkins & lids', assignee: 'Jake T.', color: 'hsl(var(--accent))' },
  { text: 'Deep clean fryer #2', assignee: 'You', color: 'hsl(150 40% 45%)' },
];

const HOURS = [
  { hour: '11a', val: 820, pct: 82 },
  { hour: '12p', val: 1100, pct: 100 },
  { hour: '1p', val: 940, pct: 85 },
  { hour: '2p', val: 620, pct: 56 },
  { hour: '5p', val: 780, pct: 71 },
  { hour: '6p', val: 950, pct: 86 },
];

// ─── Shared Components ──────────────────────────────────────────
const ProgressRing = ({ pct, size = 40, stroke = 4 }: { pct: number; size?: number; stroke?: number }) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        className="transition-all duration-700" />
    </svg>
  );
};

const TrendArrow = ({ trend }: { trend: 'up' | 'down' }) => (
  trend === 'up' 
    ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
    : <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />
);

// ════════════════════════════════════════════════════════════════
// OPTION 1: BENTO GRID — Apple-inspired asymmetric cards
// ════════════════════════════════════════════════════════════════
const Option1Bento = () => {
  const [metricPage, setMetricPage] = useState(0);
  const pageMetrics = METRICS.slice(metricPage * 2, metricPage * 2 + 2);
  
  return (
    <div className="space-y-3">
      {/* Swipeable Metric Cards */}
      <div className="relative">
        <div className="flex gap-2.5 overflow-hidden">
          <AnimatePresence mode="popLayout">
            {pageMetrics.map((m) => (
              <motion.div
                key={m.label}
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                className="flex-1 min-w-0 rounded-2xl bg-card p-4 border border-border/50"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-lg bg-primary/10">
                    <m.icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">{m.label}</span>
                </div>
                <p className="text-2xl font-black tracking-tight">{m.value}</p>
                <div className="flex items-center gap-1 mt-1">
                  <TrendArrow trend={m.trend} />
                  <span className="text-xs text-muted-foreground">{m.sub}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {/* Pagination dots */}
        <div className="flex items-center justify-center gap-1.5 mt-2">
          {[0, 1, 2].map(i => (
            <button key={i} onClick={() => setMetricPage(i)}
              className={cn("h-1.5 rounded-full transition-all", i === metricPage ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30")} />
          ))}
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Sales Chart - Large */}
        <div className="col-span-2 rounded-2xl bg-card border border-border/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Peak Hours</h3>
            <span className="text-xs text-muted-foreground">Today</span>
          </div>
          <div className="flex items-end gap-1.5 h-20">
            {HOURS.map(h => (
              <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${h.pct}%` }} />
                <span className="text-[10px] text-muted-foreground">{h.hour}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Checklists */}
        {CHECKLISTS.map(cl => (
          <div key={cl.name} className="rounded-2xl bg-card border border-border/50 p-3 flex flex-col justify-between min-h-[100px]">
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold leading-tight">{cl.name}</span>
              <ProgressRing pct={cl.progress} size={32} stroke={3} />
            </div>
            <div className="mt-auto">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${cl.progress}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground mt-1">{cl.done}/{cl.items} items</span>
            </div>
          </div>
        ))}

        {/* Tasks */}
        <div className="col-span-2 rounded-2xl bg-card border border-border/50 p-4">
          <h3 className="text-sm font-semibold mb-2.5">Active Tasks</h3>
          <div className="space-y-2">
            {TASKS.map(t => (
              <div key={t.text} className="flex items-center gap-3 p-2 rounded-xl bg-muted/50">
                <div className="w-1 h-8 rounded-full" style={{ background: t.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{t.text}</p>
                  <p className="text-[10px] text-muted-foreground">{t.assignee}</p>
                </div>
                <CircleCheck className="h-5 w-5 text-muted-foreground/40 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// OPTION 2: SCROLL CARDS — Linear single-column with inline metrics
// ════════════════════════════════════════════════════════════════
const Option2ScrollCards = () => (
  <div className="space-y-3">
    {/* Hero Metric */}
    <div className="rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10 border border-primary/20 p-5">
      <p className="text-xs font-medium text-muted-foreground mb-1">Today's Sales</p>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-black tracking-tighter">$4,823</span>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15">
          <TrendingUp className="h-3 w-3 text-emerald-500" />
          <span className="text-xs font-semibold text-emerald-600">+12.3%</span>
        </div>
      </div>
      <div className="flex gap-4 mt-3">
        <div><p className="text-[10px] text-muted-foreground">Goal</p><p className="text-sm font-bold">$7,500</p></div>
        <div><p className="text-[10px] text-muted-foreground">Pace</p><p className="text-sm font-bold">$6,210</p></div>
        <div><p className="text-[10px] text-muted-foreground">Labor</p><p className="text-sm font-bold text-amber-500">18.2%</p></div>
      </div>
    </div>

    {/* Inline Metric Strip */}
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
      {METRICS.slice(3).map(m => (
        <div key={m.label} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border/50 shrink-0">
          <m.icon className="h-4 w-4 text-primary" />
          <div>
            <p className="text-xs font-bold">{m.value}</p>
            <p className="text-[10px] text-muted-foreground">{m.label}</p>
          </div>
        </div>
      ))}
    </div>

    {/* Checklists as stacked cards */}
    <div>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-primary" /> Checklists
      </h3>
      <div className="space-y-2">
        {CHECKLISTS.map(cl => (
          <div key={cl.name} className="rounded-xl bg-card border border-border/50 p-3 flex items-center gap-3">
            <ProgressRing pct={cl.progress} size={44} stroke={4} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{cl.name}</p>
              <p className="text-xs text-muted-foreground">{cl.done}/{cl.items} complete · Due {cl.time}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        ))}
      </div>
    </div>

    {/* Tasks */}
    <div>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Zap className="h-4 w-4 text-accent" /> Tasks
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {TASKS.map(t => (
          <div key={t.text} className="flex items-center gap-2 px-3 py-2 rounded-full border border-border/50 bg-card">
            <div className="w-2 h-2 rounded-full" style={{ background: t.color }} />
            <span className="text-xs font-medium">{t.text}</span>
          </div>
        ))}
      </div>
    </div>

    {/* Peak Hours inline */}
    <div className="rounded-2xl bg-card border border-border/50 p-4">
      <h3 className="text-sm font-semibold mb-3">Hourly Sales</h3>
      <div className="flex items-end gap-2 h-16">
        {HOURS.map(h => (
          <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[9px] font-medium text-primary">${(h.val/1000).toFixed(1)}k</span>
            <div className="w-full rounded-md bg-primary/20" style={{ height: `${h.pct}%` }}>
              <div className="w-full h-full rounded-md bg-primary/60" />
            </div>
            <span className="text-[10px] text-muted-foreground">{h.hour}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════
// OPTION 3: EDITORIAL / MAGAZINE — Big hero, supporting modules
// ════════════════════════════════════════════════════════════════
const Option3Editorial = () => (
  <div className="space-y-4">
    {/* Full-width hero card */}
    <div className="rounded-3xl bg-gradient-to-br from-foreground to-foreground/80 text-background p-6 relative overflow-hidden">
      <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, hsl(var(--primary)), transparent 50%)' }} />
      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="h-4 w-4 opacity-60" />
          <span className="text-xs opacity-60 font-medium tracking-widest uppercase">Live Sales</span>
        </div>
        <p className="text-5xl font-black tracking-tighter mt-1">$4,823</p>
        <div className="flex items-center gap-2 mt-2 mb-4">
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-semibold">▲ 12.3%</span>
          <span className="text-xs opacity-50">vs last week</span>
        </div>
        {/* Mini bar chart */}
        <div className="flex items-end gap-1 h-12 opacity-40">
          {HOURS.map(h => (
            <div key={h.hour} className="flex-1 rounded-t-sm bg-background/50" style={{ height: `${h.pct}%` }} />
          ))}
        </div>
      </div>
    </div>

    {/* KPI row */}
    <div className="grid grid-cols-3 gap-2">
      {[METRICS[1], METRICS[3], METRICS[2]].map(m => (
        <div key={m.label} className="rounded-2xl bg-card border border-border/40 p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{m.label}</p>
          <p className="text-lg font-black mt-0.5">{m.value}</p>
          <div className="flex items-center justify-center gap-0.5 mt-0.5">
            <TrendArrow trend={m.trend} />
            <span className="text-[10px] text-muted-foreground">{m.sub.split(' ')[0]}</span>
          </div>
        </div>
      ))}
    </div>

    {/* Checklists — Magazine list */}
    <div className="rounded-2xl bg-card border border-border/40 overflow-hidden">
      <div className="p-3 border-b border-border/40 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-tight">Checklists</h3>
        <span className="text-xs text-muted-foreground">3 of 4 remaining</span>
      </div>
      {CHECKLISTS.map((cl, i) => (
        <div key={cl.name} className={cn("flex items-center gap-3 px-3 py-3", i < CHECKLISTS.length - 1 && "border-b border-border/30")}>
          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
            cl.progress === 100 ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"
          )}>
            {cl.progress === 100 ? '✓' : `${cl.done}`}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">{cl.name}</p>
            <p className="text-[10px] text-muted-foreground">{cl.items} items · {cl.time}</p>
          </div>
          <div className="w-16">
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${cl.progress}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* Tasks as editorial tags */}
    <div>
      <h3 className="text-sm font-bold mb-2">Today's Tasks</h3>
      <div className="space-y-1.5">
        {TASKS.map(t => (
          <div key={t.text} className="flex items-center gap-2.5 rounded-xl p-2.5" 
            style={{ background: `color-mix(in srgb, ${t.color} 8%, transparent)` }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)` }}>
              <CircleCheck className="h-3.5 w-3.5" style={{ color: t.color }} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold">{t.text}</p>
              <p className="text-[10px] text-muted-foreground">{t.assignee}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════
// OPTION 4: GLASSMORPHIC PANELS — Floating depth with blur
// ════════════════════════════════════════════════════════════════
const Option4Glass = () => (
  <div className="space-y-3 relative">
    {/* Ambient blobs */}
    <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-primary/10 blur-3xl" />
    <div className="absolute top-40 -right-10 w-32 h-32 rounded-full bg-accent/10 blur-3xl" />
    
    {/* Metric ribbon */}
    <div className="relative rounded-2xl bg-card/80 backdrop-blur-xl border border-white/10 p-4 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-accent/5" />
      <div className="relative grid grid-cols-3 gap-3">
        {METRICS.slice(0, 3).map(m => (
          <div key={m.label} className="text-center">
            <m.icon className="h-5 w-5 mx-auto text-primary/70 mb-1" />
            <p className="text-lg font-black">{m.value}</p>
            <p className="text-[10px] text-muted-foreground">{m.label}</p>
          </div>
        ))}
      </div>
    </div>

    <div className="relative grid grid-cols-3 gap-2">
      {METRICS.slice(3).map(m => (
        <div key={m.label} className="rounded-xl bg-card/70 backdrop-blur-lg border border-white/10 p-2.5 text-center">
          <p className="text-sm font-black">{m.value}</p>
          <p className="text-[10px] text-muted-foreground">{m.label}</p>
        </div>
      ))}
    </div>

    {/* Sales chart glass panel */}
    <div className="relative rounded-2xl bg-card/70 backdrop-blur-xl border border-white/10 p-4">
      <h3 className="text-sm font-semibold mb-3 text-primary">Hourly Breakdown</h3>
      <div className="flex items-end gap-1.5 h-20">
        {HOURS.map((h, i) => (
          <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full rounded-lg bg-gradient-to-t from-primary/60 to-primary/20" style={{ height: `${h.pct}%` }} />
            <span className="text-[10px] text-muted-foreground">{h.hour}</span>
          </div>
        ))}
      </div>
    </div>

    {/* Checklists glass */}
    <div className="relative rounded-2xl bg-card/70 backdrop-blur-xl border border-white/10 p-4 space-y-2.5">
      <h3 className="text-sm font-semibold">Checklists</h3>
      {CHECKLISTS.map(cl => (
        <div key={cl.name} className="flex items-center gap-3">
          <div className="relative">
            <ProgressRing pct={cl.progress} size={38} stroke={3} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold">{cl.progress}%</span>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold">{cl.name}</p>
            <p className="text-[10px] text-muted-foreground">{cl.done}/{cl.items} · {cl.time}</p>
          </div>
        </div>
      ))}
    </div>

    {/* Tasks as floating pills */}
    <div className="relative space-y-2">
      <h3 className="text-sm font-semibold">Tasks</h3>
      {TASKS.map(t => (
        <div key={t.text} className="rounded-xl bg-card/60 backdrop-blur-lg border border-white/10 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `color-mix(in srgb, ${t.color} 20%, transparent)` }}>
            <CircleCheck className="h-4 w-4" style={{ color: t.color }} />
          </div>
          <div>
            <p className="text-xs font-semibold">{t.text}</p>
            <p className="text-[10px] text-muted-foreground">{t.assignee}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ════════════════════════════════════════════════════════════════
// OPTION 5: COMMAND CENTER — Dense, data-forward, dashboard-style
// ════════════════════════════════════════════════════════════════
const Option5Command = () => (
  <div className="space-y-2.5">
    {/* Live ticker bar */}
    <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
      {METRICS.map(m => (
        <div key={m.label} className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border/50">
          <m.icon className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold">{m.value}</span>
          <TrendArrow trend={m.trend} />
        </div>
      ))}
    </div>

    {/* Main grid */}
    <div className="grid grid-cols-2 gap-2">
      {/* Sales panel */}
      <div className="col-span-2 rounded-xl bg-card border border-border/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">Live Sales</span>
          </div>
          <span className="text-2xl font-black">$4,823</span>
        </div>
        <div className="flex items-end gap-1 h-14">
          {HOURS.map(h => (
            <div key={h.hour} className="flex-1 flex flex-col items-center">
              <div className="w-full rounded-sm bg-primary/70" style={{ height: `${h.pct * 0.14}px` }} />
              <span className="text-[8px] text-muted-foreground mt-0.5">{h.hour}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Goal + Pace mini cards */}
      <div className="rounded-xl bg-card border border-border/50 p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Target className="h-3.5 w-3.5 text-accent" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Goal</span>
        </div>
        <p className="text-xl font-black">$7,500</p>
        <div className="h-1 rounded-full bg-muted mt-2 overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: '64%' }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">64% achieved</p>
      </div>

      <div className="rounded-xl bg-card border border-border/50 p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Flame className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Labor</span>
        </div>
        <p className="text-xl font-black">18.2%</p>
        <p className="text-sm text-muted-foreground font-semibold">$876</p>
        <p className="text-[10px] text-muted-foreground mt-1">6 team clocked in</p>
      </div>

      {/* Checklists compact */}
      <div className="col-span-2 rounded-xl bg-card border border-border/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wider">Checklists</span>
          <span className="text-xs text-primary font-semibold">1/4 Done</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {CHECKLISTS.map(cl => (
            <div key={cl.name} className={cn(
              "rounded-lg p-2 text-center border",
              cl.progress === 100 
                ? "bg-emerald-500/10 border-emerald-500/30" 
                : cl.progress > 0 
                  ? "bg-amber-500/10 border-amber-500/30" 
                  : "bg-muted/50 border-border/30"
            )}>
              <p className="text-lg font-black">{cl.progress}%</p>
              <p className="text-[9px] font-medium truncate leading-tight mt-0.5">{cl.name}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tasks compact */}
      <div className="col-span-2 rounded-xl bg-card border border-border/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wider">Tasks</span>
          <span className="text-xs text-muted-foreground">{TASKS.length} active</span>
        </div>
        <div className="flex gap-1.5">
          {TASKS.map(t => (
            <div key={t.text} className="flex-1 rounded-lg p-2 border border-border/30"
              style={{ background: `color-mix(in srgb, ${t.color} 6%, transparent)` }}>
              <div className="w-5 h-5 rounded-full mb-1.5 flex items-center justify-center" style={{ background: `color-mix(in srgb, ${t.color} 15%, transparent)` }}>
                <CircleCheck className="h-3 w-3" style={{ color: t.color }} />
              </div>
              <p className="text-[10px] font-semibold leading-tight">{t.text}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{t.assignee}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

// ─── Preview Page ────────────────────────────────────────────────
const OPTIONS = [
  { id: 1, name: 'Bento Grid', desc: 'Apple-inspired asymmetric cards with swipeable metrics', component: Option1Bento },
  { id: 2, name: 'Scroll Cards', desc: 'Linear single-column with hero metric + pill tasks', component: Option2ScrollCards },
  { id: 3, name: 'Editorial', desc: 'Magazine-style hero with dark contrast + clean lists', component: Option3Editorial },
  { id: 4, name: 'Glassmorphic', desc: 'Floating depth panels with ambient color blobs', component: Option4Glass },
  { id: 5, name: 'Command Center', desc: 'Dense data-forward grid with live ticker strip', component: Option5Command },
];

export default function DashboardStylePreview() {
  const [active, setActive] = useState(0);
  const ActiveComponent = OPTIONS[active].component;

  return (
    <Layout>
      <div className="space-y-4 pb-24">
        <div>
          <h1 className="text-2xl font-black">Dashboard Options</h1>
          <p className="text-xs text-muted-foreground mt-0.5">5 modern approaches — all mockup data</p>
        </div>

        {/* Option selector */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1 pb-1">
          {OPTIONS.map((opt, i) => (
            <button key={opt.id} onClick={() => setActive(i)}
              className={cn(
                "shrink-0 px-3 py-2 rounded-xl text-left transition-all border",
                i === active 
                  ? "bg-primary text-primary-foreground border-primary" 
                  : "bg-card border-border/50 hover:border-primary/50"
              )}>
              <p className="text-xs font-bold">Option {opt.id}</p>
              <p className={cn("text-[10px] mt-0.5", i === active ? "text-primary-foreground/70" : "text-muted-foreground")}>{opt.name}</p>
            </button>
          ))}
        </div>

        {/* Description */}
        <div className="rounded-xl bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{OPTIONS[active].name}:</span> {OPTIONS[active].desc}
          </p>
        </div>

        {/* Active preview */}
        <div className="rounded-2xl border-2 border-dashed border-border/60 p-3 bg-background">
          <ActiveComponent />
        </div>
      </div>
    </Layout>
  );
}
