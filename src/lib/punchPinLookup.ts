/**
 * Punch clock PIN lookup result, from punch_clock_device_lookup_pin.
 * The server checks the paired device, uses the device's own store, counts
 * misses per device and per store, and logs the attempt without the PIN.
 * Never log or store the typed PIN on the client.
 */
export type PinLookupMatch = { id: string; full_name: string | null; profile_photo_url: string | null };

export type PinLookupResult =
  | { status: 'ok'; match: PinLookupMatch }
  | { status: 'miss' }
  | { status: 'locked'; retryAfterSeconds: number }
  | { status: 'not_paired' }
  | { status: 'error' };

export function parsePinLookup(data: unknown): PinLookupResult {
  const r = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null;
  const status = typeof r?.status === 'string' ? r.status : null;
  if (status === 'ok' && typeof r?.id === 'string' && r.id) {
    return {
      status: 'ok',
      match: {
        id: r.id,
        full_name: typeof r.full_name === 'string' ? r.full_name : null,
        profile_photo_url: typeof r.profile_photo_url === 'string' ? r.profile_photo_url : null,
      },
    };
  }
  if (status === 'miss') return { status: 'miss' };
  if (status === 'locked') {
    const n = Number(r?.retry_after_seconds);
    return { status: 'locked', retryAfterSeconds: Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60 };
  }
  if (status === 'not_paired') return { status: 'not_paired' };
  return { status: 'error' };
}

/** "Too many tries. Wait 2 min." / "Wait 45 sec." — rounded up, never 0. */
export function lockoutMessage(secondsLeft: number): string {
  const s = Math.max(1, Math.ceil(secondsLeft));
  if (s >= 60) return `Too many tries. Wait ${Math.ceil(s / 60)} min.`;
  return `Too many tries. Wait ${s} sec.`;
}

/** Seconds left on a lockout that ends at `untilMs`; 0 once it's over. */
export function lockoutSecondsLeft(untilMs: number | null, nowMs: number = Date.now()): number {
  if (!untilMs) return 0;
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}
