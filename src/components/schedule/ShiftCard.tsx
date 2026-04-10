import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { Scissors, Coffee } from "lucide-react";
import { shiftHasBreak } from "@/utils/shiftUtils";
import { formatTime12Hour } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ShiftCardProps {
  shift: any;
  isDragging?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  isPublished?: boolean;
  isCompactMode?: boolean;
  hasTimeOffConflict?: boolean;
}

function ShiftCardComponent({ shift, isDragging, onEdit, isPublished = true, isCompactMode = false, hasTimeOffConflict = false }: ShiftCardProps) {
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

  // Split position into two lines at the midpoint for multi-word names
  const formatPosition = (pos: string) => pos;

  // For templates, use the position/role field, not the full template_name
  const templatePosition = shift.isTemplate ? (template?.position || template?.role) : null;

  // Warning border + stripe overlay for time-off conflicts
  const conflictBorderClass = hasTimeOffConflict ? "ring-2 ring-amber-500 ring-offset-1 ring-offset-transparent" : "";
  const stripeOverlayStyle = hasTimeOffConflict ? {
    backgroundImage: `repeating-linear-gradient(
      45deg,
      transparent,
      transparent 10px,
      rgba(0, 0, 0, 0.2) 10px,
      rgba(0, 0, 0, 0.2) 20px
    )`
  } : {};

  return (
    <Card
      ref={setNodeRef}
      style={{ 
        ...style, 
        backgroundColor: `${bgColor}20`,
        borderColor: `${bgColor}40`,
      }}
      className={`${isCompactMode ? 'p-0 min-h-[22px] rounded-none border border-solid shadow-none' : 'p-1.5 min-h-[46px] rounded-md border-2'} ${shift.isTemplate ? (isCompactMode ? 'shrink-0 w-[100px]' : 'min-w-[110px]') : 'flex-1 min-w-0'} flex flex-col justify-center ${shift.isTemplate ? 'cursor-grab' : 'cursor-pointer'} active:cursor-grabbing relative group ${isDragging ? "opacity-50" : ""} ${draftStyles} ${isCompactMode ? '' : conflictBorderClass} overflow-hidden`}
      onClick={handleCardClick}
      {...listeners}
      {...attributes}
    >
      {/* Inset accent stripe - non-compact only */}
      {!isCompactMode && (
        <div 
          className="absolute left-1 top-1 bottom-1 w-[3px] rounded-full"
          style={{ backgroundColor: bgColor }}
        />
      )}
      {/* Time-off conflict stripe overlay */}
      {hasTimeOffConflict && (
        <div 
          className="absolute inset-0 pointer-events-none rounded-lg" 
          style={stripeOverlayStyle}
        />
      )}
      <div className={`relative z-10 ${isCompactMode ? 'text-center' : 'text-left pl-2.5'}`}>
        <div 
          className={`font-semibold leading-tight flex items-center gap-0.5 whitespace-nowrap ${isCompactMode ? 'text-[8px] md:text-xs justify-center' : 'text-[10px] lg:text-xs'}`}
          style={{ color: bgColor }}
        >
          <span className="lg:hidden">{`${formatTime12Hour(shiftData.start_time, true, true)} - ${formatTime12Hour(shiftData.end_time, true, true)}`}</span>
          <span className="hidden lg:inline">{`${formatTime12Hour(shiftData.start_time, true)} - ${formatTime12Hour(shiftData.end_time, true)}`}</span>
          {!isCompactMode && wasTrimmed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-amber-400 text-amber-900">
                  <Scissors className="h-2 w-2" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Theo trimmed: was {formatTime12Hour(shift.original_end_time, true)}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {!isCompactMode && shift.isTemplate && templatePosition && (
          <div className="text-muted-foreground text-[9px] lg:text-[10px] mt-0.5 leading-tight text-left truncate">{formatPosition(templatePosition)}</div>
        )}
        {!isCompactMode && !shift.isTemplate && position && (
          <div className="text-muted-foreground text-[9px] lg:text-[10px] mt-0.5 leading-tight text-left truncate">{formatPosition(position)}</div>
        )}
       {shift.is_time_off && (
          <div className={`text-foreground font-medium text-left ${isCompactMode ? 'text-[8px] leading-none' : 'text-xs lg:text-sm'}`}>TIME OFF</div>
        )}
      </div>
      {!isCompactMode && !shift.isTemplate && shiftHasBreak(shiftData.start_time, shiftData.end_time) && (
        <div 
          className="absolute bottom-0 right-0 rounded-tl-lg px-1.5 py-0.5 flex items-center justify-center"
          style={{ backgroundColor: bgColor }}
          title="30-minute unpaid break"
        >
          <Coffee className="h-3 w-3 text-white" />
        </div>
      )}
    </Card>
  );
}

export const ShiftCard = memo(ShiftCardComponent);
