// @ts-nocheck
// notify-new-application
// ---------------------------------------------------------------------------
// Thin, single-purpose notifier for NEW public job applications.
//
// Why this exists instead of calling hiring-email-service from the public form:
// hiring-email-service exposes many actions behind one public endpoint. The
// public application form must only be able to trigger THIS one thing.
//
// Contract:
//   - Client sends ONLY { applicationId }. Any other client-supplied field is
//     ignored — every detail is re-fetched server-side with the service role.
//   - PII: push body carries position + location only. Email carries first
//     name + position + location + a login-gated link. No phone, no email
//     address, no resume content in either body.
//   - Recipients: active general_manager users assigned to the applied-to
//     location, plus active admin / org_admin / super_admin scoped to that
//     organization. shift_manager is intentionally excluded.
//   - Preferences are read at the APPLICATION's location_id. A missing
//     user_notification_settings row means ON for both channels.
//   - Deduplicated per (application, channel, recipient) so a retry or a
//     double submit can never double-notify.
//   - Always returns 200-ish semantics to the caller: the application submit
//     must never fail because notification failed.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFICATION_TYPE = "new_job_application";
const ADMIN_ROLES = ["admin", "org_admin", "super_admin"];

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";
const systemFontStack =
  "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeHttpsUrl = (v: unknown) => {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" ? escapeHtml(u.toString()) : "";
  } catch {
    return "";
  }
};

