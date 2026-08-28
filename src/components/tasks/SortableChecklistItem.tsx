import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from "@/components/ui/button";
import { FileCheck, GripVertical, Pencil, EyeOff, Eye, Trash2, Copy, CalendarDays, CopyPlus, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { isPendingDraft, isSupersededVersion, formatActivation } from "@/utils/checklistVersions";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";

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
  onDuplicate?: (checklist: any) => void;
  onDiscardDraft?: (id: string) => void;
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
  onDuplicate,
  onDiscardDraft,
  editMode = false,
}: SortableChecklistItemProps) {
  const { timezone } = useLocationTimezone();
  const isDraft = isPendingDraft(checklist);
  const isOldVersion = isSupersededVersion(checklist);
  const {

    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: checklist.id });

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
    >
      <div
        className={`border rounded-lg p-3 transition-colors cursor-pointer ${
          !checklist.is_active 
            ? 'opacity-40 border-dashed bg-muted/30' 
            : 'hover:bg-accent/50'
        }`}
        style={{ borderLeftWidth: 4, borderLeftColor: checklist.is_active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
        onClick={handleClick}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 flex items-start gap-2">
            {isAdmin && (
              <div
                className="cursor-grab active:cursor-grabbing touch-none text-muted-foreground mt-0.5 flex-shrink-0"
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="h-4 w-4" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate">{checklist.title}</p>
                {isDraft && (
                  <Badge className="text-[10px] px-1.5 gap-0.5">
                    Draft
                    {checklist.activation_at ? ` · goes live ${formatActivation(checklist.activation_at, timezone)}` : ' · not scheduled'}
                  </Badge>
                )}
                {isOldVersion && (
                  <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">
                    Last version
                  </Badge>
                )}
                {!checklist.is_active && !isDraft && !isOldVersion && (
                  <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">
                    Inactive
                  </Badge>
                )}

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
          </div>
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {onDuplicate && !isDraft && !isOldVersion && (
                  <>
                    <DropdownMenuItem onClick={() => onDuplicate(checklist)}>
                      <CopyPlus className="h-4 w-4 mr-2" />
                      Duplicate & Schedule
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isDraft && onScheduleDraft && (
                  <>
                    <DropdownMenuItem onClick={() => onScheduleDraft(checklist)}>
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Schedule
                    </DropdownMenuItem>
                    {onLiveNowDraft && (
                      <DropdownMenuItem onClick={() => onLiveNowDraft(checklist)}>
                        <Zap className="h-4 w-4 mr-2" />
                        Live now
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
                {onCopyTo && !isDraft && (
                  <>
                    <DropdownMenuItem onClick={() => onCopyTo(checklist.id, checklist.title)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy To...
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {!isDraft && !isOldVersion && (
                  <DropdownMenuItem onClick={() => onDeactivate(checklist.id)}>
                    {checklist.is_active ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                    {checklist.is_active ? 'Make Inactive' : 'Reactivate'}
                  </DropdownMenuItem>
                )}
                {isDraft && onDiscardDraft ? (
                  <DropdownMenuItem onClick={() => onDiscardDraft(checklist.id)} className="text-destructive">
                    <Archive className="h-4 w-4 mr-2" />
                    Discard draft
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => onDelete(checklist.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>

            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
