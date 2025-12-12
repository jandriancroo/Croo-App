import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface LiveStatusBadgeProps {
  isPublished: boolean;
  isPublishing: boolean;
  hasPendingChanges: boolean;
  onGoLive: () => void;
  onUpdate: () => void;
}

export function LiveStatusBadge({ 
  isPublished, 
  isPublishing, 
  hasPendingChanges,
  onGoLive,
  onUpdate
}: LiveStatusBadgeProps) {
  // State 1: Never published - show "Go Live" button
  if (!isPublished) {
    return (
      <Button onClick={onGoLive} disabled={isPublishing}>
        {isPublishing ? 'Publishing...' : 'Go Live'}
      </Button>
    );
  }

  // State 2: Published with pending changes - show "Update" button
  if (hasPendingChanges) {
    return (
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
            Update
          </>
        )}
      </Button>
    );
  }

  // State 3: Published with no changes - show "LIVE" badge
  return (
    <div className="relative inline-flex items-center gap-2 px-4 py-2 bg-red-500/10 border-2 border-red-500 rounded-lg">
      <span className="relative flex items-end gap-[2px] h-4">
        <span className="w-1 bg-red-500 rounded-sm animate-wifi-bar-1" style={{ height: '25%' }}></span>
        <span className="w-1 bg-red-500 rounded-sm animate-wifi-bar-2" style={{ height: '50%' }}></span>
        <span className="w-1 bg-red-500 rounded-sm animate-wifi-bar-3" style={{ height: '75%' }}></span>
        <span className="w-1 bg-red-500 rounded-sm animate-wifi-bar-4" style={{ height: '100%' }}></span>
      </span>
      <span className="font-semibold text-red-500 uppercase tracking-wide">Live</span>
    </div>
  );
}
