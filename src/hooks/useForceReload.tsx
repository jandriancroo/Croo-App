import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { subscribeUniversalUpdate } from '@/lib/universalUpdate';

declare const __APP_VERSION__: string;

// Get current app version from build
export function getCurrentAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
}

// Fetch the latest version - simplified query
async function fetchLatestKnownVersion(): Promise<string | null> {
  try {
    // Only fetch 10 most recent, not 50
    const { data } = await supabase
      .from('profiles')
      .select('app_version')
      .not('app_version', 'is', null)
      .not('app_version', 'eq', 'unknown')
      .order('updated_at', { ascending: false })
      .limit(10);
    
    if (!data || data.length === 0) return null;
    
    const versions = data
      .map(p => p.app_version)
      .filter((v): v is string => v !== null);
    
    if (versions.length === 0) return null;
    
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions[0];
  } catch (error) {
    console.error('[ForceReload] Error fetching latest version:', error);
    return null;
  }
}

export function useForceReload() {
  const { user } = useAuth();
  const hasReportedVersion = useRef(false);
  const lastCheckTime = useRef(0);

  const checkForUpdates = useCallback(async () => {
    // Throttle checks to once per 60 seconds
    const now = Date.now();
    if (now - lastCheckTime.current < 60000) return;
    lastCheckTime.current = now;

    const currentVersion = getCurrentAppVersion();
    if (currentVersion === 'unknown') return;

    const latestVersion = await fetchLatestKnownVersion();
    if (!latestVersion) return;

    if (currentVersion.localeCompare(latestVersion, undefined, { numeric: true }) < 0) {
      console.log(`[ForceReload] Outdated version detected (${currentVersion} < ${latestVersion}), reloading...`);
      window.location.reload();
    }
  }, []);

  // Universal update: one public channel every client listens on, signed in or
  // not, so a single button can refresh the whole company.
  useEffect(() => {
    // Punch-clock tablets handle the same signal themselves so a reload can
    // never land mid-punch.
    if (window.location.pathname.startsWith('/punch-clock')) return;
    return subscribeUniversalUpdate(() => {
      console.log('[ForceReload] Universal update received, reloading...');
      window.location.reload();
    });
  }, []);

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

    // Report version ONCE per session using sessionStorage
    const sessionKey = `version_reported_${user.id}`;
    if (!hasReportedVersion.current && !sessionStorage.getItem(sessionKey)) {
      hasReportedVersion.current = true;
      sessionStorage.setItem(sessionKey, 'true');
      
      const version = getCurrentAppVersion();
      (async () => {
        try {
          await supabase
            .from('profiles')
            .update({ app_version: version })
            .eq('id', user.id);
          console.log('[ForceReload] Reported app version:', version);
        } catch (err) {
          console.error('[ForceReload] Error reporting version:', err);
        }
      })();
    }

    // Check for updates on visibility change (after 2 min absence, not 30s)
    let lastActiveTime = Date.now();
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastActiveTime = Date.now();
      } else if (document.visibilityState === 'visible') {
        const timeSinceActive = Date.now() - lastActiveTime;
        // Only check after 2 minutes of absence (was 30 seconds)
        if (timeSinceActive > 120000) {
          console.log('[ForceReload] Tab became visible after extended absence, checking for updates...');
          checkForUpdates();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, checkForUpdates]);
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
