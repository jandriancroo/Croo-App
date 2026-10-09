// @ts-nocheck
// ---------------------------------------------------------------------------
// availability-insights — "Availability Insights · <next week>" email.
// Replaces the old Who's Out nightly + weekly digests.
//
// Actions:
//   { action: "run_hourly" }            internal (cron, hourly). Acts only for
//       stores whose local hour is 7 AND that got ≥1 new time-off request the
//       previous local day. dedup_key availability_insights_v1_<loc>_<date>.
//   { action: "dry_run", location_id, date? }   internal or super_admin.
//       Builds the email and returns it; never queues or sends anything.
//   { action: "send_sample", location_id }      signed-in manager+ at the
//       store: "[Sample]" to the caller's own inbox only.
//   { action: "send_location_sample", location_id }  super_admin only.
//
// Delivery is the existing email-queue-sender.
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, requireInternalCaller } from "../_shared/callerAuth.ts";
import { resolveEmailLogo } from "../_shared/emailHeader.ts";
import {
  INSIGHTS_NOTIFICATION_TYPE,
  buildInsightsHtml,
  countNewRequestsYesterday,
  dayCounts,
  insightsSubject,
  isInsightsHour,
  loadInsights,
  localDateInTimezone,
  nextWeekRange,
  resolveInsightsRecipients,
} from "../_shared/availabilityInsights.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FROM = "CrooHQ <hello@croohq.email>";
const SAMPLE_ROLES = ["admin", "general_manager", "manager", "org_admin", "super_admin"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function timezoneOf(supabase: any, locationId: string): Promise<string> {
  const { data } = await supabase.from("location_settings").select("timezone").eq("location_id", locationId).maybeSingle();
  return data?.timezone || "America/Los_Angeles";
}

/** Everything one email needs, built once. Pure read — no writes. */
async function buildFor(supabase: any, locationId: string, localDate: string, timezone: string, isSample = false) {
  const { weekStart, weekEnd } = nextWeekRange(localDate);
  const [data, logo, newRequestsYesterday, recipients] = await Promise.all([
    loadInsights(supabase, locationId, weekStart, weekEnd),
    resolveEmailLogo(supabase, { locationId }),
    countNewRequestsYesterday(supabase, locationId, timezone, localDate),
    resolveInsightsRecipients(supabase, locationId),
  ]);
  return {
    data, recipients, newRequestsYesterday, weekStart, weekEnd,
    subject: insightsSubject(weekStart, weekEnd, isSample),
    html: buildInsightsHtml(data, { logoUrl: logo.logoUrl, logoAlt: logo.alt, newRequestsYesterday, isSample }),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "send_sample";

    if (action === "run_hourly") {
      const deny = requireInternalCaller(req, corsHeaders);
      if (deny) return deny;
      return json(await runHourly(supabase));
    }

    const locationId: string | undefined = body?.location_id;
    if (!locationId) return json({ error: "location_id required" }, 400);

    const caller = await authenticateCaller(req);
    if (!caller) return json({ error: "Unauthorized" }, 401);
    let callerId: string | null = null;
    if (caller.kind === "user") {
      callerId = caller.userId;
      const { data: rows, error } = await supabase.from("user_roles").select("role").eq("user_id", callerId);
      if (error) return json({ error: "Role lookup failed" }, 500);
      const roles = (rows || []).map((r: any) => r.role);
      const isSuperAdmin = roles.includes("super_admin");
      if ((action === "send_location_sample" || action === "dry_run") && !isSuperAdmin) return json({ error: "Forbidden" }, 403);
      if (!roles.some((r: string) => SAMPLE_ROLES.includes(r))) return json({ error: "Forbidden" }, 403);
      if (!isSuperAdmin) {
        const { data: a, error: aErr } = await supabase
          .from("user_locations").select("user_id").eq("user_id", callerId).eq("location_id", locationId).maybeSingle();
        if (aErr) return json({ error: "Access lookup failed" }, 500);
        if (!a) return json({ error: "Forbidden" }, 403);
      }
    } else if (action === "send_sample") {
      return json({ error: "send_sample requires a signed-in caller" }, 400);
    }

    const timezone = await timezoneOf(supabase, locationId);
    const localDate = DATE_RE.test(body?.date || "") ? body.date : localDateInTimezone(timezone);

    if (action === "dry_run") {
      const b = await buildFor(supabase, locationId, localDate, timezone);
      return json({
        dry_run: true,
        local_date: localDate,
        subject: b.subject,
        html: b.html,
        recipientCount: b.recipients.length,
        dayCounts: dayCounts(b.data),
        newRequestsYesterday: b.newRequestsYesterday,
        gate: { localHourIs7Now: isInsightsHour(timezone), hasNewRequestYesterday: b.newRequestsYesterday > 0 },
      });
    }

    if (action !== "send_sample" && action !== "send_location_sample") return json({ error: "Unknown action" }, 400);

    const b = await buildFor(supabase, locationId, localDate, timezone, true);
    let to: string[] = [];
    if (action === "send_location_sample") to = b.recipients.map((r) => r.email);
    else {
      const { data: me } = await supabase.from("profiles").select("email").eq("id", callerId).maybeSingle();
      if (!me?.email) return json({ error: "Your profile has no email address" }, 400);
      to = [me.email];
    }
    if (to.length === 0) return json({ success: false, message: "No recipients" });

    const { error: qErr } = await supabase.from("email_queue").insert({
      from_address: FROM, to_addresses: to, subject: b.subject, html: b.html,
      source: "test_preview", dedup_key: null,
      metadata: { notification_type: INSIGHTS_NOTIFICATION_TYPE, location_id: locationId, week_start: b.weekStart, week_end: b.weekEnd, sample: true },
    });
    if (qErr) return json({ error: "Queue failed" }, 500);
    return json({ success: true, week_start: b.weekStart, week_end: b.weekEnd, queued_to: to });
  } catch (error) {
    console.error("[availability-insights] error:", error);
    return json({ error: String((error as any)?.message || error) }, 500);
  }
});

