// TEMPORARY side-by-side model test (Oct 2026). The real request runs exactly as before and its
// answer is what the app uses. In the background, the same request goes to the candidate model and
// both answers are saved to ai_shadow_runs for Jordan to compare. Nothing the app shows changes.
// Remove once each job's model decision is made.
import { createClient } from "npm:@supabase/supabase-js@2";

export const SHADOW_MODEL = "openai/gpt-6-luna";

function outputOf(j: any): string {
  const m = j?.choices?.[0]?.message;
  const tool = m?.tool_calls?.[0]?.function?.arguments;
  return String(tool || m?.content || "");
}

async function runShadow(job: string, url: string, init: RequestInit, primary: any, primaryMs: number) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = JSON.parse(String(init.body));
  const primaryModel = body.model;
  const shadowBody = { ...body, model: SHADOW_MODEL };
  // Luna on chat-completions only accepts function tools with reasoning off; keep it off everywhere for a fair test.
  shadowBody.reasoning_effort = "none";
  const t0 = Date.now();
  let shadowOut: string | null = null, err: string | null = null, sin = null, sout = null;
  try {
    const r = await fetch(url, { ...init, body: JSON.stringify(shadowBody) });
    if (r.ok) {
      const j = await r.json();
      shadowOut = outputOf(j);
      sin = j?.usage?.prompt_tokens ?? null;
      sout = j?.usage?.completion_tokens ?? null;
    } else err = `${r.status}: ${(await r.text()).slice(0, 500)}`;
  } catch (e) { err = String(e); }
  await admin.from("ai_shadow_runs").insert({
    job, primary_model: primaryModel, shadow_model: SHADOW_MODEL,
    primary_output: outputOf(primary).slice(0, 20000), shadow_output: shadowOut?.slice(0, 20000) ?? null,
    shadow_error: err, primary_ms: primaryMs, shadow_ms: Date.now() - t0,
    primary_in: primary?.usage?.prompt_tokens ?? null, primary_out: primary?.usage?.completion_tokens ?? null,
    shadow_in: sin, shadow_out: sout,
  });
}

/** Drop-in for fetch() on a chat-completions call. Returns the real response untouched. */
export async function aiFetchWithShadow(job: string, url: string, init: RequestInit): Promise<Response> {
  const t0 = Date.now();
  const res = await fetch(url, init);
  const ms = Date.now() - t0;
  if (res.ok) {
    try {
      const primary = await res.clone().json();
      const p = runShadow(job, url, init, primary, ms).catch((e) => console.error("[ai-shadow]", job, String(e)));
      // @ts-ignore EdgeRuntime is provided by the edge runtime
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
    } catch { /* never affect the real request */ }
  }
  return res;
}
