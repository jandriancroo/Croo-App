import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Local copy of requireInternalCaller from ../_shared/callerAuth.ts (no supabase import).
// Kept in lockstep by the source assertion below.
const SERVICE_ROLE_KEY = "test-service-role-key";
const CRON_SECRET = "test-cron-secret";
const cors = { "Content-Type": "application/json" };

function requireInternalCaller(req: Request, corsHeaders: Record<string, string>): Response | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const providedCronSecret = req.headers.get("x-cron-secret");
  const isService = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
  const isCron = !!CRON_SECRET && providedCronSecret === CRON_SECRET;
  if (isService || isCron) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function req(headers: Record<string, string> = {}) {
  return new Request("https://example.test/toast-session-check", { method: "POST", headers, body: '{"action":"check"}' });
}

Deno.test("shared requireInternalCaller still only allows service role bearer or x-cron-secret", () => {
  const src = Deno.readTextFileSync(new URL("../_shared/callerAuth.ts", import.meta.url));
  const start = src.indexOf("export function requireInternalCaller");
  assert(start >= 0);
  const fn = src.slice(start, src.indexOf("export async function authorizeCaller", start));
  assert(fn.includes("SERVICE_ROLE_KEY") && fn.includes("bearer === SERVICE_ROLE_KEY"));
  assert(fn.includes("x-cron-secret") && fn.includes("CRON_SECRET"));
  assert(!fn.includes("getUser("), "must not accept an end-user JWT");
  const index = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  assert(index.includes("requireInternalCaller(req, cors)"));
  assert(!index.includes("authorizeCaller("), "must not use the user-JWT path");
});

Deno.test("no Authorization and no cron secret is 401", () => {
  const res = requireInternalCaller(req(), cors);
  assert(res instanceof Response);
  assertEquals(res.status, 401);
});

Deno.test("anon / public apikey bearer is 401", () => {
  const res = requireInternalCaller(req({ Authorization: "Bearer test-anon-key", apikey: "test-anon-key" }), cors);
  assert(res instanceof Response);
  assertEquals(res.status, 401);
});

Deno.test("signed-out empty bearer is 401", () => {
  const res = requireInternalCaller(req({ Authorization: "Bearer " }), cors);
  assert(res instanceof Response);
  assertEquals(res.status, 401);
});

Deno.test("end-user JWT that is not the service role is 401", () => {
  const res = requireInternalCaller(req({ Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.not-a-real-user" }), cors);
  assert(res instanceof Response);
  assertEquals(res.status, 401);
});

Deno.test("service role bearer is allowed (cron_edge_headers path)", () => {
  assertEquals(requireInternalCaller(req({ Authorization: "Bearer test-service-role-key" }), cors), null);
});

Deno.test("x-cron-secret is allowed", () => {
  assertEquals(requireInternalCaller(req({ "x-cron-secret": "test-cron-secret" }), cors), null);
});

Deno.test("wrong cron secret is 401", () => {
  const res = requireInternalCaller(req({ "x-cron-secret": "nope" }), cors);
  assert(res instanceof Response);
  assertEquals(res.status, 401);
});
