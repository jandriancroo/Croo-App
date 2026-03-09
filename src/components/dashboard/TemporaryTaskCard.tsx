import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CircleCircleCheck, LucideIcon, AlarmClock, Send, ListChecks } from "lucide-react";
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
      <div
        className="flex items-center gap-2.5 rounded-xl overflow-hidden cursor-pointer active:opacity-80 transition-opacity"
        style={{ backgroundColor: `${accentColor}10` }}
      >
        {/* Inset rounded accent stripe */}
        <div 
          className="w-1 self-stretch rounded-full shrink-0 my-1 ml-2"
          style={{ backgroundColor: accentColor }}
        />
        <div className="flex-1 flex items-center gap-2 py-2 pr-2.5 min-w-0">
          <span className="font-medium text-sm truncate flex-1">{title}</span>
          {taskStyle === "alarm" && (
            <span 
              className="px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              RECURRING
            </span>
          )}
          {hasSubtasks && (
            <span className="text-xs text-muted-foreground font-medium shrink-0">
              {subtasksCompleted}/{subtasksTotal}
            </span>
          )}
          {badge && !hasSubtasks && (
            <span className="text-xs text-muted-foreground shrink-0">
              {badge.label}
            </span>
          )}
      <CircleCheck className="h-5 w-5 text-muted-foreground/40 shrink-0" />
          {showShare && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-primary shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setShareOpen(true);
              }}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

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