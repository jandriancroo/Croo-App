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
    console.error(`[hiring-message-notification] Queue insert failed for "${opts.subject}":`, error);
    throw error;
  }
  console.log(`[hiring-message-notification] Queued: "${opts.subject}" → ${opts.to.join(', ')}`);
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

function getEmailHeader(title: string): string {
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:16px;">Open Croo</a><p style="color:#aaa;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { conversation_id, applicant_email, applicant_name, sender_name, message_preview, organization_name } = payload;

    if (!conversation_id || !applicant_email) {
      return new Response(JSON.stringify({ error: "conversation_id and applicant_email required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const subject = `💬 New message from ${organization_name || "Croo Hiring"}`;
    const preview = message_preview ? message_preview.substring(0, 150) : "(no preview)";

    const content = `
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">You have a new message from <strong>${sender_name || "a hiring manager"}</strong>.</p>
      <div style="background:${backgroundColor};border-radius:10px;padding:16px;margin-bottom:24px;border-left:4px solid ${primaryColor};">
        <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Message Preview</p>
        <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;font-style:italic;">"${preview}"</p>
      </div>
      <p style="color:${textColor};font-size:15px;margin:0 0 20px;">Open the Croo app to read the full message and respond.</p>
    `;

    const emailHtml = wrapEmail(`
      ${getEmailHeader("📬 New Hiring Message")}
      <tr><td style="padding:30px 40px;">${content}<div style="margin-top:24px;">${getCTAButton("https://croohq.com", "Open Croo")}</div></td></tr>
      ${getEmailFooter()}
    `);

    await queueEmail({
      from: "CrooHQ Hiring <hiring@croohq.email>",
      to: [applicant_email],
      subject,
      html: emailHtml,
      source: "hiring_message_notification",
      dedupKey: `hiring_msg_${conversation_id}_${Date.now()}`,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[notify-hiring-message] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
