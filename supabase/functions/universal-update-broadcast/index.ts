// @ts-nocheck
// Nightly automatic Universal Update.
// Broadcasts the same signal the super-admin "Universal Update" button sends,
// so every phone, browser, tablet and watch lands on the published build once
// a day without anyone pressing anything.
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const CHANNEL = "croohq-universal-update";
const EVENT = "reload";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      messages: [
        {
          topic: CHANNEL,
          event: EVENT,
          payload: { at: new Date().toISOString(), source: "nightly-cron" },
        },
      ],
    }),
  });

  const ok = res.ok;
  const body = await res.text();

  return new Response(JSON.stringify({ ok, status: res.status, body: body.slice(0, 200) }), {
    status: ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
