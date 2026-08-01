import { memo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Card } from "@/components/ui/card";
import { Scissors, Coffee, CalendarOff, Clock, AlertCircle } from "lucide-react";
import { shiftHasBreak } from "@/utils/shiftUtils";
import { formatTime12Hour } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ShiftCardProps {
  shift: any;
  isDragging?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
  isPublished?: boolean;
  isCompactMode?: boolean;
  hasTimeOffConflict?: boolean;
  conflictingTimeOff?: any[];
}

function ShiftCardComponent({ shift, isDragging, onEdit, isPublished = true, isCompactMode = false, hasTimeOffConflict = false, conflictingTimeOff = [] }: ShiftCardProps) {
  const [conflictPopoverOpen, setConflictPopoverOpen] = useState(false);
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

  const hasConflictDetails = hasTimeOffConflict && conflictingTimeOff && conflictingTimeOff.length > 0;

  const handleCardClick = (e: React.MouseEvent) => {
    if (shift.isTemplate) return;
    e.stopPropagation();
    // Smart-tap: first click shows time-off info, second click opens shift editor
    if (hasConflictDetails && !conflictPopoverOpen) {
      setConflictPopoverOpen(true);
      return;
    }
    setConflictPopoverOpen(false);
    onEdit?.();
  };

  // Draft styling: reduced opacity, dashed border, and grayscale filter for unpublished shifts
  const isDraft = !isPublished && !shift.isTemplate;
  const draftStyles = isDraft
    ? "opacity-70 border-2 border-dashed border-foreground/25 grayscale-[30%]"
    : "";

  // Check if shift was trimmed by auto-scheduler
  const wasTrimmed = shift.was_trimmed && shift.original_end_time;

  // Split position into two lines at the midpoint for multi-word names
  const formatPosition = (pos: string) => pos;

  // For templates, use the position/role field, not the full template_name
  const templatePosition = shift.isTemplate ? (template?.position || template?.role) : null;

  // Warning border + stripe overlay for time-off conflicts
  const conflictBorderClass = hasTimeOffConflict ? "ring-2 ring-red-500 ring-offset-1 ring-offset-transparent" : "";
  const stripeOverlayStyle = hasTimeOffConflict ? {
    backgroundImage: `repeating-linear-gradient(
      45deg,
      transparent,
      transparent 8px,
      rgba(239, 68, 68, 0.28) 8px,
      rgba(239, 68, 68, 0.28) 16px
    )`
  } : {};

  const formatTime = (t: string) => {
    const [h, m] = t.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
  };



  const cardEl = (
    <Card
      ref={setNodeRef}
      style={{ 
        ...style, 
        backgroundColor: `${bgColor}1A`,
        borderColor: 'transparent',
        borderLeftColor: bgColor,
        boxShadow: shift.isTemplate ? 'none' : (style as any)?.boxShadow ?? 'none',
      }}
      className={`${isCompactMode ? 'p-0 min-h-[22px] rounded-none border border-solid border-l-[3px] shadow-none' : `px-2 py-1.5 min-h-[46px] ${shift.isTemplate ? 'rounded-[4px]' : 'rounded-[9px]'} border border-l-[3px] shadow-none`} ${shift.isTemplate ? (isCompactMode ? 'shrink-0 w-[100px]' : 'min-w-[110px]') : 'flex-1 min-w-0'} flex flex-col justify-center ${shift.isTemplate ? 'cursor-grab' : 'cursor-pointer'} active:cursor-grabbing relative group ${isDragging ? "opacity-50" : ""} ${draftStyles} ${isCompactMode ? '' : conflictBorderClass} overflow-hidden`}

      onClick={handleCardClick}
      {...listeners}
      {...attributes}
    >
      {/* Time-off conflict stripe overlay */}
      {hasTimeOffConflict && (
        <div 
          className="absolute inset-0 pointer-events-none rounded-md" 
          style={stripeOverlayStyle}
        />
      )}
      <div className={`relative z-10 ${isCompactMode ? 'text-center' : 'text-left'}`}>
        <div 
          className={`font-extrabold leading-tight flex items-center gap-0.5 whitespace-nowrap tracking-tight text-foreground ${isCompactMode ? 'text-[8px] md:text-xs justify-center' : 'text-[11px] lg:text-[12.5px]'}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
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
          <div className="text-muted-foreground font-bold uppercase tracking-[0.09em] text-[9px] lg:text-[9.5px] mt-0.5 leading-tight text-left truncate">{formatPosition(templatePosition)}</div>
        )}
        {!isCompactMode && !shift.isTemplate && position && (
          <div className="text-muted-foreground font-bold uppercase tracking-[0.09em] text-[9px] lg:text-[9.5px] mt-0.5 leading-tight text-left truncate">{formatPosition(position)}</div>

        )}
       {shift.is_time_off && (
          <div className={`text-foreground font-medium text-left ${isCompactMode ? 'text-[8px] leading-none' : 'text-xs lg:text-sm'}`}>TIME OFF</div>
        )}
      </div>
      {!isCompactMode && !shift.isTemplate && shiftHasBreak(shiftData.start_time, shiftData.end_time) && (
        <div 
          className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-[3px] flex items-center justify-center"
          style={{ backgroundColor: `${bgColor}26` }}
          title="30-minute unpaid break"
        >
          <Coffee className="h-2.5 w-2.5" style={{ color: bgColor }} />
        </div>
      )}
    </Card>
  );


  if (!hasConflictDetails) return cardEl;

  return (
    <Popover open={conflictPopoverOpen} onOpenChange={setConflictPopoverOpen}>
      <PopoverTrigger asChild>{cardEl}</PopoverTrigger>
      <PopoverContent className="w-72 p-3 z-[200]" side="top" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="space-y-3">
          {conflictingTimeOff.map((request, idx) => (
            <div key={request.id || idx} className={idx > 0 ? "pt-3 border-t border-border space-y-2" : "space-y-2"}>
              <div className="flex items-center gap-2">
                <CalendarOff className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">
                  {request.request_type === "time_off" ? "Time Off Request" : "Availability Request"}
                </span>
                {request.status === "pending" && (
                  <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Pending
                  </span>
                )}
                {request.status === "approved" && (
                  <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Approved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {request.time_scope === "partial_day" && request.start_time && request.end_time
                  ? `${formatTime(request.start_time)} - ${formatTime(request.end_time)}`
                  : "Full day"}
              </div>
              {request.notes && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{request.notes}</span>
                </div>
              )}
            </div>
          ))}
          <div className="pt-2 border-t border-border text-[11px] text-muted-foreground">
            Tap the shift again to edit it.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const ShiftCard = memo(ShiftCardComponent);
