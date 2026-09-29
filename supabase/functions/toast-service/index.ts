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
  z.object({ action: z.literal("schedule_list") }),
  z.object({
    action: z.literal("heartbeat"),
    locationIds: z.array(z.string().uuid()).min(1).max(20),
    state: z.enum(["starting", "signing_in", "signed_in", "polling", "human_check", "blank", "error", "login_capped", "handoff", "stopped"]),
    message: z.string().max(500).optional(),
    runId: z.string().max(80).optional(),
    fullLogin: z.boolean().optional(),
  }),
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

  if (body.action === "heartbeat") {
    if (auth.caller.kind !== "service") return json({ error: "Forbidden" }, 403);
    const MAX_FULL_LOGINS = 4;
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await supabase.from("toast_robot_status").select("*").in("location_id", body.locationIds);
    const byId = new Map((rows ?? []).map((r: any) => [r.location_id, r]));
    let allowed = true;
    let used = 0;
    const now = new Date().toISOString();
    const upserts = body.locationIds.map((id) => {
      const prev: any = byId.get(id) ?? {};
      const count = prev.full_logins_date === today ? (prev.full_logins_count ?? 0) : 0;
      used = Math.max(used, count);
      if (body.fullLogin && count >= MAX_FULL_LOGINS) allowed = false;
      const good = body.state === "polling" || body.state === "signed_in";
      return {
        location_id: id,
        state: body.fullLogin && count >= MAX_FULL_LOGINS ? "login_capped" : body.state,
        message: body.message ?? null,
        run_id: body.runId ?? prev.run_id ?? null,
        heartbeat_at: now,
        full_logins_date: today,
        full_logins_count: body.fullLogin && count < MAX_FULL_LOGINS ? count + 1 : count,
        // A healthy check-in resets the watchdog's alert ladder.
        ...(good ? { alert_stage: 0 } : {}),
        updated_at: now,
      };
    });
    const { error } = await supabase.from("toast_robot_status").upsert(upserts, { onConflict: "location_id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, allowed, fullLoginsToday: used + (body.fullLogin && allowed ? 1 : 0), maxFullLogins: MAX_FULL_LOGINS });
  }

  if (body.action === "schedule_list") {
    if (auth.caller.kind !== "service") return json({ error: "Forbidden" }, 403);
    const { data: active, error: e1 } = await supabase
      .from("location_integrations")
      .select("location_id, credentials")
      .eq("integration_type", "toast")
      .eq("is_active", true);
    if (e1) return json({ error: e1.message }, 500);
    const ids = (active ?? []).map((r: any) => r.location_id);
    if (ids.length === 0) return json({ stores: [] });
    const { data: locs, error: e2 } = await supabase
      .from("location_settings").select("location_id, timezone").in("location_id", ids);
    if (e2) return json({ error: e2.message }, 500);
    const { data: hours, error: e3 } = await supabase
      .from("location_hours").select("location_id, day_of_week, open_time, close_time, is_closed").in("location_id", ids);
    if (e3) return json({ error: e3.message }, 500);
    return json({
      stores: (locs ?? []).map((l: any) => ({
        locationId: l.location_id,
        restaurantGuid: (active ?? []).find((a: any) => a.location_id === l.location_id)?.credentials?.restaurant_guid ?? null,
        timezone: l.timezone ?? "America/Los_Angeles",
        hours: (hours ?? [])
          .filter((h: any) => h.location_id === l.location_id)
          .map((h: any) => ({ dow: h.day_of_week, open: String(h.open_time).slice(0, 5), close: String(h.close_time).slice(0, 5), closed: !!h.is_closed })),
      })),
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
