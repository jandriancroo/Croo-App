import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

declare const __APP_VERSION__: string;

// Get current app version from build
export function getCurrentAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
}

// Fetch the latest version from any user who has the newest version
async function fetchLatestKnownVersion(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('app_version')
      .not('app_version', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(50);
    
    if (!data || data.length === 0) return null;
    
    // Find the highest version number
    const versions = data
      .map(p => p.app_version)
      .filter((v): v is string => v !== null && v !== 'unknown');
    
    if (versions.length === 0) return null;
    
    // Sort versions descending (assuming format like "1.0.0" or timestamp-based)
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions[0];
  } catch (error) {
    console.error('[ForceReload] Error fetching latest version:', error);
    return null;
  }
}

export function useForceReload() {
  const { user } = useAuth();

  const checkForUpdates = useCallback(async () => {
    const currentVersion = getCurrentAppVersion();
    if (currentVersion === 'unknown') return;

    const latestVersion = await fetchLatestKnownVersion();
    if (!latestVersion) return;

    // If our version is older than the latest known version, reload
    if (currentVersion.localeCompare(latestVersion, undefined, { numeric: true }) < 0) {
      console.log(`[ForceReload] Outdated version detected (${currentVersion} < ${latestVersion}), reloading...`);
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    // Subscribe to personal channel for force-reload signals (keep for manual triggers)
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
        const version = getCurrentAppVersion();
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

    // Check for updates when page becomes visible (user returns to tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[ForceReload] Tab became visible, checking for updates...');
        checkForUpdates();
      }
    };

    // Check for updates when window gains focus
    const handleFocus = () => {
      console.log('[ForceReload] Window focused, checking for updates...');
      checkForUpdates();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user, checkForUpdates]);
}

// Function to trigger force reload for a specific user (kept for manual use)
export async function triggerForceReload(userId: string) {
  const channel = supabase.channel(`user-updates:${userId}`);
  await channel.send({
    type: 'broadcast',
    event: 'force-reload',
    payload: {}
  });
  await supabase.removeChannel(channel);
}
