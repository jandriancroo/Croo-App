import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, LucideIcon, AlarmClock } from "lucide-react";

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
}

export function TemporaryTaskCard({
  title,
  subtitle,
  icon: Icon,
  accentColor,
  buttonLabel = "Done",
  isLoading = false,
  onAction,
  badge,
  taskStyle = "standard",
  iconStyle = "default",
}: TemporaryTaskCardProps) {
  return (
    <Card
      className="overflow-hidden"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <CardContent className="py-2 px-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {iconStyle === "minimal" ? (
            <Icon className="h-6 w-6 shrink-0" style={{ color: accentColor }} />
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
          <div className="min-w-0 flex items-center gap-1.5 flex-1">
            <p className="font-medium text-sm truncate">{title}</p>
            {taskStyle === "alarm" && (
              <span 
                className="px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                RECURRING
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
        <Button
          size="sm"
          className="shrink-0 h-8 px-4 rounded-lg text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground border-0 shadow-sm gap-1.5"
          onClick={onAction}
          disabled={isLoading}
        >
          <Check className="h-3.5 w-3.5" />
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}