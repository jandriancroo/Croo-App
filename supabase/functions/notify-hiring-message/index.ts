import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function queueEmail(opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string; metadata?: Record<string, any> }) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error } = await supabase.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: opts.metadata || {},
  });
  if (error) {
    console.error(`[notify-hiring-message] Queue insert failed:`, error);
    throw error;
  }
  console.log(`[notify-hiring-message] Queued → ${opts.to.join(', ')}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

const systemFontStack = "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:${systemFontStack};"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="width:100%;max-width:720px;margin:0 auto;background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f0ebe1;padding:30px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><div style="display:inline-flex;align-items:center;gap:12px;justify-content:center;"><span style="color:#3a5f7d;font-size:16px;font-weight:400;letter-spacing:-0.2px;">Powered by</span><div style="display:flex;align-items:center;gap:6px;"><span style="color:#1a1a1a;font-size:18px;font-weight:700;letter-spacing:-0.5px;">croo</span></div></div></td></tr></table></td></tr>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Preview mode
    if (body.preview) {
      const previewOrgName = "Blaze Pizza";
      const previewLogoHtml = `<img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:36px;"/>`;
      const previewChatUrl = "https://croohq.com/hiring-chat/preview-token";
      const previewHtml = wrapEmail(`
        <tr><td style="background:${primaryColor};padding:24px 40px;">
          <table role="presentation" style="width:100%;"><tr>
            <td style="width:33%;text-align:left;vertical-align:middle;">${previewLogoHtml}</td>
            <td style="width:34%;text-align:center;vertical-align:middle;">
              <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;font-family:${systemFontStack};text-transform:uppercase;letter-spacing:1px;">💬 New Message</h1>
            </td>
            <td style="width:33%;text-align:right;vertical-align:middle;">
              <span style="color:rgba(255,255,255,0.9);font-size:13px;font-weight:500;">${previewOrgName}</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:${textColor};font-size:15px;margin:0 0 20px;line-height:1.6;">Hi <strong>Jane</strong>,</p>
          <p style="color:${textColor};font-size:15px;margin:0 0 20px;line-height:1.6;">You have a new message from <strong>Marcus Rivera</strong>:</p>
          <div style="background:#fafaf8;border-radius:16px;padding:20px 24px;margin-bottom:28px;border-left:4px solid ${primaryColor};">
            <p style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;font-weight:600;">Message Preview</p>
            <p style="color:${textColor};font-size:15px;line-height:1.6;margin:0;font-style:italic;">"Hey Jane! Thanks for applying. We'd love to bring you in for a quick interview this week. Are you available Thursday or Friday afternoon? Let me know what works best!"</p>
          </div>
          <div style="text-align:center;margin:28px 0;">
            <a href="${previewChatUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.3px;">Reply Now</a>
          </div>
          <p style="color:#999;font-size:12px;text-align:center;margin:0;">Or open: <a href="${previewChatUrl}" style="color:${primaryColor};text-decoration:underline;">${previewChatUrl}</a></p>
        </td></tr>
        ${getEmailFooter()}
      `);
      return new Response(JSON.stringify({ html: previewHtml }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { conversationId, messageContent, senderName } = body;

    if (!conversationId) {
      return new Response(JSON.stringify({ error: "conversationId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up conversation → application → applicant email + org info
    const { data: conversation, error: convError } = await supabase
      .from("hiring_conversations")
      .select("id, access_token, application:job_applications(id, full_name, email, organization_id, organization:organizations(name, brand_name, logo_url))")
      .eq("id", conversationId)
      .single();

    if (convError || !conversation) {
      console.error("[notify-hiring-message] Conversation not found:", convError);
      return new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const application = conversation.application as any;
    const applicantEmail = application?.email;
    const applicantName = application?.full_name || "Applicant";
    const firstName = applicantName.split(" ")[0];
    const org = application?.organization;
    const orgName = org?.brand_name || org?.name || "Croo Hiring";
    const logoUrl = org?.logo_url || "";

    if (!applicantEmail) {
      console.log("[notify-hiring-message] No applicant email, skipping");
      return new Response(JSON.stringify({ success: true, message: "No email on file" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const chatUrl = `https://croohq.lovable.app/hiring-chat/${conversation.access_token}`;
    const preview = messageContent ? messageContent.substring(0, 200) : "(no preview)";
    const sender = senderName || "a hiring manager";

    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:44px;max-width:140px;border-radius:6px;"/>`
      : `<img src="https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp" alt="Croo" style="height:36px;"/>`;

    const subject = `New message from ${orgName}`;

    const emailHtml = wrapEmail(`
      <tr><td style="background:${primaryColor};padding:24px 40px;">
        <table role="presentation" style="width:100%;"><tr>
          <td style="width:33%;text-align:left;vertical-align:middle;">${logoHtml}</td>
          <td style="width:34%;text-align:center;vertical-align:middle;">
            <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;font-family:${systemFontStack};text-transform:uppercase;letter-spacing:1px;">💬 New Message</h1>
          </td>
          <td style="width:33%;text-align:right;vertical-align:middle;">
            <span style="color:rgba(255,255,255,0.9);font-size:13px;font-weight:500;">${orgName}</span>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 40px;">
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;line-height:1.6;">You have a new message from <strong>${sender}</strong>:</p>
        <div style="background:#fafaf8;border-radius:16px;padding:20px 24px;margin-bottom:28px;border-left:4px solid ${primaryColor};">
          <p style="color:#666;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;font-weight:600;">Message Preview</p>
          <p style="color:${textColor};font-size:15px;line-height:1.6;margin:0;font-style:italic;">"${preview}"</p>
        </div>
        <div style="text-align:center;margin:28px 0;">
          <a href="${chatUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:12px;font-weight:700;font-size:15px;letter-spacing:0.3px;">Reply Now</a>
        </div>
        <p style="color:#999;font-size:12px;text-align:center;margin:0;">Or open: <a href="${chatUrl}" style="color:${primaryColor};text-decoration:underline;">${chatUrl}</a></p>
      </td></tr>
      ${getEmailFooter()}
    `);

    await queueEmail({
      from: "CrooHQ Hiring <hiring@croohq.email>",
      to: [applicantEmail],
      subject,
      html: emailHtml,
      source: "hiring_message_notification",
      dedupKey: `hiring_msg_${conversationId}_${Date.now()}`,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[notify-hiring-message] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