async function runHourly(supabase: any) {
  const { data: locs, error } = await supabase.from("locations").select("id, name").eq("is_active", true);
  if (error) throw new Error(`locations read failed: ${error.message}`);
  const results: any[] = [];
  for (const loc of (locs || []).filter((l: any) => !String(l.name || "").startsWith("[TEST]"))) {
    try {
      const timezone = await timezoneOf(supabase, loc.id);
      if (!isInsightsHour(timezone)) continue; // quiet: not 7 AM there
      const localDate = localDateInTimezone(timezone);
      const b = await buildFor(supabase, loc.id, localDate, timezone);
      if (b.newRequestsYesterday === 0) { results.push({ store: loc.name, status: "no_new_requests" }); continue; }
      if (b.recipients.length === 0) { results.push({ store: loc.name, status: "no_recipients" }); continue; }
      const { error: qErr } = await supabase.from("email_queue").insert({
        from_address: FROM,
        to_addresses: b.recipients.map((r) => r.email),
        subject: b.subject,
        html: b.html,
        source: "availability_insights",
        dedup_key: `availability_insights_v1_${loc.id}_${localDate}`,
        metadata: { notification_type: INSIGHTS_NOTIFICATION_TYPE, location_id: loc.id, local_date: localDate, week_start: b.weekStart, new_requests: b.newRequestsYesterday },
      });
      if (qErr && qErr.code === "23505") results.push({ store: loc.name, status: "already_queued" });
      else if (qErr) throw new Error(qErr.message);
      else results.push({ store: loc.name, status: "queued", recipients: b.recipients.length });
    } catch (e) {
      console.error(`[availability-insights] ${loc.name} failed:`, e);
      results.push({ store: loc.name, status: "error", error: String((e as any)?.message || e) });
    }
  }
  console.log("[availability-insights] run_hourly", JSON.stringify(results));
  return { success: true, count: results.length, results };
}
