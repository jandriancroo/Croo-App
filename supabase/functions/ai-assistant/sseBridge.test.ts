import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bridge, readStreamedRound, streamEligible, wantsStream } from "./sseBridge.ts";

const base = { streamer: true, source: "chat", anyPending: false, dryRun: false, bakeoff: false, opus: false, pick: undefined, listContext: undefined, liveProposal: null, screen: null, cancelPending: false, declineLine: null };

Deno.test("eligibility: plain typed chat only", () => {
  assertEquals(streamEligible(base), true);
  for (const k of ["anyPending", "dryRun", "bakeoff", "opus", "cancelPending"]) assertEquals(streamEligible({ ...base, [k]: true }), false, k);
  for (const k of ["pick", "listContext", "liveProposal", "screen", "declineLine"]) assertEquals(streamEligible({ ...base, [k]: { x: 1 } }), false, k);
  assertEquals(streamEligible({ ...base, source: "voice" }), false);
  assertEquals(streamEligible({ ...base, streamer: false }), false);
  assertEquals(wantsStream({ stream: true, source: "chat" }), true);
  assertEquals(wantsStream({ stream: true, source: "voice" }), false);
  assertEquals(wantsStream({ source: "chat" }), false);
});

Deno.test("bridge: no deltas -> the handler's JSON response untouched", async () => {
  const r = await bridge(async () => new Response('{"content":"hi"}', { headers: { "Content-Type": "application/json" } }), {});
  assertEquals(r.headers.get("content-type"), "application/json");
  assertEquals(await r.text(), '{"content":"hi"}');
});

Deno.test("bridge: deltas then done with the same JSON", async () => {
  const r = await bridge(async (s) => { s.delta("He"); s.delta("llo"); return new Response(JSON.stringify({ content: "Hello", actions: { a: 1 } })); }, {});
  assertEquals(r.headers.get("content-type"), "text/event-stream");
  const t = await r.text();
  assertEquals(t, 'event: delta\ndata: {"text":"He"}\n\nevent: delta\ndata: {"text":"llo"}\n\nevent: done\ndata: {"content":"Hello","actions":{"a":1}}\n\n');
});

Deno.test("readStreamedRound: text deltas and tool calls", async () => {
  const sse = (lines: string[]) => new Response(lines.map((l) => `data: ${l}\n\n`).join(""));
  const seen: string[] = [];
  const a = await readStreamedRound(sse([JSON.stringify({ choices: [{ delta: { content: "Hi " } }] }), JSON.stringify({ choices: [{ delta: { content: "there" }, finish_reason: "stop" }] }), JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }), "[DONE]"]), (t) => seen.push(t));
  assertEquals(seen, ["Hi ", "there"]);
  assertEquals(a.choices[0].message.content, "Hi there");
  assertEquals(a.usage.prompt_tokens, 5);
  const b = await readStreamedRound(sse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "query_sales", arguments: '{"a"' } }] } }] }), JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "tool_calls" }] })]), () => { throw new Error("no text expected"); });
  assertEquals(b.choices[0].message.tool_calls, [{ id: "c1", type: "function", function: { name: "query_sales", arguments: '{"a":1}' } }]);
});
