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

function deviceSnapshot() {
  const nav: any = typeof navigator !== 'undefined' ? navigator : {};
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
    screen:
      typeof window !== 'undefined'
        ? `${window.screen?.width}x${window.screen?.height}@${window.devicePixelRatio}`
        : null,
  };
}

/** Fire-and-forget log, only for the watched users inside the window. */
export function debugWatchLog(tag: string, payload: Record<string, any> = {}) {
  if (!isDebugWatched()) return;
  serverDebugLog(`watch48:${tag}`, {
    userId: currentUserId,
    payload: { ...deviceSnapshot(), ...payload },
  });
}
