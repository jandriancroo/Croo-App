import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, LayoutGrid, Sparkles, Plus, Pencil, Signal, GripVertical, Ban, ArrowRightLeft, Package, Copy, Printer, Clock, Users, DollarSign, CalendarDays, MoreHorizontal, Filter, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

// ============ MOCK DATA ============
const DAYS = [
  { label: "Mon", date: "2/9", isToday: false },
  { label: "Tue", date: "2/10", isToday: true },
  { label: "Wed", date: "2/11", isToday: false },
  { label: "Thu", date: "2/12", isToday: false },
  { label: "Fri", date: "2/13", isToday: false },
  { label: "Sat", date: "2/14", isToday: false, badge: "Blackout" },
  { label: "Sun", date: "2/15", isToday: false },
];

const EVENTS = [
  { day: 1, label: "Order Produce", time: "9:00 AM", icon: "📦" },
  { day: 2, label: "Order PFG", time: "9:00 AM", icon: "📦", extra: "+1" },
  { day: 3, label: "Order Produce", time: "9:00 AM", icon: "📦" },
  { day: 5, label: "Order Produce", time: "9:00 AM", icon: "📦" },
  { day: 6, label: "Order PFG", time: "9:00 AM", icon: "📦" },
];

interface Shift {
  time: string;
  position: string;
  color: string;
  isDraft?: boolean;
  isOffer?: boolean;
}

interface Employee {
  name: string;
  avatar: string;
  hours: number;
  cost: number;
  shifts: (Shift | null)[];
  timeOff?: number[];
  unavailable?: number[];
}

interface RoleGroup {
  role: string;
  employees: Employee[];
  totalHours: number;
}

const GROUPS: RoleGroup[] = [
  {
    role: "SUPER ADMINS",
    totalHours: 0,
    employees: [
      {
        name: "Jordan A.",
        avatar: "JA",
        hours: 0,
        cost: 0,
        shifts: [
          null,
          { time: "5:00P–9:00P", position: "", color: "#94a3b8", isDraft: true },
          null, null, null, null, null,
        ],
        unavailable: [5, 6],
      },
    ],
  },
  {
    role: "SHIFT MANAGERS",
    totalHours: 129,
    employees: [
      {
        name: "Alle R.",
        avatar: "AR",
        hours: 34,
        cost: 816,
        shifts: [
          { time: "9:00A–4:00P", position: "Opening Manager", color: "#4ade80" },
          null,
          { time: "9:00A–5:30P", position: "Opening Manager", color: "#4ade80" },
          null,
          { time: "9:00A–4:00P", position: "Opening Manager", color: "#4ade80" },
          { time: "9:00A–4:00P", position: "Opening Manager", color: "#4ade80" },
          { time: "9:00A–4:00P", position: "Opening Manager", color: "#4ade80" },
        ],
      },
      {
        name: "Joshua H.",
        avatar: "JH",
        hours: 41,
        cost: 902,
        shifts: [
          { time: "3:30P–11:00P", position: "Closing Manager", color: "#60a5fa" },
          { time: "4:00P–11:00P", position: "Prep", color: "#fbbf24" },
          null,
          { time: "9:00A–4:00P", position: "Opening Manager", color: "#4ade80" },
          { time: "3:30P–11:00P", position: "Closing Manager", color: "#60a5fa" },
          { time: "3:30P–11:00P", position: "Closing Manager", color: "#60a5fa" },
          { time: "3:30P–11:00P", position: "Closing Manager", color: "#60a5fa" },
        ],
      },
      {
        name: "Cheyenne N.",
        avatar: "CN",
        hours: 20.5,
        cost: 471.5,
        shifts: [
          null,
          null,
          { time: "3:30P–11:00P", position: "Closing Manager", color: "#60a5fa" },
          { time: "3:30P–11:00P", position: "Closing Manager", color: "#60a5fa" },
          { time: "5:00P–11:00P", position: "", color: "#94a3b8" },
          null,
          { time: "4:00P–11:00P", position: "Prep", color: "#fbbf24" },
        ],
        timeOff: [5],
      },
    ],
  },
  {
    role: "TEAM MEMBERS",
    totalHours: 88,
    employees: [
      {
        name: "Marcus T.",
        avatar: "MT",
        hours: 32,
        cost: 480,
        shifts: [
          { time: "10:00A–4:00P", position: "Dough", color: "#f472b6" },
          { time: "10:00A–4:00P", position: "Dough", color: "#f472b6" },
          null,
          { time: "10:00A–4:00P", position: "Dough", color: "#f472b6" },
          { time: "10:00A–4:00P", position: "Dough", color: "#f472b6" },
          { time: "10:00A–4:00P", position: "Dough", color: "#f472b6" },
          null,
        ],
      },
      {
        name: "Sophia L.",
        avatar: "SL",
        hours: 28,
        cost: 420,
        shifts: [
          { time: "12:00P–8:00P", position: "Line", color: "#c084fc" },
          null,
          { time: "12:00P–8:00P", position: "Line", color: "#c084fc" },
          { time: "12:00P–8:00P", position: "Line", color: "#c084fc" },
          null,
          { time: "4:00P–11:00P", position: "Line", color: "#818cf8" },
          { time: "5:30P–10:30P", position: "Line", color: "#818cf8" },
        ],
      },
      {
        name: "David K.",
        avatar: "DK",
        hours: 28,
        cost: 420,
        shifts: [
          null,
          { time: "5:30P–11:00P", position: "Line", color: "#818cf8", isOffer: true },
          { time: "4:00P–11:00P", position: "Prep", color: "#fbbf24" },
          null,
          { time: "4:00P–8:00P", position: "Line", color: "#818cf8" },
          { time: "5:00P–11:00P", position: "Line", color: "#818cf8" },
          { time: "5:30P–11:00P", position: "Line", color: "#818cf8" },
        ],
      },
    ],
  },
];

