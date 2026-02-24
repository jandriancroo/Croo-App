import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Check, Lock, ChevronRight, ArrowRight, Flame, CircleDot, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Mock data for the preview
const mockChecklists = [
  { title: "Morning Line Check", completed: 19, expected: 26, frequency: "daily", isLocked: false, isComplete: false },
  { title: "Shift Change Line Check", completed: 0, expected: 18, frequency: "daily", isLocked: true, lockUntilTime: "3:00 PM" },
  { title: "End of Day Closeout", completed: 12, expected: 12, frequency: "daily", isLocked: false, isComplete: true },
  { title: "Weekly Deep Clean", completed: 5, expected: 14, frequency: "weekly", isLocked: false, isComplete: false },
];

// ─── OPTION A: Horizontal Bar Card (inspired by uploaded screenshot) ────────
function OptionA({ c }: { c: typeof mockChecklists[0] }) {
  const pct = c.expected > 0 ? Math.round((c.completed / c.expected) * 100) : 0;
  return (
    <Card className="p-4 border-0 overflow-hidden relative">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-secondary">
          <ClipboardCheck className="h-4 w-4 text-primary" />
        </div>
        <span className="font-semibold text-sm flex-1 truncate">{c.title}</span>
        <Badge variant="outline" className="text-[10px] font-medium px-2 py-0.5">{c.frequency}</Badge>
      </div>
      {c.isLocked ? (
        <div className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground font-medium">Locked until {c.lockUntilTime}</span>
        </div>
      ) : c.isComplete ? (
        <div className="flex items-center gap-2 rounded-xl bg-primary px-4 py-3">
          <Check className="h-4 w-4 text-primary-foreground" strokeWidth={3} />
          <span className="text-sm text-primary-foreground font-semibold">Complete</span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 relative h-11 rounded-xl bg-muted overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-xl bg-primary flex items-center pl-4 transition-all duration-500"
              style={{ width: `${Math.max(pct, 30)}%` }}
            >
              <span className="text-sm font-semibold text-primary-foreground whitespace-nowrap">
                Continue • {c.completed}/{c.expected}
              </span>
            </div>
          </div>
          <span className="text-sm font-semibold text-muted-foreground w-10 text-right">{pct}%</span>
        </div>
      )}
    </Card>
  );
}

