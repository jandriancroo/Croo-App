import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Returns current hourly wages for a set of users at a location.
 *
 * Authorized callers:
 *  - a manager (or higher) at that location, OR
 *  - an active paired punch-clock device bound to that location.
 *
 * The device is a first-class principal (punch_clock_devices.auth_user_id), so
 * the kiosk manager overlay can show real labor dollars without exposing the
 * wage table to the client. Only { user_id, hourly_wage } for the requested
 * users at the device's own location is ever returned.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { location_id, user_ids, date } = await req.json();
    if (!location_id || !Array.isArray(user_ids)) {
      return json({ error: "location_id and user_ids required" }, 400);
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const callerId = userData?.user?.id;
    if (userErr || !callerId) return json({ error: "Unauthorized" }, 401);

    // --- authorize: paired device for this location ---
    const { data: device } = await admin
      .from("punch_clock_devices")
      .select("id")
      .eq("auth_user_id", callerId)
      .eq("location_id", location_id)
      .is("revoked_at", null)
      .maybeSingle();

    let allowed = !!device;

    // --- authorize: manager+ human session with access to this location ---
    if (!allowed) {
      const { data: isManager } = await admin.rpc("has_role_or_higher", {
        _user_id: callerId,
        _minimum_role: "manager",
      });
      if (isManager === true) {
        const { data: membership } = await admin
          .from("user_locations")
          .select("location_id")
          .eq("user_id", callerId)
          .eq("location_id", location_id)
          .maybeSingle();
        allowed = !!membership;
      }
    }

    if (!allowed) return json({ error: "Forbidden" }, 403);

    if (user_ids.length === 0) return json({ wages: [] });

    // Only return wages for users actually attached to this location.
    const { data: scoped } = await admin
      .from("user_locations")
      .select("user_id")
      .eq("location_id", location_id)
      .in("user_id", user_ids);

    const scopedIds = (scoped || []).map((r: any) => r.user_id);
    if (scopedIds.length === 0) return json({ wages: [] });

    const { data: wages, error: wageErr } = await admin.rpc("get_current_wages_batch", {
      p_user_ids: scopedIds,
      p_date: date || new Date().toISOString().slice(0, 10),
    });
    if (wageErr) return json({ error: wageErr.message }, 500);

    return json({
      wages: (wages || []).map((w: any) => ({
        user_id: w.user_id,
        hourly_wage: Number(w.hourly_wage),
      })),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
