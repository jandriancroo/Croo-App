import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CalendarIcon, Pencil } from 'lucide-react';
import { BreakIndicator } from './BreakIndicator';
import { shiftHasBreak } from '@/utils/shiftUtils';
import { formatTime12Hour } from '@/lib/utils';

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

  // Status indicator styles
  const getStatusTextColor = () => {
    if (statusIndicator === 'break') return 'text-amber-600';
    if (statusIndicator === 'active') return 'text-green-600';
    return 'text-foreground';
  };

  return (
    <div
      className={`flex rounded-lg bg-card shadow-neumorphic cursor-pointer hover:bg-muted/50 transition-colors overflow-hidden ${
        isPublished 
          ? 'border border-border/30' 
          : 'opacity-70 border-[3px] border-dashed border-border/70 grayscale-[30%]'
      }`}
      onClick={onClick}
    >
      {/* Left color edge - rendered outside overflow context */}
      {leftColor && (
        <div 
          className="w-1 shrink-0" 
          style={{ backgroundColor: leftColor }}
        />
      )}
      
      <div className="flex-1 px-3 pt-2.5 pb-2 flex items-center">
        <div className="flex items-center gap-3">
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
            {/* Name row with hours */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold truncate">{name}</span>
              </div>
              {hoursWorked !== undefined && (
                <span className={`text-sm font-bold shrink-0 ${getStatusTextColor()}`}>
                  {hoursWorked.toFixed(1)}h
                </span>
              )}
            </div>
            
            {/* Scheduled time row (for Today view) */}
            {clockInTime && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
                {scheduledStart && scheduledEnd ? (
                  <span>{formatTime12Hour(scheduledStart)} - {formatTime12Hour(scheduledEnd)}</span>
                ) : (
                  <span>Not Scheduled</span>
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
              /* Schedule view - just show shift times */
              !scheduledStart && (
                <div className="text-xs text-muted-foreground">
                  {formatTime12Hour(startTime)} - {formatTime12Hour(endTime)}
                </div>
              )
            )}
            
            {/* Position badge */}
            {positionLabel && (
              <Badge 
                variant="secondary" 
                className="mt-1 text-xs"
                style={{ 
                  backgroundColor: positionColor ? `${positionColor}20` : undefined,
                  borderColor: positionColor || undefined,
                  color: positionColor || undefined
                }}
              >
                {positionLabel}
              </Badge>
            )}
            
            {/* Created by note */}
            {createdByName && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Pencil className="h-3 w-3" />
                <span>Entered by {createdByName}</span>
              </div>
            )}
          </div>
          
          {/* Action button or break indicator */}
          {actionButton}
          {!actionButton && hasBreak && (
            <BreakIndicator hasBreak={true} size="sm" />
          )}
        </div>
      </div>
    </div>
  );
}
