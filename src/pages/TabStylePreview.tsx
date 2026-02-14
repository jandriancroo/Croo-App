import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, ClipboardList, Eye, Pencil, Users, History, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Fake task data for preview
const fakeTasks = [
  { title: "Please Get Your Food Handler…", assignees: ["Andrea", "Diego"], color: "hsl(var(--destructive))" },
  { title: "Personal/Blaze TODO's", assignees: ["Jordan"], progress: "4/6", color: "hsl(var(--primary))" },
  { title: "Check Lobby", assignees: [], alarm: true, color: "hsl(var(--destructive))" },
];

function TaskCard({ task }: { task: typeof fakeTasks[0] }) {
  return (
    <Card className="border-l-4" style={{ borderLeftColor: task.color }}>
      <CardContent className="py-3 px-4 flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{task.title}</span>
            {task.progress && (
              <Badge variant="outline" className="text-xs font-mono">{task.progress}</Badge>
            )}
            {task.alarm && (
              <Badge variant="destructive" className="text-xs gap-1">⏰ ALARM</Badge>
            )}
          </div>
          {task.assignees.length > 0 && (
            <div className="flex gap-1.5">
              {task.assignees.map(a => (
                <Badge key={a} variant="secondary" className="text-xs gap-1">
                  <Users className="h-3 w-3" /> {a}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskList({ label }: { label: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{label}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9"><ClipboardList className="h-4 w-4" /></Button>
          <Button size="icon" className="h-9 w-9"><Zap className="h-4 w-4" /></Button>
        </div>
      </div>
      {fakeTasks.map((t, i) => <TaskCard key={i} task={t} />)}
    </div>
  );
}

function HistoryPlaceholder() {
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <History className="h-4 w-4" /> Timeline for today
      </div>
      {["Opening Checklist — 7:12 AM", "Lobby Check — 9:00 AM", "Mid-Day Tasks — 12:30 PM"].map((item, i) => (
        <Card key={i}>
          <CardContent className="py-3 px-4 text-sm text-muted-foreground">{item}</CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Shared pill component ──
function PillGroup({ items, active, onSelect, size = "md" }: {
  items: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("inline-flex bg-muted rounded-full p-1 gap-0.5", size === "sm" && "p-0.5")}>
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            "rounded-full font-medium transition-all duration-200",
            size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-5 py-2 text-sm",
            active === item.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-1.5">{item.icon}{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Shared segmented control ──
function SegmentGroup({ items, active, onSelect, size = "md" }: {
  items: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex border border-border rounded-xl overflow-hidden">
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            "font-medium transition-all duration-150",
            size === "sm" ? "px-3.5 py-1.5 text-xs" : "px-5 py-2.5 text-sm",
            i < items.length - 1 && "border-r border-border",
            active === item.id
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-muted/60"
          )}
        >
          <span className="flex items-center gap-1.5">{item.icon}{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Shared underline tabs ──
function UnderlineGroup({ items, active, onSelect, size = "md" }: {
  items: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onSelect: (id: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("flex border-b border-border", size === "sm" ? "gap-4" : "gap-6")}>
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={cn(
            "pb-2.5 font-medium transition-colors relative",
            size === "sm" ? "text-xs" : "text-sm",
            active === item.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-1.5">{item.icon}{item.label}</span>
          {active === item.id && (
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}

const topTabs = [
  { id: "history", label: "History", icon: <History className="h-4 w-4" /> },
  { id: "edit", label: "Edit", icon: <PenLine className="h-4 w-4" /> },
];
const subTabs = [
  { id: "quick", label: "Quick Tasks", icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "templates", label: "Templates", icon: <ClipboardList className="h-3.5 w-3.5" /> },
];

// ── Option A: Pill + Pill ──
function OptionPillPill() {
  const [top, setTop] = useState("edit");
  const [sub, setSub] = useState("quick");
  return (
    <div className="space-y-4">
      <PillGroup items={topTabs} active={top} onSelect={setTop} />
      {top === "edit" ? (
        <div className="space-y-3">
          <PillGroup items={subTabs} active={sub} onSelect={setSub} size="sm" />
          <TaskList label={sub === "quick" ? "Quick Tasks" : "Templates"} />
        </div>
      ) : <HistoryPlaceholder />}
    </div>
  );
}

// ── Option B: Pill + Segmented ──
function OptionPillSegmented() {
  const [top, setTop] = useState("edit");
  const [sub, setSub] = useState("quick");
  return (
    <div className="space-y-4">
      <PillGroup items={topTabs} active={top} onSelect={setTop} />
      {top === "edit" ? (
        <div className="space-y-3">
          <SegmentGroup items={subTabs} active={sub} onSelect={setSub} size="sm" />
          <TaskList label={sub === "quick" ? "Quick Tasks" : "Templates"} />
        </div>
      ) : <HistoryPlaceholder />}
    </div>
  );
}

// ── Option C: Pill + Underline ──
function OptionPillUnderline() {
  const [top, setTop] = useState("edit");
  const [sub, setSub] = useState("quick");
  return (
    <div className="space-y-4">
      <PillGroup items={topTabs} active={top} onSelect={setTop} />
      {top === "edit" ? (
        <div className="space-y-3">
          <UnderlineGroup items={subTabs} active={sub} onSelect={setSub} size="sm" />
          <TaskList label={sub === "quick" ? "Quick Tasks" : "Templates"} />
        </div>
      ) : <HistoryPlaceholder />}
    </div>
  );
}

// ── Option D: Pill + Dropdown ──
function OptionPillDropdown() {
  const [top, setTop] = useState("edit");
  const [sub, setSub] = useState("quick");
  return (
    <div className="space-y-4">
      <PillGroup items={topTabs} active={top} onSelect={setTop} />
      {top === "edit" ? (
        <div className="space-y-3">
          <Select value={sub} onValueChange={setSub}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick"><span className="flex items-center gap-2"><Zap className="h-3.5 w-3.5" /> Quick Tasks</span></SelectItem>
              <SelectItem value="templates"><span className="flex items-center gap-2"><ClipboardList className="h-3.5 w-3.5" /> Templates</span></SelectItem>
            </SelectContent>
          </Select>
          <TaskList label={sub === "quick" ? "Quick Tasks" : "Templates"} />
        </div>
      ) : <HistoryPlaceholder />}
    </div>
  );
}

export default function TabStylePreview() {
  return (
    <Layout>
      <div className="space-y-8 max-w-2xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold">Tasks</h1>
          <p className="text-muted-foreground text-sm mt-1">Two layers: top-level (History / Edit) → sub-level (Quick Tasks / Templates)</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">A — Pill + Smaller Pill</h2>
          <Card><CardContent className="pt-5"><OptionPillPill /></CardContent></Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">B — Pill + Segmented Control</h2>
          <Card><CardContent className="pt-5"><OptionPillSegmented /></CardContent></Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">C — Pill + Underline Tabs</h2>
          <Card><CardContent className="pt-5"><OptionPillUnderline /></CardContent></Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">D — Pill + Dropdown</h2>
          <Card><CardContent className="pt-5"><OptionPillDropdown /></CardContent></Card>
        </section>
      </div>
    </Layout>
  );
}