function buildEmailHtml(args: {
  firstName: string;
  position: string;
  locationName: string;
  orgName: string;
  logoUrl: string;
  reviewUrl: string;
}): string {
  const firstName = escapeHtml(args.firstName);
  const position = escapeHtml(args.position);
  const locationName = escapeHtml(args.locationName);
  const orgName = escapeHtml(args.orgName);
  const logo = safeHttpsUrl(args.logoUrl);
  const logoHtml = logo
    ? `<img src="${logo}" alt="${orgName}" style="max-height:44px;max-width:140px;border-radius:6px;"/>`
    : `<span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.5px;">croo</span>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:640px;margin:0 auto;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
<tr><td style="background:${primaryColor};padding:24px 40px;"><table role="presentation" style="width:100%;"><tr>
<td style="width:40%;text-align:left;vertical-align:middle;">${logoHtml}</td>
<td style="width:60%;text-align:right;vertical-align:middle;"><span style="color:#fff;font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">New Application</span><br/><span style="color:rgba(255,255,255,0.9);font-size:12px;font-weight:500;">${orgName}</span></td>
</tr></table></td></tr>
<tr><td style="padding:32px 40px;">
<p style="color:${textColor};font-size:15px;margin:0 0 20px;line-height:1.6;"><strong>${firstName}</strong> just applied.</p>
<div style="background:${backgroundColor};border-radius:12px;padding:20px 24px;margin-bottom:26px;">
<table style="width:100%;">
<tr><td style="padding:8px 0;border-bottom:1px solid #e8e5df;"><span style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Position</span><br/><strong style="color:${textColor};font-size:15px;">${position}</strong></td></tr>
<tr><td style="padding:8px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Location</span><br/><strong style="color:${textColor};font-size:15px;">${locationName}</strong></td></tr>
</table>
</div>
<div style="text-align:center;margin:26px 0;">
<a href="${args.reviewUrl}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;padding:14px 36px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.3px;">Review in CrooHQ</a>
</div>
<p style="color:#999;font-size:12px;text-align:center;margin:0;line-height:1.6;">Contact details and the full application stay in CrooHQ — sign in to view them.</p>
</td></tr>
<tr><td style="background-color:${backgroundColor};padding:28px 40px;border-top:1px solid #e8e5df;text-align:center;"><span style="color:#3a5f7d;font-size:15px;">Powered by</span> <strong style="color:#1a1a1a;font-size:17px;letter-spacing:-0.5px;">croo</strong></td></tr>
</table></td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    // ONLY the id is trusted. Everything else is re-fetched server-side.
    const applicationId: string | undefined = body?.applicationId;
    if (!applicationId || typeof applicationId !== "string") {
      return json({ error: "applicationId required" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Re-fetch + validate the application (ignore client-supplied PII) ──
    const { data: application, error: appErr } = await supabase
      .from("job_applications")
      .select("id, full_name, location_id, organization_id, template_id, submitted_at")
      .eq("id", applicationId)
      .maybeSingle();

    if (appErr) {
      console.error("[notify-new-application] application fetch failed:", appErr);
      return json({ error: "Lookup failed" }, 500);
    }
    if (!application) {
      return json({ error: "Application not found" }, 404);
    }

    const firstName = String(application.full_name || "A new applicant").trim().split(/\s+/)[0];
    const locationId: string | null = application.location_id ?? null;
    const organizationId: string | null = application.organization_id ?? null;

    let position = "Job Application";
    if (application.template_id) {
      const { data: tmpl } = await supabase
        .from("job_application_templates")
        .select("name")
        .eq("id", application.template_id)
        .maybeSingle();
      if (tmpl?.name) position = tmpl.name;
    }

    let locationName = "Any location";
    if (locationId) {
      const { data: loc } = await supabase
        .from("locations")
        .select("name")
        .eq("id", locationId)
        .maybeSingle();
      if (loc?.name) locationName = loc.name;
    }

    let orgName = "CrooHQ";
    let logoUrl = "";
    if (organizationId) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name, brand_name, logo_url")
        .eq("id", organizationId)
        .maybeSingle();
      orgName = org?.brand_name || org?.name || orgName;
      logoUrl = org?.logo_url || "";
    }

    // ── Recipients ──────────────────────────────────────────────────────
    // 1. active general_manager users assigned to the applied-to location
    // 2. active admin / org_admin / super_admin scoped to the same org
    // shift_manager is deliberately NOT included.
    const gmIds = new Set<string>();
    if (locationId) {
      const { data: locUsers } = await supabase
        .from("user_locations")
        .select("user_id")
        .eq("location_id", locationId);
      const locUserIds = (locUsers || []).map((r: any) => r.user_id);
      if (locUserIds.length > 0) {
        const { data: gmRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "general_manager")
          .in("user_id", locUserIds);
        for (const r of gmRoles || []) gmIds.add(r.user_id);
      }
    }

    const adminIds = new Set<string>();
    if (organizationId) {
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ADMIN_ROLES);
      const candidateIds = [...new Set((adminRoles || []).map((r: any) => r.user_id))];

      if (candidateIds.length > 0) {
        // Org scope via explicit membership…
        const { data: members } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", organizationId)
          .in("user_id", candidateIds);
        for (const m of members || []) adminIds.add(m.user_id);

        // …or via any location assignment inside that organization.
        const { data: orgLocations } = await supabase
          .from("locations")
          .select("id")
          .eq("organization_id", organizationId);
        const orgLocationIds = (orgLocations || []).map((l: any) => l.id);
        if (orgLocationIds.length > 0) {
          const { data: assigned } = await supabase
            .from("user_locations")
            .select("user_id")
            .in("location_id", orgLocationIds)
            .in("user_id", candidateIds);
          for (const a of assigned || []) adminIds.add(a.user_id);
        }
      }
    }

    const candidateIds = [...new Set([...gmIds, ...adminIds])];
    if (candidateIds.length === 0) {
      console.log("[notify-new-application] no recipients for", applicationId);
      return json({ success: true, message: "No recipients" });
    }

    // Active users only, and we need their email for the email channel.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, is_active")
      .in("id", candidateIds);
    const activeRecipients = (profiles || []).filter((p: any) => p.is_active !== false);
    if (activeRecipients.length === 0) {
      return json({ success: true, message: "No active recipients" });
    }
    const activeIds = activeRecipients.map((p: any) => p.id);

    // ── Preferences at the application's location (missing row = ON) ────
    const prefs = new Map<string, { push: boolean; email: boolean }>();
    if (locationId) {
      const { data: prefRows } = await supabase
        .from("user_notification_settings")
        .select("user_id, push_enabled, email_enabled")
        .eq("notification_type", NOTIFICATION_TYPE)
        .eq("location_id", locationId)
        .in("user_id", activeIds);
      for (const row of prefRows || []) {
        prefs.set(row.user_id, {
          push: row.push_enabled !== false,
          email: row.email_enabled !== false,
        });
      }
    }
    const wantsPush = (id: string) => prefs.get(id)?.push ?? true;
    const wantsEmail = (id: string) => prefs.get(id)?.email ?? true;

    // ── Dedup ledger (per application + channel + recipient) ────────────
    const { data: alreadySent } = await supabase
      .from("application_notify_log")
      .select("channel, recipient")
      .eq("application_id", applicationId);
    const sentKeys = new Set((alreadySent || []).map((r: any) => `${r.channel}|${r.recipient}`));
    const markSent = async (channel: string, recipients: string[]) => {
      if (recipients.length === 0) return;
      await supabase
        .from("application_notify_log")
        .upsert(
          recipients.map((recipient) => ({ application_id: applicationId, channel, recipient })),
          { onConflict: "application_id,channel,recipient", ignoreDuplicates: true },
        );
    };

    const results = { push: 0, email: 0, skippedByPref: 0, skippedDuplicate: 0 };

    // ── Push: position + location only. No applicant PII. ───────────────
    const pushTargets = activeIds.filter((id) => {
      if (!wantsPush(id)) {
        results.skippedByPref++;
        return false;
      }
      if (sentKeys.has(`push|${id}`)) {
        results.skippedDuplicate++;
        return false;
      }
      return true;
    });

    if (pushTargets.length > 0) {
      try {
        const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_ids: pushTargets,
            location_id: locationId,
            notification_type: NOTIFICATION_TYPE,
            title: "New Application",
            body: `${position} — ${locationName}`,
            data: { url: "/hiring", type: NOTIFICATION_TYPE },
          }),
        });
        const pushBody = await pushRes.text();
        if (!pushRes.ok) {
          console.error(`[notify-new-application] push failed [${pushRes.status}]: ${pushBody}`);
        } else {
          results.push = pushTargets.length;
          await markSent("push", pushTargets);
        }
      } catch (pushErr) {
        console.error("[notify-new-application] push threw:", pushErr);
      }
    }

    // ── Email: first name + position + location + login-gated link ──────
    const emailHtml = buildEmailHtml({
      firstName,
      position,
      locationName,
      orgName,
      logoUrl,
      reviewUrl: "https://croohq.com/hiring",
    });

    const emailTargets = activeRecipients.filter((p: any) => {
      if (!p.email) return false;
      if (!wantsEmail(p.id)) {
        results.skippedByPref++;
        return false;
      }
      if (sentKeys.has(`email|${p.id}`)) {
        results.skippedDuplicate++;
        return false;
      }
      return true;
    });

    const queued: string[] = [];
    for (const p of emailTargets) {
      const { error: qErr } = await supabase.from("email_queue").insert({
        from_address: "CrooHQ Hiring <hiring@croohq.email>",
        to_addresses: [p.email],
        subject: `New application — ${position} at ${locationName}`,
        html: emailHtml,
        source: "new_application",
        dedup_key: `new_app_${applicationId}_${p.id}`,
        location_id: locationId,
        metadata: { application_id: applicationId, notification_type: NOTIFICATION_TYPE },
      });
      if (qErr) {
        console.error(`[notify-new-application] email queue failed for ${p.id}:`, qErr);
      } else {
        queued.push(p.id);
      }
    }
    results.email = queued.length;
    await markSent("email", queued);

    console.log(
      `[notify-new-application] ${applicationId}: push=${results.push} email=${results.email} ` +
        `prefSkipped=${results.skippedByPref} dupSkipped=${results.skippedDuplicate}`,
    );
    return json({ success: true, ...results });
  } catch (error) {
    // Never surface a hard failure — the submit must not depend on this.
    console.error("[notify-new-application] unexpected error:", error);
    return json({ success: false, error: String((error as any)?.message || error) }, 200);
  }
});
