// Opt-in streaming for TYPED CHAT only (request body stream: true AND source "chat").
// The handler runs exactly as it does without streaming and still returns its normal JSON
// Response. This bridge only decides how that answer reaches the browser:
// - no text streamed yet when the handler finishes -> its Response is returned as-is (plain JSON);
// - text streamed -> an SSE response: `delta` events, then one `done` event carrying the SAME JSON
//   body the handler returned (or one `error` event if the handler ended in an error).

export type Streamer = { delta(text: string): void; started(): boolean };

/** Pure: may this AI round stream its text to the chat bubble? Plain answers only. */
export function streamEligible(x: {
  streamer: boolean; source: unknown; anyPending: boolean; dryRun: boolean; bakeoff: boolean; opus: boolean;
  pick: unknown; listContext: unknown; liveProposal: unknown; screen: unknown; cancelPending: boolean; declineLine: unknown;
}): boolean {
  return x.streamer && x.source === "chat" && !x.anyPending && !x.dryRun && !x.bakeoff && !x.opus
    && !x.pick && !x.listContext && !x.liveProposal && !x.screen && !x.cancelPending && !x.declineLine;
}

/** Pure: should this request even try the streaming bridge? */
export function wantsStream(body: any): boolean {
  return !!body && body.stream === true && body.source === "chat";
}

export async function bridge(run: (s: Streamer) => Promise<Response>, headers: Record<string, string>): Promise<Response> {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  const write = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  let started = false;
  let markFirst!: () => void;
  const first = new Promise<void>((r) => { markFirst = r; });
  const s: Streamer = {
    delta(text: string) {
      if (!text) return;
      if (!started) { started = true; markFirst(); }
      write("delta", { text });
    },
    started: () => started,
  };
  const done = run(s).catch((e) => new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...headers, "Content-Type": "application/json" } }));
  const winner = await Promise.race([done.then((r) => ({ r })), first.then(() => null)]);
  if (winner && !started) return winner.r; // nothing streamed: the normal JSON response, untouched
  done.then(async (r) => {
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { error: "Bad response" }; }
    if (r.ok && !json?.error) write("done", json);
    else write("error", { status: r.status, ...(json && typeof json === "object" ? json : {}) });
  }).catch(() => write("error", { status: 500, error: "Stream failed" }))
    .finally(() => { try { ctrl.close(); } catch { /* closed */ } });
  return new Response(body, { headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

/**
 * Reads a streamed chat-completions response into the same shape as a non-streamed one
 * ({ choices: [{ message, finish_reason }], usage }). Text is passed to onDelta only while no
 * tool call has appeared in this round.
 */
export async function readStreamedRound(resp: Response, onDelta: (t: string) => void): Promise<any> {
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let finish: string | null = null;
  let usage: any = undefined;
  const tools: any[] = [];
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    const j = JSON.parse(payload);
    if (j.usage) usage = j.usage;
    const ch = j.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) finish = ch.finish_reason;
    const d = ch.delta || {};
    for (const t of d.tool_calls || []) {
      const i = typeof t.index === "number" ? t.index : tools.length;
      tools[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
      if (t.id) tools[i].id = t.id;
      if (t.function?.name) tools[i].function.name += t.function.name;
      if (t.function?.arguments) tools[i].function.arguments += t.function.arguments;
    }
    if (typeof d.content === "string" && d.content) {
      content += d.content;
      if (!tools.length) onDelta(d.content);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, nl).replace(/\r$/, "")); buf = buf.slice(nl + 1); }
  }
  if (buf.trim()) handle(buf.trim());
  const toolCalls = tools.filter(Boolean);
  const message: any = { role: "assistant", content: content || null };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return { choices: [{ message, finish_reason: finish }], usage };
}
