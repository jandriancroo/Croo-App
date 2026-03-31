import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

interface SortableInventoryItemProps {
  item: any;
  sortableId: string;
  isShortcut: boolean;
  isSelected: boolean;
  isSelectingThisGroup: boolean;
  isDragDisabled: boolean;
  isReorderMode?: boolean;
  reorderState?: "idle" | "picked" | "target";
  pickedCount?: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function SortableInventoryItem({
  item,
  sortableId,
  isShortcut,
  isSelected,
  isSelectingThisGroup,
  isDragDisabled,
  isReorderMode = false,
  reorderState = "idle",
  pickedCount = 0,
  onClick,
  onContextMenu,
}: SortableInventoryItemProps) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    disabled: isDragDisabled || isReorderMode,
  });

  const style = isReorderMode
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : undefined,
      };

  const reorderClasses = isReorderMode
    ? reorderState === "picked"
      ? "bg-primary/15 ring-2 ring-primary shadow-md scale-[1.02] -translate-y-0.5"
      : reorderState === "target"
      ? "bg-primary/5"
      : "hover:bg-muted/40"
    : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center py-1.5 px-2 rounded text-sm cursor-pointer gap-2 transition-all duration-150 ${
        isDragging
          ? "border border-primary/40 border-dashed bg-primary/5 shadow-lg"
          : isReorderMode
          ? `${reorderClasses} ${reorderState === "picked" ? "" : ""}`
          : isSelected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : isShortcut
          ? "bg-orange-100 dark:bg-orange-950/30 border border-dashed border-orange-300 dark:border-orange-700/50"
          : "bg-background hover:bg-muted/30"
      }`}
      onClick={onClick}
      onContextMenu={isReorderMode ? undefined : onContextMenu}
    >
      {/* Left icons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isReorderMode ? (
          <>
            {reorderState === "picked" ? (
              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <span className="text-[10px] text-primary-foreground font-bold">
                  {pickedCount > 1 ? pickedCount : "✓"}
                </span>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground">
                  {reorderState === "target" ? "↓" : ""}
                </span>
              </div>
            )}
            {isShortcut && (
              <Link2 className="h-3.5 w-3.5 text-orange-500/60 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            {isSelectingThisGroup && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => {}}
                className="h-3.5 w-3.5 flex-shrink-0 pointer-events-none"
              />
            )}
            {isShortcut && (
              <Link2 className="h-3.5 w-3.5 text-orange-500/60 flex-shrink-0" />
            )}
          </>
        )}
      </div>

      {/* Name */}
      <div className="flex items-center gap-2 truncate flex-1 min-w-0">
        <span className={`truncate ${isShortcut ? "text-muted-foreground" : ""} ${reorderState === "picked" ? "font-medium" : ""}`}>
          {(item as any).common_name || item.name}
        </span>
        {(item as any).common_name && !isShortcut && (
          <span
            className="text-[10px] text-muted-foreground truncate max-w-[100px]"
            title={item.name}
          >
            ({item.name})
          </span>
        )}
        {isShortcut && (
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 flex-shrink-0 gap-0.5 border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400"
          >
            Shortcut
          </Badge>
        )}
      </div>

      {/* Badge columns — hidden in reorder mode, responsive on mobile */}
      {!isReorderMode && (
        <div className="flex items-center gap-1 flex-shrink-0 justify-end">
          {(item as any).category && !isShortcut ? (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground whitespace-nowrap hidden sm:inline-flex">
              {(item as any).category}
            </Badge>
          ) : null}
          {(item as any).pan_sizes?.enabled && !isShortcut && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 whitespace-nowrap hidden sm:inline-flex">
              Pans
            </Badge>
          )}
        </div>
      )}

      {/* Price/unit column — hidden in reorder mode */}
      {!isReorderMode && (
        <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground flex-shrink-0">
          <span className="text-[10px] sm:text-xs">{item.pack_size || item.unit || "ea"}</span>
          {item.cost_per_unit && !isShortcut && (
            <span className="text-[10px] sm:text-xs text-primary">
              ${Number(item.cost_per_unit).toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Reorder hint */}
      {isReorderMode && reorderState === "target" && (
        <div className="flex-shrink-0">
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 bg-primary/10 text-primary">
            Place here
          </Badge>
        </div>
      )}
    </div>
  );
}

export function ItemDragOverlay({ item }: { item: any }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded text-sm bg-background border border-primary shadow-xl scale-105">
      <div className="flex items-center gap-2 truncate flex-1">
        <div className="w-3.5 h-3.5 rounded-full bg-primary flex-shrink-0" />
        <span className="truncate font-medium">
          {(item as any).common_name || item.name}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{item.pack_size || item.unit || "ea"}</span>
    </div>
  );
}
