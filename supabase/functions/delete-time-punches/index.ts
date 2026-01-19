// Lovable Cloud backend function: delete-time-punches
// Deletes punches using elevated privileges after verifying the caller has manager+ permissions.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.84.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DeleteTimePunchesBody = {
  location_id: string;
  punch_ids: string[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";

    // Client scoped to the calling user (for auth.getUser)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Partial<DeleteTimePunchesBody>;
    const locationId = body.location_id;
    const punchIds = body.punch_ids;

    if (!locationId || !Array.isArray(punchIds) || punchIds.length === 0) {
      return new Response(JSON.stringify({ error: "location_id and punch_ids are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(url, serviceRoleKey);

    // Authorization: must be manager or higher AND have access to this location.
    const { data: hasRole, error: roleErr } = await admin.rpc("has_role_or_higher", {
      _user_id: user.id,
      _minimum_role: "manager",
    });

    if (roleErr) throw roleErr;

    const { data: hasLocationAccess, error: accessErr } = await admin.rpc("has_location_access", {
      _user_id: user.id,
      _location_id: locationId,
    });

    if (accessErr) throw accessErr;

    if (!hasRole || !hasLocationAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delete punches ONLY for the provided location to avoid cross-location deletes.
    const { data: deleted, error: delErr } = await admin
      .from("time_punches")
      .delete()
      .in("id", punchIds)
      .eq("location_id", locationId)
      .select("id");

    if (delErr) throw delErr;

    return new Response(
      JSON.stringify({ ok: true, deleted_ids: (deleted ?? []).map((r: { id: string }) => r.id) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
