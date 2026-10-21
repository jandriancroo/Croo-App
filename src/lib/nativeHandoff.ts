import type { Session } from '@supabase/supabase-js';
import { registerPlugin } from '@capacitor/core';
import { isWatchBridgeAvailable } from './watchBridge';

// iPhone app only: hands the signed-in person to the native side so Siri ("ask Theo…"),
// the Action Button / Control Center Theo button and the Home Screen widgets work without the
// Apple Watch pairing screen. Native trades this access token once for its OWN session and a
// read-only device token (watch-device-service native_session + issue_self); it never keeps the
// web view's refresh token. Shift managers and up only (the server decides).

interface NativeAuthPlugin {
  nativeHandoff(options: { accessToken: string; userId: string }): Promise<{ ok: boolean; reason?: string }>;
  nativeSignOut(): Promise<{ ok: boolean }>;
}

const native = registerPlugin<NativeAuthPlugin>('WatchBridge');
let lastUserId: string | null = null;

export async function syncNativeSession(session: Session | null) {
  if (!isWatchBridgeAvailable() || !session?.access_token || !session.user?.id) return;
  if (lastUserId === session.user.id) return; // once per app launch per person; native skips if already set up
  lastUserId = session.user.id;
  try {
    const res = await native.nativeHandoff({ accessToken: session.access_token, userId: session.user.id });
    console.log('[NativeAuth] handoff', res);
  } catch (e) {
    console.log('[NativeAuth] handoff unavailable (older app build?)', e);
  }
}

export async function clearNativeSession() {
  lastUserId = null;
  if (!isWatchBridgeAvailable()) return;
  try {
    await native.nativeSignOut();
  } catch {
    /* older app build */
  }
}
