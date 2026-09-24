// @ts-nocheck
// hiring-interview-response
// ---------------------------------------------------------------------------
// Public (anon) endpoint the applicant chat page calls when the applicant
// accepts, declines, or asks for a different time on an interview invite.
//
// Contract:
//   - Client sends ONLY { token, messageId, response }. The token is the
//     conversation access token from the applicant's chat link; everything
//     else is re-fetched server-side with the service role.
//   - Updates the invite bubble + application interview_status, posts the
//     applicant's reply in chat, then emails + pushes location staff:
//     GMs at the location + org-scoped admin/org_admin/super_admin
//     (shift_manager excluded — same audience as new-application alerts).
//   - Staff copy: "Interview accepted by Ryan L at 10:30 AM, September 24th".
//   - Deduped per (message, response, recipient) via email_queue dedup keys.
//   - Notification failures never fail the applicant's response.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFICATION_TYPE = "hiring_interview_response";
const ADMIN_ROLES = ["admin", "org_admin", "super_admin"];
const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const textColor = "#0f1215";
const font = "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function fmtDate(d: string) {
  const [y, mo, da] = d.split("-").map(Number);
  const month = new Date(Date.UTC(y, mo - 1, da, 12)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `${month} ${ordinal(da)}`;
}
function shortName(full: string) {
  const parts = String(full || "Applicant").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}` : parts[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const response = body?.response;
  if (!token || token.length > 200) return json({ error: "token required" }, 400);
  if (!UUID.test(messageId)) return json({ error: "messageId invalid" }, 400);
  if (!["accept", "decline", "reschedule"].includes(response)) return json({ error: "response must be accept, decline, or reschedule" }, 400);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: conv, error: convErr } = await supabase
    .from("hiring_conversations")
    .select("id, application_id")
    .eq("access_token", token)
    .maybeSingle();
  if (convErr) return json({ error: "Lookup failed" }, 503);
  if (!conv) return json({ error: "Conversation not found" }, 404);

  const { data: msg } = await supabase
    .from("hiring_messages")
    .select("id, content, conversation_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.conversation_id !== conv.id || !String(msg.content).startsWith("INTERVIEW_INVITE:")) {
    return json({ error: "Invite not found" }, 404);
  }

  let invite: any;
  try { invite = JSON.parse(String(msg.content).replace("INTERVIEW_INVITE:", "")); } catch { return json({ error: "Invalid invite" }, 400); }
  if (invite.status !== "pending") return json({ error: "This invite has already been answered or cancelled" }, 409);

  const newStatus = response === "accept" ? "accepted" : response === "decline" ? "declined" : "reschedule_requested";
  invite.status = newStatus;

  const { error: updMsgErr } = await supabase
    .from("hiring_messages")
    .update({ content: `INTERVIEW_INVITE:${JSON.stringify(invite)}` })
    .eq("id", messageId);
  if (updMsgErr) return json({ error: updMsgErr.message }, 500);

  // Accept keeps Interviewing; decline keeps the prior behavior (back to Interested);
  // a reschedule ask stays Interviewing so staff can send a new time.
  const appUpdate: any = { interview_status: newStatus };
  if (response === "decline") appUpdate.status = "interested";
  else appUpdate.status = "interviewing";
  const { data: app, error: appErr } = await supabase
    .from("job_applications")
    .update(appUpdate)
    .eq("id", conv.application_id)
    .select("id, full_name, organization_id, location_id")
    .single();
  if (appErr) return json({ error: appErr.message }, 500);

  const replyText =
    response === "accept"
      ? "I've accepted the interview invitation. Looking forward to meeting you!"
      : response === "decline"
        ? "I'm not able to make this interview."
        : "I can't make that time. Could we schedule a different time?";
  await supabase.from("hiring_messages").insert({
    conversation_id: conv.id,
    sender_type: "applicant",
    sender_id: null,
    content: replyText,
  }).then(({ error }) => { if (error) console.error("[interview-response] reply insert failed", error); });

  // ── Staff notifications (never fail the response) ───────────────────
  const notify = { push: 0, email: 0 };
  try {
    const who = shortName(app.full_name);
    const when = invite.date && invite.time ? `${fmtTime(invite.time)}, ${fmtDate(invite.date)}` : "";
    const headline =
      response === "accept"
        ? `Interview accepted by ${who}${when ? ` at ${when}` : ""}`
        : response === "decline"
          ? `Interview declined by ${who}${when ? ` (${when})` : ""}`
          : `${who} asked to reschedule${when ? ` the ${when} interview` : " their interview"}`;

    const locationId = app.location_id;
    const orgId = app.organization_id;
    const ids = new Set<string>();
    if (locationId) {
      const { data: lu } = await supabase.from("user_locations").select("user_id").eq("location_id", locationId);
      const locIds = (lu || []).map((r: any) => r.user_id);
      if (locIds.length) {
        const { data: gm } = await supabase.from("user_roles").select("user_id").eq("role", "general_manager").in("user_id", locIds);
        for (const r of gm || []) ids.add(r.user_id);
      }
    }
    if (orgId) {
      const { data: ar } = await supabase.from("user_roles").select("user_id").in("role", ADMIN_ROLES);
      const cand = [...new Set((ar || []).map((r: any) => r.user_id))];
      if (cand.length) {
        const { data: mem } = await supabase.from("organization_members").select("user_id").eq("organization_id", orgId).in("user_id", cand);
        for (const m of mem || []) ids.add(m.user_id);
        const { data: ol } = await supabase.from("locations").select("id").eq("organization_id", orgId);
        const olIds = (ol || []).map((l: any) => l.id);
        if (olIds.length) {
          const { data: as } = await supabase.from("user_locations").select("user_id").in("location_id", olIds).in("user_id", cand);
          for (const a of as || []) ids.add(a.user_id);
        }
      }
    }
    const candidateIds = [...ids];
    if (candidateIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, email, is_active").in("id", candidateIds);
      const active = (profiles || []).filter((p: any) => p.is_active !== false);
      const activeIds = active.map((p: any) => p.id);

      const prefs = new Map<string, { push: boolean; email: boolean }>();
      if (locationId && activeIds.length) {
        const { data: pr } = await supabase
          .from("user_notification_settings")
          .select("user_id, push_enabled, email_enabled")
          .eq("notification_type", NOTIFICATION_TYPE)
          .eq("location_id", locationId)
          .in("user_id", activeIds);
        for (const r of pr || []) prefs.set(r.user_id, { push: r.push_enabled !== false, email: r.email_enabled !== false });
      }

      const pushIds = activeIds.filter((id: string) => prefs.get(id)?.push ?? true);
      if (pushIds.length) {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            user_ids: pushIds,
            location_id: locationId,
            notification_type: NOTIFICATION_TYPE,
            title: response === "accept" ? "Interview accepted" : response === "decline" ? "Interview declined" : "Reschedule requested",
            body: headline,
            data: { url: `/messages?tab=hiring&applicationId=${app.id}`, type: NOTIFICATION_TYPE, conversation_id: conv.id },
          }),
        });
        const t = await res.text();
        if (!res.ok) console.error(`[interview-response] push failed [${res.status}]: ${t}`);
        else notify.push = pushIds.length;
      }

      const link = `https://croohq.com/messages?tab=hiring&applicationId=${app.id}`;
      const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0ebe1;font-family:${font};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:600px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;">
        <tr><td style="background:${primaryColor};padding:22px 32px;"><h1 style="color:#fff;font-size:20px;margin:0;">${esc(response === "accept" ? "Interview Accepted" : response === "decline" ? "Interview Declined" : "Reschedule Requested")}</h1></td></tr>
        <tr><td style="padding:28px 32px;"><p style="color:${textColor};font-size:16px;margin:0 0 24px;line-height:1.5;"><strong>${esc(headline)}</strong></p>
        ${response === "reschedule" ? `<p style="color:#555;font-size:14px;margin:0 0 24px;">Open the chat to send a new time.</p>` : ""}
        <div style="text-align:center;"><a href="${link}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;">Open hiring chat</a></div></td></tr>
        </table></td></tr></table></body></html>`;

      for (const p of active) {
        if (!p.email || !(prefs.get(p.id)?.email ?? true)) continue;
        const { error } = await supabase.from("email_queue").insert({
          from_address: "CrooHQ Hiring <hiring@croohq.email>",
          to_addresses: [p.email],
          subject: headline,
          html,
          source: `interview_${newStatus}`,
          dedup_key: `interview_resp_${messageId}_${newStatus}_${p.id}`,
          metadata: {},
        });
        if (error && (error as any).code !== "23505") console.error("[interview-response] email queue failed", error);
        else if (!error) notify.email++;
      }
    }
  } catch (e) {
    console.error("[interview-response] notify threw", e);
  }

  return json({ success: true, status: newStatus, notify });
});
