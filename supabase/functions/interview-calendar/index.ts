// @ts-nocheck
// Public calendar file (.ics) for one interview. Link is signed per application,
// so only people who got the email can open it. Always reads the latest time,
// meeting link and address, so a newer email's link updates the same event.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { buildIcs, loadInterview, signApplication } from "../_shared/interviewCalendar.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const appId = url.searchParams.get("a") || "";
  const sig = url.searchParams.get("s") || "";
  const audience = url.searchParams.get("for") === "staff" ? "staff" : "applicant";
  if (!UUID.test(appId) || sig !== (await signApplication(appId))) {
    return new Response("Link not valid", { status: 404 });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const interview = await loadInterview(supabase, appId);
  if (!interview) return new Response("This interview is no longer scheduled", { status: 404 });
  return new Response(buildIcs(interview, audience), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="interview-${interview.date}.ics"`,
      "Cache-Control": "no-store",
    },
  });
});
