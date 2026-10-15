// Supabase hands back the existing channel when a name is reused, and adding
// a listener to an already-subscribed channel throws. Components that can be
// on screen more than once (or a hook used by several components) give each
// subscription its own name with this. Never use it for broadcast channels,
// whose name has to match the sender's.
export function uniqueChannelName(base: string): string {
  return `${base}-${Math.random().toString(36).slice(2, 10)}`;
}
