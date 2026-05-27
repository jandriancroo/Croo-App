import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = (env: string) =>
  env === "sandbox" ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";

interface Body {
  action: "test" | "save";
  locationId?: string;
  apiToken?: string;
  merchantId?: string;
  environment?: "production" | "sandbox";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { action, locationId, apiToken, merchantId, environment = "production" } = body;

    if (!action) throw new Error("action required");

    // ── TEST: ping Clover to validate token + merchant ──
    if (action === "test") {
      if (!apiToken || !merchantId) {
        return new Response(
          JSON.stringify({ success: false, error: "apiToken and merchantId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const r = await fetch(`${BASE(environment)}/v3/merchants/${merchantId}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!r.ok) {
        const text = await r.text();
        return new Response(
          JSON.stringify({ success: false, status: r.status, error: text.slice(0, 300) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const merchant = await r.json();
      return new Response(
        JSON.stringify({
          success: true,
          merchant: { id: merchant.id, name: merchant.name, currency: merchant.defaultCurrency },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── SAVE: persist credentials to location_integrations ──
    if (action === "save") {
      if (!locationId || !apiToken || !merchantId) {
        throw new Error("locationId, apiToken, merchantId required");
      }
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      // upsert by (location_id, integration_type)
      const { data: existing } = await supabase
        .from("location_integrations")
        .select("id")
        .eq("location_id", locationId)
        .eq("integration_type", "clover")
        .maybeSingle();

      const payload = {
        location_id: locationId,
        integration_type: "clover",
        credentials: { api_token: apiToken, merchant_id: merchantId, environment },
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
    console.error("[clover-service] error", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
