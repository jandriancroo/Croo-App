import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, LucideIcon, AlarmClock, Send, ListChecks } from "lucide-react";
import { ShareTaskDialog } from "./ShareTaskDialog";

export interface TemporaryTaskCardProps {
  /** Unique identifier for the task */
  id: string;
  /** Main title of the task */
  title: string;
  /** Subtitle/description text */
  subtitle?: string;
  /** Icon component to display */
  icon: LucideIcon;
  /** Accent color for the left border and icon background (hex or HSL) */
  accentColor: string;
  /** Button label - defaults to "Done" */
  buttonLabel?: string;
  /** Whether the action is in progress */
  isLoading?: boolean;
  /** Callback when button is clicked */
  onAction: () => void;
  /** Optional badge/tag to display */
  badge?: {
    label: string;
    color?: string;
  };
  /** Task style - standard or alarm */
  taskStyle?: "standard" | "alarm";
  /** Icon style - default has colored background, minimal is just the icon */
  iconStyle?: "default" | "minimal";
  /** Whether to show share button */
  showShare?: boolean;
  /** Custom share details (defaults to title) */
  shareDetails?: string;
  /** Subtask progress - completed count */
  subtasksCompleted?: number;
  /** Subtask progress - total count */
  subtasksTotal?: number;
}

export function TemporaryTaskCard({
  title,
  subtitle,
  icon: Icon,
  accentColor,
  buttonLabel,
  isLoading = false,
  onAction,
  badge,
  taskStyle = "standard",
  iconStyle = "default",
  showShare = false,
  shareDetails,
  subtasksCompleted,
  subtasksTotal,
}: TemporaryTaskCardProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const hasSubtasks = subtasksTotal !== undefined && subtasksTotal > 0;
  const subtaskProgress = hasSubtasks ? (subtasksCompleted || 0) / subtasksTotal : 0;
  
  // Smart button label: "Start" for subtasks, "Done" for simple tasks
  const resolvedButtonLabel = buttonLabel ?? (hasSubtasks ? "Start" : "Done");

  return (
    <>
      <Card
        className="overflow-hidden border-0 relative rounded-xl"
        style={{ backgroundColor: `${accentColor}10` }}
      >
        <CardContent className="py-1.5 px-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {/* Inset rounded accent stripe */}
            <div 
              className="w-1 self-stretch rounded-full shrink-0 my-0.5"
              style={{ backgroundColor: accentColor }}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm leading-tight">{title}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {taskStyle === "alarm" && (
                <span 
                  className="px-1 py-0.5 rounded text-[9px] font-medium"
                  style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                >
                  RECURRING
                </span>
              )}
              {hasSubtasks && (
                <span className="text-xs text-muted-foreground font-medium">
                  {subtasksCompleted}/{subtasksTotal}
                </span>
              )}
              {badge && !hasSubtasks && (
                <span className="text-xs text-muted-foreground">
                  {badge.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50"
              onClick={onAction}
              disabled={isLoading}
            >
              <Check className="h-4.5 w-4.5 text-muted-foreground/50" />
            </button>
            {showShare && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setShareOpen(true);
                }}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ShareTaskDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        taskTitle={title}
        taskDetails={shareDetails || subtitle}
        accentColor={accentColor}
      />
    </>
  );
}