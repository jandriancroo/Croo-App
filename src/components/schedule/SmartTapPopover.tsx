import { memo, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sparkles, MapPin, Check, Plus } from "lucide-react";
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

interface StationOption {
  id: string;
  name: string;
  color?: string | null;
}

interface SmartTapPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ShiftTemplate[];
  recentTemplateIds: string[];
  onSelectTemplate: (template: ShiftTemplate) => void;
  children: React.ReactNode;
  isCompactMode?: boolean;
  /** Stations enabled at the location. When provided, a Station picker appears in the popover. */
  stations?: StationOption[];
  currentStationId?: string | null;
  onSelectStation?: (stationId: string | null) => void;
  /** Opens a blank new-shift dialog for this cell. */
  onNewShift?: () => void;
}

const MAX_PER_COLUMN = 5;

function SmartTapPopoverComponent({
  open,
  onOpenChange,
  templates,
  recentTemplateIds,
  onSelectTemplate,
  children,
  isCompactMode = false,
  stations,
  currentStationId,
  onSelectStation,
  onNewShift,
}: SmartTapPopoverProps) {

  const { recentTemplates, otherColumns } = useMemo(() => {
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

    // Chunk others into columns of MAX_PER_COLUMN
    const columns: ShiftTemplate[][] = [];
    for (let i = 0; i < others.length; i += MAX_PER_COLUMN) {
      columns.push(others.slice(i, i + MAX_PER_COLUMN));
    }

    return { recentTemplates: recent.slice(0, 3), otherColumns: columns };
  }, [templates, recentTemplateIds]);

  const hasStations = !!(stations && stations.length > 0 && onSelectStation);
  if (templates.length === 0 && !hasStations && !onNewShift) return <>{children}</>;

  const hasRecent = recentTemplates.length > 0;
  const hasOthers = otherColumns.length > 0;


  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-auto min-w-[200px] max-w-[min(500px,92vw)] p-2 z-[200]"
        side="bottom"
        align="center"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex gap-2 overflow-x-auto">
          {/* Stations column (only when enabled at this location) */}
          {hasStations && (
            <div className="min-w-[140px] flex-shrink-0">
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <MapPin className="h-3 w-3 text-sky-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Station
                </span>
              </div>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => { onSelectStation?.(null); onOpenChange(false); }}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-accent/70"
                >
                  <span className="text-muted-foreground">Unassigned</span>
                  {(currentStationId ?? null) === null && <Check className="h-3.5 w-3.5" />}
                </button>
                {stations!.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => { onSelectStation?.(s.id); onOpenChange(false); }}
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-accent/70"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ background: s.color || "#94a3b8" }}
                      />
                      <span className="truncate">{s.name}</span>
                    </span>
                    {currentStationId === s.id && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hasStations && (hasRecent || hasOthers || !!onNewShift) && (
            <div className="w-px bg-border flex-shrink-0" />
          )}

          {/* New Shift + Recent column */}
          {(hasRecent || onNewShift) && (
            <div className="min-w-[130px] flex-shrink-0">
              {onNewShift && (
                <div className="pb-2">
                  <div className="px-1 pb-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      New
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onNewShift}
                    className="w-full h-[23px] flex items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-accent/40 transition-colors"
                    aria-label="Create new shift"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {hasRecent && (
                <>
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
                </>
              )}
            </div>
          )}

          {/* Other template columns */}
          {otherColumns.map((column, colIdx) => (
            <div key={colIdx} className="flex gap-2">
              {(hasRecent || onNewShift || colIdx > 0) && (
                <div className="w-px bg-border flex-shrink-0" />
              )}
              <div className="min-w-[130px] flex-shrink-0">
                {colIdx === 0 && (
                  <div className="px-1 pb-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      All Templates
                    </span>
                  </div>
                )}
                {colIdx > 0 && <div className="h-[18px]" />}
                <div className="space-y-0.5">
                  {column.map((template) => (
                    <TemplateOption
                      key={template.id}
                      template={template}
                      onSelect={onSelectTemplate}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}

        </div>
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
        <p
          className="text-[12.5px] font-extrabold tracking-tight leading-tight text-foreground truncate"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatTime12Hour(template.start_time)} –{" "}
          {formatTime12Hour(template.end_time)}
        </p>
        <p className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mt-0.5 leading-tight truncate">
          {displayName}
        </p>
      </div>

    </button>
  );
}

export const SmartTapPopover = memo(SmartTapPopoverComponent);
