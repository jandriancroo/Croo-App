import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from "@/components/ui/button";
import { FileCheck, GripVertical, Pencil, EyeOff, Trash2, Copy, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

  const frequencyLabel = checklist.frequency === 'daily' ? 'Daily' 
    : checklist.frequency === 'weekly' ? 'Weekly'
    : checklist.frequency === 'monthly' ? 'Monthly'
    : checklist.frequency;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex gap-2 items-start"
    >
      {isReordering && (
        <Button
          variant="ghost"
          size="icon"
          className="cursor-grab active:cursor-grabbing mt-1"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
      )}
      <div
        className="flex-1 border rounded-lg p-3 hover:bg-accent/50 transition-colors cursor-pointer"
        style={{ borderLeftWidth: 4, borderLeftColor: 'hsl(var(--primary))' }}
        onClick={isReordering ? undefined : handleClick}
      >
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{checklist.title}</p>
          {isDynamic && (
            <Badge variant="outline" className="text-[10px] px-1.5 gap-0.5">
              <CalendarDays className="h-2.5 w-2.5" />
              {dayNames[currentDay]}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] px-1.5">
            {frequencyLabel}
          </Badge>
        </div>
        {checklist.description && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{checklist.description}</p>
        )}
      </div>
      {isAdmin && !isReordering && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 mt-1">
              <Pencil className="h-3.5 w-3.5" />
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
