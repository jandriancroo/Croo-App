// @ts-nocheck
// ---------------------------------------------------------------------------
// whos-out-email — manual sample of the next-week time-off digest.
//
// Actions:
//   POST { action: "send_sample", location_id, date? }
//        Caller must be admin / GM / manager (or super_admin) with an
//        assignment to that location. Queues to the CALLER'S OWN email only,
//        "[Sample]" subject prefix, source "test_preview", dedup_key null so
//        it can be re-sent as often as needed.
//
//   POST { action: "send_location_sample", location_id, date? }
//        super_admin only. Queues the same "[Sample]" digest to the location's
//        real manager/admin recipient list (shift managers excluded). Used for
//        one-off demos to a store's leadership.
//
// Delivery is left to the existing email-queue-sender.
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildWhosOutHtml,
  loadWhosOut,
  localDateInTimezone,
  nextWeekRange,
  resolveWhosOutRecipients,
  whosOutSubject,
} from "../_shared/whos-out.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_SAMPLE_ROLES = ["admin", "general_manager", "manager", "org_admin", "super_admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = body?.action || "send_sample";
    const locationId: string | undefined = body?.location_id;
    if (!locationId) return json({ error: "location_id required" }, 400);

    // ── Caller identity ──
    // Service-role / cron callers are internal and may run the location sample.
    // Everyone else must be a signed-in admin/GM/manager for that location.
    const caller = await authenticateCaller(req);
    if (!caller) return json({ error: "Unauthorized" }, 401);

    let callerId: string | null = null;
    if (caller.kind === "user") {
      callerId = caller.userId;

      const { data: callerRoles, error: roleErr } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId);
      if (roleErr) return json({ error: "Role lookup failed" }, 500);
      const roles = (callerRoles || []).map((r: any) => r.role);
      const isSuperAdmin = roles.includes("super_admin");

      if (action === "send_location_sample" && !isSuperAdmin) {
        return json({ error: "Forbidden" }, 403);
      }

      if (!roles.some((r: string) => ALLOWED_SAMPLE_ROLES.includes(r))) {
        return json({ error: "Forbidden" }, 403);
      }

      if (!isSuperAdmin) {
        const { data: assignment, error: assignErr } = await supabase
          .from("user_locations")
          .select("user_id")
          .eq("user_id", callerId)
          .eq("location_id", locationId)
          .maybeSingle();
        if (assignErr) return json({ error: "Access lookup failed" }, 500);
        if (!assignment) return json({ error: "Forbidden" }, 403);
      }
    } else if (action === "send_sample") {
      // No personal inbox for a service caller — use send_location_sample.
      return json({ error: "send_sample requires a signed-in caller" }, 400);
    }


    // ── Target week in the location's own timezone ──
    const { data: settings, error: settingsErr } = await supabase
      .from("location_settings")
      .select("timezone")
      .eq("location_id", locationId)
      .maybeSingle();
    if (settingsErr) console.error("[whos-out-email] location_settings read failed:", settingsErr);
    const timezone = settings?.timezone || "America/Los_Angeles";
    const anchor = body?.date || localDateInTimezone(timezone);
    const { weekStart, weekEnd } = nextWeekRange(anchor);

    const data = await loadWhosOut(supabase, locationId, weekStart, weekEnd);
    const html = buildWhosOutHtml(data, { isSample: true });
    const subject = whosOutSubject(data, true);

    // ── Recipients ──
    let recipients: { id: string; email: string; name: string }[] = [];
    if (action === "send_location_sample") {
      recipients = await resolveWhosOutRecipients(supabase, locationId);
    } else {
      const { data: me, error: meErr } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("id", callerId)
        .maybeSingle();
      if (meErr) return json({ error: "Profile lookup failed" }, 500);
      if (!me?.email) return json({ error: "Your profile has no email address" }, 400);
      recipients = [{ id: me.id, email: me.email, name: me.full_name || "" }];
    }

    if (recipients.length === 0) return json({ success: false, message: "No recipients" });

    const { error: queueErr } = await supabase.from("email_queue").insert({
      from_address: "CrooHQ <hello@croohq.email>",
      to_addresses: recipients.map((r) => r.email),
      subject,
      html,
      source: "test_preview",
      dedup_key: null,
      metadata: {
        notification_type: "time_off_weekly_digest",
        location_id: locationId,
        week_start: weekStart,
        week_end: weekEnd,
        sample: true,
      },
    });
    if (queueErr) {
      console.error("[whos-out-email] queue insert failed:", queueErr);
      return json({ error: "Queue failed" }, 500);
    }

    return json({
      success: true,
      week_start: weekStart,
      week_end: weekEnd,
      requests: data.totalRequests,
      people_out: data.peopleOut,
      queued_to: recipients.map((r) => r.email),
    });
  } catch (error) {
    console.error("[whos-out-email] error:", error);
    return json({ error: String((error as any)?.message || error) }, 500);
  }
});