// ─── OPTION B: Compact Row with Inline Progress ────────
function OptionB({ c }: { c: typeof mockChecklists[0] }) {
  const pct = c.expected > 0 ? Math.round((c.completed / c.expected) * 100) : 0;
  return (
    <Card className="p-0 border-0 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-2xl shrink-0",
          c.isComplete ? "bg-primary" : c.isLocked ? "bg-muted" : "bg-secondary"
        )}>
          {c.isComplete ? (
            <CheckCircle2 className="h-5 w-5 text-primary-foreground" />
          ) : c.isLocked ? (
            <Lock className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ClipboardCheck className="h-5 w-5 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{c.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{c.frequency}</Badge>
          </div>
          {c.isLocked ? (
            <span className="text-xs text-muted-foreground">Locked until {c.lockUntilTime}</span>
          ) : c.isComplete ? (
            <span className="text-xs text-primary font-medium">All tasks complete ✓</span>
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{c.completed}/{c.expected}</span>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </div>
    </Card>
  );
}

// ─── OPTION C: Pill Stack / visionOS Floating ────────
function OptionC({ c }: { c: typeof mockChecklists[0] }) {
  const pct = c.expected > 0 ? Math.round((c.completed / c.expected) * 100) : 0;
  return (
    <Card className="border-0 overflow-hidden rounded-3xl" style={{ boxShadow: '0 2px 20px -4px hsl(var(--primary) / 0.12)' }}>
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-sm">{c.title}</span>
          <Badge variant="secondary" className="text-[10px] rounded-full px-2.5">{c.frequency}</Badge>
        </div>
      </div>
      <div className="px-4 pb-4">
        {c.isLocked ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Locked until {c.lockUntilTime}</span>
          </div>
        ) : c.isComplete ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-10 rounded-2xl bg-primary/10 flex items-center justify-center gap-2">
              <Check className="h-4 w-4 text-primary" strokeWidth={3} />
              <span className="text-sm font-semibold text-primary">Complete</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-primary">{pct}</span>
                <span className="text-xs font-medium text-muted-foreground">%</span>
              </div>
              <span className="text-xs text-muted-foreground">{c.completed} of {c.expected} tasks</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── OPTION D: Neumorphic Tile with Ring ────────
function OptionD({ c }: { c: typeof mockChecklists[0] }) {
  const pct = c.expected > 0 ? Math.round((c.completed / c.expected) * 100) : 0;
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <Card className="border-0 p-4 overflow-hidden" style={{ boxShadow: '4px 4px 12px hsl(220 25% 78% / 0.5), -2px -2px 8px hsl(0 0% 100% / 0.8)' }}>
      <div className="flex items-center gap-3">
        <div className="relative w-16 h-16 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
            {!c.isLocked && (
              <circle
                cx="32" cy="32" r="28" fill="none"
                stroke={c.isComplete ? "hsl(var(--primary))" : "hsl(var(--primary))"}
                strokeWidth="4" strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={c.isComplete ? 0 : offset}
                className="transition-all duration-700"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {c.isLocked ? (
              <Lock className="h-5 w-5 text-muted-foreground" />
            ) : c.isComplete ? (
              <Check className="h-5 w-5 text-primary" strokeWidth={3} />
            ) : (
              <span className="text-sm font-black text-primary">{pct}%</span>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm block truncate">{c.title}</span>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{c.frequency}</Badge>
            {c.isLocked ? (
              <span className="text-[11px] text-muted-foreground">Until {c.lockUntilTime}</span>
            ) : c.isComplete ? (
              <span className="text-[11px] text-primary font-medium">Done</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">{c.completed}/{c.expected}</span>
            )}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      </div>
    </Card>
  );
}

// ─── OPTION E: Left Accent Border + Stacked Layout ────────
function OptionE({ c }: { c: typeof mockChecklists[0] }) {
  const pct = c.expected > 0 ? Math.round((c.completed / c.expected) * 100) : 0;
  return (
    <Card className="border-0 overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ background: c.isComplete ? 'hsl(var(--primary))' : c.isLocked ? 'hsl(var(--muted))' : `hsl(var(--primary) / 0.5)` }} />
      <div className="pl-5 pr-4 py-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">{c.title}</span>
          </div>
          <Badge variant="secondary" className="text-[10px] px-2">{c.frequency}</Badge>
        </div>
        {c.isLocked ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span className="text-xs">Locked until {c.lockUntilTime}</span>
          </div>
        ) : c.isComplete ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-primary" />
            <span className="text-xs font-semibold text-primary">{c.completed}/{c.expected}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-semibold text-muted-foreground">{c.completed}/{c.expected}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── OPTION F: Combo (B row layout + E accent border) ────────
function OptionF({ c }: { c: typeof mockChecklists[0] }) {
  const pct = c.expected > 0 ? Math.round((c.completed / c.expected) * 100) : 0;
  return (
    <Card className="border-0 overflow-hidden relative p-0">
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ background: c.isComplete ? 'hsl(var(--primary))' : c.isLocked ? 'hsl(var(--muted))' : `hsl(var(--primary) / 0.5)` }} />
      <div className="flex items-center gap-3 pl-5 pr-4 py-3.5">
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-2xl shrink-0",
          c.isComplete ? "bg-primary" : c.isLocked ? "bg-muted" : "bg-secondary"
        )}>
          {c.isComplete ? (
            <CheckCircle2 className="h-5 w-5 text-primary-foreground" />
          ) : c.isLocked ? (
            <Lock className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ClipboardCheck className="h-5 w-5 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{c.title}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{c.frequency}</Badge>
          </div>
          {c.isLocked ? (
            <span className="text-xs text-muted-foreground">Locked until {c.lockUntilTime}</span>
          ) : c.isComplete ? (
            <span className="text-xs text-primary font-medium">All tasks complete ✓</span>
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] font-medium text-muted-foreground">{c.completed}/{c.expected}</span>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </div>
    </Card>
  );
}

const options = [
  { key: "F", label: "E + B Combo", desc: "Left accent border with compact row layout, icon pill, and inline progress", Component: OptionF },
  { key: "A", label: "Horizontal Bar", desc: "Bold CTA-style progress bar matching the screenshot reference", Component: OptionA },
  { key: "B", label: "Compact Row", desc: "Minimal list-style card with inline thin progress bar", Component: OptionB },
  { key: "C", label: "visionOS Floating", desc: "Rounded pill with large percentage and soft shadow", Component: OptionC },
  { key: "D", label: "Neumorphic Ring", desc: "Circular progress ring with soft embossed card", Component: OptionD },
  { key: "E", label: "Accent Border", desc: "Left accent stripe with stacked layout, matches task card system", Component: OptionE },
];

export default function ChecklistCardPreview() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background p-4 pb-32">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Checklist Card Styles</h1>
          <p className="text-sm text-muted-foreground">6 options — tap to select your preferred style</p>
        </div>

        {options.map(({ key, label, desc, Component }) => (
          <div key={key} className="space-y-3">
            <button
              className={cn(
                "w-full text-left px-3 py-2 rounded-xl border-2 transition-all",
                selected === key ? "border-primary bg-primary/5" : "border-transparent"
              )}
              onClick={() => setSelected(key)}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-bold text-primary bg-secondary px-2 py-0.5 rounded-md">Option {key}</span>
                <span className="font-semibold text-sm">{label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </button>
            <div className="space-y-2.5">
              {mockChecklists.map((c, i) => (
                <Component key={i} c={c} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}