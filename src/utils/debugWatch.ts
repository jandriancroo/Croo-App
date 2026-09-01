import { serverDebugLog } from './serverDebugLog';

/**
 * Temporary 48-hour diagnostic window for two South Meadows / Sparks users
 * who report photo upload + app-open problems on older iPhones.
 *
 * Everything here is a no-op once WATCH_UNTIL passes, and a no-op for every
 * other user. Safe to delete after the window closes.
 */
const WATCH_UNTIL = Date.parse('2026-09-03T22:30:00Z'); // 48h from Sep 1 2026 3:30pm PT

const WATCHED_USER_IDS = new Set<string>([
  'e21aba60-2a4a-4cad-98cc-fe7476689f54', // Ashley Reese
  '3eb1371f-e27c-48b4-8675-465e5172a2b1', // Jose Castaneda
]);

let currentUserId: string | null = null;

export function setDebugWatchUser(userId: string | null | undefined) {
  currentUserId = userId ?? null;
}

export function isDebugWatched(): boolean {
  if (!currentUserId) return false;
  if (Date.now() > WATCH_UNTIL) return false;
  return WATCHED_USER_IDS.has(currentUserId);
}

function parseIOSVersion(ua: string): string | null {
  const m = ua.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/);
  if (!m) return null;
  return [m[1], m[2], m[3]].filter(Boolean).join('.');
}

function parseSafariVersion(ua: string): string | null {
  const m = ua.match(/Version\/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

function deviceSnapshot() {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  const ua: string = nav.userAgent ?? '';
  return {
    cores: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    standalone:
      typeof window !== 'undefined'
        ? (window.matchMedia?.('(display-mode: standalone)')?.matches ?? false) ||
          (nav as any).standalone === true
        : null,
    online: nav.onLine ?? null,
    connection: nav.connection?.effectiveType ?? null,
    downlink: nav.connection?.downlink ?? null,
    rtt: nav.connection?.rtt ?? null,
    saveData: nav.connection?.saveData ?? null,
    screen:
      typeof window !== 'undefined'
        ? `${window.screen?.width}x${window.screen?.height}@${window.devicePixelRatio}`
        : null,
    iosVersion: parseIOSVersion(ua),
    safariVersion: parseSafariVersion(ua),
    platform: nav.platform ?? null,
    maxTouchPoints: nav.maxTouchPoints ?? null,
    lowPowerHint: nav.deviceMemory != null && nav.deviceMemory <= 4 ? true : null,
  };
}

/** Heavier one-time profile: full UA, storage quota, memory pressure, feature support. */
export async function debugWatchDeviceProfile(extra: Record<string, any> = {}) {
  if (!isDebugWatched()) return;
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
  let storage: Record<string, any> | null = null;
  try {
    if (nav.storage?.estimate) {
      const est = await nav.storage.estimate();
      storage = {
        quotaMB: est.quota ? Math.round(est.quota / 1048576) : null,
        usageMB: est.usage ? Math.round(est.usage / 1048576) : null,
      };
    }
  } catch {
    /* ignore */
  }
  const perfMem = (performance as any)?.memory;
  debugWatchLog('device_profile', {
    userAgent: (nav.userAgent ?? '').slice(0, 400),
    language: nav.language ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    storage,
    jsHeapLimitMB: perfMem?.jsHeapSizeLimit ? Math.round(perfMem.jsHeapSizeLimit / 1048576) : null,
    jsHeapUsedMB: perfMem?.usedJSHeapSize ? Math.round(perfMem.usedJSHeapSize / 1048576) : null,
    supports: {
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      createImageBitmap: typeof createImageBitmap !== 'undefined',
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      webp:
        typeof document !== 'undefined'
          ? document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
          : null,
      heicInput: nav.userAgent?.includes('iPhone') ?? false,
    },
    ...extra,
  });
}

/** Fire-and-forget log, only for the watched users inside the window. */
export function debugWatchLog(tag: string, payload: Record<string, any> = {}) {
  if (!isDebugWatched()) return;
  serverDebugLog(`watch48:${tag}`, {
    userId: currentUserId,
    payload: { ...deviceSnapshot(), ...payload },
  });
}
