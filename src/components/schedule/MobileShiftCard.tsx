import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CalendarIcon, Pencil, Coffee } from 'lucide-react';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { formatTime12Hour } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface MobileShiftCardProps {
  // Common props
  name: string;
  avatarUrl?: string | null;
  startTime: string;
  endTime: string;
  onClick?: () => void;
  
  // Color/status styling
  accentColor?: string | null; // Template/shift color for left edge
  statusIndicator?: 'active' | 'break' | 'modified' | 'none';
  
  // Published status
  isPublished?: boolean;
  
  // Optional schedule info
  scheduledStart?: string;
  scheduledEnd?: string;
  
  // Optional punch info (for Today view)
  clockInTime?: string;
  clockOutTime?: string | null;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  hoursWorked?: number;
  createdByName?: string | null;
  
  // Optional badge/position
  positionLabel?: string | null;
  positionColor?: string | null;
  
  // Show break indicator
  showBreakIndicator?: boolean;
  
  // Action button (for team members)
  actionButton?: React.ReactNode;
  
  // Timezone for formatting
  timezone?: string;
  formatTimeDisplay?: (time: string, tz: string) => string;
}

export function MobileShiftCard({
  name,
  avatarUrl,
  startTime,
  endTime,
  onClick,
  accentColor,
  statusIndicator = 'none',
  isPublished = true,
  scheduledStart,
  scheduledEnd,
  clockInTime,
  clockOutTime,
  breakStartTime,
  breakEndTime,
  hoursWorked,
  createdByName,
  positionLabel,
  positionColor,
  showBreakIndicator = true,
  actionButton,
  timezone,
  formatTimeDisplay: formatTimeFn,
}: MobileShiftCardProps) {
  // Determine left edge color based on status or accent
  const getLeftEdgeColor = () => {
    if (statusIndicator === 'active') return '#22c55e'; // green-500
    if (statusIndicator === 'break') return '#f59e0b'; // amber-500
    if (statusIndicator === 'modified') return '#f59e0b'; // amber-500
    if (accentColor) return accentColor;
    return undefined;
  };

  const leftColor = getLeftEdgeColor();
  const hasBreak = showBreakIndicator && shiftHasBreak(startTime, endTime);

  // Hours badge color
  const getHoursBadgeColor = () => {
    if (statusIndicator === 'break') return 'bg-amber-500';
    if (statusIndicator === 'active') return 'bg-green-500';
    return 'bg-muted-foreground';
  };

  return (
    <div
      className={cn(
        "flex rounded-lg bg-card shadow-neumorphic cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden relative",
        isPublished 
          ? 'border border-border/30' 
          : 'opacity-70 border-[3px] border-dashed border-border/70 grayscale-[30%]'
      )}
      onClick={onClick}
    >
      {/* Corner hours badge */}
      {hoursWorked !== undefined && hoursWorked > 0 && (
        <div className={cn(
          "absolute top-0 right-0 px-2 py-1 text-[11px] font-bold text-white rounded-bl-lg z-10",
          getHoursBadgeColor()
        )}>
          {hoursWorked.toFixed(1)}h
        </div>
      )}

      {/* Left color edge */}
      {leftColor && (
        <div 
          className="w-1 shrink-0" 
          style={{ backgroundColor: leftColor }}
        />
      )}
      
      <div className="flex-1 px-3 py-2.5 flex items-center">
        <div className="flex items-center gap-3 w-full">
          {/* Avatar with status dot */}
          <div className="relative shrink-0">
            <Avatar className="h-9 w-9">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback>{name.charAt(0)}</AvatarFallback>
            </Avatar>
            {statusIndicator === 'break' && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 border-2 border-background" title="On Break" />
            )}
            {statusIndicator === 'active' && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background animate-pulse" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            {/* Name row */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold truncate">{name}</span>
            </div>
            
            {/* Scheduled time with inline position (for Today view) */}
            {clockInTime && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                {scheduledStart && scheduledEnd ? (
                  <span>
                    {formatTime12Hour(scheduledStart)} - {formatTime12Hour(scheduledEnd)}
                    {positionLabel && (
                      <span style={{ color: positionColor || undefined }}> · {positionLabel}</span>
                    )}
                  </span>
                ) : (
                  <span>
                    Not Scheduled
                    {positionLabel && (
                      <span style={{ color: positionColor || undefined }}> · {positionLabel}</span>
                    )}
                  </span>
                )}
              </div>
            )}
            
            {/* Time display - either punch times or shift times */}
            {clockInTime && timezone && formatTimeFn ? (
              <>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">In: <span className="text-foreground font-medium">{formatTimeFn(clockInTime, timezone)}</span></span>
                  {clockOutTime && (
                    <span className="text-muted-foreground">Out: <span className="text-foreground font-medium">{formatTimeFn(clockOutTime, timezone)}</span></span>
                  )}
                </div>
                
                {breakStartTime && (
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className={`whitespace-nowrap ${!breakEndTime ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                      {!breakEndTime ? 'On Break:' : 'Break:'} <span className="text-foreground font-medium">{formatTimeFn(breakStartTime, timezone)}</span>
                    </span>
                    {breakEndTime && (
                      <span className="text-muted-foreground whitespace-nowrap">- <span className="text-foreground font-medium">{formatTimeFn(breakEndTime, timezone)}</span></span>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Schedule view - just show shift times with inline position */
              !scheduledStart && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{formatTime12Hour(startTime)} - {formatTime12Hour(endTime)}</span>
                  {positionLabel && (
                    <span style={{ color: positionColor || undefined }}>· {positionLabel}</span>
                  )}
                </div>
              )
            )}
            
            {/* Created by note */}
            {createdByName && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Pencil className="h-3 w-3" />
                <span>Entered by {createdByName}</span>
              </div>
            )}
          </div>
          
          <div className="flex flex-col items-end justify-center gap-1 shrink-0">
            {actionButton}
          </div>
        </div>
      </div>
      {/* Break corner flag badge */}
      {!actionButton && hasBreak && (
        <div 
          className="absolute bottom-0 right-0 rounded-tl-lg px-1.5 py-1 flex items-center justify-center"
          style={{ backgroundColor: leftColor || 'hsl(var(--muted-foreground))' }}
          title="30-minute unpaid break"
        >
          <Coffee className="h-3.5 w-3.5 text-white" />
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
