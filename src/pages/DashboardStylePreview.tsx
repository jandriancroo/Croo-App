import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { cn } from '@/lib/utils';
import { 
  TrendingUp, ChevronRight, ClipboardCheck, CircleCheck, 
  DollarSign, Users, BarChart3, Flame,
  ArrowUpRight, ArrowDownRight,
  Timer, Zap, Target, Activity
} from 'lucide-react';


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
// OPTION 1: CURRENT DESIGN — Neumorphic cards, 3D cubes, accent stripes
// ════════════════════════════════════════════════════════════════
const Option1Current = () => {
  const MOCK_CUBES = [
    { title: 'Daily Sales', metrics: ['$4,823', '$6,210', '18.2%'], labels: ['Sales', 'Pace', 'Labor'], color: 'hsl(270 60% 55%)' },
    { title: 'Weekly Sales', metrics: ['$28,450', '$32,100', '$35,000'], labels: ['WTD', 'Pace', 'Goal'], color: 'hsl(var(--primary))' },
  ];

  return (
    <div className="space-y-3">
      {/* Header matching current */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dash</h1>
        <div className="flex gap-2">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
            <Target className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>
      <div className="h-px bg-border" />

      {/* Task pills — color-washed 2-col */}
      <div className="flex flex-wrap gap-1.5">
        {TASKS.map(t => (
          <div key={t.text} className="min-w-[calc(50%-4px)] flex items-center gap-2 px-2.5 py-2 rounded-full"
            style={{ background: `color-mix(in srgb, ${t.color} 10%, transparent)` }}>
            <div className="w-1.5 h-4 rounded-full" style={{ background: t.color }} />
            <span className="text-[11px] font-medium truncate">{t.text}</span>
          </div>
        ))}
      </div>

      {/* 3D Data Cubes mockup */}
      <div className="flex gap-2.5">
        {MOCK_CUBES.map(cube => (
          <div key={cube.title} className="flex-1 rounded-xl overflow-hidden border-0" 
            style={{ background: cube.color, perspective: '600px' }}>
            <div className="p-3 text-white">
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{cube.title}</p>
              <div className="mt-2 space-y-1.5">
                {cube.metrics.map((val, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[10px] opacity-60">{cube.labels[i]}</span>
                    <span className="text-sm font-black">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sales Chart — neumorphic card */}
      <div className="rounded-xl bg-card border-0 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Sales Overview</h3>
          </div>
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

      {/* Checklist Cards — matching current neumorphic style with left accent + ring */}
      <div className="space-y-2.5">
        {CHECKLISTS.map(cl => (
          <div key={cl.name} className="rounded-xl bg-card border-0 overflow-hidden relative p-0 shadow-sm">
            {/* Left accent stripe */}
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" 
              style={{ background: cl.progress === 100 ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.5)' }} />
            <div className="flex items-center gap-3 pl-5 pr-4 py-3.5">
              {/* Progress ring */}
              <div className="relative w-12 h-12 shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                  <circle cx="24" cy="24" r="20" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 20}
                    strokeDashoffset={(2 * Math.PI * 20) - (cl.progress / 100) * (2 * Math.PI * 20)} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  {cl.progress === 100 
                    ? <CircleCheck className="h-5 w-5 text-primary" />
                    : <span className="text-[11px] font-black text-primary">{cl.progress}%</span>
                  }
                </div>
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm">{cl.name}</span>
                {cl.progress === 100 ? (
                  <p className="text-xs text-primary font-medium">All tasks complete ✓</p>
                ) : (
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${cl.progress}%` }} />
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground">{cl.done}/{cl.items}</span>
                  </div>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            </div>
          </div>
        ))}
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
  { id: 1, name: 'Current Design', desc: 'Your existing dashboard — neumorphic cards, 3D data cubes, accent-stripe checklists, color-washed task pills', component: Option1Current },
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
