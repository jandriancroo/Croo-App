import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
        className="overflow-hidden border-0 relative"
      >
        {/* Accent left border */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
          style={{ backgroundColor: accentColor }}
        />
        <CardContent className="py-2 px-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {iconStyle === "minimal" ? (
              <Icon className="h-5 w-5 shrink-0" style={{ color: accentColor }} />
            ) : (
              <div
                className="p-1.5 rounded-md shrink-0 relative"
                style={{ backgroundColor: `${accentColor}20` }}
              >
                <Icon className="h-4 w-4" style={{ color: accentColor }} />
                {taskStyle === "alarm" && (
                  <div 
                    className="absolute -top-1 -right-1 p-0.5 rounded-full"
                    style={{ backgroundColor: accentColor }}
                  >
                    <AlarmClock className="h-2 w-2 text-white" />
                  </div>
                )}
              </div>
            )}
            <div className="min-w-0 flex flex-wrap items-center gap-1.5 flex-1">
              <p className="font-medium text-sm leading-tight">{title}</p>
              {taskStyle === "alarm" && (
                <span 
                  className="px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
                  style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                >
                  RECURRING
                </span>
              )}
              {hasSubtasks && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                  style={{
                    backgroundColor: subtaskProgress === 1 ? '#22c55e20' : `${accentColor}20`,
                    color: subtaskProgress === 1 ? '#22c55e' : accentColor,
                  }}
                >
                  <ListChecks className="h-3 w-3" />
                  {subtasksCompleted}/{subtasksTotal}
                </span>
              )}
              {badge && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] shrink-0"
                  style={{
                    backgroundColor: badge.color ? `${badge.color}20` : `${accentColor}20`,
                    color: badge.color || accentColor,
                  }}
                >
                  {badge.label}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="icon"
              className="h-8 w-8 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-sm"
              onClick={onAction}
              disabled={isLoading}
            >
              <Check className="h-4 w-4" />
            </Button>
            {showShare && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setShareOpen(true);
                }}
              >
                <Send className="h-4 w-4" />
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