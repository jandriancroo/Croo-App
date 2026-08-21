import { Button } from "@/components/ui/button";
import { ClipboardList, X, Zap } from "lucide-react";
import type { VisualAlert } from "@/hooks/useVisualAlerts";

interface Props {
  alert: VisualAlert;
  remaining: number; // total cards still in stack including this one
  isLast: boolean;
  onNext: () => void;
  onCloseAll: () => void;
}

export function VisualAlertCard({ alert, remaining, isLast, onNext, onCloseAll }: Props) {
  const isChecklist = alert.alert_type === "overdue_checklist";
  const Icon = isChecklist ? ClipboardList : Zap;

  return (
    <div className="relative w-full max-w-sm rounded-2xl bg-card border border-border/40 shadow-2xl p-6 animate-scale-in">
      {/* Close all / dismiss bubble */}
      <button
        onClick={onCloseAll}
        aria-label="Close all notifications"
        className="absolute -top-3 -left-3 h-8 w-8 rounded-full bg-card border border-border/40 shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <X className="h-4 w-4" />
      </button>

      {remaining > 1 && (
        <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow">
          {remaining} pending
        </div>
      )}

      <div className="flex items-start gap-3 mb-4">
        <div className={`p-2.5 rounded-xl ${isChecklist ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-primary/15 text-primary"}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {isChecklist ? "Overdue Checklist" : "Quick Task"}
          </div>
          <h2 className="text-lg font-semibold leading-tight mt-0.5 line-clamp-2">
            {alert.title}
          </h2>
        </div>
      </div>

      {alert.body && (
        <p className="text-sm text-muted-foreground mb-5 line-clamp-3">
          {alert.body}
        </p>
      )}

      <Button
        onClick={onNext}
        className="w-full h-12 text-base font-semibold gap-2"
        size="lg"
      >
        {isLast ? "Done" : "Next"}
      </Button>
    </div>
  );
}

