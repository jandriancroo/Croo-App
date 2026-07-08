// Aloha (NCR Aloha Enterprise / BWW GO portal) credentials service.
// Saves per-location credentials into location_integrations and performs a live
// login test against the portal.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { alohaLogin } from "../_shared/aloha-portal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  action: "test" | "save";
  locationId?: string;
  portalUrl?: string;
  companyId?: string;
  username?: string;
  password?: string;
  storeId?: string;
}

const DEFAULT_PORTAL = "https://sierrafoodgroup.alohaenterprise.com";
const DEFAULT_COMPANY = "sfg07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const { action } = body;
    if (!action) throw new Error("action required");

    // ── TEST: real portal login round-trip ──
    if (action === "test") {
      if (!body.username || !body.password) throw new Error("username and password required");
      const portalUrl = body.portalUrl || DEFAULT_PORTAL;
      const companyId = body.companyId || DEFAULT_COMPANY;

      try {
        const session = await alohaLogin({
          portalUrl,
          companyId,
          loginName: body.username,
          password: body.password,
        });
        return new Response(
          JSON.stringify({
            success: true,
            status: "verified",
            sessionManagerID: session.sessionManagerID.slice(0, 6) + "…",
            userId: session.userId,
            userLocale: session.userLocale,
            companyId: session.companyId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({
            success: false,
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── SAVE ──
    if (action === "save") {
      if (!body.locationId) throw new Error("locationId required");
      if (!body.username || !body.password) throw new Error("username and password required");

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const credentials = {
        portal_url: body.portalUrl || DEFAULT_PORTAL,
        company_id: body.companyId || DEFAULT_COMPANY,
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
