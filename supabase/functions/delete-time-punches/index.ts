import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const locationId = body.location_id;
    const punchIds = body.punch_ids;

    if (!locationId || !Array.isArray(punchIds) || punchIds.length === 0) {
      return new Response(JSON.stringify({ error: "location_id and punch_ids are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check role
    const { data: hasRole, error: roleErr } = await supabaseAdmin.rpc("has_role_or_higher", {
      _user_id: user.id,
      _minimum_role: "manager",
    });
    if (roleErr) throw roleErr;

    // Check location access
    const { data: hasLocationAccess, error: accessErr } = await supabaseAdmin.rpc("has_location_access", {
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

    // Delete the punches
    const { error: deleteErr } = await supabaseAdmin
      .from("time_punches")
      .delete()
      .in("id", punchIds)
      .eq("location_id", locationId);

    if (deleteErr) throw deleteErr;

    return new Response(
      JSON.stringify({ success: true, deleted: punchIds.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("delete-time-punches error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "An error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
