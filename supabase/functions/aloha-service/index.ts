// Aloha (NCR Aloha Enterprise) credentials service — save/test.
// Mirrors clover-service. Actual data pulls live in aloha-sync.
//
// Note: The exact transport layer (Aloha Cloud REST API, Aloha Insight SFTP
// export, or headless portal scrape) is TBD — see docs/brands/bww-go.md.
// This service just stores whatever the user provides on location_integrations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  action: "test" | "save";
  locationId?: string;
  // Portal credentials (current best guess — swap for API key/secret if we move
  // to Aloha Cloud API or Insight SFTP later).
  portalUrl?: string;
  username?: string;
  password?: string;
  storeId?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { action } = body;
    if (!action) throw new Error("action required");

    // ── TEST: placeholder until we know the real Aloha data path ──
    if (action === "test") {
      return new Response(
        JSON.stringify({
          success: false,
          status: "not_implemented",
          error:
            "Aloha connectivity test not yet wired. Confirm data source with Sierra Food Group " +
            "(Aloha Cloud API credentials, Aloha Insight CSV/SFTP export, or portal login), then " +
            "the fetchAlohaDay() stub in aloha-sync will be filled in.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── SAVE: persist creds to location_integrations ──
    if (action === "save") {
      if (!body.locationId) throw new Error("locationId required");
      if (!body.username || !body.password) {
        throw new Error("username and password required");
      }
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const credentials = {
        portal_url: body.portalUrl ?? "https://sierrafoodgroup.alohaenterprise.com",
        username: body.username,
        password: body.password,
        store_id: body.storeId ?? null,
      };

      const { data: existing } = await supabase
        .from("location_integrations")
        .select("id")
        .eq("location_id", body.locationId)
        .eq("integration_type", "aloha")
        .maybeSingle();

      const payload = {
        location_id: body.locationId,
        integration_type: "aloha",
        credentials,
        is_active: true,
      };

      if (existing) {
        const { error } = await supabase
          .from("location_integrations")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("location_integrations").insert(payload);
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e) {
    console.error("[aloha-service] error", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
