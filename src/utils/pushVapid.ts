/**
 * Single source of truth for the web-push VAPID public key.
 *
 * Hardcoding this key in multiple components caused subscriptions to be created
 * with a key the server does not sign with, which push services reject with
 * `VapidPkHashMismatch`. Everything now resolves the key from the backend so the
 * browser always subscribes with exactly the key `send-push-notification` uses.
 */
import { supabase } from '@/integrations/supabase/client';

// Fallback used only if the key endpoint is unreachable (offline / cold start).
const FALLBACK_VAPID_PUBLIC_KEY =
  'BMFAfiqavc1nPrnxT3UlNQ7QmxL3bZYpzbgmQiXs3WL0jcDEKMX-6VTVLeGodW2XVCfmaQTsbdCwkjXutsVXzKU';

let cached: Promise<string> | null = null;

export function getVapidPublicKey(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('push-vapid-key');
        if (error) throw error;
        const key = (data as { publicKey?: string } | null)?.publicKey;
        if (key) return key;
        throw new Error('No publicKey returned');
      } catch (err) {
        console.warn('[Push] Could not fetch VAPID key, using fallback', err);
        cached = null; // allow a retry on the next call
        return FALLBACK_VAPID_PUBLIC_KEY;
      }
    })();
  }
  return cached;
}

export const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Returns a push subscription that is guaranteed to use `vapidPublicKey`.
 * If an existing subscription was created with a different application server
 * key (e.g. a rotated or mistyped key) it is unsubscribed and recreated —
 * otherwise the browser would keep a subscription the server can never deliver to.
 */
export async function ensureSubscriptionForKey(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string
): Promise<{ subscription: PushSubscription; staleEndpoint: string | null }> {
  const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
  let staleEndpoint: string | null = null;

  const existing = await registration.pushManager.getSubscription();

  if (existing) {
    const existingKey = existing.options?.applicationServerKey;
    const matches =
      !!existingKey && bytesEqual(new Uint8Array(existingKey), keyBytes);

    if (matches) {
      return { subscription: existing, staleEndpoint: null };
    }

    console.warn('[Push] Existing subscription uses a different VAPID key — resubscribing');
    staleEndpoint = existing.endpoint;
    try {
      await existing.unsubscribe();
    } catch (err) {
      console.warn('[Push] Failed to unsubscribe stale subscription', err);
    }
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes as BufferSource,
  });

  return { subscription, staleEndpoint };
}