const TEMPLATES = [
  { time: "9:00A–4:00P", name: "Opening Manager", color: "#4ade80" },
  { time: "10:00A–4:00P", name: "Dough", color: "#f472b6" },
  { time: "12:00P–8:00P", name: "Line", color: "#c084fc" },
  { time: "3:30P–11:00P", name: "Closing Manager", color: "#60a5fa" },
  { time: "4:00P–11:00P", name: "Prep", color: "#fbbf24" },
  { time: "4:00P–8:00P", name: "Line", color: "#818cf8" },
  { time: "5:00P–11:00P", name: "Line", color: "#818cf8" },
  { time: "5:30P–11:00P", name: "Line", color: "#818cf8" },
];

// ============ DESIGN 1: CORPORATE SHARP ============
const Design1 = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (role: string) => setCollapsed(p => ({ ...p, [role]: !p[role] }));

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', 'SF Pro Display', system-ui, sans-serif" }}>
      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
        Design 1 — Corporate Sharp
      </div>
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-foreground text-background px-3 py-1.5 rounded text-sm font-semibold tracking-tight">
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Feb 9 – Feb 15</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </div>
            <button className="text-xs font-medium border border-border px-2.5 py-1 rounded hover:bg-muted transition-colors">
              Current Week
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-xs font-medium border border-border px-2.5 py-1 rounded hover:bg-muted">
              <LayoutGrid className="h-3 w-3" /> Compact
            </button>
            <button className="flex items-center gap-1.5 text-xs font-medium border border-border px-2.5 py-1 rounded hover:bg-muted">
              <Sparkles className="h-3 w-3" /> Croo AI
            </button>
            <button className="h-6 w-6 flex items-center justify-center border border-border rounded hover:bg-muted">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button className="h-6 w-6 flex items-center justify-center border border-border rounded hover:bg-muted">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] text-muted-foreground ml-1">Updated by Jordan A.</span>
            <div className="flex items-center gap-1 border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded text-xs font-bold tracking-wide">
              <Signal className="h-3 w-3" /> LIVE
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-border">
          <div className="px-3 py-2 border-r border-border" />
          {DAYS.map((d, i) => (
            <div key={i} className={`text-center py-2 text-xs border-r border-border last:border-r-0 ${d.isToday ? "bg-foreground text-background font-bold" : "font-medium text-muted-foreground"}`}>
              <div className="text-[10px] uppercase tracking-wider">{d.label}</div>
              <div className="text-sm font-semibold">{d.date}</div>
              {d.badge && <div className="mt-0.5 text-[9px] text-red-500 font-medium">⊘ {d.badge}</div>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-border bg-amber-50/50 dark:bg-amber-950/20">
          <div className="px-3 py-1.5 border-r border-border flex items-center gap-1.5 text-xs font-semibold">Events <Plus className="h-3 w-3 text-muted-foreground" /></div>
          {DAYS.map((_, i) => {
            const ev = EVENTS.find(e => e.day === i);
            return (
              <div key={i} className="px-1 py-1 border-r border-border last:border-r-0 flex items-center justify-center">
                {ev && (
                  <div className="text-[10px] bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5 font-medium text-center leading-tight truncate w-full">
                    {ev.icon} {ev.label}
                    <div className="text-[9px] text-muted-foreground">{ev.time}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {GROUPS.map((group) => (
          <div key={group.role}>
            <div className="grid grid-cols-[180px_1fr] border-b border-border bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors" onClick={() => toggle(group.role)}>
              <div className="px-3 py-1.5 flex items-center gap-2">
                {collapsed[group.role] ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                <span className="text-[11px] font-bold tracking-wide uppercase">{group.role}</span>
                <span className="text-[10px] text-muted-foreground">({group.employees.length})</span>
              </div>
              <div className="flex items-center justify-end px-3 text-[11px] font-semibold text-muted-foreground">
                {group.totalHours > 0 && `${group.totalHours.toFixed(1)} hrs`}
              </div>
            </div>
            {!collapsed[group.role] && group.employees.map((emp, empIdx) => (
              <div key={empIdx} className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-border hover:bg-muted/20 transition-colors">
                <div className="px-2 py-2 border-r border-border flex items-center gap-2">
                  <GripVertical className="h-3 w-3 text-muted-foreground/40 cursor-grab" />
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-muted-foreground/20 to-muted-foreground/10 flex items-center justify-center text-[10px] font-bold text-muted-foreground">{emp.avatar}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{emp.hours} hrs · ${emp.cost.toFixed(0)}</div>
                  </div>
                </div>
                {emp.shifts.map((shift, dayIdx) => (
                  <div key={dayIdx} className="px-0.5 py-1 border-r border-border last:border-r-0 flex items-stretch">
                    {shift ? (
                      <div className={`w-full rounded text-[10px] leading-tight px-1.5 py-1 text-white font-medium flex flex-col justify-center ${shift.isDraft ? "opacity-60 border-2 border-dashed border-muted-foreground" : ""}`} style={{ backgroundColor: shift.isDraft ? "transparent" : shift.color, color: shift.isDraft ? "inherit" : "white" }}>
                        <div className="font-semibold">{shift.time}</div>
                        {shift.position && <div className="opacity-90 truncate">{shift.position}</div>}
                        {shift.isOffer && <ArrowRightLeft className="h-2.5 w-2.5 mt-0.5 opacity-70" />}
                      </div>
                    ) : emp.timeOff?.includes(dayIdx) ? (
                      <div className="w-full rounded bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 flex items-center justify-center text-[10px] text-orange-600 dark:text-orange-400 font-medium">Time Off</div>
                    ) : emp.unavailable?.includes(dayIdx) ? (
                      <div className="w-full rounded border border-dashed border-muted-foreground/30 flex items-center justify-center text-[10px] text-muted-foreground"><Ban className="h-3 w-3 mr-0.5" /> Unavailable</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        <div className="px-3 py-2 border-t border-border bg-muted/20">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Templates</div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t, i) => (
              <div key={i} className="text-[9px] text-white font-semibold rounded px-2 py-1 leading-tight cursor-grab" style={{ backgroundColor: t.color }}>
                <div>{t.time}</div>
                <div className="opacity-80">{t.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ DESIGN 2: MODERN MINIMAL ============
const Design2 = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (role: string) => setCollapsed(p => ({ ...p, [role]: !p[role] }));

  return (
    <div style={{ fontFamily: "'Space Grotesk', 'Inter Tight', system-ui, sans-serif" }}>
      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
        Design 2 — Modern Minimal
      </div>
      <div className="rounded-xl overflow-hidden bg-card border border-border/50 shadow-sm">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button className="h-7 w-7 rounded-full border border-border flex items-center justify-center hover:bg-muted"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="text-base font-semibold tracking-tight">Feb 9 – 15</span>
              <button className="h-7 w-7 rounded-full border border-border flex items-center justify-center hover:bg-muted"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            <span className="text-[11px] text-muted-foreground border border-border/50 rounded-full px-2.5 py-0.5">Today</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3" /> AI</div>
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Live</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[200px_repeat(7,1fr)] px-1">
          <div />
          {DAYS.map((d, i) => (
            <div key={i} className="text-center py-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{d.label}</div>
              <div className={`text-lg font-bold mt-0.5 ${d.isToday ? "text-primary" : "text-foreground"}`}>{d.date.split("/")[1]}</div>
              {d.isToday && <div className="mx-auto mt-1 h-0.5 w-5 rounded-full bg-primary" />}
              {d.badge && <div className="mt-1 text-[9px] text-red-400 font-medium">{d.badge}</div>}
            </div>
          ))}
        </div>

        <div className="h-px bg-border/50 mx-4" />

        <div className="grid grid-cols-[200px_repeat(7,1fr)] px-1">
          <div className="px-4 py-2 flex items-center text-[11px] text-muted-foreground font-medium">Events</div>
          {DAYS.map((_, i) => {
            const ev = EVENTS.find(e => e.day === i);
            return (
              <div key={i} className="px-1 py-1.5 flex items-center justify-center">
                {ev && <div className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded-full px-2.5 py-1 font-medium whitespace-nowrap">{ev.label}</div>}
              </div>
            );
          })}
        </div>

        <div className="h-px bg-border/50 mx-4" />

        {GROUPS.map((group) => (
          <div key={group.role}>
            <div className="flex items-center justify-between px-5 py-2 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggle(group.role)}>
              <div className="flex items-center gap-2">
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${collapsed[group.role] ? "-rotate-90" : ""}`} />
                <span className="text-[11px] font-semibold tracking-wide">{group.role}</span>
                <span className="text-[10px] text-muted-foreground">{group.employees.length}</span>
              </div>
              {group.totalHours > 0 && <span className="text-[11px] text-muted-foreground">{group.totalHours}h</span>}
            </div>
            {!collapsed[group.role] && group.employees.map((emp, empIdx) => (
              <div key={empIdx} className="grid grid-cols-[200px_repeat(7,1fr)] px-1 hover:bg-muted/10 transition-colors">
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-[11px] font-bold text-primary/70">{emp.avatar}</div>
                  <div>
                    <div className="text-sm font-medium">{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground">{emp.hours}h · ${emp.cost.toFixed(0)}</div>
                  </div>
                </div>
                {emp.shifts.map((shift, dayIdx) => (
                  <div key={dayIdx} className="px-1 py-1.5 flex items-stretch">
                    {shift ? (
                      <div className={`w-full rounded-lg text-[10px] leading-tight px-2 py-1.5 font-medium flex flex-col justify-center ${shift.isDraft ? "border-2 border-dashed border-muted-foreground/30 text-muted-foreground bg-transparent" : "text-white shadow-sm"}`} style={!shift.isDraft ? { backgroundColor: shift.color } : undefined}>
                        <div className="font-semibold">{shift.time}</div>
                        {shift.position && <div className="opacity-80 truncate mt-0.5">{shift.position}</div>}
                        {shift.isOffer && <ArrowRightLeft className="h-2.5 w-2.5 mt-0.5 opacity-60" />}
                      </div>
                    ) : emp.timeOff?.includes(dayIdx) ? (
                      <div className="w-full rounded-lg bg-orange-500/10 flex items-center justify-center text-[10px] text-orange-500 font-medium">Time Off</div>
                    ) : emp.unavailable?.includes(dayIdx) ? (
                      <div className="w-full rounded-lg flex items-center justify-center text-[10px] text-muted-foreground/50"><Ban className="h-3 w-3 mr-0.5" /></div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
            <div className="h-px bg-border/30 mx-4" />
          </div>
        ))}

        <div className="px-5 py-3">
          <div className="text-[10px] text-muted-foreground font-medium mb-2">Shift Templates</div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t, i) => (
              <div key={i} className="text-[9px] font-medium rounded-full px-3 py-1.5 text-white cursor-grab shadow-sm" style={{ backgroundColor: t.color }}>
                {t.name} · {t.time}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ DESIGN 3: DATA-DENSE PRO ============
const Design3 = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (role: string) => setCollapsed(p => ({ ...p, [role]: !p[role] }));

  return (
    <div style={{ fontFamily: "'Geist', 'SF Pro Text', system-ui, sans-serif" }}>
      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
        Design 3 — Data-Dense Pro
      </div>
      <div className="rounded-md overflow-hidden bg-card border border-border">
        <div className="flex items-center justify-between px-3 py-2 bg-foreground text-background">
          <div className="flex items-center gap-2.5">
            <button className="text-background/60 hover:text-background"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-bold tracking-tight" style={{ fontFamily: "'JetBrains Mono', monospace" }}>W06 · FEB 9–15</span>
            <button className="text-background/60 hover:text-background"><ChevronRight className="h-4 w-4" /></button>
            <span className="text-[10px] border border-background/30 rounded px-1.5 py-0.5 text-background/70">NOW</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-background/50" style={{ fontFamily: "'JetBrains Mono', monospace" }}>217.5h · $4,509</div>
            <div className="flex items-center gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-400" style={{ fontFamily: "'JetBrains Mono', monospace" }}>LIVE</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[160px_repeat(7,1fr)] bg-muted/30">
          <div className="px-2 py-1.5 border-r border-b border-border text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Employee</div>
          {DAYS.map((d, i) => (
            <div key={i} className={`text-center py-1.5 border-r border-b border-border last:border-r-0 ${d.isToday ? "bg-primary/10 border-b-2 border-b-primary" : ""}`}>
              <div className="text-[10px] font-bold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{d.label.toUpperCase()} {d.date}</div>
              {d.badge && <div className="text-[8px] text-red-500 font-bold">{d.badge.toUpperCase()}</div>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-border">
          <div className="px-2 py-1 border-r border-border text-[9px] font-semibold text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" /> EVENTS</div>
          {DAYS.map((_, i) => {
            const ev = EVENTS.find(e => e.day === i);
            return (
              <div key={i} className="px-0.5 py-0.5 border-r border-border last:border-r-0">
                {ev && <div className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1 py-0.5 rounded-sm font-bold text-center" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{ev.label.toUpperCase()}</div>}
              </div>
            );
          })}
        </div>

        {GROUPS.map((group) => (
          <div key={group.role}>
            <div className="grid grid-cols-[160px_1fr] border-b border-border bg-muted/50 cursor-pointer" onClick={() => toggle(group.role)}>
              <div className="px-2 py-1 flex items-center gap-1.5">
                <ChevronDown className={`h-3 w-3 transition-transform ${collapsed[group.role] ? "-rotate-90" : ""}`} />
                <span className="text-[10px] font-black tracking-wider">{group.role}</span>
                <span className="text-[9px] px-1 rounded bg-muted-foreground/10 text-muted-foreground">{group.employees.length}</span>
              </div>
              <div className="flex items-center justify-end px-2 text-[10px] font-bold text-muted-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {group.totalHours > 0 && `${group.totalHours.toFixed(1)}h`}
              </div>
            </div>
            {!collapsed[group.role] && group.employees.map((emp, empIdx) => (
              <div key={empIdx} className="grid grid-cols-[160px_repeat(7,1fr)] border-b border-border/50 hover:bg-muted/10">
                <div className="px-2 py-1.5 border-r border-border flex items-center gap-2">
                  <div className="h-6 w-6 rounded bg-muted-foreground/10 flex items-center justify-center text-[9px] font-bold text-muted-foreground">{emp.avatar}</div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold truncate">{emp.name}</div>
                    <div className="text-[9px] text-muted-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{emp.hours}h/${emp.cost.toFixed(0)}</div>
                  </div>
                </div>
                {emp.shifts.map((shift, dayIdx) => (
                  <div key={dayIdx} className={`px-0.5 py-0.5 border-r border-border/30 last:border-r-0 ${DAYS[dayIdx]?.isToday ? "bg-primary/5" : ""}`}>
                    {shift ? (
                      <div className={`w-full h-full min-h-[40px] rounded-sm text-[9px] leading-tight px-1 py-1 font-bold flex flex-col justify-center ${shift.isDraft ? "border border-dashed border-muted-foreground/40 text-muted-foreground" : "text-white"}`} style={!shift.isDraft ? { backgroundColor: shift.color } : undefined}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px" }}>{shift.time}</div>
                        {shift.position && <div className="opacity-80 truncate font-medium mt-0.5">{shift.position}</div>}
                        {shift.isOffer && <div className="flex items-center gap-0.5 mt-0.5 text-[8px] opacity-70"><ArrowRightLeft className="h-2 w-2" /> OFFER</div>}
                      </div>
                    ) : emp.timeOff?.includes(dayIdx) ? (
                      <div className="w-full h-full min-h-[40px] rounded-sm bg-orange-500/15 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-orange-500 tracking-wider" style={{ fontFamily: "'JetBrains Mono', monospace" }}>OFF</span>
                      </div>
                    ) : emp.unavailable?.includes(dayIdx) ? (
                      <div className="w-full h-full min-h-[40px] rounded-sm bg-muted/30 flex items-center justify-center">
                        <span className="text-[8px] text-muted-foreground/40 font-bold tracking-wider" style={{ fontFamily: "'JetBrains Mono', monospace" }}>N/A</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        <div className="px-2 py-1.5 bg-muted/30 border-t border-border flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest shrink-0 mr-1">TPL</span>
          {TEMPLATES.map((t, i) => (
            <div key={i} className="text-[8px] font-bold text-white rounded-sm px-1.5 py-1 cursor-grab shrink-0" style={{ backgroundColor: t.color, fontFamily: "'JetBrains Mono', monospace" }}>{t.time}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============ DESIGN 4: DEPUTY-INSPIRED ============
// Clean white UI, blue accent, left-colored bar on shifts, prominent publish button, area-based grouping
const Design4 = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (role: string) => setCollapsed(p => ({ ...p, [role]: !p[role] }));

  return (
    <div style={{ fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif" }}>
      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
        Design 4 — Deputy-Inspired
      </div>
      <div className="rounded-lg overflow-hidden bg-card border border-border shadow-sm">
        {/* Top toolbar — white with blue accent */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
              <div className="px-3 py-1.5 text-sm font-semibold">Feb 9 – Feb 15, 2026</div>
              <button className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">Today</button>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted">
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted">
              <Sparkles className="h-3.5 w-3.5" /> Auto-Schedule
            </button>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted">
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            <div className="h-5 w-px bg-border mx-1" />
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
              <div className="h-2 w-2 rounded-full bg-emerald-500" /> Published
            </div>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-6 px-4 py-2 border-b border-border bg-blue-50/50 dark:bg-blue-950/20 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">{GROUPS.reduce((s, g) => s + g.employees.length, 0)}</span> staff
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">217.5</span> hours
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground">$4,509</span> labor
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-muted-foreground text-[11px]">
            <Eye className="h-3 w-3" /> Updated by Jordan A. · 2h ago
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-[190px_repeat(7,1fr)] border-b border-border">
          <div className="px-3 py-2.5 border-r border-border text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
            <Filter className="h-3 w-3" /> Team Member
          </div>
          {DAYS.map((d, i) => (
            <div key={i} className={`text-center py-2 border-r border-border last:border-r-0 ${d.isToday ? "bg-blue-600 text-white" : ""}`}>
              <div className={`text-[11px] font-semibold ${d.isToday ? "text-blue-100" : "text-muted-foreground"}`}>{d.label}</div>
              <div className={`text-base font-bold ${d.isToday ? "" : ""}`}>{d.date.split("/")[1]}</div>
              {d.badge && <div className="text-[9px] text-red-400 font-semibold mt-0.5">🚫 {d.badge}</div>}
            </div>
          ))}
        </div>

        {/* Events */}
        <div className="grid grid-cols-[190px_repeat(7,1fr)] border-b border-border">
          <div className="px-3 py-1.5 border-r border-border text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> Events
          </div>
          {DAYS.map((_, i) => {
            const ev = EVENTS.find(e => e.day === i);
            return (
              <div key={i} className="px-1 py-1 border-r border-border last:border-r-0 flex items-center justify-center">
                {ev && (
                  <div className="text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 rounded-md px-2 py-1 text-center w-full">
                    <div className="font-semibold">{ev.label}</div>
                    <div className="text-[9px] text-amber-500">{ev.time}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Role groups */}
        {GROUPS.map((group) => (
          <div key={group.role}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30 cursor-pointer hover:bg-muted/50" onClick={() => toggle(group.role)}>
              <div className="flex items-center gap-2">
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${collapsed[group.role] ? "-rotate-90" : ""}`} />
                <span className="text-xs font-bold uppercase tracking-wide">{group.role}</span>
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground font-medium">{group.employees.length}</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                {group.totalHours > 0 && <span>{group.totalHours}h scheduled</span>}
              </div>
            </div>
            {!collapsed[group.role] && group.employees.map((emp, empIdx) => (
              <div key={empIdx} className="grid grid-cols-[190px_repeat(7,1fr)] border-b border-border/60 hover:bg-muted/10 transition-colors">
                <div className="px-3 py-2.5 border-r border-border flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px] font-bold text-blue-600 dark:text-blue-400">{emp.avatar}</div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground">{emp.hours}h · ${emp.cost.toFixed(0)}</div>
                  </div>
                </div>
                {emp.shifts.map((shift, dayIdx) => (
                  <div key={dayIdx} className={`px-1 py-1 border-r border-border/40 last:border-r-0 flex items-stretch ${DAYS[dayIdx]?.isToday ? "bg-blue-50/50 dark:bg-blue-950/10" : ""}`}>
                    {shift ? (
                      <div className={`w-full rounded-md overflow-hidden flex ${shift.isDraft ? "border-2 border-dashed border-muted-foreground/30" : "border border-border/30"}`}>
                        {/* Left color bar — Deputy signature */}
                        {!shift.isDraft && <div className="w-1 shrink-0" style={{ backgroundColor: shift.color }} />}
                        <div className={`flex-1 px-1.5 py-1 text-[10px] leading-tight ${shift.isDraft ? "text-muted-foreground" : ""}`}>
                          <div className="font-semibold">{shift.time}</div>
                          {shift.position && (
                            <div className="text-[9px] mt-0.5 font-medium truncate" style={{ color: shift.isDraft ? undefined : shift.color }}>
                              {shift.position}
                            </div>
                          )}
                          {shift.isOffer && <div className="flex items-center gap-0.5 text-[9px] text-blue-500 mt-0.5"><ArrowRightLeft className="h-2.5 w-2.5" /> Offer</div>}
                        </div>
                      </div>
                    ) : emp.timeOff?.includes(dayIdx) ? (
                      <div className="w-full rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800/50 flex items-center justify-center text-[10px] text-orange-500 font-semibold">
                        Time Off
                      </div>
                    ) : emp.unavailable?.includes(dayIdx) ? (
                      <div className="w-full rounded-md bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground/40 font-medium">
                        <Ban className="h-3 w-3 mr-0.5" /> N/A
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        {/* Templates */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-[11px] font-semibold text-muted-foreground mb-2">Shift Templates</div>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium border border-border rounded-md px-2.5 py-1.5 cursor-grab hover:bg-muted/30">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: t.color }} />
                <span>{t.name}</span>
                <span className="text-muted-foreground">{t.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ DESIGN 5: 7SHIFTS-INSPIRED ============
// Dark sidebar, position-colored full cards, labor budget bar, role-grouped with dept icons
const Design5 = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (role: string) => setCollapsed(p => ({ ...p, [role]: !p[role] }));

  const laborTarget = 4800;
  const laborActual = 4509;
  const laborPct = (laborActual / laborTarget) * 100;

  return (
    <div style={{ fontFamily: "'DM Sans', 'SF Pro Display', system-ui, sans-serif" }}>
      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
        Design 5 — 7shifts-Inspired
      </div>
      <div className="rounded-xl overflow-hidden bg-card border border-border">
        {/* Top nav — 7shifts style */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
              <button className="text-[11px] font-semibold px-3 py-1.5 rounded-md bg-foreground text-background">Week</button>
              <button className="text-[11px] font-medium px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground">Day</button>
            </div>
            <div className="h-5 w-px bg-border" />
            <div className="flex items-center gap-1">
              <button className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-sm font-bold px-2">Feb 9 – 15</span>
              <button className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-purple-500" /> Smart Schedule
            </button>
            <button className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1.5">
              <Signal className="h-3 w-3" /> Published
            </button>
          </div>
        </div>

        {/* Labor budget bar — 7shifts signature */}
        <div className="px-4 py-2.5 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold">Labor Budget</span>
            <span className="text-[11px] text-muted-foreground">
              <span className="font-bold text-foreground">${laborActual.toLocaleString()}</span> / ${laborTarget.toLocaleString()} target
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(laborPct, 100)}%`,
                backgroundColor: laborPct > 100 ? '#ef4444' : laborPct > 90 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">217.5 total hours · 7 staff</span>
            <span className="text-[10px] font-semibold" style={{ color: laborPct > 100 ? '#ef4444' : laborPct > 90 ? '#f59e0b' : '#22c55e' }}>
              {laborPct.toFixed(0)}% of budget
            </span>
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-[180px_repeat(7,1fr)_60px] border-b border-border">
          <div className="px-3 py-2.5 border-r border-border text-[11px] font-medium text-muted-foreground">
            Employees
          </div>
          {DAYS.map((d, i) => (
            <div key={i} className={`text-center py-2.5 border-r border-border ${d.isToday ? "" : ""}`}>
              <div className={`text-[10px] uppercase tracking-wider font-semibold ${d.isToday ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{d.label}</div>
              <div className={`text-lg font-bold leading-tight ${d.isToday ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{d.date.split("/")[1]}</div>
              {d.isToday && <div className="mx-auto mt-0.5 h-1 w-6 rounded-full bg-emerald-500" />}
              {d.badge && <div className="text-[9px] text-red-500 font-bold mt-0.5">{d.badge}</div>}
            </div>
          ))}
          <div className="px-2 py-2.5 text-[10px] font-bold text-muted-foreground text-center uppercase">Hrs</div>
        </div>

        {/* Events */}
        <div className="grid grid-cols-[180px_repeat(7,1fr)_60px] border-b border-border bg-amber-50/30 dark:bg-amber-950/10">
          <div className="px-3 py-1 border-r border-border text-[11px] font-medium text-amber-600 flex items-center gap-1">📅 Events</div>
          {DAYS.map((_, i) => {
            const ev = EVENTS.find(e => e.day === i);
            return (
              <div key={i} className="px-0.5 py-0.5 border-r border-border flex items-center justify-center">
                {ev && <div className="text-[9px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 rounded-lg px-1.5 py-1 text-center w-full">{ev.icon} {ev.label}</div>}
              </div>
            );
          })}
          <div className="border-border" />
        </div>

        {/* Groups */}
        {GROUPS.map((group) => (
          <div key={group.role}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/40 cursor-pointer hover:bg-muted/60" onClick={() => toggle(group.role)}>
              <div className="flex items-center gap-2">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed[group.role] ? "-rotate-90" : ""}`} />
                <span className="text-[11px] font-bold uppercase tracking-wider">{group.role}</span>
                <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">{group.employees.length}</span>
              </div>
              {group.totalHours > 0 && <span className="text-[11px] font-semibold text-muted-foreground">{group.totalHours}h</span>}
            </div>
            {!collapsed[group.role] && group.employees.map((emp, empIdx) => (
              <div key={empIdx} className="grid grid-cols-[180px_repeat(7,1fr)_60px] border-b border-border/50 hover:bg-muted/10">
                <div className="px-3 py-2 border-r border-border flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-950/20 flex items-center justify-center text-[10px] font-bold text-emerald-700 dark:text-emerald-400">{emp.avatar}</div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold truncate">{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground">${emp.cost.toFixed(0)}</div>
                  </div>
                </div>
                {emp.shifts.map((shift, dayIdx) => (
                  <div key={dayIdx} className={`px-0.5 py-0.5 border-r border-border/30 ${DAYS[dayIdx]?.isToday ? "bg-emerald-50/50 dark:bg-emerald-950/10" : ""}`}>
                    {shift ? (
                      <div className={`w-full h-full min-h-[48px] rounded-lg text-[10px] leading-tight font-medium flex flex-col justify-center text-center ${shift.isDraft ? "border-2 border-dashed border-muted-foreground/30 text-muted-foreground" : "text-white"}`} style={!shift.isDraft ? { backgroundColor: shift.color } : undefined}>
                        <div className="font-bold">{shift.time}</div>
                        {shift.position && <div className="opacity-85 text-[9px] mt-0.5 truncate px-1">{shift.position}</div>}
                        {shift.isOffer && <div className="text-[8px] opacity-70 mt-0.5 flex items-center justify-center gap-0.5"><ArrowRightLeft className="h-2 w-2" /> Offer</div>}
                      </div>
                    ) : emp.timeOff?.includes(dayIdx) ? (
                      <div className="w-full h-full min-h-[48px] rounded-lg bg-orange-100 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/40 flex items-center justify-center text-[10px] font-semibold text-orange-500">
                        OFF
                      </div>
                    ) : emp.unavailable?.includes(dayIdx) ? (
                      <div className="w-full h-full min-h-[48px] rounded-lg bg-muted/20 flex items-center justify-center">
                        <Ban className="h-3 w-3 text-muted-foreground/30" />
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="flex items-center justify-center text-[12px] font-bold text-muted-foreground">
                  {emp.hours > 0 ? `${emp.hours}` : "—"}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Templates */}
        <div className="px-4 py-3 border-t border-border bg-muted/10">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Drag to Schedule</div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t, i) => (
              <div key={i} className="text-[10px] font-semibold text-white rounded-lg px-2.5 py-1.5 cursor-grab shadow-sm hover:shadow-md transition-shadow" style={{ backgroundColor: t.color }}>
                <div>{t.time}</div>
                <div className="opacity-80 text-[9px]">{t.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ DESIGN 6: HYBRID FUSION ============
// Best of both: Deputy left-bar cards + 7shifts budget bar + unique touches
const Design6 = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (role: string) => setCollapsed(p => ({ ...p, [role]: !p[role] }));

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', 'SF Pro Display', system-ui, sans-serif" }}>
      <div className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
        Design 6 — Hybrid Fusion (Deputy × 7shifts)
      </div>
      <div className="rounded-xl overflow-hidden bg-card border border-border/50">
        {/* Header — sleek gradient bar */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--muted)) 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5">
              <button className="h-8 w-8 rounded-lg border border-border/50 flex items-center justify-center hover:bg-background/50"><ChevronLeft className="h-4 w-4" /></button>
              <div className="text-sm font-bold px-3 tracking-tight">Feb 9 – 15</div>
              <button className="h-8 w-8 rounded-lg border border-border/50 flex items-center justify-center hover:bg-background/50"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <button className="text-[11px] font-semibold text-primary border border-primary/30 rounded-full px-3 py-1 hover:bg-primary/5">Today</button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mr-2">
              <span><span className="font-bold text-foreground">217.5</span>h</span>
              <span><span className="font-bold text-foreground">$4,509</span></span>
              <span><span className="font-bold text-foreground">7</span> staff</span>
            </div>
            <button className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-500" /> AI
            </button>
            <div className="flex items-center gap-1.5 bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
              <Signal className="h-3 w-3" /> LIVE
            </div>
          </div>
        </div>

        {/* Budget mini-bar */}
        <div className="px-4 py-1.5 border-b border-border flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground shrink-0">Budget</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full w-[94%] rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" />
          </div>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">94%</span>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-[185px_repeat(7,1fr)_55px]">
          <div className="px-3 py-2.5 border-r border-b border-border text-[11px] font-medium text-muted-foreground">Team</div>
          {DAYS.map((d, i) => (
            <div key={i} className={`text-center py-2 border-r border-b border-border last:border-r-0 ${d.isToday ? "border-b-2 border-b-primary" : ""}`}>
              <div className={`text-[10px] font-semibold uppercase ${d.isToday ? "text-primary" : "text-muted-foreground"}`}>{d.label}</div>
              <div className={`text-base font-bold ${d.isToday ? "text-primary" : ""}`}>{d.date.split("/")[1]}</div>
              {d.badge && <div className="text-[9px] text-red-400 font-semibold">🚫 {d.badge}</div>}
            </div>
          ))}
          <div className="px-1 py-2 border-b border-border text-center text-[10px] font-bold text-muted-foreground uppercase">Hrs</div>
        </div>

        {/* Events */}
        <div className="grid grid-cols-[185px_repeat(7,1fr)_55px] border-b border-border">
          <div className="px-3 py-1 border-r border-border text-[11px] font-medium text-amber-600 flex items-center gap-1">📦 Events</div>
          {DAYS.map((_, i) => {
            const ev = EVENTS.find(e => e.day === i);
            return (
              <div key={i} className="px-0.5 py-0.5 border-r border-border last:border-r-0 flex items-center justify-center">
                {ev && <div className="text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded-md px-1.5 py-1 font-semibold text-center w-full">{ev.label}</div>}
              </div>
            );
          })}
          <div />
        </div>

        {/* Groups */}
        {GROUPS.map((group) => (
          <div key={group.role}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30 cursor-pointer hover:bg-muted/50" onClick={() => toggle(group.role)}>
              <div className="flex items-center gap-2">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed[group.role] ? "-rotate-90" : ""}`} />
                <span className="text-[11px] font-bold uppercase tracking-wide">{group.role}</span>
                <div className="text-[10px] bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 font-medium">{group.employees.length}</div>
              </div>
              {group.totalHours > 0 && <span className="text-[11px] font-bold text-muted-foreground">{group.totalHours}h</span>}
            </div>
            {!collapsed[group.role] && group.employees.map((emp, empIdx) => (
              <div key={empIdx} className="grid grid-cols-[185px_repeat(7,1fr)_55px] border-b border-border/40 hover:bg-muted/5">
                <div className="px-3 py-2 border-r border-border flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{emp.avatar}</div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold truncate">{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground">${emp.cost.toFixed(0)}</div>
                  </div>
                </div>
                {emp.shifts.map((shift, dayIdx) => (
                  <div key={dayIdx} className={`px-0.5 py-0.5 border-r border-border/20 last:border-r-0 ${DAYS[dayIdx]?.isToday ? "bg-primary/[0.03]" : ""}`}>
                    {shift ? (
                      <div className={`w-full h-full min-h-[46px] rounded-lg overflow-hidden flex ${shift.isDraft ? "border-2 border-dashed border-muted-foreground/25" : ""}`}>
                        {/* Color sidebar — Deputy style */}
                        {!shift.isDraft && <div className="w-1.5 shrink-0 rounded-l-lg" style={{ backgroundColor: shift.color }} />}
                        <div className={`flex-1 px-1.5 py-1 text-[10px] leading-tight flex flex-col justify-center ${shift.isDraft ? "text-muted-foreground" : "bg-muted/30"}`}>
                          <div className="font-bold">{shift.time}</div>
                          {shift.position && (
                            <div className="text-[9px] font-semibold mt-0.5 truncate" style={{ color: shift.isDraft ? undefined : shift.color }}>
                              {shift.position}
                            </div>
                          )}
                          {shift.isOffer && <div className="text-[8px] text-blue-500 mt-0.5 flex items-center gap-0.5"><ArrowRightLeft className="h-2 w-2" /> Offer</div>}
                        </div>
                      </div>
                    ) : emp.timeOff?.includes(dayIdx) ? (
                      <div className="w-full h-full min-h-[46px] rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200/50 dark:border-orange-800/30 flex items-center justify-center text-[10px] text-orange-500 font-semibold">
                        OFF
                      </div>
                    ) : emp.unavailable?.includes(dayIdx) ? (
                      <div className="w-full h-full min-h-[46px] rounded-lg flex items-center justify-center">
                        <Ban className="h-3.5 w-3.5 text-muted-foreground/20" />
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="flex items-center justify-center text-[12px] font-bold text-muted-foreground">{emp.hours > 0 ? emp.hours : "—"}</div>
              </div>
            ))}
          </div>
        ))}

        {/* Templates */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Templates</div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t, i) => (
              <div key={i} className="flex items-center gap-1 text-[10px] font-semibold border border-border/50 rounded-lg px-2.5 py-1.5 cursor-grab hover:border-border hover:shadow-sm transition-all">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: t.color }} />
                <span>{t.name}</span>
                <span className="text-muted-foreground ml-0.5">{t.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ MAIN PAGE ============

export default function ScheduleDesignPreview() {
  const navigate = useNavigate();
  const [activeDesign, setActiveDesign] = useState<number | null>(null);

  const designs = [
    { id: 1, label: "Corporate Sharp", font: "IBM Plex Sans" },
    { id: 2, label: "Modern Minimal", font: "Space Grotesk" },
    { id: 3, label: "Data-Dense Pro", font: "Geist + JetBrains Mono" },
    { id: 4, label: "Deputy-Inspired", font: "Inter" },
    { id: 5, label: "7shifts-Inspired", font: "DM Sans" },
    { id: 6, label: "Hybrid Fusion", font: "Plus Jakarta Sans" },
  ];

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600;700&family=Geist:wght@400;500;600;700;900&family=DM+Sans:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      <div className="max-w-[1400px] mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Schedule Design Concepts</h1>
            <p className="text-sm text-muted-foreground">6 designs — including Deputy & 7shifts inspired directions</p>
          </div>
        </div>

        {/* Design selector */}
        <div className="flex flex-wrap gap-2 mb-6">
          {designs.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveDesign(activeDesign === d.id ? null : d.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all ${
                activeDesign === d.id || activeDesign === null
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border text-muted-foreground opacity-40"
              }`}
            >
              {d.label}
              <div className="text-[10px] text-muted-foreground">{d.font}</div>
            </button>
          ))}
        </div>

        {/* Designs */}
        <div className="space-y-10">
          {(activeDesign === null || activeDesign === 1) && <Design1 />}
          {(activeDesign === null || activeDesign === 2) && <Design2 />}
          {(activeDesign === null || activeDesign === 3) && <Design3 />}
          {(activeDesign === null || activeDesign === 4) && <Design4 />}
          {(activeDesign === null || activeDesign === 5) && <Design5 />}
          {(activeDesign === null || activeDesign === 6) && <Design6 />}
        </div>

        {/* Feature coverage */}
        <div className="mt-10 p-4 border border-border rounded-lg bg-muted/20">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Features Covered (All 6 Designs)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              "Week navigator + current week",
              "Today highlight",
              "LIVE/Published status",
              "Compact/AI/Edit controls",
              "Events row (recurring)",
              "Collapsible role groups",
              "Employee info (avatar, hrs, $)",
              "Drag handles / reorder",
              "Colored shift cards",
              "Position labels",
              "Draft shifts (dashed)",
              "Time Off indicators",
              "Unavailable indicators",
              "Shift Offer icon",
              "Blackout dates",
              "Templates bar (draggable)",
              "Weekly hour totals per group",
              "Updated by attribution",
              "Labor budget bar (D5/D6)",
              "Summary metrics bar (D4/D6)",
            ].map((f, i) => (
              <div key={i} className="text-[11px] flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
