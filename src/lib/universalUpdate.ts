/**
 * Universal update broadcast.
 *
 * ONE public channel every CrooHQ client listens on — staff phones, office
 * browsers, punch-clock tablets and watch devices. Sending on it tells every
 * connected client to reload onto the published build.
 *
 * Punch-clock tablets deliberately ignore the signal while someone is mid-punch
 * (see PunchClock.tsx) — a reload must never eat a punch.
 */
import { supabase } from '@/integrations/supabase/client';

export const UNIVERSAL_UPDATE_CHANNEL = 'croohq-universal-update';
export const UNIVERSAL_UPDATE_EVENT = 'reload';

/** Broadcast a reload signal to every connected client. */
export async function broadcastUniversalUpdate(): Promise<void> {
  const channel = supabase.channel(UNIVERSAL_UPDATE_CHANNEL);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve();
    });
    // Never hang the button on a flaky socket.
    window.setTimeout(resolve, 4000);
  });
  await channel.send({
    type: 'broadcast',
    event: UNIVERSAL_UPDATE_EVENT,
    payload: { at: new Date().toISOString() },
  });
  await supabase.removeChannel(channel);
}

/**
 * Listen for the universal update signal. Returns an unsubscribe function.
 * `handler` decides how/when to reload (kiosks defer until idle).
 */
export function subscribeUniversalUpdate(handler: () => void): () => void {
  const channel = supabase
    .channel(UNIVERSAL_UPDATE_CHANNEL)
    .on('broadcast', { event: UNIVERSAL_UPDATE_EVENT }, () => handler())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
