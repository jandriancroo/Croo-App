// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("Not authenticated");
    const user = userData.user;

    // super_admin gate
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Forbidden — super admin only");

    const body = await req.json();
    const { location_id, recipient_email, recipient_name } = body || {};
    if (!location_id || !recipient_email) {
      return new Response(JSON.stringify({ error: "location_id and recipient_email required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Load location
    const { data: loc, error: locErr } = await supabase
      .from("locations")
      .select("id, name")
      .eq("id", location_id)
      .single();
    if (locErr || !loc) throw new Error("Location not found");

    // Initiator name
    const { data: initProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const initiated_by_name = initProfile?.full_name || null;

    // Flag the location
    const { error: updErr } = await supabase
      .from("locations")
      .update({
        billing_initiated_at: new Date().toISOString(),
        billing_initiated_by: user.id,
        billing_initiated_email: recipient_email,
      })
      .eq("id", location_id);
    if (updErr) throw updErr;

    const billing_url = `https://croohq.com/billing?location=${location_id}`;

    // Send email via existing notification email function
    const { error: emailErr } = await supabase.functions.invoke("send-notification-email", {
      body: {
        type: "billing_initiated",
        to: recipient_email,
        data: {
          location_name: loc.name,
          recipient_name: recipient_name || null,
          billing_url,
          initiated_by_name,
        },
      },
    });
    if (emailErr) console.error("[initiate-billing] email send error", emailErr);

    return new Response(JSON.stringify({ success: true, billing_url }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[initiate-billing] error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
