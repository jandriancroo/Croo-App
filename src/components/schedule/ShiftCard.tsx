import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Scissors } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BreakIndicator } from "./BreakIndicator";
import { shiftHasBreak } from "@/utils/shiftUtils";
import { formatTime12Hour } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ShiftCardProps {
  shift: any;
  isDragging?: boolean;
  onDelete?: () => void;
  canTakeShift?: boolean;
  currentUserId?: string;
  onTakeShift?: () => void;
  onEdit?: () => void;
  isPublished?: boolean;
  isCompactMode?: boolean;
}

function ShiftCardComponent({ shift, isDragging, onDelete, canTakeShift, currentUserId, onTakeShift, onEdit, isPublished = true, isCompactMode = false }: ShiftCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: shift.isTemplate ? `template-${shift.template.id}` : `shift-${shift.id}`,
    data: shift,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        touchAction: 'none',
      }
    : { touchAction: 'none' };


  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shift.id) return;

    if (!confirm("Delete this shift?")) return;

    try {
      const { error } = await supabase.from("scheduled_shifts").delete().eq("id", shift.id);

      if (error) throw error;
      toast.success("Shift deleted");
      onDelete?.();
    } catch (error) {
      console.error("Error deleting shift:", error);
      toast.error("Failed to delete shift");
    }
  };

  const handleTakeShift = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shift.id || !currentUserId) return;

    try {
      const { error } = await supabase
        .from("scheduled_shifts")
        .update({ user_id: currentUserId })
        .eq("id", shift.id);

      if (error) throw error;
      toast.success("Shift assigned to you");
      onTakeShift?.();
    } catch (error) {
      console.error("Error taking shift:", error);
      toast.error("Failed to take shift");
    }
  };

  const shiftData = shift.isTemplate ? shift.template : shift;
  const template = shift.template;
  const bgColor = template?.color || shiftData.color || "#ef4444";
  const position = template?.position || template?.template_name;

  const handleCardClick = (e: React.MouseEvent) => {
    if (!shift.isTemplate && onEdit) {
      e.stopPropagation();
      onEdit();
    }
  };

  // Draft styling: reduced opacity, dashed border, and grayscale filter for unpublished shifts
  const isDraft = !isPublished && !shift.isTemplate;
  const draftStyles = isDraft
    ? "opacity-70 border-2 border-dashed border-white/60 grayscale-[30%]"
    : "";

  // Check if shift was trimmed by auto-scheduler
  const wasTrimmed = shift.was_trimmed && shift.original_end_time;

  // Split position into two lines if it has exactly 2 words
  const formatPosition = (pos: string) => {
    const words = pos.split(' ');
    if (words.length === 2) {
      return (
        <>
          <div>{words[0]}</div>
          <div>{words[1]}</div>
        </>
      );
    }
    return pos;
  };

  // For templates, use the position/role field, not the full template_name
  const templatePosition = shift.isTemplate ? (template?.position || template?.role) : null;

  return (
    <Card
      ref={setNodeRef}
      style={{ ...style, backgroundColor: bgColor }}
      className={`${isCompactMode ? 'p-1 min-h-[32px]' : 'p-1.5 min-h-[55px]'} flex flex-col ${shift.isTemplate ? 'justify-start' : 'justify-between'} ${shift.isTemplate ? 'cursor-grab' : 'cursor-pointer'} active:cursor-grabbing relative group ${isDragging ? "opacity-50" : ""} ${draftStyles}`}
      onClick={handleCardClick}
      {...listeners}
      {...attributes}
    >
      <div>
        <div className={`text-white font-semibold leading-tight flex items-center gap-1 ${isCompactMode ? 'text-[10px]' : 'text-xs'}`}>
          {`${formatTime12Hour(shiftData.start_time)} - ${formatTime12Hour(shiftData.end_time)}`}
          {!isCompactMode && wasTrimmed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-amber-400 text-amber-900">
                    <Scissors className="h-2 w-2" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>CrooAI trimmed: was {formatTime12Hour(shift.original_end_time)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {!isCompactMode && shift.isTemplate && templatePosition && (
          <div className="text-white text-[10px] opacity-90 mt-0.5 leading-tight">{formatPosition(templatePosition)}</div>
        )}
        {!isCompactMode && !shift.isTemplate && position && (
          <div className="text-white text-[10px] opacity-90 mt-0.5 leading-tight">{formatPosition(position)}</div>
        )}
        {!isCompactMode && shift.is_time_off && <div className="text-white text-sm font-medium">TIME OFF</div>}
      </div>
      {!isCompactMode && !shift.isTemplate && shiftHasBreak(shiftData.start_time, shiftData.end_time) && (
        <div className="hidden xl:flex justify-end">
          <BreakIndicator hasBreak={true} size="sm" />
        </div>
      )}
      {!shift.isTemplate && onDelete && (
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-white hover:bg-white/20"
            onClick={handleDelete}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}
    </Card>
  );
}

export const ShiftCard = memo(ShiftCardComponent);
