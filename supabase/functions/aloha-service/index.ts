// Aloha (NCR Aloha Enterprise / BWW GO portal) credentials service.
// Saves per-location credentials into location_integrations and performs a live
// login test against the portal.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { alohaLogin } from "../_shared/aloha-portal.ts";
import { requireAuthorizedCaller } from '../_shared/callerAuth.ts';
import { z } from 'npm:zod@3.23.8';
import { DateTime } from 'npm:luxon@3.7.2';
import { probeLaborDetail } from './laborProbe.ts';
import { safeProbeError } from './probeMetadata.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  action: "test" | "save" | "probe_labor_detail";
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

  const denied = await requireAuthorizedCaller(req, corsHeaders, { minRole: 'admin' });
  if (denied) return denied;


  try {
    const body = (await req.json()) as Body;
    const { action } = body;
    if (!action) throw new Error("action required");

    // Read-only diagnostic: intentionally isolated from every save/sync path.
    if (action === 'probe_labor_detail') {
      const parsed = z.object({
        action: z.literal('probe_labor_detail'),
        locationId: z.literal('5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'),
      }).strict().safeParse(body);
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      if (!parsed.success) return json({ error: 'Probe is restricted to the approved Virginia St location; no date or credential overrides' }, 400);
      const date = DateTime.now().setZone('America/Los_Angeles').minus({ days: 1 }).toFormat('yyyy-MM-dd');
      try {
        const url = Deno.env.get('SUPABASE_URL');
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!url || !key) return json({ error: 'Probe service unavailable' }, 503);
        const client = createClient(url, key);
        const { data, error } = await client.from('location_integrations')
          .select('credentials').eq('location_id', parsed.data.locationId)
          .eq('integration_type', 'aloha').eq('is_active', true).maybeSingle();
        if (error || !data?.credentials || String(data.credentials.store_id) !== '4274') return json({ error: 'Approved saved Aloha integration unavailable' }, 400);
        const results = await probeLaborDetail(data.credentials, date);
        return json({ store: '4274', businessDate: date, results });
      } catch (error) {
        return json({ error: safeProbeError(error) }, 502);
      }
    }

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
        .select("id, credentials")
        .eq("location_id", body.locationId)
        .eq("integration_type", "aloha")
        .maybeSingle();

      const payload = {
        location_id: body.locationId,
        integration_type: "aloha",
        // Keep the register-labor switch; it is only changed via set_register_labor.
        credentials: (existing?.credentials as any)?.pull_labor !== undefined
          ? { ...credentials, pull_labor: (existing!.credentials as any).pull_labor }
          : credentials,
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
