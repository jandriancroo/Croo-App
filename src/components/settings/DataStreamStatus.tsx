import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Wifi, WifiOff, Radio } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function DataStreamStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ['stream-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kds_stream_events')
        .select('id, event_type, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const hasEvents = data && data.length > 0;
  const latestEvent = hasEvents ? data[0] : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Qu Data Streaming webhook status
      </p>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        {/* Status indicator */}
        <div className="flex items-center gap-3">
          {isLoading ? (
            <Radio className="h-5 w-5 text-muted-foreground animate-pulse" />
          ) : hasEvents ? (
            <Wifi className="h-5 w-5 text-emerald-500" />
          ) : (
            <WifiOff className="h-5 w-5 text-amber-500" />
          )}
          <div>
            <p className="text-sm font-semibold">
              {isLoading
                ? 'Checking...'
                : hasEvents
                  ? 'Stream Active'
                  : 'Waiting for Data'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {isLoading
                ? ''
                : hasEvents
                  ? `Last event ${formatDistanceToNow(new Date(latestEvent!.created_at), { addSuffix: true })}`
                  : 'No webhook events received yet — Qu needs to enable the subscription'}
            </p>
          </div>
        </div>

        {/* Recent events */}
        {hasEvents && (
          <div className="space-y-1.5 pt-2 border-t border-border">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Recent Events</p>
            {data.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between text-xs">
                <span className="font-mono text-foreground">{evt.event_type}</span>
                <span className="text-muted-foreground">
                  {formatDistanceToNow(new Date(evt.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Endpoint info */}
        <div className="pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            Endpoint: <span className="font-mono text-[10px]">kds-stream</span> · Polling every 30s
          </p>
        </div>
      </div>
    </div>
  );
}
