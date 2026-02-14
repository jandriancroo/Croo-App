import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, ClipboardList, Eye, Pencil, ChevronDown, Users } from "lucide-react";
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
              <Badge variant="destructive" className="text-xs gap-1">
                ⏰ ALARM
              </Badge>
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
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Pencil className="h-4 w-4" />
          </Button>
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
          <Button variant="outline" size="icon" className="h-9 w-9">
            <ClipboardList className="h-4 w-4" />
          </Button>
          <Button size="icon" className="h-9 w-9">
            <Zap className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {fakeTasks.map((t, i) => <TaskCard key={i} task={t} />)}
    </div>
  );
}

// ── Option A: Pill Toggle ──
function PillToggle() {
  const [active, setActive] = useState("quick");
  return (
    <div className="space-y-4">
      <div className="inline-flex bg-muted rounded-full p-1 gap-0.5">
        <button
          onClick={() => setActive("quick")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
            active === "quick"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> Quick Tasks</span>
        </button>
        <button
          onClick={() => setActive("templates")}
          className={cn(
            "px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
            active === "templates"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Templates</span>
        </button>
      </div>
      <TaskList label={active === "quick" ? "Quick Tasks" : "Templates"} />
    </div>
  );
}

// ── Option B: Segmented Control ──
function SegmentedControl() {
  const [active, setActive] = useState("quick");
  return (
    <div className="space-y-4">
      <div className="inline-flex border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setActive("quick")}
          className={cn(
            "px-5 py-2.5 text-sm font-medium transition-all duration-150 border-r border-border",
            active === "quick"
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-muted/60"
          )}
        >
          <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> Quick Tasks</span>
        </button>
        <button
          onClick={() => setActive("templates")}
          className={cn(
            "px-5 py-2.5 text-sm font-medium transition-all duration-150",
            active === "templates"
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:bg-muted/60"
          )}
        >
          <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Templates</span>
        </button>
      </div>
      <TaskList label={active === "quick" ? "Quick Tasks" : "Templates"} />
    </div>
  );
}

// ── Option C: Dropdown Selector ──
function DropdownSelector() {
  const [active, setActive] = useState("quick");
  return (
    <div className="space-y-4">
      <Select value={active} onValueChange={setActive}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="quick">
            <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> Quick Tasks</span>
          </SelectItem>
          <SelectItem value="templates">
            <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Templates</span>
          </SelectItem>
        </SelectContent>
      </Select>
      <TaskList label={active === "quick" ? "Quick Tasks" : "Templates"} />
    </div>
  );
}

// ── Option D: Underline Tabs (Clean) ──
function UnderlineTabs() {
  const [active, setActive] = useState("quick");
  return (
    <div className="space-y-4">
      <div className="flex gap-6 border-b border-border">
        <button
          onClick={() => setActive("quick")}
          className={cn(
            "pb-2.5 text-sm font-medium transition-colors relative",
            active === "quick"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> Quick Tasks</span>
          {active === "quick" && (
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActive("templates")}
          className={cn(
            "pb-2.5 text-sm font-medium transition-colors relative",
            active === "templates"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Templates</span>
          {active === "templates" && (
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-full" />
          )}
        </button>
      </div>
      <TaskList label={active === "quick" ? "Quick Tasks" : "Templates"} />
    </div>
  );
}

export default function TabStylePreview() {
  return (
    <Layout>
      <div className="space-y-8 max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold">Tab Style Preview</h1>
        <p className="text-muted-foreground">Pick your preferred navigation style to replace folder tabs.</p>

        {/* Option A */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">Option A — Pill Toggle</h2>
          <Card><CardContent className="pt-5"><PillToggle /></CardContent></Card>
        </section>

        {/* Option B */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">Option B — Segmented Control</h2>
          <Card><CardContent className="pt-5"><SegmentedControl /></CardContent></Card>
        </section>

        {/* Option C */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">Option C — Dropdown Selector</h2>
          <Card><CardContent className="pt-5"><DropdownSelector /></CardContent></Card>
        </section>

        {/* Option D */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">Option D — Underline Tabs</h2>
          <Card><CardContent className="pt-5"><UnderlineTabs /></CardContent></Card>
        </section>
      </div>
    </Layout>
  );
}
