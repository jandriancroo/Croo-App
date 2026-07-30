// One-shot utility: seeds vault.secrets with supabase_url and service_role_key
// so DB triggers (notify_feed_post_push, queue_nightly_maintenance, etc.) that
// look them up via vault.decrypted_secrets can successfully call edge functions.
//
// Safe to re-run — upserts by name.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "runtime env missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Use the RPC we install alongside this function to upsert vault secrets.
    const { data: urlRes, error: urlErr } = await admin.rpc("upsert_vault_secret", {
      _name: "supabase_url",
      _secret: supabaseUrl,
    });
    if (urlErr) throw urlErr;

    const { data: keyRes, error: keyErr } = await admin.rpc("upsert_vault_secret", {
      _name: "service_role_key",
      _secret: serviceRoleKey,
    });
    if (keyErr) throw keyErr;

    return new Response(
      JSON.stringify({ ok: true, supabase_url_id: urlRes, service_role_key_id: keyRes }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("seed-push-vault error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
