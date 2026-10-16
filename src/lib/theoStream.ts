// Typed-chat Theo streaming (opt-in). Same auth as supabase.functions.invoke: the user's
// session token + the publishable apikey. If the server answers with plain JSON, that JSON is
// returned unchanged; if it streams, deltas go to onDelta and the `done` JSON is returned.
import { supabase } from '@/integrations/supabase/client';

export class TheoStreamError extends Error {
  /** true = nothing usable arrived; caller should retry once via functions.invoke. */
  retry: boolean;
  constructor(msg: string, retry: boolean) { super(msg); this.retry = retry; }
}

/** Parses SSE text into events. Returns parsed events and the unfinished remainder. */
export function parseSse(buf: string): { events: { event: string; data: any }[]; rest: string } {
  const events: { event: string; data: any }[] = [];
  const norm = buf.replace(/\r\n/g, '\n');
  const parts = norm.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    try { events.push({ event, data: JSON.parse(data.join('\n')) }); } catch { /* skip bad block */ }
  }
  return { events, rest };
}

export async function askTheoStream(body: Record<string, unknown>, onDelta: (text: string) => void): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assistant?forceFunctionRegion=eu-west-2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-region': 'eu-west-2',
        apikey: key,
        Authorization: `Bearer ${session?.access_token ?? key}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch (e: any) {
    throw new TheoStreamError(e?.message || 'network', true);
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/event-stream')) {
    // Plain JSON: same as the normal path. Non-2xx behaves like functions.invoke's error (no retry).
    if (!res.ok) throw new TheoStreamError(`HTTP ${res.status}`, false);
    return res.json();
  }
  if (!res.body) throw new TheoStreamError('no body', true);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = parseSse(buf);
      buf = rest;
      for (const ev of events) {
        if (ev.event === 'delta' && typeof ev.data?.text === 'string') onDelta(ev.data.text);
        else if (ev.event === 'done') return ev.data;
        else if (ev.event === 'error') throw new TheoStreamError(ev.data?.error || 'stream error', true);
      }
    }
  } catch (e: any) {
    if (e instanceof TheoStreamError) throw e;
    throw new TheoStreamError(e?.message || 'stream broke', true);
  }
  throw new TheoStreamError('stream ended before done', true);
}
