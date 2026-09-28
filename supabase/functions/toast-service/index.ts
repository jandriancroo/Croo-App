// Toast (homemade) connection service.
//   save        — admin saves the store's Toast restaurant ID + turns Toast on/off
//   status      — admin sees last sync per source
//   list_active — robots (x-cron-secret) get the stores to pull
// Toast Web / SFTP logins live in GitHub secrets, never in the database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@3.23.8";
import { authorizeCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), locationId: z.string().uuid(), restaurantGuid: z.string().trim().max(64).optional().default(""), isActive: z.boolean() }),
  z.object({ action: z.literal("status"), locationId: z.string().uuid() }),
  z.object({ action: z.literal("list_active") }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await authorizeCaller(req, corsHeaders, { minRole: "admin" });
  if ("response" in auth) return auth.response;

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (body.action === "list_active") {
    if (auth.caller.kind !== "service") return json({ error: "Forbidden" }, 403);
    const { data, error } = await supabase
      .from("location_integrations")
      .select("location_id, credentials")
      .eq("integration_type", "toast")
      .eq("is_active", true);
    if (error) return json({ error: error.message }, 500);
    return json({
      stores: (data ?? []).map((r: any) => ({ locationId: r.location_id, restaurantGuid: r.credentials?.restaurant_guid ?? null })),
    });
  }

  // User callers must have access to the store.
  if (auth.caller.kind === "user") {
    const { data: ok } = await supabase.rpc("has_location_access", { _user_id: auth.caller.userId, _location_id: body.locationId });
    if (ok !== true) return json({ error: "Forbidden" }, 403);
  }

  // Toast is only allowed where the brand turned it on.
  const { data: loc } = await supabase.from("locations").select("brand_id").eq("id", body.locationId).maybeSingle();
  const { data: policy } = await supabase
    .from("brand_integration_policies").select("is_enabled")
    .eq("brand_id", loc?.brand_id ?? "").eq("integration_key", "toast").maybeSingle();
  if (!policy?.is_enabled) return json({ error: "Toast is not enabled for this brand" }, 403);

  if (body.action === "status") {
    const { data: rows } = await supabase
      .from("toast_sales_cache").select("sale_date, data_source, net_sales, fetched_at")
      .eq("location_id", body.locationId).order("fetched_at", { ascending: false }).limit(20);
    const last = (src: string) => (rows ?? []).find((r: any) => r.data_source === src) ?? null;
    return json({ lastExport: last("export"), lastLive: last("live"), lastApi: last("api") });
  }

  const { data: existing } = await supabase
    .from("location_integrations").select("id, credentials")
    .eq("location_id", body.locationId).eq("integration_type", "toast").maybeSingle();
  const credentials = { ...((existing?.credentials as any) ?? {}), restaurant_guid: body.restaurantGuid || null, method: "homemade" };
  const payload = { location_id: body.locationId, integration_type: "toast", credentials, is_active: body.isActive };
  const { error } = existing
    ? await supabase.from("location_integrations").update(payload).eq("id", existing.id)
    : await supabase.from("location_integrations").insert(payload);
  if (error) return json({ error: error.message }, 500);
  return json({ success: true });
});
