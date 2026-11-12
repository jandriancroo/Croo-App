import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireInternalCaller } from "../_shared/callerAuth.ts";
import { runToastMatchDigest } from "./digest.ts";

export function createHandler(deps: { client?: () => any; authorize?: typeof requireInternalCaller } = {}) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    const denied = (deps.authorize ?? requireInternalCaller)(req, corsHeaders);
    if (denied) return denied;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (req.method !== "POST") return json({ error: "Invalid request" }, 400);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
    const keys = Object.keys(body);
    if (keys.some((key) => key !== "dry_run") || (body.dry_run !== undefined && typeof body.dry_run !== "boolean")) {
      return json({ error: "Invalid request" }, 400);
    }
    try {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!deps.client && (!url || !key)) return json({ error: "Unavailable" }, 500);
      const client = deps.client ? deps.client() : createClient(url ?? "", key ?? "", { auth: { persistSession: false } });
      const counts = await runToastMatchDigest(client, new Date(), body.dry_run === true);
      console.log(JSON.stringify(counts));
      return json({ ...counts, dry_run: body.dry_run === true });
    } catch {
      return json({ error: "Digest unavailable" }, 500);
    }
  };
}

export const handler = createHandler();
if (import.meta.main) Deno.serve(handler);
