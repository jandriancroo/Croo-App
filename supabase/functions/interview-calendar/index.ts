// @ts-nocheck
// Public calendar file (.ics) for one interview. Link is signed per application,
// so only people who got the email can open it. Always reads the latest time,
// meeting link and address, so a newer email's link updates the same event.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { buildIcs, interviewJoinUrl, loadInterview, signApplication } from "../_shared/interviewCalendar.ts";
import { authenticateCaller } from "../_shared/callerAuth.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const url = new URL(req.url);
  if (req.method === "POST") {
    const caller = await authenticateCaller(req);
    if (!caller || caller.kind !== "user") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.applicationIds) ? [...new Set(body.applicationIds.filter((id: unknown) => typeof id === "string" && UUID.test(id)))].slice(0, 100) : [];
    if (!ids.length) return new Response(JSON.stringify({ links: {} }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: apps } = await supabase.from("job_applications").select("id, organization_id, location_id").in("id", ids);
    const orgIds = [...new Set((apps || []).map((app: any) => app.organization_id).filter(Boolean))];
    const locationIds = [...new Set((apps || []).map((app: any) => app.location_id).filter(Boolean))];
    const [{ data: orgMemberships }, { data: locationMemberships }] = await Promise.all([
      orgIds.length ? supabase.from("organization_members").select("organization_id").eq("user_id", caller.userId).in("organization_id", orgIds) : Promise.resolve({ data: [] }),
      locationIds.length ? supabase.from("user_locations").select("location_id").eq("user_id", caller.userId).in("location_id", locationIds) : Promise.resolve({ data: [] }),
    ]);
    const allowedOrgs = new Set((orgMemberships || []).map((row: any) => row.organization_id));
    const allowedLocations = new Set((locationMemberships || []).map((row: any) => row.location_id));
    const allowedApps = (apps || []).filter((app: any) => allowedOrgs.has(app.organization_id) || allowedLocations.has(app.location_id));
    const links = Object.fromEntries(await Promise.all(allowedApps.map(async (app: any) => [app.id, await interviewJoinUrl(app.id)])));
    return new Response(JSON.stringify({ links }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const appId = url.searchParams.get("a") || "";
  const sig = url.searchParams.get("s") || "";
  const audience = url.searchParams.get("for") === "staff" ? "staff" : "applicant";
  if (!UUID.test(appId) || sig !== (await signApplication(appId))) {
    return new Response("Link not valid", { status: 404 });
  }
  const interview = await loadInterview(supabase, appId);
  if (!interview) return new Response("This interview is no longer scheduled", { status: 404 });
  if (url.searchParams.get("action") === "join") {
    if (interview.modality !== "virtual" || !interview.meetingUrl) return new Response("This interview does not have a video call", { status: 404 });
    return Response.redirect(interview.meetingUrl, 302);
  }
  return new Response(buildIcs(interview, audience, await interviewJoinUrl(appId)), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="interview-${interview.date}.ics"`,
      "Cache-Control": "no-store",
    },
  });
});
