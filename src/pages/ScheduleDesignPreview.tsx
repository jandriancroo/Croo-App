import { useState } from "react";
import { ArrowLeft, Plus, ClipboardCheck, ChevronDown, ChevronUp, CalendarCheck, Package, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const DAYS = [
  { label: "Mon", date: "2/9" },
  { label: "Tue", date: "2/10", isToday: true },
  { label: "Wed", date: "2/11" },
  { label: "Thu", date: "2/12" },
  { label: "Fri", date: "2/13" },
  { label: "Sat", date: "2/14" },
  { label: "Sun", date: "2/15" },
];

interface MockEvent {
  day: number;
  label: string;
  time: string;
  category: string;
  color: string;
  isDailyTask?: boolean;
  isMeeting?: boolean;
}

const EVENTS: MockEvent[] = [
  { day: 0, label: "Order Produce", time: "9:00 AM", category: "Orders", color: "#3b82f6", isDailyTask: true },
  { day: 0, label: "Team Huddle", time: "10:00 AM", category: "Meetings", color: "#8b5cf6", isMeeting: true },
  { day: 1, label: "Order PFG", time: "9:00 AM", category: "Orders", color: "#3b82f6", isDailyTask: true },
  { day: 1, label: "Health Inspection", time: "2:00 PM", category: "Compliance", color: "#ef4444" },
  { day: 2, label: "Order Produce", time: "9:00 AM", category: "Orders", color: "#3b82f6", isDailyTask: true },
  { day: 3, label: "Catering Prep", time: "11:00 AM", category: "Prep", color: "#f59e0b" },
  { day: 4, label: "Order Produce", time: "9:00 AM", category: "Orders", color: "#3b82f6", isDailyTask: true },
  { day: 4, label: "Weekly Review", time: "3:00 PM", category: "Meetings", color: "#8b5cf6", isMeeting: true },
  { day: 5, label: "Order PFG", time: "9:00 AM", category: "Orders", color: "#3b82f6", isDailyTask: true },
  { day: 6, label: "Deep Clean", time: "6:00 AM", category: "Maintenance", color: "#22c55e" },
];

const getEventsForDay = (dayIndex: number) =>
  EVENTS.filter((e) => e.day === dayIndex).sort((a, b) => a.time.localeCompare(b.time));

const GRID_COLS = "grid-cols-[120px_repeat(7,1fr)]";

// ─── CONCEPT A: Slate Ribbon ────────────────────────────────
// Neutral dark slate row with colored left-edge pills, subtle category dot
function ConceptA() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 px-1">Concept A — Slate Ribbon</h3>
      <p className="text-sm text-muted-foreground mb-3 px-1">
        Neutral dark slate background. Compact colored-edge pills with category dot indicators. Clean, professional.
      </p>
      <div className={`grid ${GRID_COLS} min-w-[700px] rounded-lg overflow-hidden border border-border/40`}>
        {/* Header label */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-[hsl(215,20%,27%)] border-r border-white/10">
          <CalendarCheck className="h-3.5 w-3.5 text-white/70" />
          <span className="font-semibold text-white text-[10px] tracking-wide uppercase">Events</span>
          <button className="ml-auto h-4 w-4 rounded flex items-center justify-center hover:bg-white/15 text-white/60 transition-colors">
            <Plus className="h-3 w-3" />
          </button>
        </div>
        {/* Day columns */}
        {DAYS.map((day, i) => {
          const dayEvents = getEventsForDay(i);
          const visible = expanded ? dayEvents : dayEvents.slice(0, 1);
          const hidden = dayEvents.length - visible.length;

          return (
            <div
              key={i}
              className={`min-h-[22px] px-1 py-0.5 border-r last:border-r-0 border-white/10 bg-[hsl(215,20%,27%)] ${
                day.isToday ? "bg-[hsl(215,25%,32%)]" : ""
              }`}
            >
              <div className="space-y-0.5">
                {visible.map((ev, j) => (
                  <div
                    key={j}
                    className="rounded px-1.5 py-0.5 cursor-pointer hover:brightness-125 transition-all flex items-center gap-1"
                    style={{
                      backgroundColor: `${ev.color}18`,
                      borderLeft: `2.5px solid ${ev.color}`,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        {ev.isDailyTask && <ClipboardCheck className="h-2.5 w-2.5 text-white/50 flex-shrink-0" />}
                        <span className="text-[10.5px] font-medium text-white truncate leading-tight mt-[3px]">{ev.label}</span>
                      </div>
                      <span className="text-[9px] text-white/50 leading-none">{ev.time}</span>
                    </div>
                    {!expanded && hidden > 0 && j === 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                        className="text-[9px] bg-white/15 hover:bg-white/25 text-white/80 px-1.5 py-0.5 rounded-full flex-shrink-0 transition-colors"
                      >
                        +{hidden}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {expanded && (
        <button onClick={() => setExpanded(false)} className="text-xs text-muted-foreground hover:text-foreground mt-1 ml-[120px] flex items-center gap-1">
          <ChevronUp className="h-3 w-3" /> Collapse events
        </button>
      )}
    </div>
  );
}

// ─── CONCEPT B: Frosted Glass Strip ─────────────────────────
// Uses the app's glass/neumorphic style. Translucent row with vivid accent chips
function ConceptB() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 px-1">Concept B — Frosted Glass Strip</h3>
      <p className="text-sm text-muted-foreground mb-3 px-1">
        Matches the app's frosted glass aesthetic. Semi-transparent row with vivid solid-color event chips.
      </p>
      <div className={`grid ${GRID_COLS} min-w-[700px] rounded-lg overflow-hidden border border-border/30`}>
        {/* Header label */}
        <div className="flex items-center gap-2 px-3 py-2.5 bg-card/80 backdrop-blur-sm border-r border-border/20">
          <CalendarCheck className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground text-xs tracking-wide uppercase">Events</span>
          <button className="ml-auto h-5 w-5 rounded flex items-center justify-center hover:bg-accent text-muted-foreground transition-colors">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Day columns */}
        {DAYS.map((day, i) => {
          const dayEvents = getEventsForDay(i);
          const visible = expanded ? dayEvents : dayEvents.slice(0, 1);
          const hidden = dayEvents.length - visible.length;

          return (
            <div
              key={i}
              className={`min-h-[44px] p-1.5 border-r last:border-r-0 border-border/20 ${
                day.isToday ? "bg-primary/8" : "bg-card/60 backdrop-blur-sm"
              }`}
            >
              <div className="space-y-1">
                {visible.map((ev, j) => (
                  <div
                    key={j}
                    className="rounded-lg px-2 py-1 cursor-pointer hover:scale-[1.02] transition-all shadow-sm"
                    style={{
                      backgroundColor: ev.color,
                    }}
                  >
                    <div className="flex items-center gap-1">
                      {ev.isDailyTask && <ClipboardCheck className="h-2.5 w-2.5 text-white/70 flex-shrink-0" />}
                      {ev.isMeeting && <Users className="h-2.5 w-2.5 text-white/70 flex-shrink-0" />}
                      <span className="text-[10px] font-semibold text-white truncate">{ev.label}</span>
                      {!expanded && hidden > 0 && j === 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                          className="ml-auto text-[9px] bg-black/20 hover:bg-black/30 text-white px-1 rounded flex-shrink-0 transition-colors"
                        >
                          +{hidden}
                        </button>
                      )}
                    </div>
                    <span className="text-[9px] text-white/80 leading-none">{ev.time}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {expanded && (
        <button onClick={() => setExpanded(false)} className="text-xs text-muted-foreground hover:text-foreground mt-1 ml-[120px] flex items-center gap-1">
          <ChevronUp className="h-3 w-3" /> Collapse events
        </button>
      )}
    </div>
  );
}

// ─── CONCEPT C: Inline Badge Row ────────────────────────────
// Minimal: events as compact inline badges/tags in a subtle tinted row
function ConceptC() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 px-1">Concept C — Inline Badge Row</h3>
      <p className="text-sm text-muted-foreground mb-3 px-1">
        Ultra-compact badge style. Events as small inline tags with category color coding. Maximum data density.
      </p>
      <div className={`grid ${GRID_COLS} min-w-[700px] rounded-lg overflow-hidden border border-border/40`}>
        {/* Header label */}
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/80 border-r border-border/30">
          <CalendarCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground text-[11px] tracking-wide uppercase">Events</span>
          <button className="ml-auto h-5 w-5 rounded-full flex items-center justify-center hover:bg-accent text-muted-foreground transition-colors">
            <Plus className="h-3 w-3" />
          </button>
        </div>
        {/* Day columns */}
        {DAYS.map((day, i) => {
          const dayEvents = getEventsForDay(i);
          const visible = expanded ? dayEvents : dayEvents.slice(0, 2);
          const hidden = dayEvents.length - visible.length;

          return (
            <div
              key={i}
              className={`min-h-[38px] px-1 py-1.5 border-r last:border-r-0 border-border/30 ${
                day.isToday ? "bg-primary/5" : "bg-muted/40"
              }`}
            >
              <div className="flex flex-wrap gap-0.5">
                {visible.map((ev, j) => (
                  <div
                    key={j}
                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 cursor-pointer hover:brightness-110 transition-all max-w-full"
                    style={{
                      backgroundColor: `${ev.color}20`,
                      border: `1px solid ${ev.color}40`,
                    }}
                  >
                    {ev.isDailyTask && <ClipboardCheck className="h-2 w-2 flex-shrink-0" style={{ color: ev.color }} />}
                    {ev.isMeeting && <Users className="h-2 w-2 flex-shrink-0" style={{ color: ev.color }} />}
                    <span className="text-[9px] font-medium truncate" style={{ color: ev.color }}>
                      {ev.label.length > 12 ? ev.label.slice(0, 10) + "…" : ev.label}
                    </span>
                  </div>
                ))}
                {!expanded && hidden > 0 && (
                  <button
                    onClick={() => setExpanded(true)}
                    className="text-[9px] text-muted-foreground hover:text-foreground px-1 flex-shrink-0 transition-colors"
                  >
                    +{hidden}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {expanded && (
        <button onClick={() => setExpanded(false)} className="text-xs text-muted-foreground hover:text-foreground mt-1 ml-[120px] flex items-center gap-1">
          <ChevronUp className="h-3 w-3" /> Collapse events
        </button>
      )}
    </div>
  );
}

// ─── CURRENT (for reference) ────────────────────────────────
function CurrentDesign() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2 px-1">Current Design (Reference)</h3>
      <p className="text-sm text-muted-foreground mb-3 px-1">
        The existing brown-toned event row for comparison.
      </p>
      <div className={`grid ${GRID_COLS} min-w-[700px] rounded-lg overflow-hidden`}>
        <div className="flex items-center gap-2 px-4 py-2 border-r border-border/20 bg-[hsl(30,25%,45%)]">
          <span className="font-semibold text-white text-sm">Events</span>
          <button className="ml-auto h-6 w-6 flex items-center justify-center hover:bg-white/20 text-white rounded">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {DAYS.map((day, i) => {
          const dayEvents = getEventsForDay(i);
          const visible = expanded ? dayEvents : dayEvents.slice(0, 1);
          const hidden = dayEvents.length - visible.length;

          return (
            <div key={i} className="min-h-[40px] p-1.5 border-r last:border-r-0 border-border/20 bg-[hsl(30,25%,45%)]">
              <div className="space-y-1">
                {visible.map((ev, j) => (
                  <div
                    key={j}
                    className="rounded-md p-1 text-[10px] cursor-pointer hover:brightness-110 transition-colors"
                    style={{
                      backgroundColor: `${ev.color}30`,
                      borderLeft: `3px solid ${ev.color}`,
                    }}
                  >
                    <div className="flex items-center gap-1 text-white font-medium">
                      {ev.isDailyTask && <ClipboardCheck className="h-3 w-3 flex-shrink-0" />}
                      <span className="truncate">{ev.label}</span>
                      {!expanded && hidden > 0 && j === 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                          className="ml-auto px-1 py-0.5 bg-white/20 hover:bg-white/30 rounded text-[9px] font-semibold flex-shrink-0 transition-colors"
                        >
                          +{hidden}
                        </button>
                      )}
                    </div>
                    <div className="text-white/70 text-[10px]">{ev.time}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────
export default function ScheduleDesignPreview() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 space-y-10">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Event Row Concepts</h1>
          <p className="text-sm text-muted-foreground">Three new directions for the schedule event row</p>
        </div>
      </div>

      {/* Current reference */}
      <CurrentDesign />

      <div className="border-t border-border/50 pt-6" />

      {/* Three concepts */}
      <ConceptA />
      <ConceptB />
      <ConceptC />
    </div>
  );
}
