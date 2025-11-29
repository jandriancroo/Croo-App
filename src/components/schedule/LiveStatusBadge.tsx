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
        <span className="relative flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 animate-radar-pulse"></span>
          <span className="absolute inline-flex h-full w-full rounded-full bg-gradient-to-r from-green-500 via-blue-500 to-purple-500 animate-radar-pulse" style={{ animationDelay: '0.5s' }}></span>
          <span className="absolute inline-flex h-full w-full rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 animate-radar-pulse" style={{ animationDelay: '1s' }}></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500"></span>
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