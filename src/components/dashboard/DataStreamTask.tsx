import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Radio, Wifi } from 'lucide-react';

export function DataStreamTask() {
  const { isSuperAdmin } = useUserRole();

  const { data: eventCount } = useQuery({
    queryKey: ['stream-task-status'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('kds_stream_events')
        .select('id', { count: 'exact', head: true });
      if (error) return 0;
      return count || 0;
    },
    enabled: isSuperAdmin,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  if (!isSuperAdmin) return null;

  const isLive = (eventCount ?? 0) > 0;

  return (
    <button
      className="w-full flex items-center gap-3 rounded-xl px-4 py-3 border transition-all"
      style={{
        borderColor: isLive ? '#22c55e' : 'hsl(var(--border))',
        background: isLive
          ? 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))'
          : 'hsl(var(--card))',
      }}
      onClick={() => {
        if (isLive) {
          window.location.href = '/settings';
        }
      }}
    >
      {isLive ? (
        <Wifi className="h-4 w-4 text-emerald-500 shrink-0" />
      ) : (
        <Radio className="h-4 w-4 text-amber-500 animate-pulse shrink-0" />
      )}
      <div className="flex-1 text-left">
        <p className="text-xs font-bold tracking-wide">
          {isLive ? '📡 DATA STREAMING LIVE' : '📡 Waiting for Qu Stream...'}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {isLive ? 'Webhook events flowing — ready to build' : 'No events yet — Qu needs to enable subscription'}
        </p>
      </div>
    </button>
  );
}
