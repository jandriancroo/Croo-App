import { Button } from "@/components/ui/button";
import { ClipboardList, Scale, X, Zap } from "lucide-react";
import type { VisualAlert } from "@/hooks/useVisualAlerts";
import { useNavigate } from "react-router-dom";
import { NUDGE_ICON } from "@/lib/quickNudges";

interface Props {
  alert: VisualAlert;
  remaining: number; // total cards still in stack including this one
  isLast: boolean;
  onNext: () => void;
  onCloseAll: () => void;
}

export function VisualAlertCard({ alert, remaining, isLast, onNext, onCloseAll }: Props) {
  const navigate = useNavigate();
  const isChecklist = alert.alert_type === "overdue_checklist";
  const isLaborLaw = alert.alert_type === "labor_rules_proposal";
  const isNudge = alert.alert_type === "checklist_nudge" || alert.alert_type === "quick_nudge";
  // notification_id = "nudge:<type>:<batch>" (older checklist nudges: "nudge:<batch>")
  const nudgeType = isNudge ? (/^nudge:(task|event):/.exec(alert.notification_id)?.[1] ?? "checklist") : null;
  const nudgeLabel = nudgeType === "task" ? "Task nudge" : nudgeType === "event" ? "Event heads-up" : "Checklist nudge";
  const nudgeAction = nudgeType === "task" ? "Open task" : nudgeType === "event" ? "Go to dashboard" : "Open checklist";
  const nudgePath = nudgeType === "task" ? `/dashboard?task=${alert.ref_id}` : nudgeType === "event" ? `/dashboard?event=${alert.ref_id}` : `/complete/${alert.ref_id}`;
  const hasAction = isNudge || isLaborLaw;
  const actionLabel = isLaborLaw ? "Review changes" : nudgeAction;
  const actionPath = isLaborLaw ? `/location/${alert.location_id}?proposal=${alert.ref_id}` : nudgePath;
  const Icon = isChecklist ? ClipboardList : isLaborLaw ? Scale : Zap;

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
          {isNudge ? <NUDGE_ICON size={20} /> : <Icon className="h-6 w-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {isLaborLaw ? "Labor law update" : isNudge ? nudgeLabel : isChecklist ? "Overdue Checklist" : "Quick Task"}
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

      {hasAction ? (
        <div className="space-y-2">
          <Button
            onClick={() => { onNext(); navigate(actionPath); }}
            className="w-full h-12 text-base font-semibold gap-2"
            size="lg"
          >
            {actionLabel}
          </Button>
          <Button onClick={onNext} variant="ghost" className="w-full">
            Later
          </Button>
        </div>
      ) : (
        <Button
          onClick={onNext}
          className="w-full h-12 text-base font-semibold gap-2"
          size="lg"
        >
          {isLast ? "Done" : "Next"}
        </Button>
      )}
    </div>
  );
}

