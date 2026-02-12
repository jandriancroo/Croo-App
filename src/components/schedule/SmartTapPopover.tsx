import { memo, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles } from "lucide-react";
import { formatTime12Hour } from "@/lib/utils";

interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
  position?: string;
}

interface SmartTapPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ShiftTemplate[];
  recentTemplateIds: string[];
  onSelectTemplate: (template: ShiftTemplate) => void;
  children: React.ReactNode;
  isCompactMode?: boolean;
}

function SmartTapPopoverComponent({
  open,
  onOpenChange,
  templates,
  recentTemplateIds,
  onSelectTemplate,
  children,
  isCompactMode = false,
}: SmartTapPopoverProps) {
  const { recentTemplates, otherTemplates } = useMemo(() => {
    const recent: ShiftTemplate[] = [];
    const others: ShiftTemplate[] = [];

    for (const id of recentTemplateIds) {
      const t = templates.find((tpl) => tpl.id === id);
      if (t) recent.push(t);
    }

    for (const t of templates) {
      if (!recentTemplateIds.includes(t.id)) {
        others.push(t);
      }
    }

    return { recentTemplates: recent.slice(0, 3), otherTemplates: others };
  }, [templates, recentTemplateIds]);

  if (templates.length === 0) return <>{children}</>;

  const hasRecent = recentTemplates.length > 0;
  const hasOthers = otherTemplates.length > 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-auto min-w-[200px] max-w-[min(380px,90vw)] p-2 z-[200]"
        side="bottom"
        align="center"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {hasRecent && hasOthers ? (
          /* Two-column layout: Recent left, All right */
          <div className="flex gap-2">
            {/* Recent column */}
            <div className="min-w-[140px] flex-shrink-0">
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Last Week
                </span>
              </div>
              <div className="space-y-0.5">
                {recentTemplates.map((template) => (
                  <TemplateOption
                    key={template.id}
                    template={template}
                    onSelect={onSelectTemplate}
                    isHighlighted
                  />
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="w-px bg-border flex-shrink-0" />

            {/* All others column */}
            <div className="min-w-[130px] max-h-[220px] overflow-y-auto">
              <div className="px-1 pb-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  All Templates
                </span>
              </div>
              <div className="space-y-0.5">
                {otherTemplates.map((template) => (
                  <TemplateOption
                    key={template.id}
                    template={template}
                    onSelect={onSelectTemplate}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Single list fallback when no recent or no others */
          <div className="space-y-0.5 max-h-[260px] overflow-y-auto">
            {hasRecent && (
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Last Week
                </span>
              </div>
            )}
            {(hasRecent ? recentTemplates : otherTemplates).map((template) => (
              <TemplateOption
                key={template.id}
                template={template}
                onSelect={onSelectTemplate}
                isHighlighted={hasRecent}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TemplateOption({
  template,
  onSelect,
  isHighlighted = false,
}: {
  template: ShiftTemplate;
  onSelect: (t: ShiftTemplate) => void;
  isHighlighted?: boolean;
}) {
  const displayName =
    template.position ||
    template.template_name?.split(" ").slice(0, -3).join(" ") ||
    template.template_name;

  return (
    <button
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-accent/70 ${
        isHighlighted ? "bg-accent/30" : ""
      }`}
      onClick={() => onSelect(template)}
    >
      <div
        className="w-3 h-3 rounded-sm flex-shrink-0"
        style={{ backgroundColor: template.color || "#ef4444" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{displayName}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatTime12Hour(template.start_time)} –{" "}
          {formatTime12Hour(template.end_time)}
        </p>
      </div>
    </button>
  );
}

export const SmartTapPopover = memo(SmartTapPopoverComponent);
