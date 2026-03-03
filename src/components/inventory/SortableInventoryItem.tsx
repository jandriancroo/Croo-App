import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Link2, ArrowUp, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

interface SortableInventoryItemProps {
  item: any;
  sortableId: string;
  isShortcut: boolean;
  isSelected: boolean;
  isSelectingThisGroup: boolean;
  isDragDisabled: boolean;
  isReorderMode?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
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
  isFirst = false,
  isLast = false,
  onMoveUp,
  onMoveDown,
  onClick,
  onContextMenu,
}: SortableInventoryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    disabled: isDragDisabled || isReorderMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center py-1.5 px-2 rounded text-sm group cursor-pointer gap-2 ${
        isDragging
          ? "border border-primary/40 border-dashed bg-primary/5 shadow-lg"
          : isSelected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : isShortcut
          ? "bg-orange-100 dark:bg-orange-950/30 border border-dashed border-orange-300 dark:border-orange-700/50"
          : "bg-background hover:bg-muted/30"
      }`}
      onClick={isReorderMode ? undefined : onClick}
      onContextMenu={isReorderMode ? undefined : onContextMenu}
    >
      {/* Reorder arrows OR drag handle */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isReorderMode ? (
          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0"
              disabled={isFirst}
              onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0"
              disabled={isLast}
              onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            {isSelectingThisGroup && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => {}}
                className="h-3.5 w-3.5 flex-shrink-0 pointer-events-none"
              />
            )}
            {!isShortcut ? (
              <div
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                className="touch-none cursor-grab active:cursor-grabbing flex-shrink-0"
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
              </div>
            ) : (
              <div className="flex items-center gap-1 flex-shrink-0">
                <div
                  ref={setActivatorNodeRef}
                  {...attributes}
                  {...listeners}
                  className="touch-none cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
                </div>
                <Link2 className="h-3.5 w-3.5 text-orange-500/60 flex-shrink-0" />
              </div>
            )}
          </>
        )}
        {isReorderMode && isShortcut && (
          <Link2 className="h-3.5 w-3.5 text-orange-500/60 flex-shrink-0" />
        )}
      </div>

      {/* Name */}
      <div className="flex items-center gap-2 truncate flex-1 min-w-0">
        <span className={`truncate ${isShortcut ? "text-muted-foreground" : ""}`}>
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

      {/* Fixed-width badge columns */}
      {!isReorderMode && (
        <div className="flex items-center gap-1.5 flex-shrink-0 w-[120px] justify-end">
          {(item as any).category && !isShortcut ? (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground whitespace-nowrap">
              {(item as any).category}
            </Badge>
          ) : !isShortcut ? (
            <span className="w-1" />
          ) : null}
          {(item as any).pan_sizes?.enabled && !isShortcut && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 whitespace-nowrap">
              Pans
            </Badge>
          )}
        </div>
      )}

      {/* Price/unit column */}
      {!isReorderMode && (
        <div className="flex items-center gap-2 text-muted-foreground flex-shrink-0">
          <span className="text-xs">{item.pack_size || item.unit || "ea"}</span>
          {item.cost_per_unit && !isShortcut && (
            <span className="text-xs text-primary">
              ${Number(item.cost_per_unit).toFixed(2)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ItemDragOverlay({ item }: { item: any }) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded text-sm bg-background border border-primary shadow-xl scale-105">
      <div className="flex items-center gap-2 truncate flex-1">
        <GripVertical className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="truncate font-medium">
          {(item as any).common_name || item.name}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{item.pack_size || item.unit || "ea"}</span>
    </div>
  );
}
