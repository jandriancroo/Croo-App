import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Eye, LucideIcon } from "lucide-react";

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
  /** Button label - defaults to "Complete" */
  buttonLabel?: string;
  /** Button variant - "complete" shows check icon, "view" shows eye icon */
  buttonVariant?: "complete" | "view";
  /** Whether the action is in progress */
  isLoading?: boolean;
  /** Callback when button is clicked */
  onAction: () => void;
  /** Optional badge/tag to display */
  badge?: {
    label: string;
    color?: string;
  };
}

export function TemporaryTaskCard({
  title,
  subtitle,
  icon: Icon,
  accentColor,
  buttonLabel = "Complete",
  buttonVariant = "complete",
  isLoading = false,
  onAction,
  badge,
}: TemporaryTaskCardProps) {
  const ButtonIcon = buttonVariant === "view" ? Eye : Check;

  return (
    <Card
      className="overflow-hidden"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="p-2 rounded-lg shrink-0"
            style={{ backgroundColor: `${accentColor}20` }}
          >
            <Icon className="h-4 w-4" style={{ color: accentColor }} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{title}</p>
            {(subtitle || badge) && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                {subtitle}
                {badge && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{
                      backgroundColor: badge.color ? `${badge.color}20` : `${accentColor}20`,
                      color: badge.color || accentColor,
                    }}
                  >
                    {badge.label}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1"
          onClick={onAction}
          disabled={isLoading}
        >
          <ButtonIcon className="h-3.5 w-3.5" />
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
