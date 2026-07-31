import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface LiveStatusBadgeProps {
  isPublished: boolean;
  isPublishing: boolean;
  hasPendingChanges: boolean;
  pendingCount?: number;
  onGoLive: () => void;
  onUpdate: () => void;
  lastStatusChangedAt?: string | null;
  lastStatusChangedByName?: string | null;
  lastStatusAction?: string | null;
}

export function LiveStatusBadge({ 
  isPublished, 
  isPublishing, 
  hasPendingChanges,
  pendingCount = 0,
  onGoLive,
  onUpdate,
  lastStatusChangedAt,
  lastStatusChangedByName,
  lastStatusAction
}: LiveStatusBadgeProps) {
  
  // Format the status info for tooltip
  const getStatusInfo = () => {
    if (!lastStatusChangedAt || !lastStatusAction) return null;
    
    const timeAgo = formatDistanceToNow(new Date(lastStatusChangedAt), { addSuffix: true });
    const actionLabel = lastStatusAction === 'published' ? 'Published' 
      : lastStatusAction === 'updated' ? 'Updated'
      : lastStatusAction === 'withdrawn' ? 'Withdrawn'
      : lastStatusAction;
    
    const byName = lastStatusChangedByName || 'Unknown';
    
    return { timeAgo, actionLabel, byName };
  };

  const statusInfo = getStatusInfo();
  
  // State 1: Never published - show "Go Live" button
  if (!isPublished) {
    // If it was withdrawn, show who did it
    if (statusInfo && lastStatusAction === 'withdrawn') {
      return (
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground hidden md:inline">
                Withdrawn by {statusInfo.byName}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{statusInfo.actionLabel} {statusInfo.timeAgo}</p>
            </TooltipContent>
          </Tooltip>
          <Button onClick={onGoLive} disabled={isPublishing}>
            {isPublishing ? 'Posting...' : 'Post'}
          </Button>
        </div>
      );
    }
    
    return (
      <Button onClick={onGoLive} disabled={isPublishing}>
        {isPublishing ? 'Posting...' : 'Post'}
      </Button>
    );
  }

  // State 2: Published with pending changes - show "Update" button
  if (hasPendingChanges) {
    return (
      <div className="flex items-center gap-2">
        {statusInfo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground hidden md:inline">
                {statusInfo.actionLabel} by {statusInfo.byName}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{statusInfo.timeAgo}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Button 
          onClick={onUpdate} 
          disabled={isPublishing}
          variant="outline"
          className="border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
        >
          {isPublishing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Updating...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Update{pendingCount > 0 ? ` · ${pendingCount}` : ''}
            </>
          )}
        </Button>
      </div>
    );
  }

  // State 3: Published with no changes - show "LIVE" badge with status info
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="relative inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border-2 border-red-500 rounded-md">
        <span className="relative flex items-end gap-[2px] h-3">
          <span className="w-[3px] bg-red-500 rounded-sm animate-wifi-bar-1" style={{ height: '25%' }}></span>
          <span className="w-[3px] bg-red-500 rounded-sm animate-wifi-bar-2" style={{ height: '50%' }}></span>
          <span className="w-[3px] bg-red-500 rounded-sm animate-wifi-bar-3" style={{ height: '75%' }}></span>
          <span className="w-[3px] bg-red-500 rounded-sm animate-wifi-bar-4" style={{ height: '100%' }}></span>
        </span>
        <span className="font-semibold text-red-500 uppercase tracking-wide text-xs">Live</span>
      </div>
      {statusInfo && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-muted-foreground hidden md:inline leading-none">
              {statusInfo.actionLabel} by {statusInfo.byName}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{statusInfo.timeAgo}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

