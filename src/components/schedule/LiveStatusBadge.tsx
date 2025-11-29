import { Button } from '@/components/ui/button';

interface LiveStatusBadgeProps {
  isPublished: boolean;
  isPublishing: boolean;
  onGoLive: () => void;
}

export function LiveStatusBadge({ isPublished, isPublishing, onGoLive }: LiveStatusBadgeProps) {
  if (isPublished) {
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

  return (
    <Button onClick={onGoLive} disabled={isPublishing}>
      {isPublishing ? 'Publishing...' : 'Go Live'}
    </Button>
  );
}