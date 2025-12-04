import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from "@/components/ui/button";
import { FileCheck, GripVertical, MoreVertical, EyeOff, Trash2, Copy } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

interface SortableChecklistItemProps {
  checklist: any;
  isDynamic: boolean;
  isReordering: boolean;
  isAdmin: boolean;
  currentDay: number;
  dayNames: string[];
  onNavigate: (path: string) => void;
  onDeactivate: (id: string) => void;
  onDelete: (id: string) => void;
  onCopyTo?: (id: string, title: string) => void;
  editMode?: boolean;
}

export function SortableChecklistItem({
  checklist,
  isDynamic,
  isReordering,
  isAdmin,
  currentDay,
  dayNames,
  onNavigate,
  onDeactivate,
  onDelete,
  onCopyTo,
  editMode = false,
}: SortableChecklistItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: checklist.id, disabled: !isReordering });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = () => {
    if (editMode) {
      // In edit mode, always navigate to edit
      if (isDynamic) {
        onNavigate(`/dynamic-checklist/${checklist.id}`);
      } else {
        onNavigate(`/edit-checklist/${checklist.id}`);
      }
    } else {
      // In complete mode, navigate to complete
      onNavigate(`/complete-checklist/${checklist.id}`);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex gap-2"
    >
      {isReordering && (
        <Button
          variant="ghost"
          size="icon"
          className="cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="outline"
        className="flex-1 justify-start"
        onClick={handleClick}
        disabled={isReordering}
      >
        <FileCheck className="h-4 w-4 mr-2" />
        <div className="flex-1 text-left">
          <div className="font-medium">
            {checklist.title}
            {isDynamic && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({dayNames[currentDay]})
              </span>
            )}
          </div>
          {checklist.description && (
            <div className="text-xs text-muted-foreground">{checklist.description}</div>
          )}
        </div>
      </Button>
      {isAdmin && !isReordering && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onCopyTo && (
              <>
                <DropdownMenuItem onClick={() => onCopyTo(checklist.id, checklist.title)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy To...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => onDeactivate(checklist.id)}>
              <EyeOff className="h-4 w-4 mr-2" />
              Make Inactive
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => onDelete(checklist.id)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
