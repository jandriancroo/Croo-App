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

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><p style="color:#aaa;font-size:11px;margin:0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { conversationId, messageContent, senderName } = await req.json();

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
      ? `<img src="${logoUrl}" alt="${orgName}" style="max-height:60px;max-width:160px;margin-bottom:12px;border-radius:8px;"/>`
      : `<img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/>`;

    const subject = `💬 New message from ${orgName}`;

    const emailHtml = wrapEmail(`
      <tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;">
        ${logoHtml}
        <h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">📬 New Message</h1>
        <p style="color:rgba(255,255,255,0.9);font-size:14px;margin:8px 0 0;">${orgName}</p>
      </td></tr>
      <tr><td style="padding:30px 40px;">
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Hi ${firstName},</p>
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">You have a new message from <strong>${sender}</strong>:</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:16px;margin-bottom:24px;border-left:4px solid ${primaryColor};">
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;font-style:italic;">"${preview}"</p>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${chatUrl}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Reply Now</a>
        </div>
        <p style="color:#888;font-size:13px;text-align:center;">Or open this link: ${chatUrl}</p>
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
