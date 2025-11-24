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
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
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