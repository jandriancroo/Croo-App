import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

declare const __APP_VERSION__: string;

export function useForceReload() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // Subscribe to personal channel for force-reload signals
    const channel = supabase
      .channel(`user-updates:${user.id}`)
      .on('broadcast', { event: 'force-reload' }, () => {
        console.log('[ForceReload] Received reload signal, refreshing...');
        window.location.reload();
      })
      .subscribe();

    // Report current app version to profile
    const reportVersion = async () => {
      try {
        const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
        await supabase
          .from('profiles')
          .update({ app_version: version })
          .eq('id', user.id);
        console.log('[ForceReload] Reported app version:', version);
      } catch (error) {
        console.error('[ForceReload] Error reporting version:', error);
      }
    };

    reportVersion();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);
}

// Function to trigger force reload for a specific user
export async function triggerForceReload(userId: string) {
  const channel = supabase.channel(`user-updates:${userId}`);
  await channel.send({
    type: 'broadcast',
    event: 'force-reload',
    payload: {}
  });
  await supabase.removeChannel(channel);
}

// Function to get current app version
export function getCurrentAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
}
