import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isWarmPing } from "./warm.ts";

const post = (body: string) => new Request("http://x", { method: "POST", body });

Deno.test("only the exact {\"warm\": true} body is a warm ping", async () => {
  assertEquals(await isWarmPing(post('{"warm": true}')), true);
  for (const b of ['{"warm":true,"messages":[]}', '{"warm":"true"}', '{"warm":1}', '[]', 'null', '', 'nope', '{"action":"search"}']) {
    assertEquals(await isWarmPing(post(b)), false, b);
  }
  assertEquals(await isWarmPing(new Request("http://x", { method: "GET" })), false);
});
